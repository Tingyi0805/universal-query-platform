import oracledb from "oracledb";
import type { DataSourceAdapter, ExecuteQueryInput } from "./datasourceAdapter.js";
import type { ConnectionTestResult, DataSourceConfig } from "../datasource.types.js";
import type { QueryResult } from "../../../query/query.types.js";
import { ensureOracleClientInitialized, getOracleRuntimeDiagnostics } from "./oracleClient.js";
import { acquireDescriptionConnection, candidateDescription, compileDescription, compileUnboundDescription, isUnboundDescription, descriptionDeadline,
  descriptionError, QueryDescriptionError, type ColumnDescribeInput } from "../../../query/queryDescription.js";

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
  async describeQuery(config: DataSourceConfig, input: ColumnDescribeInput) {
    const compiled = isUnboundDescription(input) ? compileUnboundDescription(input, "ORACLE") : compileDescription(input, "ORACLE");
    const expectedNames = "parameterNames" in compiled ? compiled.parameterNames : [];
    let connection: any;
    try {
      ensureOracleClientInitialized();
      // This capability is gated to the supported 6.x driver contract. New major
      // versions require review; no assumption based on a method name alone.
      const version = /^6\.(\d+)\.\d+$/.exec(oracledb.versionString);
      if (!version || Number(version[1]) < 8 || typeof oracledb.thin !== "boolean"
        || (!oracledb.thin && !(oracledb.oracleClientVersion >= 1801000000))) {
        throw new QueryDescriptionError("DESCRIPTION_UNSUPPORTED");
      }
      connection = await acquireDescriptionConnection(() => openConnection(config), c => c.close(), input.timeoutSec * 1000);
      if (typeof connection.getStatementInfo !== "function" || typeof connection.break !== "function"
        || connection.thin !== oracledb.thin || !(connection.oracleServerVersion >= 1201000000)) {
        throw new QueryDescriptionError("DESCRIPTION_UNSUPPORTED");
      }
      connection.callTimeout = input.timeoutSec * 1000;
      const info = await descriptionDeadline<any>(connection.getStatementInfo(compiled.sql), input.timeoutSec * 1000,
        () => connection.break());
      if (!info || info.statementType !== oracledb.STMT_TYPE_SELECT || !Array.isArray(info.bindNames)
        || info.bindNames.length > 10000 || new Set(info.bindNames).size !== expectedNames.length
        || info.bindNames.some((name: unknown) => typeof name !== "string" || !expectedNames.includes(name)) || !Array.isArray(info.metaData)) {
        throw new QueryDescriptionError("DESCRIPTION_METADATA_INVALID");
      }
      return candidateDescription("ORACLE_STATEMENT_INFO", info.metaData.map((column: any, index: number) => ({
        name: column?.name, dataType: column?.dbTypeName, ordinal: index + 1,
      })));
    } catch (error) { throw descriptionError(error); }
    finally {
      if (connection) {
        try { await connection.close(); } catch { throw new QueryDescriptionError("DESCRIPTION_CLEANUP_FAILED"); }
      }
    }
  }

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
        configuredDriverMode: runtime.configuredMode,
        clientVersion: runtime.clientVersion,
        compatibilityStatus: "VERIFIED",
      };
    } finally {
      await connection.close().catch(() => undefined);
    }
  }

  async executeQuery(config: DataSourceConfig, input: ExecuteQueryInput): Promise<QueryResult> {
    const binds = validateOracleBinds(input.binds);
    const connection = await openConnection(config);
    const started = Date.now();

    try {
      connection.callTimeout = input.timeoutSec * 1000;
      const result = await connection.execute(
        input.sql,
        binds,
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

// Do not pass plain objects as driver bind descriptors, or silently coerce Boolean
// values (Oracle SQL BOOLEAN is version-dependent). Compiler expands list values.
export function validateOracleBinds(binds: Record<string, unknown>): Record<string, unknown> {
  for (const value of Object.values(binds)) {
    if (value === null || typeof value === "string" || Buffer.isBuffer(value)
      || (typeof value === "number" && Number.isFinite(value))
      || (value instanceof Date && Number.isFinite(value.getTime()))) continue;
    throw new Error("ORACLE_BIND_INVALID");
  }
  return binds;
}
