import assert from "node:assert/strict";
import test from "node:test";
import { createIsolatedRevocationSqlDriver } from "./workstationRevocationSqlAdapter.js";
import { runIsolatedRevocationWriter } from "./workstationRevocationOwnedWriter.js";
import { isolatedCredentialAtomicSql as statements } from "./workstationCredentialAtomicSql.js";
import type { WorkstationSqlTransaction, WorkstationSqlRequest } from "./workstationSessionSql.repository.js";

const credentialId = "f0a14a4d-870b-4379-82b0-cc4d2d1c21ad";
const deviceId = "0de670b0-6b21-4e51-b013-1c84c4d21d02";
const legacyId = "923fe668-30d3-4cd1-96eb-d9acf6066330";
const incarnation = "d37f0484-f079-4689-bd36-28d3b16c1b01";
const nextIncarnation = "d37f0484-f079-4689-bd36-28d3b16c1b02";
const requestId = "d37f0484-f079-4689-bd36-28d3b16c1b03";
const command = { workstationId: "9007199254740993", credentialId, deviceSessionId: deviceId,
  expectedCredentialVersion: 2, requestId, nextIncarnation,
  transactionCorrelationId: "d37f0484-f079-4689-bd36-28d3b16c1b04" };
type Options = { legacy?: boolean; devices?: number; fail?: string; override?: Record<string, readonly Record<string, unknown>[]>;
  commitUnknown?: boolean; rollbackFails?: boolean; replay?: boolean; lease?: { held: boolean } };

/** Synthetic driver only. No SQL connection, lock or rollback proof. */
function fixture(options: Options = {}) {
  const events: string[] = [];
  const bindings: { step: string; values: Record<string, unknown> }[] = [];
  let durable: string[] = [];
  let staged: string[] = [];
  const ids = [deviceId, "0de670b0-6b21-4e51-b013-1c84c4d21d03"].slice(0, options.devices ?? 1);
  const tx: WorkstationSqlTransaction = {
    async begin(level) { assert.equal(level, 4); events.push("begin"); },
    async commit() { events.push("commit"); if (options.lease) options.lease.held = false; if (options.commitUnknown) throw Error("PRIVATE_DRIVER_DIAGNOSTIC"); durable = [...staged]; },
    async rollback() { events.push("rollback"); staged = []; if (options.rollbackFails) throw Error("PRIVATE_ROLLBACK_DIAGNOSTIC"); },
  };
  const deps = {
    async getPool() { return {}; }, transaction() { return tx; },
    request(owner: WorkstationSqlTransaction): WorkstationSqlRequest {
      assert.equal(owner, tx);
      const values: Record<string, unknown> = {};
      const req: WorkstationSqlRequest = {
        input(name, _type, value) { values[name] = value; return req; },
        async query(text) {
          let step = Object.entries(statements).find(([, value]) => value === text)?.[0];
          if (!step) step = text.includes("sp_getapplock") ? "gate" : text.includes("AS WorkstationId") ? "workstation" : "credential";
          events.push(step); bindings.push({ step, values });
          if (options.fail === step) throw Object.assign(Error("PRIVATE_SQL_INPUT"), { number: step === "credentialCas" ? 1205 : 1222 });
          const defaults: Record<string, readonly Record<string, unknown>[]> = {
            gate: [{ GateResult: options.lease?.held ? -1 : 0 }], workstation: [{ WorkstationId: command.workstationId, IsActive: true, RetiredAtUtc: null }],
            credential: [{ CredentialId: credentialId, CredentialVersion: 2 }],
            countUnmappedLegacy: [{ UnmappedActiveLegacySessions: "0" }],
            lockCredentialDevice: [{ DeviceSessionId: deviceId, BoundCredentialVersion: 2 }],
            lockDevices: ids.map(SessionId => ({ SessionId })),
            lockOperator: [{ DeviceSessionId: deviceId, Revision: "0000000000000001", Generation: "9007199254740993", Incarnation: incarnation }],
            lockLegacySessions: options.legacy ? [{ SessionId: legacyId }] : [],
            countActiveLegacyBeforeCas: [{ ActiveLegacySessions: options.legacy ? "1" : "0" }],
            credentialCas: [{ CredentialAffected: 1 }],
            revokeDevices: [{ DeviceSessionsRevoked: ids.length }],
            revokeLinkedLegacy: options.legacy ? [{ RevokedSessionId: legacyId }] : [],
            revokeOperatorCas: [{ NextOperatorRevision: "0000000000000018", NextGeneration: "9007199254740994", NextIncarnation: nextIncarnation }],
            remainingDevices: [{ Remaining: "0" }], remainingLegacy: [{ Remaining: "0" }],
            reserveRequest: [{ RequestId: requestId }], insertAudit: [{ AuditLogId: "9007199254740999" }],
            insertDecision: [{ RequestId: requestId }],
          };
          if (step === "gate" && options.lease && !options.lease.held) options.lease.held = true;
          if (step === "reserveRequest" && options.replay) throw Object.assign(Error("DUPLICATE"), { number: 2627 });
          if (["credentialCas", "revokeDevices", "revokeLinkedLegacy", "revokeOperatorCas", "reserveRequest", "insertAudit", "insertDecision"].includes(step)) staged.push(step);
          return { recordset: options.override?.[step] ?? defaults[step] ?? [], rowsAffected: [] };
        },
      };
      return req;
    },
  };
  return { driver: createIsolatedRevocationSqlDriver(deps, command), events, bindings, durable: () => durable };
}

