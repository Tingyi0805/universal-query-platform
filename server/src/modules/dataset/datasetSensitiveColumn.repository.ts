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

/** Read revision and rows under the same dataset row lock to avoid torn GET responses. */
export async function getDatasetSensitivitySnapshot(datasetId: number): Promise<{ columns: DatasetSensitiveColumn[]; version: number }> {
  const pool = await getPlatformDbPool();
  if (!pool) throw new Error("PLATFORM_DB_NOT_CONFIGURED");
  const transaction = new sql.Transaction(pool);
  await transaction.begin(sql.ISOLATION_LEVEL.REPEATABLE_READ);
  try {
    const exists = await new sql.Request(transaction).input("datasetId", sql.BigInt, datasetId)
      .query("SELECT Id FROM uqp.Dataset WITH (HOLDLOCK) WHERE Id=@datasetId");
    if (!exists.recordset.length) throw new Error("DATASET_NOT_FOUND");
    const revision = await new sql.Request(transaction).input("datasetId", sql.BigInt, datasetId)
      .query("SELECT VersionNumber FROM uqp.DatasetSensitivePolicyVersion WHERE DatasetId=@datasetId");
    const result = await new sql.Request(transaction).input("datasetId", sql.BigInt, datasetId)
      .query("SELECT ColumnName, SensitivityType, DeviceMaskMode FROM uqp.DatasetSensitiveColumn WHERE DatasetId=@datasetId ORDER BY ColumnName");
    const columns = result.recordset.map((row) => ({ columnName: String(row.ColumnName), sensitivityType: String(row.SensitivityType), deviceMaskMode: row.DeviceMaskMode as DeviceMaskMode }));
    const version = revision.recordset.length ? Number(revision.recordset[0].VersionNumber) : 0;
    await transaction.commit();
    return { columns, version };
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

export async function getDatasetSensitivityVersion(datasetId: number): Promise<number> {
  const pool = await getPlatformDbPool();
  if (!pool) throw new Error("PLATFORM_DB_NOT_CONFIGURED");
  const result = await pool.request().input("datasetId", sql.BigInt, datasetId).query("SELECT VersionNumber FROM uqp.DatasetSensitivePolicyVersion WHERE DatasetId=@datasetId");
  return result.recordset.length ? Number(result.recordset[0].VersionNumber) : 0;
}

export async function replaceDatasetSensitiveColumns(datasetId: number, rules: DatasetSensitiveColumn[], userId: number, auditContext: { ipAddress?: string | null; userAgent?: string | null }, expectedVersion: number): Promise<number> {
  const pool = await getPlatformDbPool();
  if (!pool) throw new Error("PLATFORM_DB_NOT_CONFIGURED");
  const transaction = new sql.Transaction(pool);
  await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  try {
    const exists = await new sql.Request(transaction).input("datasetId", sql.BigInt, datasetId)
      .query("SELECT Id FROM uqp.Dataset WITH (UPDLOCK, HOLDLOCK) WHERE Id=@datasetId");
    if (!exists.recordset.length) throw new Error("DATASET_NOT_FOUND");
    // Validate against saved Dataset columns under the same transaction.
    // A Dataset without synchronized column metadata cannot accept new rules.
    if (rules.length > 0) {
      const metadata = await new sql.Request(transaction).input("datasetId", sql.BigInt, datasetId)
        .query("SELECT ColumnName FROM uqp.DatasetColumn WITH (HOLDLOCK) WHERE DatasetId=@datasetId");
      const allowed = new Set(metadata.recordset.map((row) => String(row.ColumnName).toUpperCase()));
      if (rules.some((rule) => !allowed.has(rule.columnName.toUpperCase()))) {
        throw new Error("SENSITIVITY_COLUMN_NOT_FOUND");
      }
    }
    const revision = await new sql.Request(transaction).input("datasetId", sql.BigInt, datasetId)
      .query("SELECT VersionNumber FROM uqp.DatasetSensitivePolicyVersion WITH (UPDLOCK, HOLDLOCK) WHERE DatasetId=@datasetId");
    const currentVersion = revision.recordset.length ? Number(revision.recordset[0].VersionNumber) : 0;
    if (currentVersion !== expectedVersion) throw new Error("SENSITIVITY_VERSION_CONFLICT");
    if (!revision.recordset.length) {
      await new sql.Request(transaction).input("datasetId", sql.BigInt, datasetId)
        .query("INSERT INTO uqp.DatasetSensitivePolicyVersion (DatasetId, VersionNumber) VALUES (@datasetId, 0)");
    }
    const before = await new sql.Request(transaction).input("datasetId", sql.BigInt, datasetId)
      .query("SELECT ColumnName AS columnName, SensitivityType AS sensitivityType, DeviceMaskMode AS deviceMaskMode FROM uqp.DatasetSensitiveColumn WITH (UPDLOCK, HOLDLOCK) WHERE DatasetId=@datasetId ORDER BY ColumnName");
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
    const details = JSON.stringify({ before: before.recordset, after: rules });
    if (details.length > 20000) throw new Error("SENSITIVITY_AUDIT_TOO_LARGE");
    await new sql.Request(transaction)
      .input("userId", sql.BigInt, userId)
      .input("datasetId", sql.BigInt, datasetId)
      .input("parametersJson", sql.NVarChar(sql.MAX), details)
      .input("ipAddress", sql.NVarChar(100), auditContext.ipAddress ?? null)
      .input("userAgent", sql.NVarChar(500), auditContext.userAgent?.slice(0, 500) ?? null)
      .query("INSERT INTO uqp.AuditLog (EventType, EventCategory, IsImportant, UserId, DatasetId, Status, ParametersJson, IpAddress, UserAgent, CompletedAtUtc) VALUES ('DATASET_SENSITIVITY_UPDATED', 'CONFIG', 1, @userId, @datasetId, 'SUCCESS', @parametersJson, @ipAddress, @userAgent, SYSUTCDATETIME())");
    await new sql.Request(transaction).input("datasetId", sql.BigInt, datasetId)
      .query("UPDATE uqp.DatasetSensitivePolicyVersion SET VersionNumber=VersionNumber+1 WHERE DatasetId=@datasetId");
    await transaction.commit();
    return currentVersion + 1;
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}
