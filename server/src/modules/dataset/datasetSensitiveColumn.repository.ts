import {assertDatasetAuditOnlyPolicy} from "./datasetAuditOnlyPolicy.js";
import { recordTemplateApplications, type TemplateApplication } from "./datasetMaskTemplate.repository.js";
import { patientAuditService } from "./patientAuditContract.repository.js";
import sql from "mssql";
import { getPlatformDbPool } from "../../config/database.js";
import type { DeviceMaskMode, CustomMaskConfig } from "../dashboard/dashboardDeviceMasking.js";

export type DatasetSensitiveColumn = { columnName: string; sensitivityType: string; deviceMaskMode: DeviceMaskMode; customMask?: CustomMaskConfig | null };

export async function listDatasetSensitiveColumns(datasetId: number): Promise<DatasetSensitiveColumn[]> {
  const pool = await getPlatformDbPool();
  if (!pool) throw new Error("PLATFORM_DB_NOT_CONFIGURED");
  const result = await pool.request().input("datasetId", sql.BigInt, datasetId).query(
    "SELECT ColumnName, SensitivityType, DeviceMaskMode, CustomMaskJson FROM uqp.DatasetSensitiveColumn WHERE DatasetId=@datasetId ORDER BY ColumnName"
  );
  return result.recordset.map((row) => ({ columnName: String(row.ColumnName), sensitivityType: String(row.SensitivityType), deviceMaskMode: row.DeviceMaskMode as DeviceMaskMode, customMask: row.CustomMaskJson ? JSON.parse(String(row.CustomMaskJson)) as CustomMaskConfig : null }));
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
      .query("SELECT ColumnName, SensitivityType, DeviceMaskMode, CustomMaskJson FROM uqp.DatasetSensitiveColumn WHERE DatasetId=@datasetId ORDER BY ColumnName");
    const columns = result.recordset.map((row) => ({ columnName: String(row.ColumnName), sensitivityType: String(row.SensitivityType), deviceMaskMode: row.DeviceMaskMode as DeviceMaskMode, customMask: row.CustomMaskJson ? JSON.parse(String(row.CustomMaskJson)) as CustomMaskConfig : null }));
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

export type SimpleReviewEvidence = Readonly<{
  expectedDefinitionVersion: string;
  expectedSourceVersion: string;
  requestId: string;
  reauthorize: (transaction: sql.Transaction) => Promise<void>;
}>;
export async function replaceDatasetSensitiveColumns(datasetId: number, rules: DatasetSensitiveColumn[], userId: number, auditContext: { ipAddress?: string | null; userAgent?: string | null }, expectedVersion: number, templateApplications: TemplateApplication[] = [], review?: SimpleReviewEvidence): Promise<number> {
  const pool = await getPlatformDbPool();
  if (!pool) throw new Error("PLATFORM_DB_NOT_CONFIGURED");
  const transaction = new sql.Transaction(pool);
  await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  try {
    const exists = await new sql.Request(transaction).input("datasetId", sql.BigInt, datasetId)
      .query("SELECT Id FROM uqp.Dataset WITH (UPDLOCK, HOLDLOCK) WHERE Id=@datasetId");
    if (!exists.recordset.length) throw new Error("DATASET_NOT_FOUND");
    if (review) {
      await review.reauthorize(transaction);
      // Only a fresh, non-patient policy can be created by the simplified
      // manager flow. All version, source and column guards are inside this
      // SERIALIZABLE transaction, not stale preflight browser evidence.
      if (expectedVersion !== 0 || !/^[0-9a-f]{16}$/u.test(review.expectedDefinitionVersion)
        || !/^[0-9a-f]{16}$/u.test(review.expectedSourceVersion))
        throw new Error("REVIEW_EXISTING_POLICY");
      const identity = await new sql.Request(transaction).input("datasetId", sql.BigInt, datasetId).query(`
        SELECT d.IsArchived,d.DefinitionRowVersion,s.ConfigurationRowVersion,s.IsActive AS SourceActive,s.Type AS SourceType
        FROM uqp.Dataset d WITH (UPDLOCK,HOLDLOCK)
        INNER JOIN uqp.DataSource s WITH (UPDLOCK,HOLDLOCK) ON s.Id=d.DataSourceId
        WHERE d.Id=@datasetId`);
      const item=identity.recordset[0];
      if (identity.recordset.length!==1 || item.IsArchived || !item.SourceActive ||
        !["SQLSERVER","ORACLE"].includes(String(item.SourceType)) ||
        !Buffer.isBuffer(item.DefinitionRowVersion) || item.DefinitionRowVersion.length!==8 ||
        !Buffer.isBuffer(item.ConfigurationRowVersion) || item.ConfigurationRowVersion.length!==8 ||
        item.DefinitionRowVersion.toString("hex")!==review.expectedDefinitionVersion ||
        item.ConfigurationRowVersion.toString("hex")!==review.expectedSourceVersion)
        throw new Error("REVIEW_VERSION_CONFLICT");
      const patient = await new sql.Request(transaction).input("datasetId",sql.BigInt,datasetId)
        .query(`SELECT CASE
          WHEN EXISTS(SELECT 1 FROM uqp.DatasetPatientAuditConfig WITH(HOLDLOCK) WHERE DatasetId=@datasetId)
            OR EXISTS(SELECT 1 FROM uqp.DatasetPatientAuditMetadata WITH(HOLDLOCK) WHERE DatasetId=@datasetId)
          THEN CAST(1 AS BIT) ELSE CAST(0 AS BIT) END AS HasPatientEvidence`);
      if (patient.recordset.length!==1 || Boolean(patient.recordset[0].HasPatientEvidence))
        throw new Error("REVIEW_PATIENT_SCOPE_REQUIRED");
      const savedFields = await new sql.Request(transaction).input("datasetId",sql.BigInt,datasetId)
        .query("SELECT ColumnName FROM uqp.DatasetColumn WITH(HOLDLOCK) WHERE DatasetId=@datasetId");
      const expected = new Set(savedFields.recordset.map(x=>String(x.ColumnName).toUpperCase()));
      if (!expected.size || expected.size>300 || expected.size!==savedFields.recordset.length ||
        rules.length!==expected.size ||
        rules.some(rule=>!expected.has(rule.columnName.toUpperCase())) ||
        rules.some(rule=>rule.deviceMaskMode!=="NONE" && rule.deviceMaskMode!=="FULL" && rule.deviceMaskMode!=="OMIT") ||
        rules.some(rule=>rule.deviceMaskMode==="NONE" ? rule.sensitivityType!=="OTHER" : rule.sensitivityType!=="GENERIC"))
        throw new Error("REVIEW_COLUMN_MISMATCH");
    }
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
    // Removing the final classification while a dashboard is enabled could
    // temporarily expose new query columns during a SQL migration.
    if (rules.length === 0) {
      const active = await new sql.Request(transaction).input("datasetId", sql.BigInt, datasetId)
        .query(`SELECT TOP (1) db.Id FROM uqp.Dashboard db
          INNER JOIN uqp.QueryDefinition q ON q.Id=db.QueryDefinitionId
          WHERE q.DatasetId=@datasetId AND db.IsActive=1`);
      if (active.recordset.length) throw new Error("SENSITIVITY_ACTIVE_DASHBOARD");
    }
    const revision = await new sql.Request(transaction).input("datasetId", sql.BigInt, datasetId)
      .query("SELECT VersionNumber FROM uqp.DatasetSensitivePolicyVersion WITH (UPDLOCK, HOLDLOCK) WHERE DatasetId=@datasetId");
    const currentVersion = revision.recordset.length ? Number(revision.recordset[0].VersionNumber) : 0;
    if (currentVersion !== expectedVersion) throw new Error("SENSITIVITY_VERSION_CONFLICT");
    if (review && currentVersion!==0) throw new Error("REVIEW_EXISTING_POLICY");
    if (!revision.recordset.length) {
      await new sql.Request(transaction).input("datasetId", sql.BigInt, datasetId)
        .query("INSERT INTO uqp.DatasetSensitivePolicyVersion (DatasetId, VersionNumber) VALUES (@datasetId, 0)");
    }
    const before = await new sql.Request(transaction).input("datasetId", sql.BigInt, datasetId)
      .query("SELECT ColumnName AS columnName, SensitivityType AS sensitivityType, DeviceMaskMode AS deviceMaskMode, CustomMaskJson AS customMaskJson FROM uqp.DatasetSensitiveColumn WITH (UPDLOCK, HOLDLOCK) WHERE DatasetId=@datasetId ORDER BY ColumnName");
    if (review && before.recordset.length) throw new Error("REVIEW_EXISTING_POLICY");
    await new sql.Request(transaction).input("datasetId", sql.BigInt, datasetId)
      .query("DELETE FROM uqp.DatasetSensitiveColumn WHERE DatasetId=@datasetId");
    for (const rule of rules) {
      await new sql.Request(transaction)
        .input("datasetId", sql.BigInt, datasetId)
        .input("columnName", sql.NVarChar(256), rule.columnName)
        .input("sensitivityType", sql.NVarChar(64), rule.sensitivityType)
        .input("deviceMaskMode", sql.VarChar(16), rule.deviceMaskMode)
        .input("customMaskJson", sql.NVarChar(256), rule.deviceMaskMode === "CUSTOM" ? JSON.stringify(rule.customMask) : null)
        .input("userId", sql.BigInt, userId)
        .query("INSERT INTO uqp.DatasetSensitiveColumn (DatasetId, ColumnName, SensitivityType, DeviceMaskMode, CustomMaskJson, UpdatedByUserId) VALUES (@datasetId,@columnName,@sensitivityType,@deviceMaskMode,@customMaskJson,@userId)");
    }
    await recordTemplateApplications(transaction,datasetId,currentVersion+1,userId,templateApplications,rules);
    const details = JSON.stringify({ before: before.recordset, after: rules, templateApplications,
      ...(review ? { review: { kind:"MANAGER_EXPLICIT_NONPATIENT_V1",
        expectedDefinitionVersion: review.expectedDefinitionVersion,
        expectedSourceVersion: review.expectedSourceVersion, requestId: review.requestId } } : {}) });
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
    if (review) await review.reauthorize(transaction);
    await transaction.commit();
    return currentVersion + 1;
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

/** Dashboard-only extension: ordinary query/export policy contracts are unchanged. */
export async function getDashboardSensitivitySnapshot(datasetId: number) {
  const sensitivity = await getDatasetSensitivitySnapshot(datasetId);
  const patientAudit = await patientAuditService.dashboardState(datasetId);
  try{assertDatasetAuditOnlyPolicy(sensitivity,patientAudit.config?.patientKeyColumn??null);}catch{throw new Error("DASHBOARD_SENSITIVITY_POLICY_INVALID");}
  return { ...sensitivity, patientAudit };
}
