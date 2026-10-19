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
