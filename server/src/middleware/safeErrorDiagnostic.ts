export type ErrorModule = "dataset.parameters.read" | "dataset.parameters.sync" | "dataset.parameters.save" |
  "dataset.load" | "dataset.parameters.load" | "dataset.parameters.validate" | "dataset.query.compile" |
  "dataset.query.execute" | "datasource.load" | "query.patient.disclosure" | "dataset.columns.sync" | "request";
const modules = new WeakMap<object, ErrorModule>();
export async function withErrorModule<T>(module: ErrorModule, operation: () => Promise<T>): Promise<T> {
  try { return await operation(); } catch (error) {
    if (error && typeof error === "object" && !modules.has(error)) modules.set(error, module);
    throw error;
  }
}
const driverCodes = new Set(["EREQUEST", "ETIMEOUT", "ELOGIN", "ECONNCLOSED", "ENOTOPEN", "ESOCKET", "ECONNRESET", "ENOCONN", "EARGS"]);
const applicationCodes = new Set(["PLATFORM_DB_NOT_CONFIGURED", "PARAMETER_DEFINITION_MISMATCH", "PARAMETER_PARSE_FAILED",
  "PARAMETER_PREVIEW_STALE", "PARAMETER_REMOVAL_INVALID", "PARAMETER_SYNC_LIMIT", "MISSING_QUERY_PARAMETER", "QUOTED_QUERY_PARAMETER",
  "PARAMETER_REQUIRED", "PARAMETER_NUMBER_INVALID", "PARAMETER_BOOLEAN_INVALID", "PARAMETER_DATE_INVALID", "PARAMETER_DATETIME_INVALID"]);
export function safeErrorDiagnostic(error: unknown) {
  const e = (error && typeof error === "object" ? error : {}) as {
    code?: unknown; number?: unknown; originalError?: { info?: { number?: unknown } }; message?: unknown;
  };
  const number = e.number ?? e.originalError?.info?.number;
  const sqlServerNumber = typeof number === "number" && Number.isSafeInteger(number) && number > 0 && number <= 999999 ? number : undefined;
  const driverCode = typeof e.code === "string" && driverCodes.has(e.code) ? e.code : undefined;
  const messageCode = typeof e.message === "string" ? e.message.split(":", 1)[0]! : "";
  const applicationCode = applicationCodes.has(messageCode) ? messageCode : undefined;
  return { module: modules.get(e) ?? "request", errorType: driverCode || sqlServerNumber ? "DATABASE" : applicationCode ? "APPLICATION" :
      error instanceof TypeError ? "TYPE_ERROR" : error instanceof RangeError ? "RANGE_ERROR" : error instanceof SyntaxError ? "SYNTAX_ERROR" : "UNEXPECTED",
    ...(driverCode ? { driverCode } : {}), ...(sqlServerNumber ? { sqlServerNumber } : {}), ...(applicationCode ? { applicationCode } : {}) };
}

export function safeAuditErrorCode(error: unknown): string {
  const diagnostic = safeErrorDiagnostic(error);
  return diagnostic.applicationCode ?? (diagnostic.driverCode
    ? `${diagnostic.driverCode}${diagnostic.sqlServerNumber ? `:${diagnostic.sqlServerNumber}` : ""}`
    : diagnostic.sqlServerNumber ? `SQLSERVER:${diagnostic.sqlServerNumber}` : "INTERNAL_SERVER_ERROR");
}
