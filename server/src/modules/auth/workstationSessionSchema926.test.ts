import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import {
  assessSessionPersistence,
  canonicalSqlBigInt,
  exactAuditOutputContract,
  sessionLockOrder,
  workstationSessionMigration,
  workstationSessionTables926,
  type SessionPersistenceObservation,
} from "./workstationSessionSchema926.js";

const root = new URL("../../../../", import.meta.url);
const ddl = readFileSync(new URL(`database/drafts/${workstationSessionMigration}`, root), "utf8");
const catalog = readFileSync(
  new URL("tools/sqlserver-acceptance/drafts/926/926_catalog_readonly.sql", root),
  "utf8",
);

const observation = (
  overrides: Partial<SessionPersistenceObservation> = {},
): SessionPersistenceObservation => ({
  format: "WORKSTATION_SESSION_PERSISTENCE_OBSERVATION_V1",
  operation: "OPERATOR_SWITCH",
  workstationId: "9007199254740993",
  requestId: "00000000-0000-4000-8000-000000000926",
  requestDigest: "a".repeat(64),
  transactionOwner: "REPOSITORY_OWNED",
  isolation: "SERIALIZABLE",
  xactAbort: true,
  locks: [...sessionLockOrder],
  requestClaimAffectedRows: 1,
  mutationAffectedRows: 1,
  expectedRevision: "0000000000000001",
  nextRevision: "0000000000000002",
  auditLogId: "9007199254740993",
  auditAffectedRows: 1,
  decisionAffectedRows: 1,
  commitOutcome: "COMMITTED",
  ...overrides,
});

const assertNoAuthority = (result: ReturnType<typeof assessSessionPersistence>) => {
  assert.equal(result.authority, "NONE");
  assert.equal(result.queryExecutionAllowed, false);
  assert.equal(result.patientDataAllowed, false);
  assert.equal(result.productionReady, false);
  assert.equal(result.sqlTransactionVerified, false);
};

test("926 is the next isolated candidate and cannot be auto-scanned by db:migrate", () => {
  const migrationNames = readdirSync(new URL("database/migrations/", root));
  const numeric = migrationNames
    .map(name => Number.parseInt(name.match(/^(\d+)_/)?.[1] ?? "", 10))
    .filter(Number.isSafeInteger);
  assert.equal(Math.max(...numeric), 921);
  assert.ok(!migrationNames.some(name => name.startsWith("926_")));
  assert.match(new URL(`database/drafts/${workstationSessionMigration}`, root).pathname, /database\/drafts\/926_/u);
  const runner = readFileSync(new URL("server/src/scripts/migrate.ts", root), "utf8");
  assert.match(runner, /database\/migrations/u);
  assert.doesNotMatch(runner, /database\/drafts/u);
});

test("candidate preserves the legacy operator session and creates six separate persistence objects", () => {
  for (const table of workstationSessionTables926) assert.match(ddl, new RegExp(`CREATE TABLE uqp\\.${table} \\(`, "u"));
  assert.equal((ddl.match(/CREATE TABLE uqp\./gu) ?? []).length, 6);
  assert.doesNotMatch(ddl, /ALTER TABLE uqp\.SharedWorkstationSession\s+(ADD|ALTER|DROP)/iu);
  assert.match(ddl, /SharedWorkstationDeviceSession/u);
  assert.match(ddl, /SharedWorkstationOperatorState/u);
});

test("device proof, expiry, revocation, counter, and CAS columns are constrained", () => {
  assert.match(ddl, /SessionProofHash VARBINARY\(32\) NOT NULL/u);
  assert.match(ddl, /DATALENGTH\(SessionProofHash\)=32/u);
  assert.match(ddl, /IdleExpiresAtUtc<=AbsoluteExpiresAtUtc/u);
  assert.match(ddl, /RenewalCounter BIGINT NOT NULL/u);
  assert.match(ddl, /RowVersion ROWVERSION NOT NULL/u);
  assert.match(ddl, /BoundCredentialVersion>0/u);
  assert.match(ddl, /UX_WorkstationDeviceSession_ActiveCredential[\s\S]*WHERE RevokedAtUtc IS NULL/u);
});

