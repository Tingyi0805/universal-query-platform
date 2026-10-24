import assert from "node:assert/strict";
import test from "node:test";
import { computeParameterSnapshotDigest, computeSqlSnapshotDigest } from "./canonicalSnapshotDigest.js";
import { isExactReviewAuditReceipt } from "./nativeTypeReview.js";
import { validateSyntheticAuditReceipt, validateSyntheticDecisionAudit,
  type SyntheticDecisionAuditInput, type SyntheticNativeTypeDecision } from "./nativeTypeDecisionAudit.js";

function fixture(): SyntheticDecisionAuditInput {
  const decision: SyntheticNativeTypeDecision = {
    format: "SYNTHETIC_NATIVE_TYPE_DECISION_V1", decisionId: "9007199254740993",
    reviewId: "11111111-1111-4111-8111-111111111111", requestId: "22222222-2222-4222-8222-222222222222",
    actorId: "9007199254740995", action: "CONFIRM", reasonCode: "REVIEW_ACCEPTED",
    previousState: "PENDING", nextState: "CONFIRMED",
    previousStateRowVersion: "0000000000000001", nextStateRowVersion: "0000000000000002",
    snapshotIntegrity: {
      sql: structuredClone(computeSqlSnapshotDigest({ scope: "SYNTHETIC_TEST_ONLY", sql: "SELECT @P" }).integrity),
      parameterDefinition: structuredClone(computeParameterSnapshotDigest({ scope: "SYNTHETIC_TEST_ONLY", datasetId: "13", parameters: [] }).integrity),
      nativeTypes: { format: "NATIVE_TYPES_V1", digest: "c".repeat(64) },
    },
    auditLogId: "9223372036854775807", transactionCorrelationReference: "33333333-3333-4333-8333-333333333333",
  };
  return {
    scope: "SYNTHETIC_TEST_ONLY", decision,
    audit: { location: "ONLINE", record: { ...structuredClone(decision), format: "SYNTHETIC_NATIVE_TYPE_AUDIT_V1",
      eventType: "DATASET_NATIVE_TYPE_DECISION", eventStatus: "SUCCESS" } },
    receipt: { auditId: decision.auditLogId },
    cas: { reviewId: decision.reviewId, previousState: decision.previousState, nextState: decision.nextState,
      previousStateRowVersion: decision.previousStateRowVersion, nextStateRowVersion: decision.nextStateRowVersion, affectedRows: 1 },
    requestHistory: { scope: "COMPLETE_SYNTHETIC_LEDGER", decisions: [] },
  };
}
function record(input: SyntheticDecisionAuditInput) {
  if (input.audit.location !== "ONLINE" && input.audit.location !== "ARCHIVE") throw new Error("TEST_FIXTURE_INVALID");
  return input.audit.record;
}
function synchronize(input: SyntheticDecisionAuditInput) {
  const d = input.decision;
  input.receipt.auditId = d.auditLogId;
  input.cas = { reviewId: d.reviewId, previousState: d.previousState, nextState: d.nextState,
    previousStateRowVersion: d.previousStateRowVersion, nextStateRowVersion: d.nextStateRowVersion, affectedRows: 1 };
  input.audit = { location: "ONLINE", record: { ...structuredClone(d), format: "SYNTHETIC_NATIVE_TYPE_AUDIT_V1",
    eventType: "DATASET_NATIVE_TYPE_DECISION", eventStatus: "SUCCESS" } };
}
function restricted(value: ReturnType<typeof validateSyntheticDecisionAudit> | ReturnType<typeof validateSyntheticAuditReceipt>) {
  assert.equal(value.authority, "NONE"); assert.equal(value.runtimeBindVerified, false);
  assert.equal(value.deliveryAllowed, false); assert.equal(value.persistence, "NOT_PROVEN");
  assert.equal(Object.isFrozen(value), true);
}

