import { createHash, timingSafeEqual } from "node:crypto";
import sql from "mssql";
import { env } from "../../config/env.js";
import { getPlatformDbPool } from "../../config/database.js";
import { getTokenSessionState } from "./auth.repository.js";
import { matchesDeviceSecret } from "./workstationCredential.service.js";
import { parseOpaqueToken, pinSessionHash } from "./workstationCookies.js";

export const pinIdleSeconds = 180;
export const pinAbsoluteSeconds = 60 * 60;
export type WorkstationBinding = { workstationId: number; credentialVersion: number; generation: string };
export type PinActor = WorkstationBinding & { sessionId: string; userId: number; username: string; displayName: string;
  tokenVersion: number; pinVersion: number; permissions: string[]; authMethod: "PIN" };
export const allowedWorkstationUserSql = `(EXISTS (SELECT 1 FROM uqp.SharedWorkstationUser wu
  WHERE wu.WorkstationId=w.Id AND wu.UserId=u.Id AND wu.IsAllowed=1)
  OR EXISTS (SELECT 1 FROM uqp.SharedWorkstationAudience wa
    JOIN uqp.WorkstationAudience a ON a.Id=wa.AudienceId AND a.IsActive=1
    JOIN uqp.WorkstationAudienceMember am ON am.AudienceId=a.Id
    WHERE wa.WorkstationId=w.Id AND am.UserId=u.Id))`;
