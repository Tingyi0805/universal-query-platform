import sql from "mssql";
import type { DataSourceAdapter, ExecuteQueryInput } from "./datasourceAdapter.js";
import type { ConnectionTestResult, DataSourceConfig } from "../datasource.types.js";
import type { QueryResult } from "../../../query/query.types.js";

function createPool(config: DataSourceConfig, requestTimeoutSec?: number) {
  return new sql.ConnectionPool({
    server: config.host,
    port: config.port,
    database: config.databaseName ?? undefined,
    user: config.username,
    password: config.password,
    connectionTimeout: config.connectionTimeoutSec * 1000,
    requestTimeout: (requestTimeoutSec ?? config.queryTimeoutSec) * 1000,
    options: {
      encrypt: config.encryptConnection,
      trustServerCertificate: config.trustServerCertificate,
    },
    pool: { min: 0, max: 1, idleTimeoutMillis: 5_000 },
  });
}

export class SqlServerAdapter implements DataSourceAdapter {
  async testConnection(config: DataSourceConfig): Promise<ConnectionTestResult> {
    const pool = createPool(config);

    try {
      await pool.connect();
      const result = await pool.request().query("SELECT @@VERSION AS ServerVersion");
      return {
        ok: true,
        message: "SQL Server 連線成功。",
        serverVersion: result.recordset[0]?.ServerVersion
          ? String(result.recordset[0].ServerVersion)
          : undefined,
      };
    } finally {
      await pool.close().catch(() => undefined);
    }
  }

  async executeQuery(config: DataSourceConfig, input: ExecuteQueryInput): Promise<QueryResult> {
    const pool = createPool(config, input.timeoutSec);
    const started = Date.now();

    try {
      await pool.connect();
      const request = pool.request();

      for (const [name, value] of Object.entries(input.binds)) {
        request.input(name, value as any);
      }

      const fetchRows = input.maxRows + 1;
      const result = await request.query(`SET ROWCOUNT ${fetchRows};\n${input.sql}`);
      const rows = (result.recordset ?? []) as Record<string, unknown>[];
      const truncated = rows.length > input.maxRows;
      const visibleRows = truncated ? rows.slice(0, input.maxRows) : rows;

      const columnSource = result.recordset?.columns ?? {};
      const columns = Object.entries(columnSource).map(([name, metadata]: [string, any]) => ({
        name,
        dataType: metadata?.type?.declaration ? String(metadata.type.declaration) : undefined,
      }));

      return {
        columns,
        rows: visibleRows,
        rowCount: visibleRows.length,
        truncated,
        elapsedMs: Date.now() - started,
      };
    } finally {
      await pool.close().catch(() => undefined);
    }
  }
}
