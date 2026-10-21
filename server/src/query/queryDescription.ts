import { assertSelectOnlySql } from "./selectOnlySql.js";

// Native types are explicit evidence supplied by a future server-side caller.
// Generic Dataset NUMBER/STRING types alone must not be guessed into these types.
export type DescriptionParameterType =
  | { type: "INT" | "BIGINT" | "BIT" | "FLOAT" | "DATE" | "DATETIME2" }
  | { type: "NVARCHAR" | "VARCHAR" | "VARBINARY"; length: number | "MAX" }
  | { type: "DECIMAL"; precision: number; scale: number };

export type DescribeQueryInput = {
  sql: string;
  parameters: readonly { name: string; nativeType: DescriptionParameterType }[];
  timeoutSec: number;
};

export type DescriptionColumn = Readonly<{ name: string; dataType: string; ordinal: number }>;
export type CandidateQueryDescription = Readonly<{
  trust: "UNBOUND_CANDIDATE";
  evidenceType: "SQLSERVER_DESCRIBE_FIRST_RESULT_SET" | "ORACLE_STATEMENT_INFO";
  requiresExecutionComparison: true;
  columns: readonly DescriptionColumn[];
}>;

type DescriptionErrorCode = "DESCRIPTION_INVALID_INPUT" | "DESCRIPTION_SELECT_ONLY"
  | "DESCRIPTION_PARAMETER_UNSUPPORTED" | "DESCRIPTION_METADATA_INVALID"
  | "DESCRIPTION_UNSUPPORTED" | "DESCRIPTION_FAILED" | "DESCRIPTION_TIMEOUT"
  | "DESCRIPTION_CLEANUP_FAILED";

export class QueryDescriptionError extends Error {
  constructor(readonly code: DescriptionErrorCode) {
    super(code);
    this.name = "QueryDescriptionError";
  }
}

export function descriptionError(error: unknown): QueryDescriptionError {
  // Never attach a driver cause: it can contain SQL, credentials or result values.
  return error instanceof QueryDescriptionError ? error : new QueryDescriptionError("DESCRIPTION_FAILED");
}

function sqlServerType(value: DescriptionParameterType): string {
  if (!value || typeof value !== "object") throw new QueryDescriptionError("DESCRIPTION_PARAMETER_UNSUPPORTED");
  switch (value.type) {
    case "INT": return "int";
    case "BIGINT": return "bigint";
    case "BIT": return "bit";
    case "FLOAT": return "float";
    case "DATE": return "date";
    case "DATETIME2": return "datetime2";
    case "NVARCHAR": case "VARCHAR": case "VARBINARY": {
      const limit = value.type === "NVARCHAR" ? 4000 : 8000;
      if (value.length !== "MAX" && (!Number.isInteger(value.length) || value.length < 1 || value.length > limit)) break;
      const type = { NVARCHAR: "nvarchar", VARCHAR: "varchar", VARBINARY: "varbinary" }[value.type];
      return `${type}(${value.length === "MAX" ? "max" : value.length})`;
    }
    case "DECIMAL":
      if (Number.isInteger(value.precision) && value.precision >= 1 && value.precision <= 38
        && Number.isInteger(value.scale) && value.scale >= 0 && value.scale <= value.precision) {
        return `decimal(${value.precision},${value.scale})`;
      }
  }
  throw new QueryDescriptionError("DESCRIPTION_PARAMETER_UNSUPPORTED");
}