for (const auditId of ["1", "9007199254740993", "9223372036854775807"]) {
  test(`exact receipt accepts canonical BIGINT string length ${auditId.length}`, () => {
    const input = { auditId }, result = validateSyntheticAuditReceipt(input);
    assert.equal(result.formatValid, true); assert.equal(isExactReviewAuditReceipt(input), true); restricted(result);
  });
}
const invalidReceipts: unknown[] = [undefined, null, {}, { auditLogId: "1" }, { auditId: "1", durable: true },
  { auditId: 1 }, { auditId: 9007199254740993 }, { auditId: 1n }, { auditId: "" }, { auditId: "0" },
  { auditId: "01" }, { auditId: "+1" }, { auditId: "-1" }, { auditId: "1.0" }, { auditId: "1e3" },
  { auditId: " 1" }, { auditId: "1\n" }, { auditId: "9223372036854775808" }, { auditId: "９" },
  { auditId: new String("1") }, { auditId: undefined }];
invalidReceipts.forEach((input, i) => test(`receipt rejects unsafe or incomplete shape ${i}`, () => {
  const result = validateSyntheticAuditReceipt(input);
  assert.equal(result.formatValid, false); assert.equal(isExactReviewAuditReceipt(input), false); restricted(result);
}));

test("matching synthetic projections have no durable proof or delivery authority", () => {
  const input = fixture(), result = validateSyntheticDecisionAudit(input);
  assert.equal(result.consistent, true); restricted(result);
  assert.equal(input.decision.auditLogId, "9223372036854775807");
  assert.equal(input.decision.decisionId, "9007199254740993");
  assert.equal(validateSyntheticAuditReceipt(input.receipt).formatValid, true);
  assert.equal(JSON.stringify(result).includes("auditId"), false);
});

const mismatches: [string, (input: SyntheticDecisionAuditInput) => void][] = [
  ["decision ID", v => { record(v).decisionId = "7"; }],
  ["review ID", v => { record(v).reviewId = "44444444-4444-4444-8444-444444444444"; }],
  ["request ID", v => { record(v).requestId = "44444444-4444-4444-8444-444444444444"; }],
  ["actor", v => { record(v).actorId = "7"; }],
  ["action", v => { record(v).action = "REJECT"; }],
  ["reason", v => { record(v).reasonCode = "REVIEW_REJECTED"; }],
  ["previous state", v => { record(v).previousState = "CONFIRMED"; }],
  ["next state", v => { record(v).nextState = "REJECTED"; }],
  ["previous revision", v => { record(v).previousStateRowVersion = "0000000000000003"; }],
  ["next revision", v => { record(v).nextStateRowVersion = "0000000000000003"; }],
  ["SQL digest", v => { record(v).snapshotIntegrity.sql.digest = "a".repeat(64); }],
  ["parameter digest", v => { record(v).snapshotIntegrity.parameterDefinition.digest = "a".repeat(64); }],
  ["native type digest", v => { record(v).snapshotIntegrity.nativeTypes.digest = "a".repeat(64); }],
  ["audit ID", v => { record(v).auditLogId = "7"; }],
  ["receipt", v => { v.receipt.auditId = "7"; }],
  ["transaction correlation", v => { record(v).transactionCorrelationReference = "44444444-4444-4444-8444-444444444444"; }],
];
for (const [label, mutate] of mismatches) test(`relationship rejects mismatched ${label}`, () => {
  const input = fixture(); mutate(input);
  const result = validateSyntheticDecisionAudit(input);
  assert.equal(result.reason, "RELATIONSHIP_MISMATCH"); restricted(result);
});

