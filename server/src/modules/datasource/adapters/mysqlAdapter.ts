import mysql from "mysql2/promise";
import type { FieldPacket, RowDataPacket } from "mysql2/promise";
import type { DataSourceAdapter, ExecuteQueryInput } from "./datasourceAdapter.js";
import type { ConnectionTestResult, DataSourceConfig } from "../datasource.types.js";
import type { QueryResult } from "../../../query/query.types.js";

function createPool(config: DataSourceConfig) {
  return mysql.createPool({
    host: config.host,
    port: config.port,
    database: config.databaseName ?? undefined,
    user: config.username,
    password: config.password,
    connectTimeout: config.connectionTimeoutSec * 1000,
    connectionLimit: 1,
    maxIdle: 1,
    idleTimeout: 5_000,
    enableKeepAlive: false,
    ssl: config.encryptConnection
      ? { rejectUnauthorized: !config.trustServerCertificate }
      : undefined,
  });
}

function stripTerminalSemicolon(sql: string): string {
  return sql.trim().replace(/;\s*$/, "");
}

export class MySqlAdapter implements DataSourceAdapter {
  async testConnection(config: DataSourceConfig): Promise<ConnectionTestResult> {
    const pool = createPool(config);
    try {
      const [rows] = await pool.query<RowDataPacket[]>("SELECT VERSION() AS ServerVersion");
      return {
        ok: true,
        message: "MySQL 連線成功。",
        serverVersion: rows[0]?.ServerVersion ? String(rows[0].ServerVersion) : undefined,
      };
    } finally {
      await pool.end().catch(() => undefined);
    }
  }

  async executeQuery(config: DataSourceConfig, input: ExecuteQueryInput): Promise<QueryResult> {
    const pool = createPool(config);
    const started = Date.now();

    try {
      const connection = await pool.getConnection();
      try {
        await connection.query("SET SESSION MAX_EXECUTION_TIME = ?", [input.timeoutSec * 1000]);

        const fetchRows = input.maxRows + 1;
        const boundedSql = `SELECT * FROM (${stripTerminalSemicolon(input.sql)}) AS __uqp_result LIMIT ${fetchRows}`;
        const [rows, fields] = await connection.query<RowDataPacket[]>({
          sql: boundedSql,
          values: input.bindValues ?? [],
          timeout: input.timeoutSec * 1000,
        });

        const resultRows = rows as unknown as Record<string, unknown>[];
        const truncated = resultRows.length > input.maxRows;
        const visibleRows = truncated ? resultRows.slice(0, input.maxRows) : resultRows;

        const columns = (fields as FieldPacket[]).map((field) => ({
          name: String(field.name),
          dataType: field.type == null ? undefined : `MYSQL_TYPE:${field.type}`,
        }));

        return {
          columns,
          rows: visibleRows,
          rowCount: visibleRows.length,
          truncated,
          elapsedMs: Date.now() - started,
        };
      } finally {
        connection.release();
      }
    } finally {
      await pool.end().catch(() => undefined);
    }
  }
}
