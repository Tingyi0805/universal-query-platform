import oracledb from "oracledb";
import type { DataSourceAdapter, ExecuteQueryInput } from "./datasourceAdapter.js";
import type { ConnectionTestResult, DataSourceConfig } from "../datasource.types.js";
import type { QueryResult } from "../../../query/query.types.js";
import { ensureOracleClientInitialized, getOracleRuntimeDiagnostics } from "./oracleClient.js";

function buildConnectString(config: DataSourceConfig): string {
  const target = config.oracleServiceName?.trim();
  if (!target) throw new Error("ORACLE_SERVICE_REQUIRED");

  if (config.oracleConnectionMode === "SID") {
    return `(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=${config.host})(PORT=${config.port}))(CONNECT_DATA=(SID=${target})))`;
  }

  return `${config.host}:${config.port}/${target}`;
}

async function openConnection(config: DataSourceConfig) {
  ensureOracleClientInitialized();
  return oracledb.getConnection({
    user: config.username,
    password: config.password,
    connectString: buildConnectString(config),
  });
}

export class OracleAdapter implements DataSourceAdapter {
  async testConnection(config: DataSourceConfig): Promise<ConnectionTestResult> {
    const connection = await openConnection(config);

    try {
      await connection.execute("SELECT 1 AS CONNECTION_TEST FROM DUAL");
      const runtime = getOracleRuntimeDiagnostics();
      return {
        ok: true,
        message: "Oracle 連線成功。",
        serverVersion: connection.oracleServerVersionString,
        driverName: runtime.driverName,
        driverVersion: runtime.driverVersion,
        driverMode: connection.thin ? "THIN" : "THICK",
        clientVersion: runtime.clientVersion,
        compatibilityStatus: "VERIFIED",
      };
    } finally {
      await connection.close().catch(() => undefined);
    }
  }

  async executeQuery(config: DataSourceConfig, input: ExecuteQueryInput): Promise<QueryResult> {
    const connection = await openConnection(config);
    const started = Date.now();

    try {
      connection.callTimeout = input.timeoutSec * 1000;
      const result = await connection.execute(
        input.sql,
        input.binds,
        {
          outFormat: oracledb.OUT_FORMAT_OBJECT,
          maxRows: input.maxRows + 1,
        },
      );

      const rows = (result.rows ?? []) as Record<string, unknown>[];
      const truncated = rows.length > input.maxRows;
      const visibleRows = truncated ? rows.slice(0, input.maxRows) : rows;
      const columns = (result.metaData ?? []).map((column: any) => ({
        name: String(column.name),
        dataType: column.dbTypeName ? String(column.dbTypeName) : undefined,
      }));

      return {
        columns,
        rows: visibleRows,
        rowCount: visibleRows.length,
        truncated,
        elapsedMs: Date.now() - started,
      };
    } finally {
      await connection.close().catch(() => undefined);
    }
  }
}
