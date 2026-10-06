import type { DataSourceAdapter } from "./datasourceAdapter.js";
import type { DataSourceType } from "../datasource.types.js";
import { OracleAdapter } from "./oracleAdapter.js";
import { SqlServerAdapter } from "./sqlServerAdapter.js";
import { MySqlAdapter } from "./mysqlAdapter.js";
import { PostgreSqlAdapter } from "./postgresqlAdapter.js";
import { OdbcAdapter } from "./odbcAdapter.js";

export function createDataSourceAdapter(type: DataSourceType): DataSourceAdapter {
  switch (type) {
    case "SQLSERVER":
      return new SqlServerAdapter();
    case "ORACLE":
      return new OracleAdapter();
    case "MYSQL":
      return new MySqlAdapter();
    case "POSTGRESQL":
      return new PostgreSqlAdapter();
    case "ODBC":
      return new OdbcAdapter();
  }
}