for (const legacy of [false, true]) test("atomic owned writer commits exact scope; legacy=" + legacy, async () => {
  const f = fixture({ legacy });
  const result = await runIsolatedRevocationWriter(f.driver);
  assert.equal(result.status, "SYNTHETIC_COMMITTED");
  assert.equal(result.authority, "NONE"); assert.equal(result.runtimeEnabled, false);
  assert.deepEqual(f.durable(), ["credentialCas", "revokeDevices", "revokeLinkedLegacy", "revokeOperatorCas", "reserveRequest", "insertAudit", "insertDecision"]);
  assert.ok(f.events.indexOf("countActiveLegacyBeforeCas") < f.events.indexOf("credentialCas"));
  assert.ok(f.events.indexOf("revokeLinkedLegacy") < f.events.indexOf("revokeOperatorCas"));
  const decision = f.bindings.find(b => b.step === "insertDecision")!.values;
  assert.equal(decision.auditLogId, "9007199254740999");
  assert.equal(decision.previousGeneration, "9007199254740993");
  assert.equal(decision.nextGeneration, "9007199254740994");
  assert.equal(decision.previousOperatorRevision, "0000000000000001");
  assert.equal(decision.nextOperatorRevision, "0000000000000018");
  for (const binding of f.bindings) if ("workstationId" in binding.values)
    assert.equal(binding.values.workstationId, command.workstationId);
});

test("all credential devices are counted (926 unique active credential currently limits installed schema to one)", async () => {
  const f = fixture({ devices: 2 });
  assert.equal((await runIsolatedRevocationWriter(f.driver)).status, "SYNTHETIC_COMMITTED");
});

for (const step of ["credentialCas", "revokeDevices", "revokeLinkedLegacy", "revokeOperatorCas", "remainingDevices",
  "remainingLegacy", "reserveRequest", "insertAudit", "insertDecision"]) test("SQL failure rolls back all staged writes: " + step, async () => {
  const f = fixture({ legacy: true, fail: step });
  const result = await runIsolatedRevocationWriter(f.driver);
  assert.equal(result.status, "REJECTED"); assert.deepEqual(f.durable(), []);
  assert.equal(f.events.at(-1), "rollback"); assert.ok(!f.events.includes("commit"));
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|SQL_INPUT/);
});

const invalidEvidence: Record<string, readonly Record<string, unknown>[]> = {
  workstation: [{ WorkstationId: "2", IsActive: true, RetiredAtUtc: null }],
  countUnmappedLegacy: [{ UnmappedActiveLegacySessions: "1" }],
  credential: [{ CredentialId: credentialId, CredentialVersion: 3 }],
  lockCredentialDevice: [], lockOperator: [],
  countActiveLegacyBeforeCas: [{ ActiveLegacySessions: "1" }],
};
for (const [step, rows] of Object.entries(invalidEvidence)) test("unproven lineage/binding refuses every DML: " + step, async () => {
  const f = fixture({ override: { [step]: rows } });
  assert.equal((await runIsolatedRevocationWriter(f.driver)).status, "REJECTED");
  assert.ok(!f.events.includes("credentialCas")); assert.deepEqual(f.durable(), []);
});

