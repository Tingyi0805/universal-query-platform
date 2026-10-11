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

export async function replaceDatasetSensitiveColumns(datasetId: number, rules: DatasetSensitiveColumn[], userId: number): Promise<void> {
  const pool = await getPlatformDbPool();
  if (!pool) throw new Error("PLATFORM_DB_NOT_CONFIGURED");
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const exists = await new sql.Request(transaction).input("datasetId", sql.BigInt, datasetId)
      .query("SELECT Id FROM uqp.Dataset WITH (UPDLOCK, HOLDLOCK) WHERE Id=@datasetId");
    if (!exists.recordset.length) throw new Error("DATASET_NOT_FOUND");
    await new sql.Request(transaction).input("datasetId", sql.BigInt, datasetId)
      .query("DELETE FROM uqp.DatasetSensitiveColumn WHERE DatasetId=@datasetId");
    for (const rule of rules) {
      await new sql.Request(transaction)
        .input("datasetId", sql.BigInt, datasetId)
        .input("columnName", sql.NVarChar(256), rule.columnName)
        .input("sensitivityType", sql.NVarChar(64), rule.sensitivityType)
        .input("deviceMaskMode", sql.VarChar(16), rule.deviceMaskMode)
        .input("userId", sql.BigInt, userId)
        .query("INSERT INTO uqp.DatasetSensitiveColumn (DatasetId, ColumnName, SensitivityType, DeviceMaskMode, UpdatedByUserId) VALUES (@datasetId,@columnName,@sensitivityType,@deviceMaskMode,@userId)");
    }
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}
