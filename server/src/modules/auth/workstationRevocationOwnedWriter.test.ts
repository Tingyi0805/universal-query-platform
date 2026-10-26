import assert from "node:assert/strict";
import test from "node:test";
import { runIsolatedRevocationWriter, ownedRevocationWriterAvailability, type RevocationOwnedSqlDriver } from "./workstationRevocationOwnedWriter.js";
import type { CredentialRevocationEvidence } from "./workstationCredentialRevocationFence.js";

const evidence = (): CredentialRevocationEvidence => ({
  credentialMutationAffected: 1, expectedCredentialVersionMatched: true,
  deviceSessionsLocked: 1, deviceSessionsRevoked: 1, deviceSessionsRemaining: 0,
  legacySessionsLocked: 2, legacySessionsRevoked: 2, legacySessionsRemaining: 0,
  operatorStatePresent: true, operatorCasAffected: 1,
  operatorGenerationAdvanced: true, operatorIncarnationRotated: true,
  requestReservationAffected: 0, auditAffected: 0, decisionAffected: 0,
  auditLogId: null, commitOutcome: "UNKNOWN",
});
function harness(fail: string | null = null) {
  const events: string[] = [];
  const call = (name: string) => {
    events.push(name);
    if (fail === name) throw Error("INJECTED_" + name);
  };
  const driver: RevocationOwnedSqlDriver = {
    async beginSerializable() {
      call("begin");
      return {
        async acquireSecurityGate() { call("gate"); return fail !== "gate-denied"; },
        async lockAndRevalidateScope() { call("lock"); },
        async revokeCredentialAndSessions() { call("mutation"); return evidence(); },
        async insertRequestAuditAndDecision() {
          call("audit");
          return { requestReservationAffected: 1, auditAffected: 1, decisionAffected: 1, auditLogId: "9007199254740993" };
        },
        async commit() { call("commit"); },
        async rollback() { call("rollback"); },
      };
    },
  };
  return { driver, events };
}
test("mock writer owns ordered steps and always retains zero runtime authority", async () => {
  const h = harness();
  const result = await runIsolatedRevocationWriter(h.driver);
  assert.equal(result.status, "SYNTHETIC_COMMITTED");
  assert.equal(result.authority, "NONE");
  assert.equal(result.runtimeEnabled, false);
  assert.equal(ownedRevocationWriterAvailability.realSqlAdapterImplemented, false);
  assert.deepEqual(h.events, ["begin", "gate", "lock", "mutation", "audit", "commit"]);
});
test("gate, lock, mutation, audit failures rollback without commit", async () => {
  for (const fail of ["gate-denied", "lock", "mutation", "audit"]) {
    const h = harness(fail);
    const result = await runIsolatedRevocationWriter(h.driver);
    assert.equal(result.status, "REJECTED", fail);
    assert.ok(h.events.includes("rollback"), fail);
    assert.ok(!h.events.includes("commit"), fail);
  }
});
test("commit uncertainty is not retried, rollback uncertainty stays distinct", async () => {
  const h = harness("commit");
  assert.equal((await runIsolatedRevocationWriter(h.driver)).status, "COMMIT_UNKNOWN");
  assert.equal(h.events.filter(e => e === "commit").length, 1);
  assert.ok(!h.events.includes("rollback"));
  const f = harness("rollback");
  // Inject rollback by first denying the gate.
  const driver: RevocationOwnedSqlDriver = {
    async beginSerializable() {
      const tx = await f.driver.beginSerializable();
      return { ...tx, async acquireSecurityGate() { return false; } };
    },
  };
  assert.equal((await runIsolatedRevocationWriter(driver)).status, "ROLLBACK_UNKNOWN");
});

test("inconsistent mutation evidence is rejected before append-only audit writes", async () => {
  const events: string[] = [];
  const driver: RevocationOwnedSqlDriver = {
    async beginSerializable() {
      return {
        async acquireSecurityGate() { return true; },
        async lockAndRevalidateScope() {},
        async revokeCredentialAndSessions() {
          return { ...evidence(), deviceSessionsRemaining: 1 };
        },
        async insertRequestAuditAndDecision() {
          events.push("AUDIT_INSERT_MUST_NOT_RUN");
          throw Error("AUDIT_CALLED");
        },
        async commit() { events.push("COMMIT"); },
        async rollback() { events.push("ROLLBACK"); },
      };
    },
  };
  assert.equal((await runIsolatedRevocationWriter(driver)).status, "REJECTED");
  assert.deepEqual(events, ["ROLLBACK"]);
});
