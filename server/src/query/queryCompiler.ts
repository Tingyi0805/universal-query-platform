import type { DataSourceType } from "../modules/datasource/datasource.types.js";

const tokenRegex = /\{\{([A-Z][A-Z0-9_]*)\}\}/g;

export function extractParameterNames(sqlText: string): string[] {
  return [...new Set(Array.from(sqlText.matchAll(tokenRegex), (match) => match[1]))];
}

export function compileQuery(
  sqlText: string,
  type: DataSourceType,
  values: Record<string, unknown>,
): {
  sql: string;
  binds: Record<string, unknown>;
  bindValues: unknown[];
  parameterNames: string[];
} {
  const parameterNames = extractParameterNames(sqlText);
  const binds: Record<string, unknown> = {};
  const bindValues: unknown[] = [];
  const replacements = new Map<string, string>();

  for (const name of parameterNames) {
    if (!(name in values)) throw new Error(`MISSING_QUERY_PARAMETER:${name}`);
    const value = values[name];

    if (Array.isArray(value)) {
      if (value.length === 0) {
        replacements.set(name, "NULL");
        continue;
      }

      if (type === "MYSQL") {
        const placeholders = value.map((item) => {
          bindValues.push(item);
          return "?";
        });
        replacements.set(name, placeholders.join(", "));
        continue;
      }

      if (type === "POSTGRESQL") {
        const placeholders = value.map((item) => {
          bindValues.push(item);
          return `$${bindValues.length}`;
        });
        replacements.set(name, placeholders.join(", "));
        continue;
      }

      const placeholders = value.map((item, index) => {
        const bindName = `${name}_${index}`;
        binds[bindName] = item;
        return type === "SQLSERVER" ? `@${bindName}` : `:${bindName}`;
      });
      replacements.set(name, placeholders.join(", "));
      continue;
    }

    if (type === "MYSQL") {
      bindValues.push(value);
      replacements.set(name, "?");
      continue;
    }

    if (type === "POSTGRESQL") {
      bindValues.push(value);
      replacements.set(name, `$${bindValues.length}`);
      continue;
    }

    binds[name] = value;
    replacements.set(name, type === "SQLSERVER" ? `@${name}` : `:${name}`);
  }

  const sql = sqlText.replace(tokenRegex, (_whole, name: string) => {
    const replacement = replacements.get(name);
    if (!replacement) throw new Error(`MISSING_QUERY_PARAMETER:${name}`);
    return replacement;
  });

  return { sql, binds, bindValues, parameterNames };
}
