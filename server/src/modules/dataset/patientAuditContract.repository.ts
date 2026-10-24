import sql from "mssql";
import { getPlatformDbPool } from "../../config/database.js";
import { writeAuditEvent } from "../audit/audit.repository.js";
import { parsePatientAuditKeyring } from "../audit/patientAuditKeyring.js";
import { requireSecuritySchema } from "../securityContract/securityContract.repository.js";
import { parseConfigurationVersion } from "../securityContract/securityContract.js";
import { createPatientAuditService, PatientAuditError, type PatientAuditStore } from "./patientAuditConfig.service.js";

type Dependencies = { getPool: typeof getPlatformDbPool; createTransaction: (pool: sql.ConnectionPool) => sql.Transaction;
  createRequest: (tx: sql.Transaction) => sql.Request; audit: typeof writeAuditEvent };
export function createPatientAuditStore(deps: Dependencies): PatientAuditStore {
  return { async transaction(run, existingTransaction) {
    const pool = existingTransaction ? null : await deps.getPool();
    if (!existingTransaction && !pool) throw new PatientAuditError("SECURITY_SCHEMA_REQUIRED", 503);
    const tx = existingTransaction ?? deps.createTransaction(pool!);
    if (!existingTransaction) await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    const request = () => deps.createRequest(tx);
    try {
      await request().query("SET XACT_ABORT ON");
      await requireSecuritySchema(request());
      const result = await run({
        async read(id) {
          const dataset = await request().input("id", sql.BigInt, id).query(`
            SELECT SqlText, DataSourceId FROM uqp.Dataset WITH (UPDLOCK,HOLDLOCK) WHERE Id=@id`);
          if (!dataset.recordset[0]) throw new PatientAuditError("DATASET_NOT_FOUND", 404);
          if (!Number.isSafeInteger(Number(dataset.recordset[0].DataSourceId)) || Number(dataset.recordset[0].DataSourceId) < 1)
            throw new PatientAuditError("PATIENT_AUDIT_DEFINITION_INVALID", 503);
          const config = await request().input("id", sql.BigInt, id).query(`
            SELECT IsEnabled, PatientKeyColumn, CONVERT(VARCHAR(20),ConfigurationVersion) AS Version
            FROM uqp.DatasetPatientAuditConfig WITH (UPDLOCK,HOLDLOCK) WHERE DatasetId=@id`);
          const metadata = await request().input("id", sql.BigInt, id).query(`
            SELECT DefinitionHash, ColumnsJson FROM uqp.DatasetPatientAuditMetadata WITH (UPDLOCK,HOLDLOCK) WHERE DatasetId=@id`);
          const names = await request().input("id", sql.BigInt, id).query(`
            SELECT ColumnName FROM uqp.DatasetSensitiveColumn WITH (HOLDLOCK) WHERE DatasetId=@id AND SensitivityType='NAME'`);
          let columns: unknown = null;
          try { columns = JSON.parse(String(metadata.recordset[0]?.ColumnsJson)); } catch { /* unconfirmed */ }
          const c = config.recordset[0];
          if (c) parseConfigurationVersion(c.Version, false);
          return { definition: { sqlText: String(dataset.recordset[0].SqlText), dataSourceId: Number(dataset.recordset[0].DataSourceId) },
            config: c ? { isEnabled: Boolean(c.IsEnabled), patientKeyColumn: String(c.PatientKeyColumn), version: c.Version as string } : null,
            metadata: metadata.recordset[0] ? { definitionHash: String(metadata.recordset[0].DefinitionHash), columns: Array.isArray(columns) ? columns : [] } : null,
            nameColumns: names.recordset.map(row => String(row.ColumnName)) };
        },
        async save(id, config) {
          // Only called after Dataset row/range locks and expectedVersion validation.
          await request().input("id", sql.BigInt, id).input("column", sql.NVarChar(128), config.patientKeyColumn).input("enabled", sql.Bit, config.isEnabled)
            .input("version", sql.VarChar(20), config.version).query(`
              UPDATE uqp.DatasetPatientAuditConfig SET IsEnabled=@enabled,PatientKeyColumn=@column,
                ConfigurationVersion=CONVERT(BIGINT,@version),UpdatedAtUtc=SYSUTCDATETIME() WHERE DatasetId=@id;
              IF @@ROWCOUNT=0 INSERT INTO uqp.DatasetPatientAuditConfig(DatasetId,IsEnabled,PatientKeyColumn,ConfigurationVersion)
                VALUES(@id,@enabled,@column,CONVERT(BIGINT,@version));`);
        },
        async metadata(id, metadata) {
          if (!metadata) { await request().input("id", sql.BigInt, id).query("DELETE FROM uqp.DatasetPatientAuditMetadata WHERE DatasetId=@id"); return; }
          await request().input("id", sql.BigInt, id).input("hash", sql.Char(64), metadata.definitionHash)
            .input("columns", sql.NVarChar(sql.MAX), JSON.stringify(metadata.columns)).query(`
              UPDATE uqp.DatasetPatientAuditMetadata SET DefinitionHash=@hash,ColumnsJson=@columns WHERE DatasetId=@id;
              IF @@ROWCOUNT=0 INSERT INTO uqp.DatasetPatientAuditMetadata(DatasetId,DefinitionHash,ColumnsJson) VALUES(@id,@hash,@columns);`);
        },
        async audit(id, userId, config, context) {
          await deps.audit({ eventType: "DATASET_PATIENT_AUDIT_CONFIG_UPDATED", userId, datasetId: id,
            parameters: { version: config.version, patientKeyColumn: config.patientKeyColumn, isEnabled: config.isEnabled }, ...context }, tx);
        },
      });
      if (!existingTransaction) await tx.commit(); return result;
    } catch (error) { try { if (!existingTransaction) await tx.rollback(); } catch { /* preserve original error; never return success */ } throw error; }
  } };
}
export const patientAuditService = createPatientAuditService(createPatientAuditStore({ getPool: getPlatformDbPool,
  createTransaction: pool => new sql.Transaction(pool), createRequest: tx => new sql.Request(tx), audit: writeAuditEvent }),
  () => parsePatientAuditKeyring(process.env.PATIENT_AUDIT_ACTIVE_KEY_VERSION, process.env.PATIENT_AUDIT_HMAC_KEYRING_JSON));

/** Called with the Dataset row locked. Dynamic SQL is needed on installations before 919. */
export async function invalidatePatientMetadata(tx: sql.Transaction, datasetId: number): Promise<void> {
  await new sql.Request(tx).input("datasetId", sql.BigInt, datasetId).query(`
    IF OBJECT_ID(N'uqp.DatasetPatientAuditMetadata',N'U') IS NOT NULL
      EXEC sys.sp_executesql N'DELETE FROM uqp.DatasetPatientAuditMetadata WHERE DatasetId=@id', N'@id BIGINT', @id=@datasetId;`);
}