test("nullable security CHECKs reject SQL UNKNOWN and enum trailing-space variants", () => {
  for (const name of [
    "CK_WorkstationDeviceSession_Revocation",
    "CK_WorkstationPinAttempt_State",
    "CK_WorkstationOperatorState_Active",
    "CK_WorkstationSessionDecision_Revision",
    "CK_WorkstationSessionDecision_Reason",
  ]) {
    const body = ddl.slice(ddl.indexOf(name), ddl.indexOf(name) + 900);
    assert.match(body, /CHECK\s*\(CASE WHEN/u, name);
    assert.match(body, /THEN 1 ELSE 0 END=1/u, name);
  }
  for (const marker of ["DEVICE_READY#", "OPERATOR_SWITCH#", "AUTHORIZATION_REVOKE#", "REJECTED#", "PIN_ATTEMPT#"]) {
    assert.ok(ddl.includes(marker), marker);
  }
});

test("generation, incarnation, live authorization versions, and PIN policy revision are durable", () => {
  assert.match(ddl, /PolicyRevision BIGINT NOT NULL/u);
  assert.match(ddl, /PolicyRowVersion ROWVERSION NOT NULL/u);
  for (const token of ["Generation BIGINT", "Incarnation UNIQUEIDENTIFIER", "TokenVersion INT", "PinVersion INT"]) {
    assert.ok(ddl.includes(token), token);
  }
  assert.match(ddl, /UserQuickPinSecurityBinding/u);
  assert.match(ddl, /SharedWorkstationPinAttemptState/u);
  assert.doesNotMatch(ddl, /SessionSecret\s|PinPlain|PlainPin|CredentialSecret\s/iu);
});

test("request replay and immutable decision/audit correlation are database constrained", () => {
  assert.match(ddl, /RequestId UNIQUEIDENTIFIER NOT NULL[\s\S]*PRIMARY KEY/u);
  assert.match(ddl, /RequestDigest BINARY\(32\) NOT NULL/u);
  assert.match(ddl, /UQ_WorkstationSessionDecision_Request UNIQUE\(RequestId\)/u);
  assert.match(ddl, /UQ_WorkstationSessionDecision_Audit UNIQUE\(AuditLogId\)/u);
  assert.match(ddl, /TR_WorkstationSessionRequest_AppendOnly/u);
  assert.match(ddl, /TR_WorkstationSessionDecision_AppendOnly/u);
  assert.doesNotMatch(ddl, /FOREIGN KEY\s*\(AuditLogId\)|REFERENCES uqp\.AuditLog/iu);
});

test("candidate is additive, transactional, rejects partial installs, and grants no authority", () => {
  const withoutComments = ddl.replace(/^\s*--.*$/gmu, "");
  assert.match(ddl, /SET XACT_ABORT ON/u);
  assert.match(ddl, /BEGIN TRANSACTION/u);
  assert.match(ddl, /PARTIALLY_INSTALLED_REQUIRES_EXACT_VALIDATION/u);
  assert.match(ddl, /IF XACT_STATE\(\)<>0 ROLLBACK TRANSACTION/u);
  assert.doesNotMatch(withoutComments, /^\s*(DROP|TRUNCATE|DELETE|MERGE|GRANT|DENY)\b/imu);
  assert.doesNotMatch(withoutComments, /\bDELETE\s+FROM\s+uqp\.|\bUPDATE\s+uqp\./iu);
  assert.doesNotMatch(withoutComments, /INSERT\s+(?:INTO\s+)?uqp\./iu);
  assert.doesNotMatch(ddl, /SOURCE_BOUND|SQL_LOCK_VERIFIED|patientDataAllowed\s*[:=]\s*true/iu);
});

test("catalog witness is metadata-only and never installs or repairs schema", () => {
  const normalized = catalog
    .replace(/^\s*--.*$/gmu, "")
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/N?'(?:''|[^'])*'/gu, "''");
  assert.doesNotMatch(normalized, /\b(CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|MERGE|EXEC|EXECUTE|GRANT|DENY|TRUNCATE|DBCC|OPENROWSET|OPENDATASOURCE)\b/iu);
  assert.match(catalog, /sys\.columns/u);
  assert.match(catalog, /sys\.indexes/u);
  assert.match(catalog, /sys\.foreign_keys/u);
  assert.match(catalog, /OBJECT_DEFINITION/u);
  assert.match(catalog, /RowVersionCount/u);
});

test("canonical SQL BIGINT accepts exact strings beyond 2^53 and rejects Number repair", () => {
  for (const value of ["1", "9007199254740993", "9223372036854775807"]) assert.equal(canonicalSqlBigInt(value), true);
  for (const value of [0, 1, 9007199254740992, "0", "01", "+1", "1.0", "9223372036854775808", " 1"])
    assert.equal(canonicalSqlBigInt(value), false);
  assert.match(exactAuditOutputContract.insert, /CONVERT\(VARCHAR\(20\),INSERTED\.Id\)/u);
  assert.equal(exactAuditOutputContract.archiveForeignKeyAllowed, false);
});

