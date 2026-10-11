import sql from "mssql";
import { getPlatformDbPool } from "../../config/database.js";

export type WorkstationPlatform = "WINDOWS" | "ANDROID" | "IOS" | "UNKNOWN";

export type Workstation = {
  id: number; workstationCode: string; displayName: string; platformCode: WorkstationPlatform;
  isActive: boolean; pinLoginEnabled: boolean; credentialVersion: number;
};

export async function listSharedWorkstations(): Promise<Workstation[] | null> {
  const pool = await getPlatformDbPool();
  if (!pool) return null;
  const result = await pool.request().query(`
    SELECT Id AS id, WorkstationCode AS workstationCode, DisplayName AS displayName, PlatformCode AS platformCode,
      IsActive AS isActive, PinLoginEnabled AS pinLoginEnabled,
      CredentialVersion AS credentialVersion
    FROM uqp.SharedWorkstation ORDER BY DisplayName, Id
  `);
  return result.recordset as Workstation[];
}

export async function createSharedWorkstation(code: string, name: string, platform: WorkstationPlatform): Promise<number | null> {
  const pool = await getPlatformDbPool();
  if (!pool) return null;
  const result = await pool.request().input("code", sql.NVarChar(100), code)
    .input("name", sql.NVarChar(200), name).input("platform", sql.NVarChar(20), platform).query(`
      INSERT INTO uqp.SharedWorkstation (WorkstationCode, DisplayName, PlatformCode, IsActive, PinLoginEnabled)
      OUTPUT INSERTED.Id AS id VALUES (@code, @name, @platform, 0, 0)
    `);
  return Number(result.recordset[0].id);
}

export async function updateSharedWorkstation(id: number, name: string, active: boolean): Promise<"OK" | "NOT_FOUND" | "NOT_CONFIGURED"> {
  const pool = await getPlatformDbPool();
  if (!pool) return "NOT_CONFIGURED";
  const result = await pool.request().input("id", sql.BigInt, id)
    .input("name", sql.NVarChar(200), name).input("active", sql.Bit, active).query(`
      SET XACT_ABORT ON;
      BEGIN TRANSACTION;
      UPDATE uqp.SharedWorkstation SET DisplayName=@name, IsActive=@active,
        PinLoginEnabled=0, CredentialVersion=CredentialVersion+1,
        UpdatedAtUtc=SYSUTCDATETIME() WHERE Id=@id;
      DECLARE @updated INT = @@ROWCOUNT;
      IF @updated=1
        UPDATE uqp.SharedWorkstationSession SET RevokedAtUtc=SYSUTCDATETIME()
          WHERE WorkstationId=@id AND RevokedAtUtc IS NULL;
      COMMIT TRANSACTION;
      SELECT @updated AS updated;
    `);
  return Number(result.recordset[0]?.updated) === 1 ? "OK" : "NOT_FOUND";
}

export async function listWorkstationUsers(workstationId: number): Promise<{ userId: number; username: string; displayName: string }[] | null> {
  const pool = await getPlatformDbPool();
  if (!pool) return null;
  const result = await pool.request().input("workstationId", sql.BigInt, workstationId).query(`
    SELECT u.Id AS userId, u.Username AS username, u.DisplayName AS displayName
    FROM uqp.SharedWorkstationUser wu
    INNER JOIN uqp.AppUser u ON u.Id=wu.UserId
    WHERE wu.WorkstationId=@workstationId AND wu.IsAllowed=1
    ORDER BY u.DisplayName
  `);
  return result.recordset;
}

export async function setWorkstationUsers(workstationId: number, userIds: number[]): Promise<"OK" | "NOT_FOUND" | "INVALID_USER" | "NOT_CONFIGURED"> {
  const pool = await getPlatformDbPool();
  if (!pool) return "NOT_CONFIGURED";
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const lock = await new sql.Request(transaction).input("id", sql.BigInt, workstationId)
      .query("SELECT Id FROM uqp.SharedWorkstation WITH (UPDLOCK, HOLDLOCK) WHERE Id=@id");
    if (lock.recordset.length === 0) { await transaction.rollback(); return "NOT_FOUND"; }
    const users = await new sql.Request(transaction).query(
      "SELECT Id FROM uqp.AppUser WHERE IsActive=1"
    );
    const allowed = new Set<number>(users.recordset.map((row: { Id: number }) => Number(row.Id)));
    if (userIds.some(id => !allowed.has(id))) { await transaction.rollback(); return "INVALID_USER"; }
    await new sql.Request(transaction).input("id", sql.BigInt, workstationId)
      .query("DELETE FROM uqp.SharedWorkstationUser WHERE WorkstationId=@id");
    for (const userId of userIds) {
      await new sql.Request(transaction).input("id", sql.BigInt, workstationId)
        .input("userId", sql.BigInt, userId)
        .query("INSERT INTO uqp.SharedWorkstationUser (WorkstationId, UserId, IsAllowed) VALUES (@id,@userId,1)");
    }
    await new sql.Request(transaction).input("id", sql.BigInt, workstationId).query(`
      UPDATE uqp.SharedWorkstation SET CredentialVersion=CredentialVersion+1,
        PinLoginEnabled=0, UpdatedAtUtc=SYSUTCDATETIME() WHERE Id=@id;
      UPDATE uqp.SharedWorkstationSession SET RevokedAtUtc=SYSUTCDATETIME()
        WHERE WorkstationId=@id AND RevokedAtUtc IS NULL;
    `);
    await transaction.commit();
    return "OK";
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}