const defaults = {
  enabled: () => env.WORKSTATION_PIN_RUNTIME, getPool: getPlatformDbPool,
  request: (tx: sql.Transaction) => new sql.Request(tx), userState: getTokenSessionState,
};
export function createWorkstationSessions(deps = defaults) {
  async function request(tx?: sql.Transaction) {
    if (!deps.enabled()) throw new Error("PIN_RUNTIME_DISABLED");
    if (tx) return deps.request(tx);
    const pool = await deps.getPool();
    if (!pool) throw new Error("PIN_RUNTIME_NOT_CONFIGURED");
    return pool.request();
  }
  async function credential(value: string, tx?: sql.Transaction): Promise<WorkstationBinding | null> {
    const parsed = parseOpaqueToken(value);
    if (!parsed) return null;
    const result = await (await request(tx)).input("credentialId", sql.UniqueIdentifier, parsed.id).query(`
      SELECT c.SecretHash,w.Id,w.CredentialVersion,CONVERT(varchar(20),w.SwitchVersion) AS Generation
      FROM uqp.SharedWorkstationCredential c JOIN uqp.SharedWorkstation w ON w.Id=c.WorkstationId
      WHERE c.Id=@credentialId AND c.IsRevoked=0 AND c.CredentialVersion=w.CredentialVersion
        AND w.IsActive=1 AND w.PinLoginEnabled=1 AND w.RetiredAtUtc IS NULL AND w.PurposeCode=N'SHARED_QUERY';`);
    const row = result.recordset[0];
    if (!row || !Buffer.isBuffer(row.SecretHash) || !matchesDeviceSecret(parsed.secret, row.SecretHash)) return null;
    const workstationId = Number(row.Id), credentialVersion = Number(row.CredentialVersion), generation = row.Generation;
    if (!Number.isSafeInteger(workstationId) || workstationId < 1 || !Number.isSafeInteger(credentialVersion) || credentialVersion < 1
      || typeof generation !== "string" || !/^\d{1,19}$/.test(generation)) return null;
    return { workstationId, credentialVersion, generation };
  }
  async function candidate(username: string, binding: WorkstationBinding, tx: sql.Transaction) {
    // Match enrollment/policy writers: policy row before user and PIN rows.
    await (await request(tx)).query("SELECT PinLength FROM uqp.QuickPinPolicy WITH (HOLDLOCK) WHERE Id=1");
    const result = await (await request(tx)).input("workstationId", sql.BigInt, binding.workstationId)
      .input("username", sql.NVarChar(100), username).query(`
      SELECT u.Id,u.Username,u.DisplayName,u.TokenVersion,p.PinVersion,p.PinHash,q.PinLength
      FROM uqp.AppUser u WITH (UPDLOCK,HOLDLOCK)
      JOIN uqp.UserQuickPin p WITH (UPDLOCK,HOLDLOCK) ON p.UserId=u.Id AND p.IsEnabled=1
      JOIN uqp.SharedWorkstation w ON w.Id=@workstationId
      CROSS JOIN uqp.QuickPinPolicy q
      WHERE u.Username=@username AND u.IsActive=1 AND u.AuthProvider=N'LOCAL'
        AND (p.LockedUntilUtc IS NULL OR p.LockedUntilUtc<=SYSUTCDATETIME()) AND ${allowedWorkstationUserSql};`);
    return result.recordset.length === 1 ? result.recordset[0] : null;
  }
  async function accountBucketIdentity(username: string) {
    // Resolve aliases with the database's actual username collation. Different
    // spellings of one account must share the same failure bucket.
    const result = await (await request()).input("username", sql.NVarChar(100), username.trim()).query(`
      SELECT CONVERT(varchar(20),Id) AS AccountId FROM uqp.AppUser WHERE Username=@username;`);
    const id = result.recordset[0]?.AccountId;
    return typeof id === "string" && /^[1-9]\d{0,18}$/.test(id) ? `user:${id}`
      : `missing:${createHash("sha256").update(username.trim().normalize("NFKC").toLowerCase()).digest("hex")}`;
  }
  async function expire(binding: WorkstationBinding, tx: sql.Transaction): Promise<number[]> {
    const result = await (await request(tx)).input("id", sql.BigInt, binding.workstationId).input("idleSeconds", sql.Int, pinIdleSeconds).query(`
      UPDATE uqp.SharedWorkstationSession SET RevokedAtUtc=SYSUTCDATETIME()
        OUTPUT INSERTED.UserId
      WHERE WorkstationId=@id AND RevokedAtUtc IS NULL AND AuthMethod=N'PIN'
        AND (ExpiresAtUtc<=SYSUTCDATETIME() OR LastActivityAtUtc<=DATEADD(SECOND,-@idleSeconds,SYSUTCDATETIME()));`);
    return result.recordset.map(row => Number(row.UserId));
  }
  async function insert(token: string, credentialValue: string, binding: WorkstationBinding,
    user: { Id: number; TokenVersion: number; PinVersion: number }, tx: sql.Transaction) {
    const parsed = parseOpaqueToken(token);
    if (!parsed) throw new Error("PIN_SESSION_INVALID");
    await (await request(tx)).input("id", sql.UniqueIdentifier, parsed.id).input("workstationId", sql.BigInt, binding.workstationId)
      .input("userId", sql.BigInt, user.Id).input("hash", sql.VarBinary(32), pinSessionHash(token, credentialValue, binding.credentialVersion, binding.generation))
      .input("tokenVersion", sql.Int, user.TokenVersion).input("pinVersion", sql.Int, user.PinVersion)
      .input("absoluteSeconds", sql.Int, pinAbsoluteSeconds).query(`
      INSERT INTO uqp.SharedWorkstationSession (Id,WorkstationId,UserId,SessionSecretHash,AuthMethod,
        AuthenticatedAtUtc,LastActivityAtUtc,ExpiresAtUtc,TokenVersion,PinVersion)
      VALUES (@id,@workstationId,@userId,@hash,N'PIN',SYSUTCDATETIME(),SYSUTCDATETIME(),
        DATEADD(SECOND,@absoluteSeconds,SYSUTCDATETIME()),@tokenVersion,@pinVersion);`);
  }
  /** No activity extension here: repeated delivery checks and background polling
   * must not keep a workstation unlocked. Only the explicit activity route touches it.
   */
  async function read(token: string, credentialValue: string, tx?: sql.Transaction): Promise<PinActor | null> {
    const parsed = parseOpaqueToken(token);
    if (!parsed) return null;
    const binding = await credential(credentialValue, tx);
    if (!binding) return null;
    const result = await (await request(tx)).input("id", sql.UniqueIdentifier, parsed.id)
      .input("workstationId", sql.BigInt, binding.workstationId).input("idleSeconds", sql.Int, pinIdleSeconds).query(`
      SELECT s.SessionSecretHash,s.UserId,s.TokenVersion,s.PinVersion,u.Username,u.DisplayName
      FROM uqp.SharedWorkstationSession s
      JOIN uqp.SharedWorkstation w ON w.Id=s.WorkstationId
      JOIN uqp.AppUser u ON u.Id=s.UserId AND u.IsActive=1 AND u.AuthProvider=N'LOCAL' AND u.TokenVersion=s.TokenVersion
      JOIN uqp.UserQuickPin p ON p.UserId=u.Id AND p.IsEnabled=1 AND p.PinVersion=s.PinVersion
      WHERE s.Id=@id AND s.WorkstationId=@workstationId AND s.AuthMethod=N'PIN' AND s.RevokedAtUtc IS NULL
        AND s.ExpiresAtUtc>SYSUTCDATETIME() AND s.LastActivityAtUtc>DATEADD(SECOND,-@idleSeconds,SYSUTCDATETIME())
        AND ${allowedWorkstationUserSql};`);
    const row = result.recordset[0];
    const expected = pinSessionHash(token, credentialValue, binding.credentialVersion, binding.generation);
    if (!row || !Buffer.isBuffer(row.SessionSecretHash) || row.SessionSecretHash.length !== expected.length
      || !timingSafeEqual(row.SessionSecretHash, expected)) return null;
    const live = await deps.userState(Number(row.UserId), tx);
    if (!live?.isActive || live.tokenVersion !== Number(row.TokenVersion)) return null;
    return { ...binding, sessionId: parsed.id, userId: Number(row.UserId), username: String(row.Username), displayName: String(row.DisplayName),
      tokenVersion: Number(row.TokenVersion), pinVersion: Number(row.PinVersion), permissions: live.permissions.filter(p => ["VIEW_QUERY", "EXECUTE_QUERY"].includes(p)), authMethod: "PIN" };
  }
  async function touch(token: string, credentialValue: string, tx: sql.Transaction) {
    const actor = await read(token, credentialValue, tx);
    if (!actor) return null;
    const result = await (await request(tx)).input("id", sql.UniqueIdentifier, actor.sessionId).input("idleSeconds", sql.Int, pinIdleSeconds).query(`
      UPDATE uqp.SharedWorkstationSession SET LastActivityAtUtc=SYSUTCDATETIME()
      WHERE Id=@id AND RevokedAtUtc IS NULL AND ExpiresAtUtc>SYSUTCDATETIME()
        AND LastActivityAtUtc>DATEADD(SECOND,-@idleSeconds,SYSUTCDATETIME());`);
    return result.rowsAffected[0] === 1 ? actor : null;
  }
  return { credential, candidate, accountBucketIdentity, expire, insert, read, touch };
}
export const workstationSessions = createWorkstationSessions();
