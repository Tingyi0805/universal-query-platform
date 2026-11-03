import test from "node:test";
import assert from "node:assert/strict";
import type sql from "mssql";
import { createWorkstationPinService } from "./workstationPin.service.js";

function fixture() {
  const calls: string[] = [];
  const tx = {} as sql.Transaction;
  const state = { enabled: true, valid: true, candidate: true, active: "A", generation: "1", failAudit: "", failCommit: false, stale: false, blocked: false, expired: false };
  const binding = () => ({ workstationId: 7, credentialVersion: 2, generation: state.generation });
  const user = { Id: 8, TokenVersion: 3, PinVersion: 4, PinLength: 6, PinHash: "$uqp-scrypt$1$synthetic" };
  const service = createWorkstationPinService({ enabled: () => state.enabled, pepper: () => ({ id: "test", key: Buffer.alloc(32, 7) }),
    sessions: {
      credential: async () => binding(), candidate: async () => { calls.push("candidate"); return state.candidate ? user : null; },
      accountBucketIdentity: async () => "user:8", expire: async () => state.expired ? [8] : [],
      insert: async () => { calls.push("insert"); state.active = "B"; }, read: async () => null, touch: async () => null,
    },
    state: {
      revokeForIntent: async (_id, audit) => {
        calls.push("revoke"); const old = state.active; state.active = ""; state.generation = "2";
        try { await audit(tx, "2"); } catch (error) { state.active = old; throw error; }
        calls.push("commit-A"); return "2";
      },
      attempt: async (_buckets, verify) => {
        if (state.blocked) return "LOCKED";
        try {
          const valid = await verify(tx);
          if (state.failCommit) throw new Error("commit-failed");
          calls.push("commit-B"); return valid ? "OK" : "INVALID";
        } catch (error) { state.active = ""; calls.push("rollback-B"); throw error; }
      },
      claimGeneration: async () => { calls.push("CAS"); return !state.stale; },
      transaction: async run => run(tx),
    },
    verify: async () => { calls.push("verify"); assert.ok(calls.includes("commit-A")); return state.valid; },
    audit: async input => { calls.push(input.eventType); if (input.eventType === state.failAudit) throw new Error("audit-failed"); return 1; },
    token: () => "synthetic-token",
  });
  const login = () => service.login({ credential: "synthetic-credential", username: " synthetic ", pin: "837294", network: "192.0.2.1" });
  return { state, calls, service, login };
}
test("A revocation and Audit commit before B verification; CAS, insert and Audit precede success", async () => {
  const f = fixture();
  assert.deepEqual(await f.login(), { status: "OK", token: "synthetic-token" });
  assert.deepEqual(f.calls, ["revoke", "AUTH_PIN_SWITCH_REVOKED", "commit-A", "candidate", "verify", "CAS", "insert", "AUTH_PIN_LOGIN_SUCCESS", "commit-B"]);
});
test("wrong PIN, nonexistent user and locked buckets cannot resurrect A or mint B", async () => {
  for (const mode of ["wrong", "missing", "locked"]) {
    const f = fixture(); f.state.valid = mode !== "wrong"; f.state.candidate = mode !== "missing"; f.state.blocked = mode === "locked";
    const result = await f.login();
    assert.equal(result.status, mode === "locked" ? "LOCKED" : "INVALID");
    assert.equal(f.state.active, ""); assert.ok(!("token" in result)); assert.ok(!f.calls.includes("insert"));
    assert.ok(f.calls.includes(mode === "locked" ? "AUTH_PIN_LOGIN_LOCKED" : "AUTH_PIN_LOGIN_FAILED"));
  }
});
test("stale generation and phase-two Audit/commit failure leave A revoked", async () => {
  for (const mode of ["stale", "audit", "commit"]) {
    const f = fixture(); f.state.stale = mode === "stale"; f.state.failCommit = mode === "commit";
    if (mode === "audit") f.state.failAudit = "AUTH_PIN_LOGIN_SUCCESS";
    await assert.rejects(f.login()); assert.equal(f.state.active, ""); assert.ok(f.calls.includes("commit-A"));
  }
});
test("phase-one Audit failure cannot proceed to verify B", async () => {
  const f = fixture(); f.state.failAudit = "AUTH_PIN_SWITCH_REVOKED";
  await assert.rejects(f.login(), /audit-failed/); assert.equal(f.state.active, "A"); assert.ok(!f.calls.includes("verify"));
});
test("disabled runtime does no credential lookup, revocation or Audit", async () => {
  const f = fixture(); f.state.enabled = false;
  await assert.rejects(f.login(), /DISABLED/); assert.deepEqual(f.calls, []);
});
test("session check persists idle/absolute revocation Audit in caller transaction and fails closed on Audit failure", async () => {
  const f = fixture(); f.state.expired = true;
  assert.equal(await f.service.current("synthetic-token", "synthetic-credential"), null);
  assert.ok(f.calls.includes("AUTH_PIN_IDLE_LOCKED"));
  f.state.failAudit = "AUTH_PIN_IDLE_LOCKED";
  await assert.rejects(f.service.current("synthetic-token", "synthetic-credential"), /audit-failed/);
});
