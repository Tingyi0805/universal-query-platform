// Conservative V1 semantic verifier for an intentionally tiny SQL grammar.
// No data is executed, fetched or revealed. This does NOT authorize CHART by
// itself; Query/ACL, Dataset/public display, audit and snapshot checks remain
// separate mandatory gates. Production's verified-aggregate reader is OFF.
import { createHash } from "node:crypto";
import type { VerifiedQueryAggregate } from "./dashboardChartApproval.policy.js";

type Dialect = "SQLSERVER" | "ORACLE";
type Token = { kind: "ident" | "punct"; text: string; quoted: boolean };
type Identifier = { text: string; quoted: boolean };
const word = /^[A-Za-z_][A-Za-z0-9_]{0,127}/;
const square = /^\[[A-Za-z_][A-Za-z0-9_]{0,127}\]/;
const doubleQuote = /^"[A-Za-z_][A-Za-z0-9_]{0,127}"/;
const reserved = new Set(["SELECT", "FROM", "AS", "GROUP", "BY", "COUNT", "WHERE",
  "JOIN", "ON", "INNER", "OUTER", "LEFT", "RIGHT", "CROSS", "FULL", "ORDER",
  "HAVING", "UNION", "EXCEPT", "INTERSECT", "MINUS", "ALL", "DISTINCT",
  "WITH", "TOP", "LIMIT", "OFFSET", "FETCH", "OVER", "PARTITION", "WINDOW",
  "CONNECT", "START", "MODEL", "QUALIFY", "PIVOT", "UNPIVOT", "SUM", "AVG",
  "MIN", "MAX", "NULL", "CASE", "WHEN", "THEN", "END", "IS", "IN"]);
function tokenize(sql: string, dialect: Dialect): Token[] | null {
  if (typeof sql !== "string" || !sql.length || sql.length > 2048) return null;
  const tokens: Token[] = [];
  let offset = 0;
  while (offset < sql.length) {
    const rest = sql.slice(offset);
    const ws = /^\s+/u.exec(rest);
    if (ws) { offset += ws[0].length; continue; }
    const bracket = dialect === "SQLSERVER" ? square.exec(rest) : null;
    const quoted = dialect === "ORACLE" ? doubleQuote.exec(rest) : null;
    const unquoted = word.exec(rest);
    const match = bracket ?? quoted ?? unquoted;
    if (match) {
      const raw = match[0];
      const isQuoted = Boolean(bracket || quoted);
      tokens.push({ kind: "ident", text: isQuoted ? raw.slice(1, -1) : raw, quoted: isQuoted });
      offset += raw.length;
    } else if (/^[*(),.;]/u.test(rest)) {
      tokens.push({ kind: "punct", text: rest[0]!, quoted: false });
      offset++;
    } else return null; // Comments, string literals, binds, operators, quoted escapes, etc.
    if (tokens.length > 100) return null;
  }
  return tokens;
}
class ClosedCountParser {
  private i = 0;
  constructor(private readonly tokens: Token[], private readonly dialect: Dialect) {}
  private token() { return this.tokens[this.i]; }
  private keyword(value: string) {
    const tok = this.token();
    return tok?.kind === "ident" && !tok.quoted && tok.text.toUpperCase() === value;
  }
  private requireKeyword(value: string) {
    if (!this.keyword(value)) throw Error("CHART_SQL_NOT_PROVEN");
    this.i++;
  }
  private punctuation(value: string) {
    if (this.token()?.kind !== "punct" || this.token()?.text !== value)
      throw Error("CHART_SQL_NOT_PROVEN");
    this.i++;
  }
  private identifier(): Identifier {
    const tok = this.token();
    if (tok?.kind !== "ident" || !tok.text || (!tok.quoted && reserved.has(tok.text.toUpperCase())))
      throw Error("CHART_SQL_NOT_PROVEN");
    this.i++;
    return { text: tok.text, quoted: tok.quoted };
  }
  private normalizedName(id: Identifier) {
    // SQL Server identifiers can be collation-sensitive. Require exact text
    // equality for SQLSERVER even for unquoted references.
    return this.dialect === "ORACLE" && !id.quoted ? id.text.toUpperCase() : id.text;
  }
  parse(): { category: string; value: string } {
    this.requireKeyword("SELECT");
    const groupedColumn = this.identifier();
    this.requireKeyword("AS");
    const categoryAlias = this.identifier();
    this.punctuation(",");
    this.requireKeyword("COUNT");
    this.punctuation("(");
    this.punctuation("*");
    this.punctuation(")");
    this.requireKeyword("AS");
    const countAlias = this.identifier();
    if (this.normalizedName(categoryAlias) === this.normalizedName(countAlias))
      throw Error("CHART_SQL_NOT_PROVEN");
    this.requireKeyword("FROM");
    this.identifier();
    if (this.token()?.text === ".") {
      this.punctuation(".");
      this.identifier();
    }
    this.requireKeyword("GROUP");
    this.requireKeyword("BY");
    const groupedReference = this.identifier();
    if (this.normalizedName(groupedColumn) !== this.normalizedName(groupedReference) ||
        groupedColumn.quoted !== groupedReference.quoted)
      throw Error("CHART_SQL_NOT_PROVEN");
    if (this.token()?.text === ";") this.punctuation(";");
    if (this.i !== this.tokens.length) throw Error("CHART_SQL_NOT_PROVEN");
    return { category: this.normalizedName(categoryAlias), value: this.normalizedName(countAlias) };
  }
}

