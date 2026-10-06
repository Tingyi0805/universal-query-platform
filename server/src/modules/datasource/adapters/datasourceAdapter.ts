import type { ConnectionTestResult, DataSourceConfig } from "../datasource.types.js";
import type { QueryResult } from "../../../query/query.types.js";

export type ExecuteQueryInput = {
  sql: string;
  binds: Record<string, unknown>;
  maxRows: number;
  timeoutSec: number;
};

export interface DataSourceAdapter {
  testConnection(config: DataSourceConfig): Promise<ConnectionTestResult>;
  executeQuery(config: DataSourceConfig, input: ExecuteQueryInput): Promise<QueryResult>;
}