const malformed: [string, (input: SyntheticDecisionAuditInput) => void][] = [
  ["missing receipt", v => { Reflect.deleteProperty(v, "receipt"); }],
  ["extra field", v => { Object.assign(v, { confirmed: true }); }],
  ["extra nested field", v => { Object.assign(v.decision.snapshotIntegrity.sql, { sql: "SYNTHETIC_SECRET" }); }],
  ["unknown format", v => { Object.assign(v.decision, { format: "DECISION_V2" }); }],
  ["unknown state", v => { Object.assign(v.decision, { nextState: "VERIFIED" }); }],
  ["unknown action", v => { Object.assign(v.decision, { action: "APPROVE" }); }],
  ["free text reason", v => { Object.assign(v.decision, { reasonCode: "SYNTHETIC_SECRET" }); }],
  ["numeric decision ID", v => { Object.assign(v.decision, { decisionId: 9007199254740993 }); }],
  ["numeric actor ID", v => { Object.assign(v.decision, { actorId: 1 }); }],
  ["numeric revision", v => { Object.assign(v.cas, { nextStateRowVersion: 2 }); }],
  ["zero revision", v => { v.cas.previousStateRowVersion = "0000000000000000"; }],
  ["unknown event type", v => { Object.assign(record(v), { eventType: "QUERY_EXECUTE" }); }],
  ["missing history", v => { Reflect.deleteProperty(v, "requestHistory"); }],
  ["unproven history", v => { Object.assign(v.requestHistory, { scope: "UNKNOWN" }); }],
  ["CAS zero rows", v => { Object.assign(v.cas, { affectedRows: 0 }); }],
  ["CAS multiple rows", v => { Object.assign(v.cas, { affectedRows: 2 }); }],
];
for (const [label, mutate] of malformed) test(`strict contract rejects ${label}`, () => {
  const input = fixture(); mutate(input);
  const result = validateSyntheticDecisionAudit(input);
  assert.equal(result.reason, "FORMAT_INVALID"); restricted(result);
});

for (const field of ["reviewId", "previousState", "nextState", "previousStateRowVersion", "nextStateRowVersion"] as const) {
  test(`CAS rejects conflicting ${field}`, () => {
    const input = fixture();
    Object.assign(input.cas, { [field]: field === "reviewId" ? "44444444-4444-4444-8444-444444444444"
      : field.endsWith("RowVersion") ? "0000000000000003" : "INVALIDATED" });
    assert.equal(validateSyntheticDecisionAudit(input).reason, "CAS_CONFLICT");
  });
}
for (const eventStatus of ["FAILED", "STARTED"] as const) test(`${eventStatus} attempt is not a successful decision`, () => {
  const input = fixture(); record(input).eventStatus = eventStatus;
  assert.equal(validateSyntheticDecisionAudit(input).reason, "ATTEMPT_NOT_SUCCESSFUL");
});
for (const previousState of ["REJECTED", "REVOKED", "INVALIDATED"] as const) test(`terminal ${previousState} never resurrects`, () => {
  const input = fixture(); input.decision.previousState = previousState; synchronize(input);
  assert.equal(validateSyntheticDecisionAudit(input).reason, "STATE_TRANSITION_INVALID");
});
for (const revision of ["0000000000000001", "0000000000000000"]) test("equal or regressed revision rejects", () => {
  const input = fixture(); input.decision.nextStateRowVersion = revision; synchronize(input);
  assert.equal(validateSyntheticDecisionAudit(input).consistent, false);
});
test("wrong action, destination or reason cannot be made valid by matching projections", () => {
  for (const patch of [{ nextState: "REJECTED" }, { reasonCode: "REVIEW_REJECTED" }, { action: "REVOKE" }]) {
    const input = fixture(); Object.assign(input.decision, patch); synchronize(input);
    assert.equal(validateSyntheticDecisionAudit(input).reason, "STATE_TRANSITION_INVALID");
  }
});
test("successful rejection is distinct from a failed attempt", () => {
  const input = fixture(); Object.assign(input.decision, { action: "REJECT", nextState: "REJECTED", reasonCode: "REVIEW_REJECTED" });
  synchronize(input); assert.equal(validateSyntheticDecisionAudit(input).consistent, true);
});
test("identical request replay is denied; changed decision is a collision", () => {
  const input = fixture(); input.requestHistory.decisions.push(structuredClone(input.decision));
  assert.equal(validateSyntheticDecisionAudit(input).reason, "REQUEST_REPLAY");
  input.decision.actorId = "7"; synchronize(input);
  assert.equal(validateSyntheticDecisionAudit(input).reason, "REQUEST_COLLISION");
});
for (const field of ["requestId", "decisionId", "auditLogId"] as const) test(`history detects reused ${field}`, () => {
  const input = fixture(), a = structuredClone(input.decision), b = structuredClone(a);
  b.requestId = "55555555-5555-4555-8555-555555555555"; b.decisionId = "8"; b.auditLogId = "9";
  b[field] = a[field]; input.requestHistory.decisions = [a, b];
  assert.equal(validateSyntheticDecisionAudit(input).reason, "HISTORY_CONFLICT");
});

