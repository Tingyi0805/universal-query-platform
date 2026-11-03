import { createHmac } from "node:crypto";
import sql from "mssql";
import { env } from "../../config/env.js";
import { getPlatformDbPool } from "../../config/database.js";

type Scope = "ACCOUNT" | "NETWORK" | "WORKSTATION";
export type PinBucket = { scope: Scope; digest: Buffer; limit: number };
export function pinAttemptBuckets(account: string, workstationId: number, network: string, key: Buffer): PinBucket[] {
  if (!account || account.length > 200 || !network || network.length > 200 || key.length !== 32 ||
      !Number.isSafeInteger(workstationId) || workstationId <= 0) throw new Error("PIN_ATTEMPT_INPUT_INVALID");
  const bucket = (scope: Scope, value: string, limit: number): PinBucket => ({ scope, limit,
    digest: createHmac("sha256", key).update(`uqp:pin-attempt:v1\0${scope}\0`).update(value).digest() });
  // Caller supplies canonical account and trusted-resolver network identities.
  return [bucket("ACCOUNT", account, 5), bucket("NETWORK", network, 50), bucket("WORKSTATION", String(workstationId), 20)];
}

export type PinStateDependencies = {
  enabled: () => boolean;
  getPool: typeof getPlatformDbPool;
  transaction: (pool: sql.ConnectionPool) => sql.Transaction;
  request: (tx: sql.Transaction) => sql.Request;
};
const defaults: PinStateDependencies = {
  enabled: () => env.WORKSTATION_PIN_RUNTIME, getPool: getPlatformDbPool,
  transaction: pool => new sql.Transaction(pool), request: tx => new sql.Request(tx),
};
export function createWorkstationPinState(deps: PinStateDependencies = defaults) {
  async function transaction<T>(run: (tx: sql.Transaction) => Promise<T>) {
    if (!deps.enabled()) throw new Error("PIN_RUNTIME_DISABLED");
    const pool = await deps.getPool();
    if (!pool) throw new Error("PIN_RUNTIME_NOT_CONFIGURED");
    const tx = deps.transaction(pool);
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    try {
      // Same configuration lock as existing management writers, acquired first.
      await deps.request(tx).query(`DECLARE @lock int;
        EXEC @lock=sys.sp_getapplock @Resource=N'uqp.workstation.config',
          @LockMode=N'Shared',@LockOwner=N'Transaction',@LockTimeout=5000;
        IF @lock<0 THROW 51927,'PIN_CONFIG_BUSY',1;`);
      const result = await run(tx);
      await tx.commit();
      return result;
    } catch (error) { await tx.rollback().catch(() => undefined); throw error; }
  }

  /** Hold all three bucket locks through verification and its audited result.
   * Callback must revalidate live identity and perform final Session CAS/Audit
   * on this transaction. No independent transaction may be started inside it.
   */
  async function attempt(buckets: PinBucket[], verifyAndAudit: (tx: sql.Transaction) => Promise<boolean>): Promise<"OK" | "INVALID" | "LOCKED"> {
    const ordered = [...buckets].sort((a, b) => a.scope.localeCompare(b.scope, "en"));
    if (ordered.length !== 3 || ordered.map(b => b.scope).join(",") !== "ACCOUNT,NETWORK,WORKSTATION" ||
        ordered.some(b => b.digest.length !== 32 || b.limit !== ({ ACCOUNT: 5, NETWORK: 50, WORKSTATION: 20 })[b.scope]))
      throw new Error("PIN_ATTEMPT_INPUT_INVALID");
    return transaction(async tx => {
      // Lock exact logical keys before any range reads/inserts, including missing accounts.
      for (const b of ordered) {
        await deps.request(tx).input("resource", sql.NVarChar(255), `uqp.pin:${b.scope}:${b.digest.toString("hex")}`).query(`DECLARE @lock int;
          EXEC @lock=sys.sp_getapplock @Resource=@resource,@LockMode=N'Exclusive',@LockOwner=N'Transaction',@LockTimeout=5000;
          IF @lock<0 THROW 51927,'PIN_ATTEMPT_BUSY',1;`);
      }
      for (const b of ordered) {
        const result = await deps.request(tx).input("scope", sql.NVarChar(16), b.scope).input("digest", sql.VarBinary(32), b.digest).query(`
          SELECT CASE WHEN EXISTS (SELECT 1 FROM uqp.WorkstationPinAttemptBucket WITH (UPDLOCK,HOLDLOCK)
            WHERE ScopeCode=@scope AND KeyDigest=@digest AND BlockedUntilUtc>SYSUTCDATETIME())
            THEN 1 ELSE 0 END AS IsBlocked;`);
        if (!result.recordset[0] || result.recordset[0].IsBlocked === 1) return "LOCKED";
      }
      // Check all scopes before allocating missing keys. A blocked network must
      // not allow unlimited new account rows, including unknown account names.
      for (const b of ordered) {
        await deps.request(tx).input("scope", sql.NVarChar(16), b.scope).input("digest", sql.VarBinary(32), b.digest).query(`
          DECLARE @now datetime2(3)=SYSUTCDATETIME();
          IF NOT EXISTS (SELECT 1 FROM uqp.WorkstationPinAttemptBucket WITH (UPDLOCK,HOLDLOCK) WHERE ScopeCode=@scope AND KeyDigest=@digest)
            INSERT INTO uqp.WorkstationPinAttemptBucket (ScopeCode,KeyDigest,WindowStartedAtUtc) VALUES (@scope,@digest,@now);
          UPDATE uqp.WorkstationPinAttemptBucket SET FailedAttempts=0,BlockedUntilUtc=NULL,WindowStartedAtUtc=@now,UpdatedAtUtc=@now
            WHERE ScopeCode=@scope AND KeyDigest=@digest AND WindowStartedAtUtc<=DATEADD(MINUTE,-15,@now)
              AND (BlockedUntilUtc IS NULL OR BlockedUntilUtc<=@now);`);
      }
      const valid = await verifyAndAudit(tx);
      if (valid) {
        // A valid identity never clears shared network/workstation failure history.
        const account = ordered[0]!;
        await deps.request(tx).input("digest", sql.VarBinary(32), account.digest).query(`
          UPDATE uqp.WorkstationPinAttemptBucket SET FailedAttempts=0,BlockedUntilUtc=NULL,
            WindowStartedAtUtc=SYSUTCDATETIME(),UpdatedAtUtc=SYSUTCDATETIME()
          WHERE ScopeCode=N'ACCOUNT' AND KeyDigest=@digest;`);
        return "OK";
      }
      for (const b of ordered) {
        await deps.request(tx).input("scope", sql.NVarChar(16), b.scope).input("digest", sql.VarBinary(32), b.digest).input("limit", sql.Int, b.limit).query(`
          UPDATE uqp.WorkstationPinAttemptBucket SET
            FailedAttempts=CASE WHEN FailedAttempts<2147483647 THEN FailedAttempts+1 ELSE FailedAttempts END,
            BlockedUntilUtc=CASE WHEN FailedAttempts>=@limit-1 THEN DATEADD(MINUTE,15,SYSUTCDATETIME())
              WHEN ScopeCode=N'ACCOUNT' AND FailedAttempts>=3 THEN DATEADD(SECOND,30,SYSUTCDATETIME())
              WHEN ScopeCode=N'ACCOUNT' AND FailedAttempts>=2 THEN DATEADD(SECOND,5,SYSUTCDATETIME()) ELSE NULL END,
            UpdatedAtUtc=SYSUTCDATETIME()
          WHERE ScopeCode=@scope AND KeyDigest=@digest;`);
      }
      return "INVALID";
    });
  }

  /** Phase one only: commit A revocation before any B PIN verification. */
  async function revokeForIntent(workstationId: number, audit: (tx: sql.Transaction, generation: string) => Promise<void>): Promise<string> {
    if (!Number.isSafeInteger(workstationId) || workstationId <= 0) throw new Error("PIN_WORKSTATION_INVALID");
    return transaction(async tx => {
      const result = await deps.request(tx).input("id", sql.BigInt, workstationId).query(`
        DECLARE @version table (Version bigint);
        UPDATE uqp.SharedWorkstation WITH (UPDLOCK,HOLDLOCK) SET SwitchVersion=SwitchVersion+1,UpdatedAtUtc=SYSUTCDATETIME()
          OUTPUT INSERTED.SwitchVersion INTO @version
          WHERE Id=@id AND SwitchVersion<9223372036854775807;
        SELECT CONVERT(varchar(20),Version) AS Generation FROM @version;`);
      const generation = result.recordset[0]?.Generation;
      if (typeof generation !== "string" || !/^[1-9]\d{0,18}$/.test(generation)) throw new Error("PIN_WORKSTATION_INVALID");
      await deps.request(tx).input("id", sql.BigInt, workstationId).query(`
        UPDATE uqp.SharedWorkstationSession SET RevokedAtUtc=SYSUTCDATETIME()
        WHERE WorkstationId=@id AND RevokedAtUtc IS NULL;`);
      await audit(tx, generation);
      return generation;
    });
  }

  /** Phase two guard; caller inserts B and audits in this same transaction.
   * Valid credential, live user/PIN version and allowlist checks remain mandatory.
   */
  async function claimGeneration(tx: sql.Transaction, workstationId: number, generation: string): Promise<boolean> {
    if (!deps.enabled()) throw new Error("PIN_RUNTIME_DISABLED");
    if (!Number.isSafeInteger(workstationId) || workstationId <= 0 || !/^[1-9]\d{0,18}$/.test(generation) || BigInt(generation)>9223372036854775807n)
      throw new Error("PIN_GENERATION_INVALID");
    const result = await deps.request(tx).input("id", sql.BigInt, workstationId).input("generation", sql.VarChar(20), generation).query(`
      UPDATE uqp.SharedWorkstation WITH (UPDLOCK,HOLDLOCK) SET UpdatedAtUtc=SYSUTCDATETIME()
      WHERE Id=@id AND SwitchVersion=CONVERT(bigint,@generation) AND IsActive=1 AND PinLoginEnabled=1
        AND RetiredAtUtc IS NULL AND PurposeCode=N'SHARED_QUERY';`);
    return result.rowsAffected[0] === 1;
  }
  return { attempt, revokeForIntent, claimGeneration, transaction };
}
