import sql from "mssql";
import { getPlatformDbPool } from "../../config/database.js";
import type { DeviceMaskMode } from "../dashboard/dashboardDeviceMasking.js";

export type DatasetSensitiveColumn = { columnName: string; sensitivityType: string; deviceMaskMode: DeviceMaskMode };

export async function listDatasetSensitiveColumns(datasetId: number): Promise<DatasetSensitiveColumn[]> {
  const pool = await getPlatformDbPool();
  if (!pool) throw new Error("PLATFORM_DB_NOT_CONFIGURED");
  const result = await pool.request().input("datasetId", sql.BigInt, datasetId).query(
    "SELECT ColumnName, SensitivityType, DeviceMaskMode FROM uqp.DatasetSensitiveColumn WHERE DatasetId=@datasetId ORDER BY ColumnName"
  );
  return result.recordset.map((row) => ({ columnName: String(row.ColumnName), sensitivityType: String(row.SensitivityType), deviceMaskMode: row.DeviceMaskMode as DeviceMaskMode }));
}