export function compileDescription(input: DescribeQueryInput, source: "SQLSERVER" | "ORACLE") {
  if (!input || typeof input.sql !== "string" || !Array.isArray(input.parameters)
    || !Number.isInteger(input.timeoutSec) || input.timeoutSec < 1 || input.timeoutSec > 30) {
    throw new QueryDescriptionError("DESCRIPTION_INVALID_INPUT");
  }
  try { assertSelectOnlySql(input.sql); } catch { throw new QueryDescriptionError("DESCRIPTION_SELECT_ONLY"); }

  // Conservative lexer: quoted tokens, comments, alternate Oracle quoting and
  // unmanaged native binds are unsupported, rather than compiled ambiguously.
  const tokens = new Set<string>();
  const sql = input.sql.replace(/'(?:''|[^'])*'|"(?:""|[^"])*"|\[(?:\]\]|[^\]])*\]|\{\{[A-Z][A-Z0-9_]*\}\}|--|\/\*|[@:]|[{}]/g, part => {
    if (part.startsWith("{{") && part.endsWith("}}")) {
      const name = part.slice(2, -2);
      tokens.add(name);
      return source === "SQLSERVER" ? `@${name}` : `:${name}`;
    }
    if ((part.startsWith("'") || part.startsWith('"') || part.startsWith("[")) && !part.includes("{{")) return part;
    throw new QueryDescriptionError("DESCRIPTION_PARAMETER_UNSUPPORTED");
  });
  const names = new Set<string>();
  const declarations: string[] = [];
  for (const parameter of input.parameters) {
    if (!parameter || typeof parameter.name !== "string" || !/^[A-Z][A-Z0-9_]{0,126}$/.test(parameter.name)
      || names.has(parameter.name) || !tokens.has(parameter.name)) {
      throw new QueryDescriptionError("DESCRIPTION_PARAMETER_UNSUPPORTED");
    }
    names.add(parameter.name);
    declarations.push(`@${parameter.name} ${sqlServerType(parameter.nativeType)}`);
  }
  if (tokens.size !== names.size || (source === "ORACLE" && tokens.size !== 0)) {
    throw new QueryDescriptionError("DESCRIPTION_PARAMETER_UNSUPPORTED");
  }
  // Reject unmatched/alternate quoting rather than letting the lexer interpret
  // a token in it as a bind. Native parser still determines final validity.
  if (/\b[qQ]'/.test(input.sql)) throw new QueryDescriptionError("DESCRIPTION_PARAMETER_UNSUPPORTED");
  return { sql, parameterDeclaration: declarations.length ? declarations.join(", ") : null };
}

export function candidateDescription(
  evidenceType: CandidateQueryDescription["evidenceType"], columns: readonly DescriptionColumn[],
): CandidateQueryDescription {
  if (!Array.isArray(columns) || columns.length === 0) throw new QueryDescriptionError("DESCRIPTION_METADATA_INVALID");
  const names = new Set<string>();
  const projected = columns.map((column, index) => {
    if (!column || typeof column.name !== "string" || !column.name.trim() || column.name !== column.name.trim()
      || typeof column.dataType !== "string" || !column.dataType.trim() || /^(?:DB_TYPE_)?UNKNOWN$/i.test(column.dataType)
      || column.ordinal !== index + 1
      || names.has(column.name.toUpperCase())) throw new QueryDescriptionError("DESCRIPTION_METADATA_INVALID");
    names.add(column.name.toUpperCase());
    return Object.freeze({ name: column.name, dataType: column.dataType, ordinal: column.ordinal });
  });
  return Object.freeze({ trust: "UNBOUND_CANDIDATE", evidenceType, requiresExecutionComparison: true,
    columns: Object.freeze(projected) });
}

export async function descriptionDeadline<T>(operation: Promise<T>, timeoutMs: number, cancel?: () => Promise<unknown>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        if (cancel) void Promise.resolve().then(cancel).catch(() => undefined);
        reject(new QueryDescriptionError("DESCRIPTION_TIMEOUT"));
      }, timeoutMs);
    })]);
  } finally { clearTimeout(timer); }
}

// A connection acquired after our deadline must also be released. No SQL is
// submitted on a timed-out connection, even if acquisition later succeeds.
export async function acquireDescriptionConnection<T>(
  open: () => Promise<T>, close: (connection: T) => Promise<unknown>, timeoutMs: number,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let expired = false;
    const timer = setTimeout(() => {
      expired = true;
      reject(new QueryDescriptionError("DESCRIPTION_TIMEOUT"));
    }, timeoutMs);
    void Promise.resolve().then(open).then(connection => {
      if (expired) {
        void Promise.resolve().then(() => close(connection)).catch(() => undefined);
      } else {
        clearTimeout(timer);
        resolve(connection);
      }
    }, error => { clearTimeout(timer); reject(error); });
  });
}
