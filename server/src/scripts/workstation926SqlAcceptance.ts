/**
 * Disposable SQL Server 2019 acceptance ONLY. No platform configuration import.
 * All DDL/DML is restricted to a newly-created database on an empty, witnessed
 * instance launched by tools/sqlserver-acceptance/h0-926/run-isolated.sh.
 */
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import sql from "mssql";
import { createIsolatedRevocationSqlDriver, type IsolatedRevocationScope } from "../modules/auth/workstationRevocationSqlAdapter.js";
import { runIsolatedRevocationWriter } from "../modules/auth/workstationRevocationOwnedWriter.js";
import { isolatedCredentialAtomicSql as statements } from "../modules/auth/workstationCredentialAtomicSql.js";
import { deviceRenewalCasSql, workstationSessionRepositorySql } from "../modules/auth/workstationSessionSqlStatements.js";
import { legacyWorkstationWriterFenceSql } from "../modules/auth/workstationLegacyWriterFence.js";
import type { WorkstationSqlRequest, WorkstationSqlTransaction } from "../modules/auth/workstationSessionSql.repository.js";
import { isolated926Target, assertIsolated926Witness } from "./workstation926Isolation.js";

const rootUrl = new URL("../../../", import.meta.url);
const userId = "9007199254740993";
async function boundedBarrier(work: Promise<void>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([work, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(Error("ACCEPTANCE_BARRIER_TIMEOUT")), 15000);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}
type Fixture = { scope: IsolatedRevocationScope; legacyId: string };
type Fault = "NONE" | "AUDIT" | "DECISION" | "COMMIT_BEFORE_ACK" | "COMMIT_AFTER_ACK" | "OPERATOR_CAS" | "ROLLBACK_ACK" | "DEADLOCK";
type CaseResult = { name: string; status: "PASS" | "FAIL" | "NOT_RUN"; sqlError?: number };
const names = ["catalog-roundtrip", "no-legacy", "linked-legacy", "unknown-history-before-dml",
  "credential-version-conflict", "operator-cas-conflict", "request-replay-rollback", "audit-trigger-rollback",
  "decision-trigger-rollback", "commit-unknown-committed", "commit-unknown-rolled-back", "concurrent-revoke",
  "concurrent-renewal-revoke", "legacy-insert-predicate-block", "gate-timeout",
  "legacy-writer-denial", "immutable-decision-request", "foreign-workstation-unchanged",
  "multiple-active-device-constraint", "rollback-ack-unknown", "deadlock-1205"] as const;

export async function run926Acceptance() {
  const cases: CaseResult[] = names.map(name => ({ name, status: "NOT_RUN" }));
  let stage = "APPROVAL", master: sql.ConnectionPool | undefined, root: sql.ConnectionPool | undefined;
  let app: sql.ConnectionPool | undefined, created = false, loginCreated = false;
  let database = "", login = "";
  const report: Record<string, unknown> = { contract: "H0_926_SQL_ACCEPTANCE_V1", SQL_ACCEPTANCE: "NOT_RUN",
    runtimeEnabled: false, productionReady: false, cases, sourceManifest: [] };
  let exit = 1;
  try {
    const target = isolated926Target(process.env); database = target.database;
    const config: sql.config = { server: target.server, port: target.port, database: "master", user: "sa",
      password: process.env.UQP926_PASSWORD, connectionTimeout: 2000, requestTimeout: 20000,
      options: { encrypt: true, trustServerCertificate: true }, pool: { min: 0, max: 8 } };
    // trustServerCertificate is ONLY for this freshly created loopback container's
    // self-signed test certificate; never inherited from platform settings.
    stage = "STARTUP";
    for (let n = 0; n < 45; n++) {
      const probe = new sql.ConnectionPool(config);
      try { master = await probe.connect(); break; }
      catch { await probe.close().catch(() => undefined); await new Promise(resolve => setTimeout(resolve, 1000)); }
    }
    assert.ok(master, "SQL_STARTUP_TIMEOUT");
    stage = "INSTANCE_WITNESS";
    const witness = (await master.request().query(`SELECT
      CONVERT(INT,SERVERPROPERTY(N'ProductMajorVersion')) Engine,
      CONVERT(NVARCHAR(128),SERVERPROPERTY(N'MachineName')) Machine,
      CONVERT(NVARCHAR(128),@@SERVERNAME) ServerName,DB_NAME() DatabaseName,
      ORIGINAL_LOGIN() LoginName,IS_SRVROLEMEMBER(N'sysadmin') IsSysadmin,
      (SELECT COUNT(*) FROM sys.databases WHERE database_id>4) UserDatabases,
      CONVERT(NVARCHAR(128),SERVERPROPERTY(N'ProductVersion')) Build,
      CONVERT(NVARCHAR(128),SERVERPROPERTY(N'Edition')) Edition;`)).recordset[0];
    assertIsolated926Witness(witness, target.machine);
    report.environment = { engine: witness.Engine, build: witness.Build, edition: witness.Edition,
      compatibility: 150, isolatedEmptyInstance: true, tls: "ENCRYPTED_SELF_SIGNED_LOOPBACK_ONLY" };
    await master.request().batch(`CREATE DATABASE [${database}]; ALTER DATABASE [${database}] SET COMPATIBILITY_LEVEL=150;`);
    created = true;
    root = await new sql.ConnectionPool({ ...config, database }).connect();
    await root.request().batch(`CREATE SCHEMA uqp;`);
    await root.request().batch(`CREATE TABLE uqp.SchemaMigration(FileName NVARCHAR(255) PRIMARY KEY,
      AppliedAtUtc DATETIME2(0) NOT NULL DEFAULT SYSUTCDATETIME());`);
    stage = "FULL_BASELINE";
    const folder = new URL("database/migrations/", rootUrl);
    const files = (await readdir(folder)).filter(name => /^\d+_.*\.sql$/.test(name)).sort();
    assert.equal(files.length, 48); assert.equal(files.at(-1), "921_datasource_native_parameter_versions.sql");
    const manifest: { file: string; sha256: string }[] = [];
    for (const file of files) {
      stage = "BASELINE_" + file.slice(0, 3);
      const source = await readFile(new URL(file, folder), "utf8");
      manifest.push({ file, sha256: createHash("sha256").update(source).digest("hex") });
      const tx = new sql.Transaction(root); let aborted = false; tx.on("rollback", () => { aborted = true; });
      await tx.begin();
      try {
        for (const batch of source.split(/^\s*GO\s*$/gim).map(s => s.trim()).filter(Boolean))
          await new sql.Request(tx).batch(batch);
        await new sql.Request(tx).input("file", sql.NVarChar(255), file).query("INSERT uqp.SchemaMigration(FileName) VALUES(@file)");
        await tx.commit();
      } catch (error) { if (!aborted) await tx.rollback().catch(() => undefined); throw error; }
    }
    report.sourceManifest = manifest;
    stage = "DRAFT_926";
    const ddl = await readFile(new URL("database/drafts/926_shared_workstation_session_security.sql", rootUrl), "utf8");
    report.draftSha256 = createHash("sha256").update(ddl).digest("hex");
    await root.request().batch(ddl);
    // The acceptance harness does not certify a user installation or write 926's ledger.
    const catalogSource = await readFile(new URL("tools/sqlserver-acceptance/drafts/926/926_catalog_readonly.sql", rootUrl), "utf8");
    const runCase = async (name: typeof names[number], work: () => Promise<void>) => {
      stage = name;
      const result = cases.find(c => c.name === name)!;
      try { await work(); result.status = "PASS"; }
      catch (error) {
        result.status = "FAIL";
        if (error && typeof error === "object" && "number" in error && typeof error.number === "number")
          result.sqlError = error.number;
        throw error;
      }
    };
    await runCase("catalog-roundtrip", async () => {
      const sets = (await root!.request().query(catalogSource)).recordsets as unknown as Record<string, unknown>[][];
      for (const name of ["R1_OBJECTS", "R2_COLUMNS"]) {
        const rows = sets.flat().filter(row => row.ResultSet === name);
        assert.ok(rows.length > 0); assert.ok(rows.every(row => row.Status === "MATCH"));
      }
      const fks = sets.flat().filter(row => row.ResultSet === "R4_FOREIGN_KEYS");
      assert.ok(fks.length > 0);
      assert.ok(fks.every(row => !row.is_disabled && !row.is_not_trusted &&
        row.delete_referential_action_desc === "NO_ACTION" && row.update_referential_action_desc === "NO_ACTION"));
      const rv = sets.flat().filter(row => row.ResultSet === "R6_TABLE_SHAPE");
      assert.equal(rv.length, 6);
      assert.equal(rv.filter(row => row.RowVersionCount === 1).length, 4);
      report.catalog = "REQUIRED_WITNESS_MATCH_NOT_EXACT_INSTALLER_CERTIFICATION";
    });
    stage = "RESTRICTED_IDENTITY";
    login = "H0_926_" + randomBytes(12).toString("hex");
    const password = "S9!" + randomBytes(24).toString("hex") + "z";
    await master.request().batch(`CREATE LOGIN [${login}] WITH PASSWORD=N'${password}',CHECK_POLICY=OFF;`); loginCreated = true;
    await root.request().batch(`CREATE USER [${login}] FOR LOGIN [${login}];
      ${["SharedWorkstation","SharedWorkstationCredential","SharedWorkstationDeviceSession","SharedWorkstationSession",
        "SharedWorkstationOperatorState","SharedWorkstationSessionRequest","SharedWorkstationSessionDecision","AuditLog"]
        .map(table => `GRANT SELECT ON OBJECT::uqp.${table} TO [${login}];`).join("\n")}
      ${["SharedWorkstationCredential","SharedWorkstationDeviceSession","SharedWorkstationSession","SharedWorkstationOperatorState"]
        .map(table => `GRANT UPDATE ON OBJECT::uqp.${table} TO [${login}];`).join("\n")}
      ${["SharedWorkstationSessionRequest","SharedWorkstationSessionDecision","AuditLog"]
        .map(table => `GRANT INSERT ON OBJECT::uqp.${table} TO [${login}];`).join("\n")}
      DENY UPDATE,DELETE ON OBJECT::uqp.SharedWorkstationSessionRequest TO [${login}];
      DENY UPDATE,DELETE ON OBJECT::uqp.SharedWorkstationSessionDecision TO [${login}];`);
    app = await new sql.ConnectionPool({ ...config, database, user: login, password }).connect();
    const privileges = (await app.request().query(`SELECT IS_SRVROLEMEMBER(N'sysadmin') SA,
      IS_MEMBER(N'db_owner') DO,HAS_PERMS_BY_NAME(NULL,NULL,N'VIEW SERVER STATE') VS,
      HAS_PERMS_BY_NAME(DB_NAME(),N'DATABASE',N'CONTROL') CT;`)).recordset[0];
    assert.ok(Object.values(privileges).every(value => value === 0));
    report.runtimePrivileges = privileges;
    await root.request().batch(`SET IDENTITY_INSERT uqp.AppUser ON;
      INSERT uqp.AppUser(Id,Username,DisplayName,PasswordHash) VALUES(${userId},N'h0-synthetic-user',N'SYNTHETIC',NULL);
      SET IDENTITY_INSERT uqp.AppUser OFF;
      SET IDENTITY_INSERT uqp.AuditLog ON;
      INSERT uqp.AuditLog(Id,EventType,Status) VALUES(9007199254740993,N'H0_SYNTHETIC_SEED',N'SUCCESS');
      SET IDENTITY_INSERT uqp.AuditLog OFF;`);
    const fixtureSource = await readFile(new URL("tools/sqlserver-acceptance/h0-926/fixture.sql", rootUrl), "utf8");
    let fixtureNumber = 0;
    const fixture = async (legacyMode = 0): Promise<Fixture> => {
      const workstationId = String(9007199254741000n + BigInt(fixtureNumber++));
      const credentialId = randomUUID(), deviceId = randomUUID(), legacyId = randomUUID(), incarnation = randomUUID();
      await root!.request().input("workstationId", sql.VarChar(20), workstationId).input("code", sql.NVarChar(100), "SYNTHETIC_" + workstationId)
        .input("credentialId", sql.UniqueIdentifier, credentialId).input("deviceId", sql.UniqueIdentifier, deviceId)
        .input("legacyId", sql.UniqueIdentifier, legacyId).input("incarnation", sql.UniqueIdentifier, incarnation)
        .input("userId", sql.VarChar(20), userId).input("legacyMode", sql.Int, legacyMode).batch(fixtureSource);
      return { legacyId, scope: { workstationId, credentialId, deviceSessionId: deviceId, expectedCredentialVersion: 2,
        requestId: randomUUID(), transactionCorrelationId: randomUUID(), nextIncarnation: randomUUID() } };
    };
    const snapshot = async (f: Fixture) => (await root!.request().input("w", sql.VarChar(20), f.scope.workstationId).query(`
      SELECT (SELECT IsRevoked FROM uqp.SharedWorkstationCredential WHERE WorkstationId=CONVERT(BIGINT,@w)) Revoked,
      (SELECT COUNT(*) FROM uqp.SharedWorkstationDeviceSession WHERE WorkstationId=CONVERT(BIGINT,@w) AND RevokedAtUtc IS NULL) Devices,
      (SELECT COUNT(*) FROM uqp.SharedWorkstationSession WHERE WorkstationId=CONVERT(BIGINT,@w) AND RevokedAtUtc IS NULL) Legacy,
      (SELECT LOWER(CONVERT(VARCHAR(16),RowVersion,2)) FROM uqp.SharedWorkstationOperatorState WHERE WorkstationId=CONVERT(BIGINT,@w)) Revision,
      (SELECT COUNT(*) FROM uqp.SharedWorkstationSessionRequest WHERE WorkstationId=CONVERT(BIGINT,@w)) Requests,
      (SELECT COUNT(*) FROM uqp.SharedWorkstationSessionDecision WHERE WorkstationId=CONVERT(BIGINT,@w)) Decisions;`)).recordset[0];
    const auditCount = async () => (await root!.request().query("SELECT COUNT(*) C FROM uqp.AuditLog")).recordset[0].C;
    const sqlErrors: number[] = [];
    const writer = (f: Fixture, fault: Fault = "NONE", afterLock?: () => Promise<void>, deadlock?: { workstationId: string; ready: () => void }) => {
      const driver = createIsolatedRevocationSqlDriver({
        getPool: async () => app!,
        transaction: pool => {
          const real = new sql.Transaction(pool as sql.ConnectionPool);
          return { begin: level => real.begin(level).then(() => undefined), async rollback() { await real.rollback(); if (fault === "ROLLBACK_ACK") throw Error("INJECTED_ROLLBACK_ACK_LOSS"); },
            async commit() {
              if (fault === "COMMIT_BEFORE_ACK") { await real.rollback(); throw Error("INJECTED_ACK_LOSS"); }
              await real.commit();
              if (fault === "COMMIT_AFTER_ACK") throw Error("INJECTED_ACK_LOSS");
            },
            real,
          } as WorkstationSqlTransaction;
        },
        request: tx => {
          const real = (tx as WorkstationSqlTransaction & { real: sql.Transaction }).real;
          const req = new sql.Request(real);
          const wrapped: WorkstationSqlRequest = {
            input(name, type, value) { req.input(name, type as sql.ISqlType, value); return wrapped; },
            async query(text) {
              try {
              if (fault === "DEADLOCK" && text === statements.credentialCas && deadlock) {
                req.input("deadlockWorkstationId", sql.VarChar(20), deadlock.workstationId);
                deadlock.ready();
                await req.query(`SET DEADLOCK_PRIORITY LOW; SET LOCK_TIMEOUT 15000;
                  SELECT Id FROM uqp.SharedWorkstation WITH (UPDLOCK,HOLDLOCK)
                  WHERE Id=CONVERT(BIGINT,@deadlockWorkstationId);`);
              }
              if (text === statements.revokeOperatorCas && (fault === "OPERATOR_CAS" || fault === "ROLLBACK_ACK"))
                text = text.replace("AND Generation=CONVERT(BIGINT,@expectedGeneration)", "AND Generation=CONVERT(BIGINT,@expectedGeneration)+1");
              const result = await req.query(text);
              if (text === statements.countActiveLegacyBeforeCas && afterLock) await boundedBarrier(afterLock());
              return result;
              } catch (error) {
                if (error && typeof error === "object" && "number" in error && typeof error.number === "number") sqlErrors.push(error.number);
                throw error;
              }
            },
          }; return wrapped;
        },
      }, f.scope);
      return runIsolatedRevocationWriter(driver);
    };
    const assertCommitted = async (f: Fixture) => {
      assert.equal((await writer(f)).status, "SYNTHETIC_COMMITTED");
      const state = await snapshot(f);
      assert.equal(state.Revoked, true); assert.equal(state.Devices, 0); assert.equal(state.Legacy, 0);
      assert.equal(state.Requests, 1); assert.equal(state.Decisions, 1);
      const receipts = (await root!.request().input("requestId", sql.UniqueIdentifier, f.scope.requestId).query(`
        SELECT CONVERT(VARCHAR(20),d.AuditLogId) AuditLogId,d.PreviousRevision,d.NextRevision,
          CONVERT(VARCHAR(20),d.PreviousGeneration) PreviousGeneration,
          CONVERT(VARCHAR(20),d.NextGeneration) NextGeneration,d.PreviousIncarnation,d.NextIncarnation,
          d.AuditEventType,a.EventType,a.Status
        FROM uqp.SharedWorkstationSessionDecision d JOIN uqp.AuditLog a ON a.Id=d.AuditLogId
        JOIN uqp.SharedWorkstationSessionRequest r ON r.RequestId=d.RequestId
        WHERE d.RequestId=@requestId AND r.WorkstationId=d.WorkstationId AND r.DeviceSessionId=d.DeviceSessionId
          AND r.OperationCode=d.OperationCode;`)).recordset;
      assert.equal(receipts.length, 1);
      const receipt = receipts[0];
      assert.equal(typeof receipt.AuditLogId, "string"); assert.ok(BigInt(receipt.AuditLogId) > 9007199254740992n);
      assert.equal(receipt.PreviousGeneration, "9007199254740993"); assert.equal(receipt.NextGeneration, "9007199254740994");
      assert.equal(receipt.EventType, receipt.AuditEventType); assert.equal(receipt.Status, "SUCCESS");
      assert.notDeepEqual(receipt.PreviousRevision, receipt.NextRevision);
      assert.notEqual(receipt.PreviousIncarnation, receipt.NextIncarnation);
    };
    await runCase("no-legacy", async () => assertCommitted(await fixture()));
    await runCase("linked-legacy", async () => assertCommitted(await fixture(1)));
    const unchanged = async (f: Fixture, fault: Fault = "NONE", allowRollbackUnknown = false) => {
      const before = await snapshot(f), audits = await auditCount();
      assert.ok((allowRollbackUnknown ? ["REJECTED", "ROLLBACK_UNKNOWN"] : ["REJECTED"]).includes((await writer(f, fault)).status));
      assert.deepEqual(await snapshot(f), before); assert.equal(await auditCount(), audits);
    };
    await runCase("unknown-history-before-dml", async () => {
      const f = await fixture(2), revision = (await root!.request().query("SELECT CONVERT(VARCHAR(16),@@DBTS,2) R")).recordset[0].R;
      await unchanged(f);
      // No ROWVERSION movement proves that no UPDATE was even attempted here.
      assert.equal((await root!.request().query("SELECT CONVERT(VARCHAR(16),@@DBTS,2) R")).recordset[0].R, revision);
    });
    await runCase("credential-version-conflict", async () => {
      const f = await fixture(); f.scope = { ...f.scope, expectedCredentialVersion: 3 }; await unchanged(f);
    });
    await runCase("operator-cas-conflict", async () => unchanged(await fixture(1), "OPERATOR_CAS"));
    await runCase("request-replay-rollback", async () => {
      const first = await fixture(); await assertCommitted(first);
      const second = await fixture(1); second.scope = { ...second.scope, requestId: first.scope.requestId };
      // A duplicate-key failure with XACT_ABORT may already have rolled back
      // server-side, making the driver's later rollback acknowledgment unknown.
      await unchanged(second, "NONE", true);
    });
    for (const [name, table] of [["audit-trigger-rollback","AuditLog"],["decision-trigger-rollback","SharedWorkstationSessionDecision"]] as const)
      await runCase(name, async () => {
        const f = await fixture(1);
        await root!.request().batch(`CREATE TRIGGER uqp.H0_AcceptanceFail ON uqp.${table} AFTER INSERT AS
          BEGIN THROW 52926,'SYNTHETIC_ACCEPTANCE_FAILURE',1; END;`);
        try { await unchanged(f, "NONE", true); } finally { await root!.request().batch("DROP TRIGGER uqp.H0_AcceptanceFail"); }
      });
    await runCase("commit-unknown-committed", async () => {
      const f = await fixture(1); assert.equal((await writer(f, "COMMIT_AFTER_ACK")).status, "COMMIT_UNKNOWN");
      assert.equal((await snapshot(f)).Decisions, 1); assert.equal((await snapshot(f)).Revoked, true);
    });
    await runCase("commit-unknown-rolled-back", async () => {
      const f = await fixture(1), before = await snapshot(f), audits = await auditCount();
      assert.equal((await writer(f, "COMMIT_BEFORE_ACK")).status, "COMMIT_UNKNOWN");
      assert.deepEqual(await snapshot(f), before); assert.equal(await auditCount(), audits);
    });
    await runCase("concurrent-revoke", async () => {
      const f = await fixture(1);
      let release!: () => void, acquired!: () => void;
      const barrier = new Promise<void>(resolve => { release = resolve; });
      const locked = new Promise<void>(resolve => { acquired = resolve; });
      const a = writer(f, "NONE", async () => { acquired(); await barrier; });
      await Promise.race([locked, a.then(() => { throw Error("WRITER_DID_NOT_REACH_BARRIER"); })]);
      const b = writer({ ...f, scope: { ...f.scope, requestId: randomUUID(), nextIncarnation: randomUUID(), transactionCorrelationId: randomUUID() } });
      release();
      assert.deepEqual((await Promise.all([a,b])).map(r => r.status).sort(), ["REJECTED","SYNTHETIC_COMMITTED"]);
      assert.equal((await snapshot(f)).Decisions, 1);
    });
    await runCase("concurrent-renewal-revoke", async () => {
      const f = await fixture(), tx = new sql.Transaction(app!);
      await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
      try {
        await new sql.Request(tx).query(workstationSessionRepositorySql.acquireGate);
        const pending = writer(f);
        const prior = (await new sql.Request(tx).input("id", sql.UniqueIdentifier, f.scope.deviceSessionId)
          .query("SELECT RowVersion FROM uqp.SharedWorkstationDeviceSession WITH (UPDLOCK,HOLDLOCK) WHERE Id=@id")).recordset[0];
        const now = new Date();
        const result = await new sql.Request(tx).input("sessionId", sql.UniqueIdentifier, f.scope.deviceSessionId)
          .input("workstationId", sql.BigInt, f.scope.workstationId).input("credentialId", sql.UniqueIdentifier, f.scope.credentialId)
          .input("expectedRevision", sql.VarBinary(8), prior.RowVersion).input("expectedCounter", sql.BigInt, "9007199254740993")
          .input("nextCounter", sql.BigInt, "9007199254740994").input("lastActivityUtc", sql.DateTime2(3), now)
          .input("idleExpiresUtc", sql.DateTime2(3), new Date(now.getTime() + 600000)).query(deviceRenewalCasSql);
        assert.equal(result.recordset.length, 1); await tx.commit();
        assert.equal((await pending).status, "SYNTHETIC_COMMITTED");
        assert.equal((await snapshot(f)).Devices, 0);
        const counter = (await root!.request().input("id", sql.UniqueIdentifier, f.scope.deviceSessionId)
          .query("SELECT CONVERT(VARCHAR(20),RenewalCounter) C FROM uqp.SharedWorkstationDeviceSession WHERE Id=@id")).recordset[0].C;
        assert.equal(counter, "9007199254740994");
      } catch (error) { await tx.rollback().catch(() => undefined); throw error; }
    });
    await runCase("legacy-insert-predicate-block", async () => {
      const f = await fixture();
      let acquired!: () => void, release!: () => void;
      const locked = new Promise<void>(resolve => { acquired = resolve; });
      const barrier = new Promise<void>(resolve => { release = resolve; });
      const pending = writer(f, "NONE", async () => { acquired(); await barrier; });
      await Promise.race([locked, pending.then(() => { throw Error("WRITER_DID_NOT_REACH_BARRIER"); })]);
      const competing = new sql.Transaction(root!); await competing.begin();
      try {
        let timeout = false;
        try { await new sql.Request(competing).input("id", sql.UniqueIdentifier, randomUUID())
          .input("w", sql.VarChar(20), f.scope.workstationId).query(`SET LOCK_TIMEOUT 300;
            INSERT uqp.SharedWorkstationSession(Id,WorkstationId,UserId,SessionSecretHash,AuthMethod,AuthenticatedAtUtc,LastActivityAtUtc,ExpiresAtUtc,TokenVersion)
            VALUES(@id,CONVERT(BIGINT,@w),${userId},HASHBYTES('SHA2_256',0x01),N'PASSWORD',
            SYSUTCDATETIME(),SYSUTCDATETIME(),DATEADD(MINUTE,1,SYSUTCDATETIME()),1);`); }
        catch (error) { assert.equal((error as { number?: number }).number, 1222); timeout = true; }
        assert.equal(timeout, true);
      } finally { await competing.rollback(); release(); }
      assert.equal((await pending).status, "SYNTHETIC_COMMITTED");
    });
    await runCase("gate-timeout", async () => {
      const f = await fixture(), before = await snapshot(f), tx = new sql.Transaction(root!);
      await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
      try {
        await new sql.Request(tx).query(workstationSessionRepositorySql.acquireGate);
        assert.equal((await writer(f)).status, "REJECTED"); assert.deepEqual(await snapshot(f), before);
      } finally { await tx.rollback(); }
    });
    await runCase("legacy-writer-denial", async () => {
      const tx = new sql.Transaction(root!); await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
      try { await assert.rejects(new sql.Request(tx).query(legacyWorkstationWriterFenceSql),
        (error: unknown) => (error as { number?: number }).number === 52926); }
      finally { await tx.rollback().catch(() => undefined); }
    });
    await runCase("immutable-decision-request", async () => {
      for (const table of ["SharedWorkstationSessionRequest","SharedWorkstationSessionDecision"]) {
        await assert.rejects(app!.request().query(`DELETE FROM uqp.${table}`));
        // Also prove the SQL append-only trigger, independently of runtime DENY.
        await assert.rejects(root!.request().query(`DELETE FROM uqp.${table}`),
          (error: unknown) => (error as { number?: number }).number === 52926);
      }
    });
    await runCase("foreign-workstation-unchanged", async () => {
      const foreign = await fixture(1), before = await snapshot(foreign);
      await assertCommitted(await fixture(1)); assert.deepEqual(await snapshot(foreign), before);
    });
    await runCase("multiple-active-device-constraint", async () => {
      const f = await fixture();
      await assert.rejects(root!.request().input("id", sql.UniqueIdentifier, randomUUID()).input("c", sql.UniqueIdentifier, f.scope.credentialId)
        .query(`INSERT uqp.SharedWorkstationDeviceSession(Id,WorkstationId,CredentialId,BoundCredentialVersion,SessionProofHash,
          CreatedAtUtc,LastActivityAtUtc,IdleExpiresAtUtc,AbsoluteExpiresAtUtc)
          SELECT @id,WorkstationId,CredentialId,BoundCredentialVersion,SessionProofHash,CreatedAtUtc,LastActivityAtUtc,IdleExpiresAtUtc,AbsoluteExpiresAtUtc
          FROM uqp.SharedWorkstationDeviceSession WHERE CredentialId=@c;`),
        (error: unknown) => [2601,2627].includes((error as { number: number }).number));
    });
    await runCase("rollback-ack-unknown", async () => {
      const f = await fixture(1), before = await snapshot(f), audits = await auditCount();
      assert.equal((await writer(f, "ROLLBACK_ACK")).status, "ROLLBACK_UNKNOWN");
      assert.deepEqual(await snapshot(f), before); assert.equal(await auditCount(), audits);
    });
    await runCase("deadlock-1205", async () => {
      const a = await fixture(1), b = await fixture(), before = await snapshot(a), audits = await auditCount();
      const competitor = new sql.Transaction(root!); await competitor.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
      let ready!: () => void;
      const barrier = new Promise<void>(resolve => { ready = resolve; });
      const priorErrors = sqlErrors.length;
      try {
        await new sql.Request(competitor).input("b", sql.VarChar(20), b.scope.workstationId).query(`SET DEADLOCK_PRIORITY HIGH;
          SELECT Id FROM uqp.SharedWorkstation WITH (UPDLOCK,HOLDLOCK) WHERE Id=CONVERT(BIGINT,@b);`);
        const pending = writer(a, "DEADLOCK", undefined, { workstationId: b.scope.workstationId, ready });
        await Promise.race([barrier, pending.then(() => { throw Error("NO_DEADLOCK_BARRIER"); })]);
        await new sql.Request(competitor).input("a", sql.VarChar(20), a.scope.workstationId).query(`
          SELECT Id FROM uqp.SharedWorkstation WITH (UPDLOCK,HOLDLOCK) WHERE Id=CONVERT(BIGINT,@a);`);
        assert.ok(["REJECTED", "ROLLBACK_UNKNOWN"].includes((await pending).status));
        assert.ok(sqlErrors.slice(priorErrors).includes(1205));
      } finally { await competitor.rollback().catch(() => undefined); }
      assert.deepEqual(await snapshot(a), before); assert.equal(await auditCount(), audits);
    });
    report.observedSqlErrorNumbers = [...new Set(sqlErrors)].sort();
    assert.ok(cases.every(result => result.status === "PASS"), "EVERY_SQL_CASE_MUST_EXECUTE");
    report.SQL_ACCEPTANCE = "PASS_ISOLATED_REVOCATION_CASES_ONLY"; exit = 0;
  } catch {
    report.failureStage = stage;
    report.SQL_ACCEPTANCE = created ? "FAIL" : "NOT_RUN";
  } finally {
    await app?.close().catch(() => undefined); await root?.close().catch(() => undefined);
    try {
      if (created) await master!.request().batch(`ALTER DATABASE [${database}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${database}];`);
      if (loginCreated) await master!.request().batch(`DROP LOGIN [${login}];`);
    } catch { report.cleanup = "FAILED_DISPOSABLE_CONTAINER_MUST_BE_REMOVED"; report.SQL_ACCEPTANCE = "FAIL"; exit = 1; }
    await master?.close().catch(() => undefined);
    // Fixed local report location. Never serialize driver exceptions/credentials/SQL.
    await writeFile(new URL("tools/sqlserver-acceptance/h0-926/last-report.json", rootUrl), JSON.stringify(report, null, 2) + "\n");
    console.log("SQL_ACCEPTANCE=" + report.SQL_ACCEPTANCE);
    if (report.failureStage) console.log("FAILURE_STAGE=" + report.failureStage);
  }
  return exit;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  process.exitCode = await run926Acceptance();
