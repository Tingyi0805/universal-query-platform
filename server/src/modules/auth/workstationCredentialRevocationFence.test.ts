import assert from "node:assert/strict";
import test from "node:test";
import { assessCredentialRevocation, assessCredentialRevocationMutation, credentialRevocationRuntimeGate, type CredentialRevocationEvidence } from "./workstationCredentialRevocationFence.js";

const complete = (): CredentialRevocationEvidence => ({
  credentialMutationAffected: 1,
  expectedCredentialVersionMatched: true,
  deviceSessionsLocked: 2, deviceSessionsRevoked: 2, deviceSessionsRemaining: 0,
  legacySessionsLocked: 3, legacySessionsRevoked: 3, legacySessionsRemaining: 0,
  operatorStatePresent: true, operatorCasAffected: 1,
  operatorGenerationAdvanced: true, operatorIncarnationRotated: true,
  requestReservationAffected: 1, auditAffected: 1, decisionAffected: 1,
  auditLogId: "9007199254740993", commitOutcome: "COMMITTED",
});

test("even complete synthetic evidence has zero runtime authority", () => {
  const output = assessCredentialRevocation(complete());
  assert.equal(output.admissible, true);
  assert.equal(output.reason, "SYNTHETIC_CONSISTENT");
  assert.equal(output.authority, "NONE");
  assert.equal(output.productionReady, false);
  assert.equal(credentialRevocationRuntimeGate.registered, false);
  assert.equal(credentialRevocationRuntimeGate.writerIntegrated, false);
});

test("deny partial device/legacy/operator invalidation, even when audit exists", () => {
  const cases: Partial<CredentialRevocationEvidence>[] = [
    { credentialMutationAffected: 0 }, { credentialMutationAffected: 2 },
    { expectedCredentialVersionMatched: false },
    { deviceSessionsRevoked: 1 }, { deviceSessionsRemaining: 1 },
    { legacySessionsRevoked: 2 }, { legacySessionsRemaining: 1 },
    { deviceSessionsLocked: -1 }, { legacySessionsLocked: Number.NaN },
    { operatorStatePresent: false }, { operatorCasAffected: 0 },
    { operatorGenerationAdvanced: false }, { operatorIncarnationRotated: false },
  ];
  for (const change of cases) {
    const output = assessCredentialRevocation({ ...complete(), ...change });
    assert.equal(output.admissible, false, JSON.stringify(change));
    assert.equal(output.authority, "NONE");
  }
});

test("deny missing request, audit, decision, imprecise ID and uncertain commits", () => {
  const cases: Partial<CredentialRevocationEvidence>[] = [
    { requestReservationAffected: 0 }, { auditAffected: 0 }, { decisionAffected: 0 },
    { auditLogId: 9007199254740993 }, { auditLogId: "01" },
    { commitOutcome: "UNKNOWN" }, { commitOutcome: "ROLLED_BACK" },
  ];
  for (const change of cases) {
    const output = assessCredentialRevocation({ ...complete(), ...change });
    assert.equal(output.admissible, false, JSON.stringify(change));
    assert.equal(output.productionReady, false);
  }
});

test("zero active sessions still requires operator generation fence and receipt", () => {
  const output = assessCredentialRevocation({
    ...complete(), deviceSessionsLocked: 0, deviceSessionsRevoked: 0,
    legacySessionsLocked: 0, legacySessionsRevoked: 0,
  });
  assert.equal(output.admissible, true);
  assert.equal(output.authority, "NONE");
});

test("pre-audit evidence uses unknown commit and requires no fabricated audit receipt", () => {
  const valid = { ...complete(), commitOutcome: "UNKNOWN" as const,
    requestReservationAffected: 0, auditAffected: 0, decisionAffected: 0, auditLogId: null };
  assert.equal(assessCredentialRevocationMutation(valid).admissible, true);
  assert.equal(assessCredentialRevocationMutation({ ...valid, deviceSessionsRemaining: 1 }).admissible, false);
  assert.equal(assessCredentialRevocationMutation({ ...valid, commitOutcome: "COMMITTED" }).admissible, false);
});