for (const [label, step, rows] of [
  ["credential CAS", "credentialCas", [{ CredentialAffected: 0 }]],
  ["device count", "revokeDevices", [{ DeviceSessionsRevoked: 2 }]],
  ["legacy receipt", "revokeLinkedLegacy", [{ RevokedSessionId: deviceId }]],
  ["operator RowVersion", "revokeOperatorCas", [{ NextOperatorRevision: "0000000000000001", NextGeneration: "9007199254740994", NextIncarnation: nextIncarnation }]],
  ["operator generation", "revokeOperatorCas", [{ NextOperatorRevision: "0000000000000002", NextGeneration: "9007199254740993", NextIncarnation: nextIncarnation }]],
  ["operator incarnation", "revokeOperatorCas", [{ NextOperatorRevision: "0000000000000002", NextGeneration: "9007199254740994", NextIncarnation: incarnation }]],
  ["remaining legacy after cleared link", "remainingLegacy", [{ Remaining: "1" }]],
  ["Number audit ID", "insertAudit", [{ AuditLogId: 9007199254740992 }]],
  ["decision correlation", "insertDecision", [{ RequestId: deviceId }]],
] as const) test("reject inconsistent receipt: " + label, async () => {
  const f = fixture({ override: { [step]: rows } });
  assert.equal((await runIsolatedRevocationWriter(f.driver)).status, "REJECTED");
  assert.deepEqual(f.durable(), []); assert.ok(!f.events.includes("commit"));
});

test("duplicate RequestId aborts transaction and never inserts audit/decision", async () => {
  const f = fixture({ replay: true });
  assert.equal((await runIsolatedRevocationWriter(f.driver)).status, "REJECTED");
  assert.deepEqual(f.durable(), []); assert.ok(!f.events.includes("insertAudit"));
});
test("commit unknown is never retried or claimed rolled back", async () => {
  const f = fixture({ commitUnknown: true });
  assert.equal((await runIsolatedRevocationWriter(f.driver)).status, "COMMIT_UNKNOWN");
  assert.equal(f.events.filter(e => e === "commit").length, 1); assert.ok(!f.events.includes("rollback"));
});
test("rollback failure remains unknown", async () => {
  const f = fixture({ fail: "insertAudit", rollbackFails: true });
  assert.equal((await runIsolatedRevocationWriter(f.driver)).status, "ROLLBACK_UNKNOWN");
});
test("direct transaction caller cannot skip scope, audit or reenter mutation", async () => {
  const f = fixture();
  const tx = await f.driver.beginSerializable();
  await assert.rejects(tx.commit(), /COMMIT_ORDER_INVALID/);
  await assert.rejects(tx.revokeCredentialAndSessions(), /MUTATION_ORDER_INVALID/);
  await tx.acquireSecurityGate(); await tx.lockAndRevalidateScope();
  await tx.revokeCredentialAndSessions();
  await assert.rejects(tx.revokeCredentialAndSessions(), /MUTATION_ORDER_INVALID/);
  await assert.rejects(tx.commit(), /COMMIT_ORDER_INVALID/);
  await tx.rollback();
  await assert.rejects(tx.acquireSecurityGate(), /TRANSACTION_CLOSED/);
});

test("synthetic competing gate admits one writer; denied contender performs no DML", async () => {
  const lease = { held: false };
  const a = fixture({ lease }); const b = fixture({ lease });
  const results = await Promise.all([runIsolatedRevocationWriter(a.driver), runIsolatedRevocationWriter(b.driver)]);
  assert.deepEqual(results.map(r => r.status).sort(), ["REJECTED", "SYNTHETIC_COMMITTED"]);
  const denied = a.events.includes("commit") ? b : a;
  assert.ok(!denied.events.includes("credentialCas"));
  assert.deepEqual(denied.durable(), []);
});

test("accessor and Proxy commands are rejected without evaluating hooks", async () => {
  let hooks = 0;
  const accessor = Object.defineProperty({}, "workstationId", { get() { hooks++; throw Error("SECRET"); } });
  const proxy = new Proxy({}, { ownKeys() { hooks++; throw Error("SECRET"); } });
  for (const input of [accessor, proxy]) {
    const driver = createIsolatedRevocationSqlDriver({
      async getPool() { return {}; },
      transaction() { return { async begin() {}, async commit() {}, async rollback() {} }; },
      request() { const req: WorkstationSqlRequest = { input() { return req; }, async query() { return { recordset: [{ GateResult: 0 }], rowsAffected: [] }; } }; return req; },
    }, input as typeof command);
    assert.equal((await runIsolatedRevocationWriter(driver)).status, "REJECTED");
  }
  assert.equal(hooks, 0);
});

test("command target is copied before asynchronous transaction work", async () => {
  const f = fixture();
  const original = command.workstationId;
  command.workstationId = "2";
  try {
    // Mock now reports workstation 2. The adapter must still demand its copied
    // original ID and reject, rather than following a changed caller target.
    assert.equal((await runIsolatedRevocationWriter(f.driver)).status, "REJECTED");
    assert.ok(!f.events.includes("credentialCas"));
  } finally { command.workstationId = original; }
});