export type GroupedCountProofInput = {
  dialect: Dialect;
  sqlText: string;
  queryId: number;
  datasetId: number;
  queryRevision: string;
  datasetRevision: string;
  categoryColumn: string;
  valueColumn: string;
};

/** Closed grammar (V1):
 * SELECT <column> AS <category>, COUNT(*) AS <value>
 * FROM [schema.]<single table> GROUP BY <same column> [;]
 *
 * No joins, predicates, subqueries, CTE, arbitrary functions, DISTINCT,
 * HAVING, ORDER BY, extra columns, comments, or templated binds.
 * This only proves COUNT(*) grouped by a single expression at the SQL text
 * level; it does not prove the source field is nonsensitive or public-safe.
 */
export function proveSimpleGroupedCount(input: GroupedCountProofInput): VerifiedQueryAggregate | null {
  if (!input || !["SQLSERVER", "ORACLE"].includes(input.dialect) ||
      !Number.isSafeInteger(input.queryId) || input.queryId < 1 ||
      !Number.isSafeInteger(input.datasetId) || input.datasetId < 1 ||
      !/^[0-9a-f]{16}$/.test(input.queryRevision) ||
      !/^[0-9a-f]{16}$/.test(input.datasetRevision) ||
      typeof input.categoryColumn !== "string" || typeof input.valueColumn !== "string") return null;
  const tokens = tokenize(input.sqlText, input.dialect);
  if (!tokens) return null;
  let parsed: { category: string; value: string };
  try { parsed = new ClosedCountParser(tokens, input.dialect).parse(); }
  catch { return null; }
  if (parsed.category !== input.categoryColumn || parsed.value !== input.valueColumn) return null;
  const evidenceVersion = createHash("sha256").update(JSON.stringify([
    "CHART_SIMPLE_GROUPED_COUNT_V1", input.dialect, input.sqlText,
    input.queryId, input.datasetId, input.queryRevision, input.datasetRevision,
    parsed.category, parsed.value,
  ])).digest("hex");
  return {
    verified: true, queryId: input.queryId, datasetId: input.datasetId,
    queryRevision: input.queryRevision, datasetRevision: input.datasetRevision,
    categoryColumn: parsed.category, valueColumn: parsed.value, evidenceVersion,
  };
}
