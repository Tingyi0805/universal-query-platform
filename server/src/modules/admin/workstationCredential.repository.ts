import { randomUUID } from "node:crypto";
import sql from "mssql";
import { getPlatformDbPool } from "../../config/database.js";
import { createDeviceSecret, hashDeviceSecret } from "../auth/workstationCredential.service.js";

export type DeviceCredentialInfo = {
  id: string; createdAtUtc: string; revokedAtUtc: string | null;
};

export async function listDeviceCredentials(workstationId: number): Promise<DeviceCredentialInfo[] | null> {
  const pool = await getPlatformDbPool();
  if (!pool) return null;
  const result = await pool.request().input("workstationId", sql.BigInt, workstationId).query(`
    SELECT c.Id AS id, c.CreatedAtUtc AS createdAtUtc, c.RevokedAtUtc AS revokedAtUtc
    FROM uqp.SharedWorkstationCredential c
    WHERE c.WorkstationId=@workstationId ORDER BY c.CreatedAtUtc DESC
  `);
  return result.recordset;
}

export async function issueDeviceCredential(workstationId: number):
  Promise<{ id: string; secret: string } | "NOT_CONFIGURED" | "NOT_FOUND"> {
  const pool = await getPlatformDbPool();
  if (!pool) return "NOT_CONFIGURED";
  const secret = createDeviceSecret();
  const id = randomUUID();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const workstation = await new sql.Request(transaction).input("id", sql.BigInt, workstationId).query(`
      SELECT CredentialVersion FROM uqp.SharedWorkstation WITH (UPDLOCK, HOLDLOCK)
      WHERE Id=@id AND IsActive=1
    `);
    if (!workstation.recordset.length) { await transaction.rollback(); return "NOT_FOUND"; }
    await new sql.Request(transaction).input("id", sql.UniqueIdentifier, id)
      .input("workstationId", sql.BigInt, workstationId)
      .input("secretHash", sql.VarBinary(32), hashDeviceSecret(secret))
      .input("version", sql.Int, workstation.recordset[0].CredentialVersion).query(`
        INSERT INTO uqp.SharedWorkstationCredential
          (Id, WorkstationId, SecretHash, CredentialVersion)
        VALUES (@id, @workstationId, @secretHash, @version)
      `);
    await transaction.commit();
    return { id, secret };
  } catch (error) { await transaction.rollback(); throw error; }
}

export async function revokeDeviceCredential(workstationId: number, credentialId: string):
  Promise<"OK" | "NOT_FOUND" | "NOT_CONFIGURED"> {
  const pool = await getPlatformDbPool();
  if (!pool) return "NOT_CONFIGURED";
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const result = await new sql.Request(transaction)
      .input("workstationId", sql.BigInt, workstationId)
      .input("credentialId", sql.UniqueIdentifier, credentialId).query(`
        UPDATE uqp.SharedWorkstationCredential
          SET IsRevoked=1, RevokedAtUtc=SYSUTCDATETIME()
        WHERE Id=@credentialId AND WorkstationId=@workstationId AND IsRevoked=0
      `);
    if (!result.rowsAffected[0]) { await transaction.rollback(); return "NOT_FOUND"; }
    await new sql.Request(transaction).input("workstationId", sql.BigInt, workstationId).query(`
      UPDATE uqp.SharedWorkstationSession SET RevokedAtUtc=SYSUTCDATETIME()
      WHERE WorkstationId=@workstationId AND RevokedAtUtc IS NULL
    `);
    await transaction.commit();
    return "OK";
  } catch (error) { await transaction.rollback(); throw error; }
}
