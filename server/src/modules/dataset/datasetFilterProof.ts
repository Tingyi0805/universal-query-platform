import { createHash } from "node:crypto";
import { compileUnboundDescription } from "../../query/queryDescription.js";
import { detectParameterNames } from "./parameterSync.js";

// This is a deliberately closed recognizer, not a general SQL equivalence
// engine. Only direct column projections over fixed table sources are proved.
// Reject expressions, stars, CTEs, subqueries, functions, row limits, aggregates,
// comments and dialect extensions rather than treating equal aliases as lineage.
type Token = { raw: string; kind: "word" | "identifier" | "literal" | "parameter" | "symbol" };
type Predicate = { key: string; filterOnly: boolean; terms?: Predicate[] };
const unsupported = (): never => { throw new Error("UNPROVEN_SQL_CHANGE"); };
const reserved = new Set(("SELECT FROM WHERE AS AND OR NOT BETWEEN IN IS NULL LIKE JOIN INNER LEFT RIGHT FULL OUTER CROSS ON ORDER BY ASC DESC " +
  "WITH UNION INTERSECT EXCEPT MINUS GROUP HAVING DISTINCT ALL TOP LIMIT OFFSET FETCH FOR CONNECT START MODEL QUALIFY WINDOW OVER " +
  "CASE WHEN THEN ELSE END APPLY USING NATURAL PIVOT UNPIVOT TABLESAMPLE MATCH_RECOGNIZE COLLATE INTO").split(" "));
