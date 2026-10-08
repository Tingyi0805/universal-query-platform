import odbc from "odbc";
import type { DataSourceAdapter, ExecuteQueryInput } from "./datasourceAdapter.js";
import type { ConnectionTestResult, DataSourceConfig } from "../datasource.types.js";
import type { QueryResult } from "../../../query/query.types.js";

function quoteOdbcValue(value: string): string {
  return `{${value.replace(/}/g, "}}")}}`;
}

function buildConnectionString(config: DataSourceConfig): string {
  if (config.odbcConnectionMode === "CONNECTION_STRING") {
    const value = config.odbcConnectionString?.trim();
    if (!value) throw new Error("ODBC_CONNECTION_STRING_REQUIRED");
    return value;
  }

  if (config.odbcConnectionMode === "DSN") {
    const dsn = config.odbcDsn?.trim();
    if (!dsn) throw new Error("ODBC_DSN_REQUIRED");

    const parts = [`DSN=${quoteOdbcValue(dsn)}`];
    if (config.username.trim()) parts.push(`UID=${quoteOdbcValue(config.username.trim())}`);
    if (config.password) parts.push(`PWD=${quoteOdbcValue(config.password)}`);
    return `${parts.join(";")};`;
  }

  throw new Error("ODBC_CONNECTION_MODE_REQUIRED");
}

async function openConnection(config: DataSourceConfig) {
  return odbc.connect({
    connectionString: buildConnectionString(config),
    connectionTimeout: config.connectionTimeoutSec,
    loginTimeout: config.connectionTimeoutSec,
  });
}

export class OdbcAdapter implements DataSourceAdapter {
  async testConnection(config: DataSourceConfig): Promise<ConnectionTestResult> {
    const connection = await openConnection(config);

    try {
      return {
        ok: true,
        message: "ODBC 連線成功。",
        driverName: "ODBC",
        driverMode: config.odbcConnectionMode ?? undefined,
        compatibilityStatus: "VERIFIED",
      };
    } finally {
      await connection.close().catch(() => undefined);
    }
  }

  async executeQuery(config: DataSourceConfig, input: ExecuteQueryInput): Promise<QueryResult> {
    const connection = await openConnection(config);
    const started = Date.now();
    const fetchRows = input.maxRows + 1;
    let cursor: any;

    try {
      const parameters = (input.bindValues ?? []) as unknown as (string | number)[];

      cursor = await connection.query(
        input.sql,
        parameters,
        {
          cursor: true,
          fetchSize: fetchRows,
          timeout: input.timeoutSec,
        },
      );

      const fetched = await cursor.fetch();
      const rows = Array.isArray(fetched)
        ? fetched as Record<string, unknown>[]
        : [];

      const truncated = rows.length > input.maxRows;
      const visibleRows = truncated ? rows.slice(0, input.maxRows) : rows;
      const metadata = (fetched as any)?.columns ?? [];

      const columns = metadata.length > 0
        ? metadata.map((column: any) => ({
            name: String(column.name),
            dataType: column.dataType == null ? undefined : String(column.dataType),
          }))
        : visibleRows.length > 0
          ? Object.keys(visibleRows[0]!).map((name) => ({ name }))
          : [];

      return {
        columns,
        rows: visibleRows,
        rowCount: visibleRows.length,
        truncated,
        elapsedMs: Date.now() - started,
      };
    } finally {
      if (cursor) await cursor.close().catch(() => undefined);
      await connection.close().catch(() => undefined);
    }
  }
}