function revocation(): SyntheticDecisionAuditInput {
  const input = fixture(), prior = structuredClone(input.decision);
  input.requestHistory.decisions = [prior];
  Object.assign(input.decision, { decisionId: "8", auditLogId: "9", requestId: "55555555-5555-4555-8555-555555555555",
    action: "REVOKE", reasonCode: "AUTHORIZATION_REVOKED", previousState: "CONFIRMED", nextState: "REVOKED",
    previousStateRowVersion: prior.nextStateRowVersion, nextStateRowVersion: "0000000000000003" });
  synchronize(input); return input;
}
test("confirmed review can only revoke or invalidate with continuous history", () => {
  const input = revocation(); assert.equal(validateSyntheticDecisionAudit(input).consistent, true);
  Object.assign(input.decision, { action: "INVALIDATE", reasonCode: "EVIDENCE_INVALIDATED", nextState: "INVALIDATED" });
  synchronize(input); assert.equal(validateSyntheticDecisionAudit(input).consistent, true);
});
test("pending review may be invalidated", () => {
  const input = fixture(); Object.assign(input.decision, { action: "INVALIDATE", reasonCode: "EVIDENCE_INVALIDATED", nextState: "INVALIDATED" });
  synchronize(input); assert.equal(validateSyntheticDecisionAudit(input).consistent, true);
});
test("history cannot resurrect an older PENDING snapshot after revocation", () => {
  const revoked = revocation(), input = fixture();
  input.requestHistory.decisions = [...revoked.requestHistory.decisions, revoked.decision];
  Object.assign(input.decision, { decisionId: "10", auditLogId: "11", requestId: "66666666-6666-4666-8666-666666666666" });
  synchronize(input); assert.equal(validateSyntheticDecisionAudit(input).reason, "CAS_CONFLICT");
});
test("missing decision history, discontinuity and changed snapshot fail closed", () => {
  for (const mutate of [
    (v: SyntheticDecisionAuditInput) => { v.requestHistory.decisions = []; },
    (v: SyntheticDecisionAuditInput) => { v.decision.previousStateRowVersion = "0000000000000004"; v.decision.nextStateRowVersion = "0000000000000005"; },
    (v: SyntheticDecisionAuditInput) => { v.decision.snapshotIntegrity.sql.digest = "b".repeat(64); },
  ]) {
    const input = revocation(); mutate(input); synchronize(input);
    assert.equal(validateSyntheticDecisionAudit(input).reason, "CAS_CONFLICT");
  }
});
test("a ledger with a broken chain is rejected independently of row order", () => {
  const revoked = revocation(), input = fixture();
  revoked.decision.previousStateRowVersion = "0000000000000004"; revoked.decision.nextStateRowVersion = "0000000000000005";
  input.requestHistory.decisions = [revoked.decision, ...revoked.requestHistory.decisions];
  Object.assign(input.decision, { decisionId: "10", auditLogId: "11", requestId: "66666666-6666-4666-8666-666666666666" });
  synchronize(input); assert.equal(validateSyntheticDecisionAudit(input).reason, "HISTORY_CONFLICT");
});

