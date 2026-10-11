import sql from "mssql";
import { getPlatformDbPool } from "../../config/database.js";
import { hashPatientForDisclosure, type PatientAuditKeyring } from "./patientAuditKeyring.js";

export type PatientListDisclosureInput = {
  userId: number | null;
  workstationId?: number | null;
  sessionId?: string | null;
  queryDefinitionId?: number | null;
  datasetId: number;
  deliveryType: "MANUAL" | "PAGE" | "AUTO_REFRESH" | "DASHBOARD";
  pageNumber?: number | null;
  masked: boolean;
  patientKeyColumn: string;
  sourceScope: string;
  rows: ReadonlyArray<Record<string, unknown>>;
  keyring: PatientAuditKeyring;
};

/**
 * Fail-closed persistence: callers MUST await completion before returning any
 * patient-bearing response to a client. Do not swallow errors.
 */
export async function persistPatientListDisclosure(input: PatientListDisclosureInput): Promise<number> {
  if (input.rows.length > 10000) throw new Error("PATIENT_AUDIT_TOO_MANY_ROWS");
  if (!input.patientKeyColumn || !input.sourceScope) throw new Error("PATIENT_AUDIT_CONFIG_INVALID");
  if (input.rows.some(row => !Object.prototype.hasOwnProperty.call(row, input.patientKeyColumn))) {
    throw new Error("PATIENT_AUDIT_COLUMN_MISSING");
  }
  const digests = new Map<string, { version: number; digest: Buffer }>();
  for (const row of input.rows) {
    const item = hashPatientForDisclosure(row[input.patientKeyColumn], input.sourceScope, input.keyring);
    digests.set(item.patientKeyHash.toString("hex"), { version: item.keyVersion, digest: item.patientKeyHash });
  }
  const pool = await getPlatformDbPool();
  if (!pool) throw new Error("PLATFORM_DB_NOT_CONFIGURED");
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const inserted = await new sql.Request(tx)
      .input("userId", sql.BigInt, input.userId)
      .input("workstationId", sql.BigInt, input.workstationId ?? null)
      .input("sessionId", sql.UniqueIdentifier, input.sessionId ?? null)
      .input("queryDefinitionId", sql.BigInt, input.queryDefinitionId ?? null)
      .input("datasetId", sql.BigInt, input.datasetId)
      .input("deliveryType", sql.NVarChar(20), input.deliveryType)
      .input("rowCount", sql.Int, input.rows.length)
      .input("pageNumber", sql.Int, input.pageNumber ?? null)
      .input("masked", sql.Bit, input.masked)
      .query(`
        INSERT INTO uqp.PatientListDisclosure
          (UserId, WorkstationId, SessionId, QueryDefinitionId, DatasetId,
           DeliveryType, RowCount, PageNumber, Masked)
        OUTPUT INSERTED.Id AS id
        VALUES (@userId,@workstationId,@sessionId,@queryDefinitionId,@datasetId,
                @deliveryType,@rowCount,@pageNumber,@masked)
      `);
    const disclosureId = Number(inserted.recordset[0].id);
    for (const item of digests.values()) {
      await new sql.Request(tx)
        .input("disclosureId", sql.BigInt, disclosureId)
        .input("version", sql.Int, item.version)
        .input("hash", sql.VarBinary(32), item.digest)
        .query(`
          INSERT INTO uqp.PatientListDisclosureSubject
            (DisclosureId, KeyVersion, PatientKeyHash)
          VALUES (@disclosureId, @version, @hash)
        `);
    }
    await tx.commit();
    return disclosureId;
  } catch (error) {
    await tx.rollback();
    throw error;
  }
}