function tokenize(sql: string): Token[] {
  const tokens: Token[] = [];
  const pattern = /\s+|\{\{[A-Z][A-Z0-9_]*\}\}|'(?:''|[^'])*'|"(?:""|[^"])+"|\[(?:\]\]|[^\]])+\]|[\p{L}_][\p{L}\p{N}_$#]*|\d+(?:\.\d+)?|<>|!=|<=|>=|[.,()=<>;+\-]/uy;
  let offset = 0;
  while (offset < sql.length) {
    pattern.lastIndex = offset;
    const match = pattern.exec(sql);
    if (!match) return unsupported();
    const raw = match[0]; offset = pattern.lastIndex;
    if (/^\s/.test(raw)) continue;
    const kind = raw.startsWith("{{") ? "parameter" : raw.startsWith("'") || /^\d/.test(raw) ? "literal"
      : raw.startsWith('"') || raw.startsWith("[") ? "identifier" : /^[\p{L}_]/u.test(raw) ? "word" : "symbol";
    tokens.push({ raw, kind });
    if (tokens.length > 10000) return unsupported();
  }
  if (tokens.at(-1)?.raw === ";") tokens.pop();
  return tokens;
}
// Fixed-size subtree identities avoid exponential escaping for nested booleans.
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const key = (tokens: Token[]) => digest(tokens.map(t => [t.kind, t.raw]));
function identifierName(token: Token): string {
  if (token.kind !== "identifier") return token.raw;
  const text = token.raw.slice(1, -1);
  return token.raw.startsWith('"') ? text.replace(/""/g, '"') : text.replace(/\]\]/g, "]");
}
class Parser {
  i = 0;
  aliases = new Set<string>();
  references: string[][] = [];
  constructor(readonly tokens: Token[]) {}
  peek(word: string) { return this.tokens[this.i]?.raw.toUpperCase() === word; }
  take(word: string) { if (!this.peek(word)) return false; this.i++; return true; }
  need(word: string) { if (!this.take(word)) unsupported(); }
  isIdentifier() { const t = this.tokens[this.i]; return t?.kind === "identifier" || t?.kind === "word" && !reserved.has(t.raw.toUpperCase()); }
  identifier() { if (!this.isIdentifier()) return unsupported(); return this.tokens[this.i++]!; }
  column() {
    const parts = [identifierName(this.identifier())];
    if (this.take(".")) parts.push(identifierName(this.identifier()));
    if (this.peek(".")) return unsupported();
    this.references.push(parts);
    return parts;
  }
  table() {
    let name = identifierName(this.identifier());
    let parts = 1;
    while (this.take(".")) { name = identifierName(this.identifier()); if (++parts > 3) unsupported(); }
    if (this.take("AS") || this.isIdentifier()) name = identifierName(this.identifier());
    if (this.aliases.has(name)) unsupported();
    this.aliases.add(name);
  }
  operand(): boolean {
    if (["literal", "parameter"].includes(this.tokens[this.i]?.kind ?? "")) { this.i++; return false; }
    if (this.take("NULL")) return false;
    if (this.take("-") || this.take("+")) {
      if (this.tokens[this.i]?.kind !== "literal" || !/^\d/.test(this.tokens[this.i]!.raw)) return unsupported();
      this.i++; return false;
    }
    this.column(); return true;
  }
  atom(depth: number): Predicate {
    if (depth > 32) return unsupported();
    const start = this.i;
    if (this.take("(")) { const result = this.boolean(depth + 1); this.need(")"); return result; }
    if (this.take("NOT")) {
      const inner = this.atom(depth + 1);
      return { key: digest(["NOT", inner.key]), filterOnly: inner.filterOnly };
    }
    // New filters must compare a column with bind/literal values. Existing
    // column-to-column join predicates can be retained but cannot be added.
    this.column();
    let filterOnly = true;
    if (this.take("IS")) { this.take("NOT"); this.need("NULL"); }
    else {
      const negated = this.take("NOT");
      if (this.take("BETWEEN")) { const first = this.operand(); this.need("AND"); const last = this.operand(); filterOnly = !first && !last; }
      else if (this.take("IN")) {
        this.need("(");
        do { const column = this.operand(); filterOnly = !column && filterOnly; } while (this.take(","));
        this.need(")");
      } else if (this.take("LIKE")) filterOnly = !this.operand();
      else {
        if (negated || !["=", "<>", "!=", "<", ">", "<=", ">="].some(op => this.take(op))) return unsupported();
        filterOnly = !this.operand();
      }
    }
    return { key: key(this.tokens.slice(start, this.i)), filterOnly };
  }
  boolean(depth = 0): Predicate {
    const conjunction = () => {
      const terms = [this.atom(depth)];
      while (this.take("AND")) terms.push(this.atom(depth));
      if (terms.length === 1) return terms[0]!;
      const flat = terms.flatMap(t => t.terms ?? [t]);
      return { key: digest(["AND", ...flat.map(t => t.key)]), filterOnly: flat.every(t => t.filterOnly), terms: flat };
    };
    const parts = [conjunction()];
    while (this.take("OR")) parts.push(conjunction());
    return parts.length === 1 ? parts[0]! : { key: digest(["OR", ...parts.map(t => t.key)]), filterOnly: parts.every(t => t.filterOnly) };
  }
  parse() {
    this.need("SELECT");
    const outputs: string[] = [];
    do {
      const path = this.column();
      let name = path.at(-1)!;
      if (this.take("AS") || this.isIdentifier()) name = identifierName(this.identifier());
      if (outputs.some(n => n.toUpperCase() === name.toUpperCase())) return unsupported();
      outputs.push(name);
    } while (this.take(","));
    this.need("FROM"); this.table();
    while (!this.peek("WHERE") && !this.peek("ORDER") && this.i < this.tokens.length) {
      if (this.take(",")) { this.table(); continue; }
      if (this.take("INNER")) this.need("JOIN");
      else if (this.take("LEFT") || this.take("RIGHT") || this.take("FULL")) { this.take("OUTER"); this.need("JOIN"); }
      else this.need("JOIN");
      this.table(); this.need("ON"); this.boolean();
    }
    const prefix = key(this.tokens.slice(0, this.i));
    const predicate = this.take("WHERE") ? this.boolean() : null;
    const suffixStart = this.i;
    if (this.take("ORDER")) {
      this.need("BY");
      do { this.column(); this.take("ASC") || this.take("DESC"); } while (this.take(","));
    }
    if (this.i !== this.tokens.length || this.references.some(parts => parts.length !== 2 || !this.aliases.has(parts[0]!))) return unsupported();
    return { prefix, predicate, suffix: key(this.tokens.slice(suffixStart)), outputs };
  }
}
export function proveDatasetFilterChange(before: string, after: string, ruleColumns: string[]) {
  try {
    if (before.length > 200000 || after.length > 200000) return null;
    for (const sql of [before, after]) {
      const parameterNames = detectParameterNames(sql);
      // Reuse the existing SELECT-only/strict quoting/template guard. No metadata
      // query or driver access grants semantic authority to this local proof.
      compileUnboundDescription({ purpose: "COLUMN_OPTIONS_ONLY", sql, parameterNames, timeoutSec: 1 }, "SQLSERVER");
    }
    const old = new Parser(tokenize(before)).parse(), next = new Parser(tokenize(after)).parse();
    if (old.prefix !== next.prefix || old.suffix !== next.suffix || !next.predicate ||
        ruleColumns.some(name => !old.outputs.some(output => output.toUpperCase() === name.toUpperCase()))) return null;
    const retained = [...(old.predicate?.terms ?? (old.predicate ? [old.predicate] : []))];
    const added: Predicate[] = [];
    for (const term of next.predicate.terms ?? [next.predicate]) {
      const index = retained.findIndex(oldTerm => oldTerm.key === term.key);
      if (index >= 0) retained.splice(index, 1); else added.push(term);
    }
    if (retained.length || added.some(term => !term.filterOnly)) return null;
    return { kind: "ROW_FILTER_REFINEMENT" as const, parameterNames: detectParameterNames(after) };
  } catch { return null; }
}
