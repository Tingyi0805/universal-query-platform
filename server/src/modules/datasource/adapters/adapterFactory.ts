import type { DataSourceAdapter } from "./datasourceAdapter.js";
import type { DataSourceType } from "../datasource.types.js";
import { OracleAdapter } from "./oracleAdapter.js";
import { SqlServerAdapter } from "./sqlServerAdapter.js";

export function createDataSourceAdapter(type: DataSourceType): DataSourceAdapter {
  switch (type) {
    case "SQLSERVER":
      return new SqlServerAdapter();
    case "ORACLE":
      return new OracleAdapter();
  }
}
