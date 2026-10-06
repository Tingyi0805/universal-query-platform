import { Pool } from "pg";
import type { DataSourceAdapter, ExecuteQueryInput } from "./datasourceAdapter.js";
import type { ConnectionTestResult, DataSourceConfig } from "../datasource.types.js";
import type { QueryResult } from "../../../query/query.types.js";

function createPool(config: DataSourceConfig) {
  return new Pool({
    host: config.host,
    port: config.port,
    database: config.databaseName ?? undefined,
    user: config.username,
    password: config.password,
    connectionTimeoutMillis: config.connectionTimeoutSec * 1000,
    max: 1,
    idleTimeoutMillis: 5_000,
    ssl: config.encryptConnection
      ? { rejectUnauthorized: !config.trustServerCertificate }
      : false,
  });
}

function stripTerminalSemicolon(sql: string): string {
  return sql.trim().replace(/;\s*$/, "");
}

export class PostgreSqlAdapter implements DataSourceAdapter {
  async testConnection(config: DataSourceConfig): Promise<ConnectionTestResult> {
    const pool = createPool(config);
    try {
      const result = await pool.query("SHOW server_version");
      return {
        ok: true,
        message: "PostgreSQL 連線成功。",
        serverVersion: result.rows[0]?.server_version
          ? String(result.rows[0].server_version)
          : undefined,
      };
    } finally {
      await pool.end().catch(() => undefined);
    }
  }

  async executeQuery(config: DataSourceConfig, input: ExecuteQueryInput): Promise<QueryResult> {
    const pool = createPool(config);
    const started = Date.now();
    const client = await pool.connect();

    try {
      await client.query(`SET statement_timeout = ${Math.max(1, input.timeoutSec * 1000)}`);

      const fetchRows = input.maxRows + 1;
      const boundedSql = `SELECT * FROM (${stripTerminalSemicolon(input.sql)}) AS __uqp_result LIMIT ${fetchRows}`;
      const result = await client.query(boundedSql, input.bindValues ?? []);

      const rows = result.rows as Record<string, unknown>[];
      const truncated = rows.length > input.maxRows;
      const visibleRows = truncated ? rows.slice(0, input.maxRows) : rows;
      const columns = result.fields.map((field) => ({
        name: String(field.name),
        dataType: `OID:${field.dataTypeID}`,
      }));

      return {
        columns,
        rows: visibleRows,
        rowCount: visibleRows.length,
        truncated,
        elapsedMs: Date.now() - started,
      };
    } finally {
      client.release();
      await pool.end().catch(() => undefined);
    }
  }
}