test("a complete synthetic observation remains non-authoritative", () => {
  const result = assessSessionPersistence(observation());
  assert.equal(result.ok, true);
  assert.equal(result.status, "SYNTHETIC_CONSISTENT");
  if (result.ok) assert.equal(result.auditLogId, "9007199254740993");
  assertNoAuthority(result);
});

test("common lock order is exact; missing, reversed, or tail-added gate fails", () => {
  for (const locks of [sessionLockOrder.slice(1), [...sessionLockOrder].reverse(), [...sessionLockOrder.slice(1), sessionLockOrder[0]]]) {
    const result = assessSessionPersistence(observation({ locks }));
    assert.deepEqual({ ok: result.ok, reason: result.ok ? null : result.reason }, { ok: false, reason: "LOCK_ORDER_INVALID" });
    assertNoAuthority(result);
  }
});

test("unowned, non-SERIALIZABLE, or non-XACT_ABORT observations fail closed", () => {
  const cases = [
    { transactionOwner: "EXTERNAL" },
    { isolation: "READ_COMMITTED" },
    { xactAbort: false },
  ];
  for (const change of cases) {
    const result = assessSessionPersistence({ ...observation(), ...change });
    assert.deepEqual({ ok: result.ok, reason: result.ok ? null : result.reason }, { ok: false, reason: "TRANSACTION_NOT_OWNED" });
    assertNoAuthority(result);
  }
});

test("request replay, CAS conflict, audit failure, and decision failure cannot partially succeed", () => {
  const cases: [Partial<SessionPersistenceObservation>, string][] = [
    [{ requestClaimAffectedRows: 0 }, "REQUEST_CONFLICT"],
    [{ requestClaimAffectedRows: 2 }, "REQUEST_CONFLICT"],
    [{ mutationAffectedRows: 0 }, "CAS_CONFLICT"],
    [{ nextRevision: null }, "CAS_CONFLICT"],
    [{ nextRevision: "0000000000000001" }, "CAS_CONFLICT"],
    [{ auditAffectedRows: 0 }, "AUDIT_NOT_ATOMIC"],
    [{ decisionAffectedRows: 0 }, "DECISION_NOT_ATOMIC"],
  ];
  for (const [change, reason] of cases) {
    const result = assessSessionPersistence(observation(change));
    assert.deepEqual({ ok: result.ok, reason: result.ok ? null : result.reason }, { ok: false, reason });
    assertNoAuthority(result);
  }
});

test("Audit receipt refuses every Number, malformed string, zero, and overflow", () => {
  for (const auditLogId of [1, Number.MAX_SAFE_INTEGER, 9007199254740992, "0", "01", "9007199254740993.0", "9223372036854775808"]) {
    const result = assessSessionPersistence(observation({ auditLogId }));
    assert.deepEqual({ ok: result.ok, reason: result.ok ? null : result.reason }, { ok: false, reason: "AUDIT_RECEIPT_INVALID" });
    assertNoAuthority(result);
  }
});

test("rollback and commit-unknown are never reported as success", () => {
  for (const commitOutcome of ["ROLLED_BACK", "UNKNOWN"] as const) {
    const result = assessSessionPersistence(observation({ commitOutcome }));
    assert.deepEqual({ ok: result.ok, reason: result.ok ? null : result.reason }, { ok: false, reason: "COMMIT_NOT_PROVEN" });
    assertNoAuthority(result);
  }
});

test("renewal, switching, PIN failure, locking, sign-out, and revocation share the same atomic boundary", () => {
  for (const operation of ["DEVICE_RENEW", "OPERATOR_SWITCH", "PIN_FAILURE", "OPERATOR_LOCK", "OPERATOR_SIGNOUT", "DEVICE_REVOKE", "AUTHORIZATION_REVOKE"] as const) {
    const result = assessSessionPersistence(observation({ operation }));
    assert.equal(result.ok, true, operation);
    assertNoAuthority(result);
  }
});

test("unknown fields, getters, proxies, and unsafe identifiers are rejected without evaluation", () => {
  let calls = 0;
  const getter = Object.defineProperty({}, "format", { enumerable: true, get() { calls += 1; throw new Error("SECRET"); } });
  const proxy = new Proxy({}, { getPrototypeOf() { calls += 1; throw new Error("SECRET"); } });
  for (const value of [
    { ...observation(), extra: true }, getter, proxy,
    observation({ workstationId: "9007199254740993.0" }),
    observation({ requestId: "not-a-uuid" }),
  ]) {
    const result = assessSessionPersistence(value);
    assert.equal(result.ok, false);
    assertNoAuthority(result);
    assert.doesNotMatch(JSON.stringify(result), /SECRET/u);
  }
  assert.equal(calls, 0);
});
