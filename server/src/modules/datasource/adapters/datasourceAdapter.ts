import type { ConnectionTestResult, DataSourceConfig } from "../datasource.types.js";

export interface DataSourceAdapter {
  testConnection(config: DataSourceConfig): Promise<ConnectionTestResult>;
}
