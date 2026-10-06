import sql from "mssql";
import type { DataSourceAdapter } from "./datasourceAdapter.js";
import type { ConnectionTestResult, DataSourceConfig } from "../datasource.types.js";

export class SqlServerAdapter implements DataSourceAdapter {
  async testConnection(config: DataSourceConfig): Promise<ConnectionTestResult> {
    const pool = new sql.ConnectionPool({
      server: config.host,
      port: config.port,
      database: config.databaseName ?? undefined,
      user: config.username,
      password: config.password,
      connectionTimeout: config.connectionTimeoutSec * 1000,
      requestTimeout: config.queryTimeoutSec * 1000,
      options: {
        encrypt: config.encryptConnection,
        trustServerCertificate: config.trustServerCertificate,
      },
      pool: { min: 0, max: 1, idleTimeoutMillis: 5_000 },
    });

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
}
