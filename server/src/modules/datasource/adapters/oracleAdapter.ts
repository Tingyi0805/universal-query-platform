import oracledb from "oracledb";
import type { DataSourceAdapter } from "./datasourceAdapter.js";
import type { ConnectionTestResult, DataSourceConfig } from "../datasource.types.js";

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
    const connection = await oracledb.getConnection({
      user: config.username,
      password: config.password,
      connectString: buildConnectString(config),
    });

    try {
      const result = await connection.execute(
        "SELECT * FROM (SELECT VERSION FROM PRODUCT_COMPONENT_VERSION WHERE PRODUCT LIKE 'Oracle Database%') WHERE ROWNUM = 1",
        [],
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );

      const row = result.rows?.[0] as { VERSION?: string } | undefined;
      return {
        ok: true,
        message: "Oracle 連線成功。",
        serverVersion: row?.VERSION,
      };
    } finally {
      await connection.close().catch(() => undefined);
    }
  }
}
