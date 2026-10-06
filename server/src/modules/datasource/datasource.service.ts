import { createDataSourceAdapter } from "./adapters/adapterFactory.js";
import { getDataSourceConfig } from "./datasource.repository.js";
import type { ConnectionTestResult, DataSourceConfig } from "./datasource.types.js";

export async function testDataSourceConfig(config: DataSourceConfig): Promise<ConnectionTestResult> {
  try {
    return await createDataSourceAdapter(config.type).testConnection(config);
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知錯誤";
    return {
      ok: false,
      message: `連線失敗：${message}`,
    };
  }
}

export async function testSavedDataSource(id: number): Promise<ConnectionTestResult> {
  const config = await getDataSourceConfig(id);
  if (!config) throw new Error("DATASOURCE_NOT_FOUND");
  return testDataSourceConfig(config);
}
