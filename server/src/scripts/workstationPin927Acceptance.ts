// Real SQL Server 2019/2022 acceptance for Migration 927 in an independently
// created disposable D1 database only. Never load application .env or production data.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import sql from "mssql";
import { workstationPinSchemaSql } from "../modules/auth/workstationPinSchema.js";
import { createWorkstationPinState, pinAttemptBuckets } from "../modules/auth/workstationPinState.repository.js";

const migrations = [
  "902_shared_workstation_foundation.sql",
  "903_quick_pin_policy.sql",
  "904_workstation_device_credentials.sql",
  "905_workstation_platform.sql",
  "916_workstation_management.sql",
] as const;
const batches = (source: string) => source.split(/^\s*GO\s*$/gim).map(x => x.trim()).filter(Boolean);

export async function verify927(
  admin: sql.ConnectionPool,
  config: sql.config,
  machine: string,
): Promise<void> {
  if (process.env.UQP_D1_SCOPE !== "DISPOSABLE_ONLY" ||
      !/^uqp-d1-[a-f0-9]{12}$/.test(machine) ||
      process.env.UQP_D1_CONTAINER_NAME !== machine ||
      Object.keys(process.env).some(k => k.startsWith("PLATFORM_DB_") || k === "DOTENV_CONFIG_PATH"))
    throw new Error("PIN_927_DISPOSABLE_TARGET_REQUIRED");
  const where = (await admin.request().query(
    "SELECT CONVERT(nvarchar(128),SERVERPROPERTY('MachineName')) AS Machine,DB_NAME() AS Db"
  )).recordset[0];
  assert.equal(where.Machine, machine);
  assert.equal(where.Db, "master");
  const name = "UQP_D1_PIN927_" + randomBytes(6).toString("hex");
  let db: sql.ConnectionPool | undefined;
  let created = false;
  let stage = "init";
  try {
    await admin.request().query(`CREATE DATABASE [${name}]`);
    created = true;
    db = await new sql.ConnectionPool({
      ...config, database: name,
      pool: { max: 5, min: 0 },
    }).connect();
    const pool = db;
    const query = (code: string) => pool.request().query(code);
    stage = "wrong-target-and-missing-prerequisites";
    const dbName = (await query("SELECT DB_NAME() AS Db")).recordset[0]?.Db;
    assert.equal(dbName, name);
    const migration927 = await readFile(new URL(
      "../../../database/migrations/927_workstation_pin_runtime.sql", import.meta.url
    ), "utf8");
    await assert.rejects(pool.request().batch(migration927));
    assert.equal((await query("SELECT OBJECT_ID(N'uqp.WorkstationPinAttemptBucket',N'U') AS Bucket")).recordset[0]?.Bucket, null);

    stage = "exact-historical-prerequisites-in-synthetic-database";
    await query("CREATE SCHEMA uqp");
    // Only the four pre-existing objects needed by 916 are simulated;
    // the 902/903/904/905/916 migration files themselves run unchanged.
    await query(`CREATE TABLE uqp.AppUser(
      Id bigint NOT NULL PRIMARY KEY,
      Username nvarchar(100) NOT NULL UNIQUE,
      IsActive bit NOT NULL DEFAULT 1,
      AuthProvider nvarchar(30) NOT NULL DEFAULT N'LOCAL',
      TokenVersion int NOT NULL DEFAULT 1,
      DisplayName nvarchar(100) NOT NULL DEFAULT N'Synthetic'
    );
    CREATE TABLE uqp.PatientListDisclosure(Id bigint NOT NULL PRIMARY KEY);
    CREATE TABLE uqp.AuditLog(Id bigint NOT NULL PRIMARY KEY);
    CREATE TABLE uqp.DashboardDisplayDevice(Id bigint NOT NULL PRIMARY KEY);
    CREATE TABLE uqp.SchemaMigration(FileName nvarchar(255) NOT NULL PRIMARY KEY);`);
    for (const file of migrations) {
      const source = await readFile(new URL("../../../database/migrations/" + file, import.meta.url), "utf8");
      for (const batch of batches(source)) await pool.request().batch(batch);
    }
    await query(`INSERT INTO uqp.AppUser(Id,Username) VALUES(8,N'synthetic-927');
      INSERT INTO uqp.SharedWorkstation(WorkstationCode,DisplayName,IsActive,PinLoginEnabled)
      VALUES(N'D1-927-SYNTHETIC',N'Synthetic',1,1);
      INSERT INTO uqp.UserQuickPin(UserId,PinHash,IsEnabled)
      VALUES(8,N'synthetic-not-a-verifier',1);
      INSERT INTO uqp.SharedWorkstationCredential(Id,WorkstationId,SecretHash,CredentialVersion)
      VALUES('12345678-1234-4234-8234-123456789abc',1,0x010203,1);
      INSERT INTO uqp.SharedWorkstationSession(Id,WorkstationId,UserId,SessionSecretHash,
        AuthMethod,AuthenticatedAtUtc,LastActivityAtUtc,ExpiresAtUtc,TokenVersion,PinVersion)
      VALUES('12345678-1234-4234-8234-123456789abd',1,8,0x010203,N'PIN',
        DATEADD(MINUTE,-1,SYSUTCDATETIME()),SYSUTCDATETIME(),DATEADD(HOUR,1,SYSUTCDATETIME()),1,1);`);
    const original = (await query(`SELECT WorkstationCode,CredentialVersion,IsActive,PinLoginEnabled,PlatformCode,
      PurposeCode,RetiredAtUtc FROM uqp.SharedWorkstation WHERE Id=1`)).recordset[0];

    stage = "outer-transaction-ledger-and-DDL-rollback";
    const outer = new sql.Transaction(pool);
    await outer.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    try {
      await new sql.Request(outer).batch(migration927);
      await new sql.Request(outer).input("file", sql.NVarChar(255), "927_workstation_pin_runtime.sql")
        .query("INSERT INTO uqp.SchemaMigration(FileName) VALUES(@file)");
      assert.equal((await new sql.Request(outer).query(
        "SELECT COL_LENGTH(N'uqp.SharedWorkstation',N'SwitchVersion') AS ColumnLength"
      )).recordset[0]?.ColumnLength, 8);
    } finally {
      await outer.rollback();
    }
    const absent = (await query(`SELECT COL_LENGTH(N'uqp.SharedWorkstation',N'SwitchVersion') AS ColumnLength,
      OBJECT_ID(N'uqp.WorkstationPinAttemptBucket',N'U') AS Bucket,
      (SELECT COUNT(*) FROM uqp.SchemaMigration WHERE FileName=N'927_workstation_pin_runtime.sql') AS LedgerCount`)).recordset[0];
    assert.equal(absent.ColumnLength, null);
    assert.equal(absent.Bucket, null);
    assert.equal(absent.LedgerCount, 0);

    stage = "first-install-catalog-and-existing-rows";
    await pool.request().batch(migration927);
    await pool.request().batch(workstationPinSchemaSql);
    const restored = (await query(`SELECT WorkstationCode,CredentialVersion,IsActive,PinLoginEnabled,PlatformCode,
      PurposeCode,RetiredAtUtc FROM uqp.SharedWorkstation WHERE Id=1`)).recordset[0];
    assert.deepEqual(restored, original);
    assert.equal((await query("SELECT SwitchVersion AS V FROM uqp.SharedWorkstation WHERE Id=1")).recordset[0].V, "0");
    assert.equal((await query("SELECT COUNT(*) AS N FROM uqp.SharedWorkstationSession")).recordset[0].N, 1);
    assert.equal((await query("SELECT COUNT(*) AS N FROM uqp.UserQuickPin")).recordset[0].N, 1);

    stage = "bucket-persistence-repeat-and-constraints";
    await query(`INSERT INTO uqp.WorkstationPinAttemptBucket
      (ScopeCode,KeyDigest,WindowStartedAtUtc,FailedAttempts)
      VALUES(N'ACCOUNT',CONVERT(binary(32),HASHBYTES('SHA2_256',N'synthetic-927')),
      SYSUTCDATETIME(),2)`);
    await pool.request().batch(migration927);
    await pool.request().batch(workstationPinSchemaSql);
    assert.equal((await query("SELECT FailedAttempts AS N FROM uqp.WorkstationPinAttemptBucket")).recordset[0].N, 2);
    await assert.rejects(query(`UPDATE uqp.SharedWorkstation SET SwitchVersion=-1 WHERE Id=1`));
    await assert.rejects(query(`INSERT INTO uqp.WorkstationPinAttemptBucket
      (ScopeCode,KeyDigest,WindowStartedAtUtc) VALUES(N'BAD',0x01,SYSUTCDATETIME())`));

    stage = "actual-SQL-generation-CAS-and-concurrency";
    const bump = async () => {
      const tx = new sql.Transaction(pool);
      await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
      try {
        const got = await new sql.Request(tx).input("id", sql.BigInt, 1).query(`
          DECLARE @version TABLE(V bigint);
          UPDATE uqp.SharedWorkstation WITH (UPDLOCK,HOLDLOCK)
            SET SwitchVersion=SwitchVersion+1,UpdatedAtUtc=SYSUTCDATETIME()
            OUTPUT INSERTED.SwitchVersion INTO @version
            WHERE Id=@id AND SwitchVersion<9223372036854775807;
          SELECT CONVERT(varchar(20),V) AS Generation FROM @version`);
        await tx.commit();
        return String(got.recordset[0]?.Generation);
      } catch(e) { await tx.rollback().catch(() => undefined); throw e; }
    };
    const versions = await Promise.all([bump(), bump()]);
    assert.deepEqual(versions.sort(), ["1", "2"]);
    const stale = await pool.request().input("generation", sql.VarChar(20), "1").query(`
      UPDATE uqp.SharedWorkstation SET UpdatedAtUtc=SYSUTCDATETIME()
      WHERE Id=1 AND SwitchVersion=CONVERT(bigint,@generation)
        AND IsActive=1 AND PinLoginEnabled=1 AND RetiredAtUtc IS NULL AND PurposeCode=N'SHARED_QUERY'`);
    assert.equal(stale.rowsAffected[0], 0);
    const latest = await pool.request().input("generation", sql.VarChar(20), "2").query(`
      UPDATE uqp.SharedWorkstation SET UpdatedAtUtc=SYSUTCDATETIME()
      WHERE Id=1 AND SwitchVersion=CONVERT(bigint,@generation)
        AND IsActive=1 AND PinLoginEnabled=1 AND RetiredAtUtc IS NULL AND PurposeCode=N'SHARED_QUERY'`);
    assert.equal(latest.rowsAffected[0], 1);


    stage = "real-SQL-PIN-repository-shared-buckets-and-revocation";
    // These two independent repository objects share a real SQL Server pool, not
    // an in-memory failure map. Full multi-process HTTP/KDF testing is separate.
    const dependencies = {
      enabled: () => true, getPool: async () => pool,
      transaction: (connection: sql.ConnectionPool) => new sql.Transaction(connection),
      request: (tx: sql.Transaction) => new sql.Request(tx),
    };
    const first = createWorkstationPinState(dependencies);
    const second = createWorkstationPinState(dependencies);
    const buckets = pinAttemptBuckets("user:8", 1, "192.0.2.100", Buffer.alloc(32, 23));
    assert.deepEqual(buckets.map(b => b.limit), [5, 100, 20]);
    const bucketRecord = async (b: (typeof buckets)[number]) =>
      (await pool.request().input("scope", sql.NVarChar(16), b.scope)
        .input("digest", sql.VarBinary(32), b.digest)
        .query("SELECT FailedAttempts AS Failures,BlockedUntilUtc AS Blocked FROM uqp.WorkstationPinAttemptBucket WHERE ScopeCode=@scope AND KeyDigest=@digest"))
        .recordset[0] as { Failures: number; Blocked: Date | null } | undefined;
    const auditInsert = async (tx: sql.Transaction, id: number) =>
      new sql.Request(tx).input("id", sql.BigInt, id)
        .query("INSERT INTO uqp.AuditLog(Id) VALUES(@id)");
    const wrong = (state: typeof first, id: number) => state.attempt(buckets, async tx => {
      await auditInsert(tx, id);
      return false;
    });
    assert.deepEqual(await Promise.all([wrong(first, 92701), wrong(second, 92702)]), ["INVALID", "INVALID"]);
    for (const b of buckets) assert.equal((await bucketRecord(b))?.Failures, 2);
    assert.equal((await query("SELECT COUNT(*) AS N FROM uqp.AuditLog WHERE Id IN (92701,92702)")).recordset[0].N, 2);

    stage = "real-SQL-bucket-and-audit-rollback";
    await assert.rejects(first.attempt(buckets, async tx => {
      await auditInsert(tx, 92703);
      throw new Error("SYNTHETIC_AUDIT_ABORT");
    }), /SYNTHETIC_AUDIT_ABORT/);
    for (const b of buckets) assert.equal((await bucketRecord(b))?.Failures, 2);
    assert.equal((await query("SELECT COUNT(*) AS N FROM uqp.AuditLog WHERE Id=92703")).recordset[0].N, 0);

    stage = "real-SQL-account-lock-and-shared-network";
    assert.equal(await wrong(second, 92704), "INVALID");
    assert((await bucketRecord(buckets[0]!))?.Blocked != null);
    // Stabilize the blocked window rather than depending on a 5-second wall-clock.
    await pool.request().input("digest", sql.VarBinary(32), buckets[0]!.digest)
      .query("UPDATE uqp.WorkstationPinAttemptBucket SET BlockedUntilUtc=DATEADD(MINUTE,15,SYSUTCDATETIME()) WHERE ScopeCode=N'ACCOUNT' AND KeyDigest=@digest");
    assert.equal(await first.attempt(buckets, async () => { throw Error("blocked verifier must not run"); }), "LOCKED");
    await pool.request().input("digest", sql.VarBinary(32), buckets[0]!.digest)
      .query("UPDATE uqp.WorkstationPinAttemptBucket SET BlockedUntilUtc=NULL WHERE ScopeCode=N'ACCOUNT' AND KeyDigest=@digest");
    assert.equal(await second.attempt(buckets, async tx => {
      await auditInsert(tx, 92705);
      return true;
    }), "OK");
    assert.equal((await bucketRecord(buckets[0]!))?.Failures, 0);
    assert.equal((await bucketRecord(buckets[1]!))?.Failures, 3);
    assert.equal((await bucketRecord(buckets[2]!))?.Failures, 3);
    await pool.request().input("digest", sql.VarBinary(32), buckets[1]!.digest)
      .query("UPDATE uqp.WorkstationPinAttemptBucket SET BlockedUntilUtc=DATEADD(MINUTE,15,SYSUTCDATETIME()) WHERE ScopeCode=N'NETWORK' AND KeyDigest=@digest");
    const alternate = pinAttemptBuckets("user:999", 1, "192.0.2.100", Buffer.alloc(32, 23));
    assert.equal(await first.attempt(alternate, async () => { throw Error("blocked verifier must not run"); }), "LOCKED");
    assert.equal(await bucketRecord(alternate[0]!), undefined);

    stage = "real-SQL-revocation-audit-rollback-and-serial-intents";
    const versionBefore = (await query("SELECT CONVERT(varchar(20),SwitchVersion) AS V FROM uqp.SharedWorkstation WHERE Id=1")).recordset[0].V;
    await assert.rejects(first.revokeForIntent(1, async tx => {
      await auditInsert(tx, 92706);
      throw Error("SYNTHETIC_REVOCATION_AUDIT_ABORT");
    }), /SYNTHETIC_REVOCATION_AUDIT_ABORT/);
    assert.equal((await query("SELECT CONVERT(varchar(20),SwitchVersion) AS V FROM uqp.SharedWorkstation WHERE Id=1")).recordset[0].V, versionBefore);
    assert.equal((await query("SELECT COUNT(*) AS N FROM uqp.SharedWorkstationSession WHERE RevokedAtUtc IS NULL")).recordset[0].N, 1);
    assert.equal((await query("SELECT COUNT(*) AS N FROM uqp.AuditLog WHERE Id=92706")).recordset[0].N, 0);
    const intents = await Promise.all([
      first.revokeForIntent(1, tx => auditInsert(tx, 92707).then(() => undefined)),
      second.revokeForIntent(1, tx => auditInsert(tx, 92708).then(() => undefined)),
    ]);
    assert.deepEqual([...intents].sort(), ["3", "4"]);
    assert.equal((await query("SELECT COUNT(*) AS N FROM uqp.SharedWorkstationSession WHERE RevokedAtUtc IS NULL")).recordset[0].N, 0);
    assert.equal((await query("SELECT COUNT(*) AS N FROM uqp.AuditLog WHERE Id IN (92707,92708)")).recordset[0].N, 2);
    assert.equal(await first.transaction(tx => first.claimGeneration(tx, 1, "3")), false);
    assert.equal(await second.transaction(tx => second.claimGeneration(tx, 1, "4")), true);

    stage = "real-SQL-phase-two-insert-and-audit-atomicity";
    const fresh = pinAttemptBuckets("user:8", 1, "192.0.2.101", Buffer.alloc(32, 24));
    const newId = "22345678-1234-4234-8234-123456789abd";
    const insertSession = (tx: sql.Transaction) => new sql.Request(tx)
      .input("id", sql.UniqueIdentifier, newId).query(
        "INSERT INTO uqp.SharedWorkstationSession(Id,WorkstationId,UserId,SessionSecretHash,AuthMethod,AuthenticatedAtUtc,LastActivityAtUtc,ExpiresAtUtc,TokenVersion,PinVersion) VALUES(@id,1,8,0x010203,N'PIN',SYSUTCDATETIME(),SYSUTCDATETIME(),DATEADD(HOUR,1,SYSUTCDATETIME()),1,1)"
      );
    await assert.rejects(second.attempt(fresh, async tx => {
      assert.equal(await second.claimGeneration(tx, 1, "4"), true);
      await insertSession(tx);
      await auditInsert(tx, 92709);
      throw Error("SYNTHETIC_PHASE_TWO_ABORT");
    }), /SYNTHETIC_PHASE_TWO_ABORT/);
    assert.equal((await pool.request().input("id",sql.UniqueIdentifier,newId)
      .query("SELECT COUNT(*) AS N FROM uqp.SharedWorkstationSession WHERE Id=@id")).recordset[0].N, 0);
    assert.equal((await query("SELECT COUNT(*) AS N FROM uqp.AuditLog WHERE Id=92709")).recordset[0].N, 0);
    assert.equal(await bucketRecord(fresh[0]!), undefined);
    assert.equal(await second.attempt(fresh, async tx => {
      assert.equal(await second.claimGeneration(tx, 1, "4"), true);
      await insertSession(tx);
      await auditInsert(tx, 92710);
      return true;
    }), "OK");
    assert.equal((await pool.request().input("id",sql.UniqueIdentifier,newId)
      .query("SELECT COUNT(*) AS N FROM uqp.SharedWorkstationSession WHERE Id=@id AND RevokedAtUtc IS NULL")).recordset[0].N, 1);
    assert.equal((await query("SELECT COUNT(*) AS N FROM uqp.AuditLog WHERE Id=92710")).recordset[0].N, 1);
    assert.equal(await first.revokeForIntent(1, async tx => { await auditInsert(tx, 92711); }), "5");
    assert.equal((await query("SELECT COUNT(*) AS N FROM uqp.SharedWorkstationSession WHERE RevokedAtUtc IS NULL")).recordset[0].N, 0);
    assert.equal(await second.transaction(tx => second.claimGeneration(tx, 1, "4")), false);
    console.log("PIN_RUNTIME_SQL_REAL_SHARED_BUCKET_AUDIT_ROLLBACK_REVOKE_CAS_SESSION_PASS (disposable synthetic DB; two repository instances, not multi-process HTTP)");

    stage = "real-http-PIN-two-processes";
    await (await import("./workstationPin927HttpAcceptance.js")).verify927Http(pool, name);

    stage = "disabled-and-mutated-catalog-refusal";
    await query("ALTER TABLE uqp.WorkstationPinAttemptBucket NOCHECK CONSTRAINT CK_PinAttempt_Failed");
    await assert.rejects(pool.request().batch(workstationPinSchemaSql));
    await assert.rejects(pool.request().batch(migration927));
    await query("ALTER TABLE uqp.WorkstationPinAttemptBucket WITH CHECK CHECK CONSTRAINT CK_PinAttempt_Failed");
    await pool.request().batch(workstationPinSchemaSql);
    await query("CREATE INDEX IX_927_Unexpected ON uqp.WorkstationPinAttemptBucket(FailedAttempts)");
    await assert.rejects(pool.request().batch(workstationPinSchemaSql));
    await assert.rejects(pool.request().batch(migration927));
    await query("DROP INDEX IX_927_Unexpected ON uqp.WorkstationPinAttemptBucket");
    await pool.request().batch(workstationPinSchemaSql);

    stage = "partial-schema-fail-closed";
    const generationBeforePartial = (await query("SELECT CONVERT(varchar(20),SwitchVersion) AS V FROM uqp.SharedWorkstation WHERE Id=1")).recordset[0].V;
    await query("DROP TABLE uqp.WorkstationPinAttemptBucket");
    await assert.rejects(pool.request().batch(migration927));
    assert.equal((await query("SELECT CONVERT(varchar(20),SwitchVersion) AS V FROM uqp.SharedWorkstation WHERE Id=1")).recordset[0].V, generationBeforePartial);
    console.log("PIN_927_SQL_REAL_FRESH_REPEAT_OUTER_ROLLBACK_CATALOG_CONSTRAINT_CAS_PARTIAL_PASS (disposable synthetic database only; full PIN repository concurrency not certified)");
  } catch (e) {
    const code = Number((e as {number?:number}).number) || 0;
    console.error(`PIN_927_SQL_ACCEPTANCE_FAILED:${stage}:${code} (details suppressed; disposable DB only)`);
    throw new Error(`PIN_927_SQL_ACCEPTANCE_FAILED:${stage}`);
  } finally {
    await db?.close();
    if (created) {
      await admin.request().query(`ALTER DATABASE [${name}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${name}]`);
    }
  }
}
