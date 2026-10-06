import oracledb from "oracledb";
import type { DataSourceAdapter } from "./datasourceAdapter.js";
import type { ConnectionTestResult, DataSourceConfig } from "../datasource.types.js";
import { ensureOracleClientInitialized } from "./oracleClient.js";

function buildConnectString(config: DataSourceConfig): string {
  const target = config.oracleServiceName?.trim();
  if (!target) throw new Error("ORACLE_SERVICE_REQUIRED");

  if (config.oracleConnectionMode === "SID") {
    return `(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=${config.host})(PORT=${config.port}))(CONNECT_DATA=(SID=${target})))`;
  }

  return `${config.host}:${config.port}/${target}`;
}

export class OracleAdapter implements DataSourceAdapter {
  async testConnection(config: DataSourceConfig): Promise<ConnectionTestResult> {
    ensureOracleClientInitialized();

    const connection = await oracledb.getConnection({
      user: config.username,
      password: config.password,
      connectString: buildConnectString(config),
    });

    try {
      await connection.execute("SELECT 1 AS CONNECTION_TEST FROM DUAL");

      return {
        ok: true,
        message: "Oracle 連線成功。",
        serverVersion: connection.oracleServerVersionString,
      };
    } finally {
      await connection.close().catch(() => undefined);
    }
  }
}
