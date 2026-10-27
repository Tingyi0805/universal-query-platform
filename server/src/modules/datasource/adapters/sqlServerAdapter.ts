import sql from "mssql";
import type { DataSourceAdapter, ExecuteQueryInput } from "./datasourceAdapter.js";
import type { ConnectionTestResult, DataSourceConfig } from "../datasource.types.js";
import type { QueryResult } from "../../../query/query.types.js";
import { candidateDescription, compileDescription, compileUnboundDescription, isUnboundDescription, inferredDescriptionDeclarations, descriptionError, QueryDescriptionError,
  type ColumnDescribeInput } from "../../../query/queryDescription.js";

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
  async describeQuery(config: DataSourceConfig, input: ColumnDescribeInput) {
    const unbound = isUnboundDescription(input);
    const compiled = unbound ? compileUnboundDescription(input, "SQLSERVER") : compileDescription(input, "SQLSERVER");
    let pool: sql.ConnectionPool | undefined;
    try {
      pool = createPool({ ...config, connectionTimeoutSec: input.timeoutSec }, input.timeoutSec);
      await pool.connect();
      let declaration = "parameterDeclaration" in compiled ? compiled.parameterDeclaration : null;
      if ("parameterNames" in compiled && compiled.parameterNames.length) {
        const inference = pool.request();
        inference.input("tsql", sql.NVarChar(sql.MAX), compiled.sql);
        const types = await inference.execute("sys.sp_describe_undeclared_parameters");
        declaration = inferredDescriptionDeclarations(types.recordset, compiled.parameterNames);
      }
      const request = pool.request();
      request.input("tsql", sql.NVarChar(sql.MAX), compiled.sql);
      request.input("params", sql.NVarChar(sql.MAX), declaration);
      request.input("browse_information_mode", sql.TinyInt, 0);
      const result = await request.execute("sys.sp_describe_first_result_set");
      if (!Array.isArray(result.recordset)) throw new QueryDescriptionError("DESCRIPTION_METADATA_INVALID");
      const columns = result.recordset.map((column: any) => {
        if (!column || (column.error_number != null && column.error_number !== 0)
          || (column.is_hidden !== false && column.is_hidden !== 0)) {
          throw new QueryDescriptionError("DESCRIPTION_METADATA_INVALID");
        }
        return { name: column.name, dataType: column.system_type_name, ordinal: column.column_ordinal };
      });
      return candidateDescription("SQLSERVER_DESCRIBE_FIRST_RESULT_SET", columns);
    } catch (error) { throw descriptionError(error); }
    finally {
      if (pool) {
        try { await pool.close(); } catch { throw new QueryDescriptionError("DESCRIPTION_CLEANUP_FAILED"); }
      }
    }
  }

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
        // Inferred mssql DateTime rounds 23:59:59.999 into the next day.
        // Keep canonical native dates precise; formatted STRING dates stay strings.
        if (value instanceof Date) request.input(name, sql.DateTime2(7), value);
        else request.input(name, value as any);
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
