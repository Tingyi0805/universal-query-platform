import type { DataSourceType } from "../modules/datasource/datasource.types.js";

const tokenRegex = /\{\{([A-Z][A-Z0-9_]*)\}\}/g;

export function extractParameterNames(sqlText: string): string[] {
  return [...new Set(Array.from(sqlText.matchAll(tokenRegex), (match) => match[1]))];
}

export function compileQuery(
  sqlText: string,
  type: DataSourceType,
  values: Record<string, unknown>,
): { sql: string; binds: Record<string, unknown>; parameterNames: string[] } {
  const parameterNames = extractParameterNames(sqlText);
  const binds: Record<string, unknown> = {};

  for (const name of parameterNames) {
    if (!(name in values)) throw new Error(`MISSING_QUERY_PARAMETER:${name}`);
    binds[name] = values[name];
  }

  const sql = sqlText.replace(tokenRegex, (_whole, name: string) =>
    type === "SQLSERVER" ? `@${name}` : `:${name}`
  );

  return { sql, binds, parameterNames };
}
