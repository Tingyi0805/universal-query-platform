import type { ConnectionTestResult, DataSourceConfig } from "../datasource.types.js";
import type { QueryResult } from "../../../query/query.types.js";
import type { CandidateQueryDescription, ColumnDescribeInput } from "../../../query/queryDescription.js";

export type ExecuteQueryInput = {
  sql: string;
  binds: Record<string, unknown>;
  bindValues?: unknown[];
  maxRows: number;
  timeoutSec: number;
};

export interface DataSourceAdapter {
  // An absent capability is unsupported. Callers must never fall back to executeQuery.
  describeQuery?(config: DataSourceConfig, input: ColumnDescribeInput): Promise<CandidateQueryDescription>;
  // Explicit source snapshot capability; never emulate using separate connections.
  withReadOnlySnapshot?<T>(config: DataSourceConfig, timeoutSec: number,
    run: (execute: (input: ExecuteQueryInput) => Promise<QueryResult>) => Promise<T>): Promise<T>;
  testConnection(config: DataSourceConfig): Promise<ConnectionTestResult>;
  executeQuery(config: DataSourceConfig, input: ExecuteQueryInput): Promise<QueryResult>;
}
