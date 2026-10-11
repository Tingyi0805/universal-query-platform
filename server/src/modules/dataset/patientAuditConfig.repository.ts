import sql from "mssql";
import { getPlatformDbPool } from "../../config/database.js";

export type DatasetPatientAuditConfig = { isEnabled: boolean; patientKeyColumn: string };

export async function getDatasetPatientAuditConfig(datasetId: number): Promise<DatasetPatientAuditConfig | null> {
  const pool = await getPlatformDbPool();
  if (!pool) throw new Error("PLATFORM_DB_NOT_CONFIGURED");
  const result = await pool.request().input("datasetId", sql.BigInt, datasetId).query(`
    SELECT IsEnabled, PatientKeyColumn FROM uqp.DatasetPatientAuditConfig WHERE DatasetId=@datasetId
  `);
  const row = result.recordset[0];
  return row ? { isEnabled: Boolean(row.IsEnabled), patientKeyColumn: String(row.PatientKeyColumn) } : null;
}

export async function saveDatasetPatientAuditConfig(datasetId: number, config: DatasetPatientAuditConfig): Promise<void> {
  const pool = await getPlatformDbPool();
  if (!pool) throw new Error("PLATFORM_DB_NOT_CONFIGURED");
  const result = await pool.request().input("datasetId", sql.BigInt, datasetId)
    .input("enabled", sql.Bit, config.isEnabled)
    .input("column", sql.NVarChar(128), config.patientKeyColumn).query(`
      SET XACT_ABORT ON;
      BEGIN TRANSACTION;
      IF NOT EXISTS (SELECT 1 FROM uqp.Dataset WITH (UPDLOCK, HOLDLOCK) WHERE Id=@datasetId)
        THROW 50011, 'DATASET_NOT_FOUND', 1;
      UPDATE uqp.DatasetPatientAuditConfig WITH (UPDLOCK, SERIALIZABLE)
      SET IsEnabled=@enabled, PatientKeyColumn=@column, UpdatedAtUtc=SYSUTCDATETIME()
      WHERE DatasetId=@datasetId;
      IF @@ROWCOUNT=0
        INSERT INTO uqp.DatasetPatientAuditConfig (DatasetId, IsEnabled, PatientKeyColumn)
        VALUES (@datasetId, @enabled, @column);
      COMMIT TRANSACTION;
    `);
  void result;
}