test("complete archived projection preserves logical association but proves no storage", () => {
  const input = fixture(); input.audit = { location: "ARCHIVE", record: record(input) };
  const result = validateSyntheticDecisionAudit(input); assert.equal(result.consistent, true); restricted(result);
});
test("archive ID alone or a truncated payload cannot substitute for core evidence", () => {
  const input = fixture(); input.audit = { location: "ARCHIVE", record: record(input) };
  Reflect.deleteProperty(record(input), "snapshotIntegrity");
  assert.equal(validateSyntheticDecisionAudit(input).reason, "FORMAT_INVALID");
  Object.assign(input.audit, { parametersJson: "{}" });
  assert.equal(validateSyntheticDecisionAudit(input).consistent, false);
});
for (const location of ["MISSING", "PURGED"] as const) test(`${location} history never becomes durable proof from a valid receipt`, () => {
  const input = fixture(); input.audit = { location, auditLogId: input.decision.auditLogId };
  assert.equal(validateSyntheticAuditReceipt(input.receipt).formatValid, true);
  const retainedDecision = structuredClone(input.decision);
  const result = validateSyntheticDecisionAudit(input);
  assert.equal(result.reason, "AUDIT_HISTORY_UNAVAILABLE"); restricted(result);
  assert.equal(retainedDecision.auditLogId, "9223372036854775807");
});

test("unsafe objects never execute hooks or disclose input in results", () => {
  let invoked = 0;
  const getter = Object.defineProperty({}, "auditId", { enumerable: true, get() { invoked++; return "1"; } });
  const proxy = new Proxy({}, { ownKeys() { invoked++; throw new Error("SYNTHETIC_SECRET"); } });
  const hidden = Object.defineProperty({ auditId: "1" }, "hidden", { value: "SYNTHETIC_SECRET" });
  const symbol = { auditId: "1", [Symbol("hidden")]: "SYNTHETIC_SECRET" };
  const custom = Object.assign(Object.create({}), { auditId: "1" });
  for (const input of [getter, proxy, hidden, symbol, custom, { auditId: "1", toJSON() { invoked++; throw new Error("SYNTHETIC_SECRET"); } }]) {
    const result = validateSyntheticAuditReceipt(input); assert.equal(result.formatValid, false);
    assert.equal(JSON.stringify(result).includes("SYNTHETIC_SECRET"), false);
  }
  assert.equal(invoked, 0);
  const input = fixture(); Object.assign(input.decision, { sql: "SYNTHETIC_SQL", parameters: "SYNTHETIC_PATIENT", credential: "SYNTHETIC_SECRET" });
  const output = JSON.stringify(validateSyntheticDecisionAudit(input));
  for (const marker of ["SYNTHETIC_SQL", "SYNTHETIC_PATIENT", "SYNTHETIC_SECRET", "SELECT", "@P"]) assert.equal(output.includes(marker), false);
});
test("cycles, sparse arrays, unknown array fields and oversized history reject safely", () => {
  const cyclic = fixture(); Object.assign(cyclic.decision, { cycle: cyclic });
  assert.equal(validateSyntheticDecisionAudit(cyclic).consistent, false);
  for (const history of [new Array(1), Object.assign([], { extra: true }), Array.from({ length: 101 }, () => fixture().decision)]) {
    const input = fixture(); input.requestHistory.decisions = history;
    assert.equal(validateSyntheticDecisionAudit(input).reason, "FORMAT_INVALID");
  }
});

