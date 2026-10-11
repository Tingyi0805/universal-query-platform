import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import sql from "mssql";
import { getPlatformDbPool } from "../../config/database.js";

export const DEVICE_SECRET_BYTES = 32;

export function createDeviceSecret(): string {
  return randomBytes(DEVICE_SECRET_BYTES).toString("base64url");
}

export function hashDeviceSecret(secret: string): Buffer {
  return createHash("sha256").update(secret, "utf8").digest();
}

export function matchesDeviceSecret(candidate: string, storedHash: Buffer): boolean {
  if (!/^[A-Za-z0-9_-]{43}$/.test(candidate) || storedHash.length !== 32) return false;
  const computed = hashDeviceSecret(candidate);
  return timingSafeEqual(computed, storedHash);
}

export async function verifyWorkstationCredential(
  credentialId: string, secret: string
): Promise<{ workstationId: number } | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(credentialId)
    || !/^[A-Za-z0-9_-]{43}$/.test(secret)) return null;
  const pool = await getPlatformDbPool();
  if (!pool) return null;
  const result = await pool.request().input("credentialId", sql.UniqueIdentifier, credentialId).query(`
    SELECT c.WorkstationId, c.SecretHash
    FROM uqp.SharedWorkstationCredential c
    INNER JOIN uqp.SharedWorkstation w ON w.Id=c.WorkstationId
    WHERE c.Id=@credentialId AND c.IsRevoked=0 AND w.IsActive=1
      AND c.CredentialVersion=w.CredentialVersion
  `);
  const row = result.recordset[0] as { WorkstationId: number; SecretHash: Buffer } | undefined;
  return row && matchesDeviceSecret(secret, row.SecretHash)
    ? { workstationId: Number(row.WorkstationId) } : null;
}