// Test-only staged-copy model. Neither queue/trace nor correlation UUID proves SQL transactions.
class SyntheticTransactionModel {
  trace: string[] = [];
  decisions: SyntheticNativeTypeDecision[] = [];
  state: string = "PENDING";
  revision = "0000000000000001";
  run(input: SyntheticDecisionAuditInput, fail?: "decision" | "audit" | "commit" | "final-revalidation") {
    this.trace = [];
    const step = (name: string) => { this.trace.push(name); if (name === fail) throw new Error("SYNTHETIC_STEP_FAILED"); };
    try {
      step("read"); input = structuredClone(input); input.requestHistory.decisions = structuredClone(this.decisions);
      step("cas");
      if (input.cas.previousState !== this.state || input.cas.previousStateRowVersion !== this.revision) throw new Error("SYNTHETIC_CAS_CONFLICT");
      step("decision"); const staged = [...this.decisions, structuredClone(input.decision)];
      step("audit"); step("receipt");
      if (!validateSyntheticAuditReceipt(input.receipt).formatValid) throw new Error("SYNTHETIC_RECEIPT_INVALID");
      step("final-revalidation");
      if (!validateSyntheticDecisionAudit(input).consistent) throw new Error("SYNTHETIC_ASSOCIATION_INVALID");
      step("commit"); this.decisions = staged; this.state = input.decision.nextState; this.revision = input.decision.nextStateRowVersion;
      return { simulatedCommit: true, authority: "NONE", runtimeBindVerified: false, deliveryAllowed: false, persistence: "NOT_PROVEN" } as const;
    } catch {
      this.trace.push("discard-staged-copies");
      return { simulatedCommit: false, authority: "NONE", runtimeBindVerified: false, deliveryAllowed: false, persistence: "NOT_PROVEN" } as const;
    }
  }
}
for (const failure of ["decision", "audit", "commit", "final-revalidation"] as const) test(`model ${failure} failure discards staged state without claiming SQL rollback`, () => {
  const model = new SyntheticTransactionModel(), result = model.run(fixture(), failure);
  assert.equal(result.simulatedCommit, false); assert.equal(result.persistence, "NOT_PROVEN");
  assert.equal(model.decisions.length, 0); assert.equal(model.state, "PENDING"); assert.equal(model.revision, "0000000000000001");
  assert.equal(model.trace.at(-1), "discard-staged-copies"); assert.equal(result.deliveryAllowed, false);
});
test("model success checks order but grants no persistence or runtime rights", () => {
  const model = new SyntheticTransactionModel(), result = model.run(fixture());
  assert.equal(result.simulatedCommit, true); assert.equal(result.persistence, "NOT_PROVEN");
  assert.equal(result.authority, "NONE"); assert.equal(result.deliveryAllowed, false); assert.equal(result.runtimeBindVerified, false);
  assert.deepEqual(model.trace, ["read", "cas", "decision", "audit", "receipt", "final-revalidation", "commit"]);
});
test("model rejects an invalid receipt or association before simulated commit", () => {
  for (const mutate of [
    (v: SyntheticDecisionAuditInput) => { Object.assign(v.receipt, { auditId: 9007199254740993 }); },
    (v: SyntheticDecisionAuditInput) => { record(v).actorId = "7"; },
  ]) {
    const model = new SyntheticTransactionModel(), input = fixture(); mutate(input);
    assert.equal(model.run(input).simulatedCommit, false); assert.equal(model.decisions.length, 0);
    assert.equal(model.trace.includes("commit"), false);
  }
});
test("two stale reviewers and replay cannot append a second model decision", () => {
  const model = new SyntheticTransactionModel(), first = fixture(), second = fixture();
  Object.assign(second.decision, { decisionId: "8", auditLogId: "9", actorId: "7", requestId: "55555555-5555-4555-8555-555555555555" }); synchronize(second);
  assert.equal(model.run(first).simulatedCommit, true); assert.equal(model.run(second).simulatedCommit, false);
  assert.equal(model.run(first).simulatedCommit, false); assert.equal(model.decisions.length, 1);
});
