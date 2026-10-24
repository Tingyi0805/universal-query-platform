import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { inspect } from "node:util";
import test from "node:test";
import { isExactReviewAuditReceipt, validateNativeTypeReview, type ReviewEvidenceEnvelope,
  type ReviewObservations, type ReviewConsistency, type NativeReviewReason } from "./nativeTypeReview.js";
import type { AuthorizationEpochProvider, MandatoryAuditWriter, ReviewCasReceipt, ReviewDecisionCommand,
  ReviewDecisionRecord, ReviewDecisionRepository, ReviewSnapshotReader, ReviewTransaction,
  SourceEvidenceProvider } from "./nativeTypeReview.ports.js";
import { compileSqlServerTypedBindPlan, readSqlServerTypedBindPlan } from "../../query/sqlServerTypedBindPlan.js";
import { normalizeSqlServerTypedParameters } from "../../query/sqlServerTypedParameterNormalizer.js";

const uuid = (suffix: string) => `00000000-0000-4000-8000-${suffix.padStart(12, "0")}`;
const digest = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
function fixture(): { envelope: ReviewEvidenceEnvelope; observations: ReviewObservations } {
  const nativeTypes: ReviewEvidenceEnvelope["nativeTypes"] = { format: "NATIVE_TYPES_V1",
    digest: digest(JSON.stringify([["P", "BIGINT", null, null, null, "FIXED_LIST", 2], ["Q", "BIT", null, null, null, "SCALAR", null]])),
    parameters: [{ name: "P", nativeType: { type: "BIGINT" }, cardinality: { kind: "FIXED_LIST", length: 2 } },
      { name: "Q", nativeType: { type: "BIT" }, cardinality: { kind: "SCALAR" } }] };
  const envelope: ReviewEvidenceEnvelope = { format: "NATIVE_TYPE_REVIEW_V1", provenance: "SYNTHETIC_TEST_ONLY",
    datasetId: "9007199254740993", dataSourceId: "9223372036854775807", definitionRowVersion: "0000000000000001",
    configurationRowVersion: "0000000000000002", baseContract: { state: "MISSING" }, authorizationEpoch: "0000000000000003",
    review: { reviewId: uuid("1"), state: "PENDING", stateRowVersion: "0000000000000004" },
    sql: { format: "SQL_UTF8_EXACT_V1", digest: digest("synthetic-sql-integrity") },
    parameterDefinition: { format: "SAVED_PARAMETER_SNAPSHOT_V1", digest: digest("synthetic-definition-integrity") }, nativeTypes,
    source: { identity: uuid("2"), schemaGeneration: "0000000000000005", leaseId: uuid("3"), leaseVersion: "0000000000000006" },
    reviewer: { userId: "2", tokenVersion: "9007199254740993", scope: { datasetId: "9007199254740993",
      dataSourceId: "9223372036854775807", rowVersion: "0000000000000007" } },
    versions: { collector: "SYNTHETIC_COLLECTOR_V1", codec: "A3_ISOLATED_V1", plan: "A2_ISOLATED_V1", driver: "SYNTHETIC_MSSQL11_V1" },
    evidenceAt: "2026-10-22T00:00:00.000Z", expiresAt: "2026-10-22T01:00:00.000Z" };
  const observations: ReviewObservations = { provenance: "SYNTHETIC_TEST_ONLY", now: "2026-10-22T00:30:00.000Z",
    snapshot: { provenance: "SYNTHETIC_TEST_ONLY", datasetId: envelope.datasetId, dataSourceId: envelope.dataSourceId,
      datasetActive: true, datasetArchived: false, sourceActive: true, sourceType: "SQLSERVER",
      definitionRowVersion: envelope.definitionRowVersion, configurationRowVersion: envelope.configurationRowVersion,
      baseContract: structuredClone(envelope.baseContract), review: structuredClone(envelope.review),
      sql: { ...envelope.sql, tokenNames: ["P", "Q"] }, parameterDefinition: { ...envelope.parameterDefinition,
        bindings: [{ name: "P", dataType: "NUMBER", controlType: "MULTISELECT", dateOutputMode: "NATIVE" },
          { name: "Q", dataType: "BOOLEAN", controlType: "CHECKBOX", dateOutputMode: "NATIVE" }] },
      nativeTypes: structuredClone(nativeTypes), proposedByUserId: "1", versions: { ...envelope.versions } },
    authorization: { provenance: "SYNTHETIC_TEST_ONLY", authorizationEpoch: envelope.authorizationEpoch,
      reviewer: structuredClone(envelope.reviewer), active: true, interactive: true, designQuery: true, reviewNativeType: true, scopeAllowed: true },
    source: { provenance: "SYNTHETIC_TEST_ONLY", ...envelope.source, lease: { state: "SYNTHETIC_VALIDATED", ...envelope.source,
      validFrom: envelope.evidenceAt, validUntil: "2026-10-22T02:00:00.000Z" } } };
  return { envelope, observations };
}
function refused(e: unknown, o: unknown, reason?: NativeReviewReason) {
  const result = validateNativeTypeReview(e, o);
  assert.equal(result.consistent, false);
  if (reason) assert.equal(result.reason, reason);
  assert.equal(result.deliveryAllowed, false);
  assert.equal(result.runtimeBindVerified, false);
  return result;
}

test("synthetic consistency preserves exact ID/version strings and never authenticates or grants delivery", () => {
  const { envelope: e, observations: o } = fixture(), original = structuredClone({ e, o });
  for (const state of ["PENDING", "CONFIRMED"] as const) {
    e.review.state = o.snapshot.review.state = state;
    assert.deepEqual(validateNativeTypeReview(e, o), { kind: "ISOLATED_REVIEW_CONSISTENCY", consistent: true,
      reason: null, authority: "NONE", runtimeBindVerified: false, deliveryAllowed: false });
  }
  assert.equal(e.reviewer.tokenVersion, "9007199254740993");
  e.review.state = o.snapshot.review.state = "PENDING";
  assert.deepEqual({ e, o }, original);
  e.baseContract = o.snapshot.baseContract = { state: "PRESENT", rowVersion: "0000000000000008" };
  assert.equal(validateNativeTypeReview(e, o).consistent, true);
});

const conflicts: [string, (e: ReviewEvidenceEnvelope, o: ReviewObservations) => void, NativeReviewReason][] = [
  ["Dataset revision", (_e, o) => { o.snapshot.definitionRowVersion = "0000000000000009"; }, "DATASET_CONFLICT"],
  ["Dataset ID", (_e, o) => { o.snapshot.datasetId = "3"; }, "DATASET_CONFLICT"],
  ["inactive Dataset", (_e, o) => { o.snapshot.datasetActive = false; }, "DATASET_CONFLICT"],
  ["archived Dataset", (_e, o) => { o.snapshot.datasetArchived = true; }, "DATASET_CONFLICT"],
  ["Source revision", (_e, o) => { o.snapshot.configurationRowVersion = "0000000000000009"; }, "SOURCE_CONFLICT"],
  ["Source ID", (_e, o) => { o.snapshot.dataSourceId = "3"; }, "SOURCE_CONFLICT"],
  ["disabled Source", (_e, o) => { o.snapshot.sourceActive = false; }, "SOURCE_CONFLICT"],
  ["contract absent to present", (_e, o) => { o.snapshot.baseContract = { state: "PRESENT", rowVersion: "0000000000000009" }; }, "CONTRACT_CONFLICT"],
  ["contract revision", (e, o) => { e.baseContract = { state: "PRESENT", rowVersion: "0000000000000008" };
    o.snapshot.baseContract = { state: "PRESENT", rowVersion: "0000000000000009" }; }, "CONTRACT_CONFLICT"],
  ["Review revision", (_e, o) => { o.snapshot.review.stateRowVersion = "0000000000000009"; }, "REVIEW_CONFLICT"],
  ["Review ID", (_e, o) => { o.snapshot.review.reviewId = uuid("9"); }, "REVIEW_CONFLICT"],
  ["Review state", (_e, o) => { o.snapshot.review.state = "CONFIRMED"; }, "REVIEW_CONFLICT"],
  ["revoked review", (e) => { e.review.state = "REVOKED"; }, "STATE_UNUSABLE"],
  ["invalidated current review", (_e, o) => { o.snapshot.review.state = "INVALIDATED"; }, "STATE_UNUSABLE"],
  ["SQL integrity", (_e, o) => { o.snapshot.sql.digest = digest("different"); }, "INTEGRITY_CONFLICT"],
  ["parameter integrity", (_e, o) => { o.snapshot.parameterDefinition.digest = digest("different"); }, "INTEGRITY_CONFLICT"],
  ["native declaration", (e) => { e.nativeTypes.parameters[0]!.nativeType = { type: "INT" }; }, "INTEGRITY_CONFLICT"],
  ["list arity", (e) => { e.nativeTypes.parameters[0]!.cardinality = { kind: "FIXED_LIST", length: 3 }; }, "INTEGRITY_CONFLICT"],
  ["independent manifest", (_e, o) => { o.snapshot.nativeTypes.parameters[0]!.nativeType = { type: "INT" }; }, "INTEGRITY_CONFLICT"],
  ["SQL tokens", (_e, o) => { o.snapshot.sql.tokenNames = ["OTHER", "Q"]; }, "BINDING_INVALID"],
  ["duplicate tokens", (_e, o) => { o.snapshot.sql.tokenNames = ["P", "P"]; }, "BINDING_INVALID"],
  ["duplicate definitions", (_e, o) => { o.snapshot.parameterDefinition.bindings[1]!.name = "P"; }, "BINDING_INVALID"],
  ["generic/native conflict", (_e, o) => { o.snapshot.parameterDefinition.bindings[0]!.dataType = "STRING"; }, "BINDING_INVALID"],
  ["scalar/list conflict", (_e, o) => { o.snapshot.parameterDefinition.bindings[0]!.controlType = "TEXT"; }, "BINDING_INVALID"],
  ["authorization epoch", (_e, o) => { o.authorization.authorizationEpoch = "0000000000000009"; }, "AUTHORIZATION_CONFLICT"],
  ["permission revoked", (_e, o) => { o.authorization.reviewNativeType = false; }, "REVIEWER_INVALID"],
  ["design permission revoked", (_e, o) => { o.authorization.designQuery = false; }, "REVIEWER_INVALID"],
  ["review scope revoked", (_e, o) => { o.authorization.scopeAllowed = false; }, "REVIEWER_INVALID"],
  ["disabled reviewer", (_e, o) => { o.authorization.active = false; }, "REVIEWER_INVALID"],
  ["device identity", (_e, o) => { o.authorization.interactive = false; }, "REVIEWER_INVALID"],
  ["reviewer token version", (_e, o) => { o.authorization.reviewer.tokenVersion = "9007199254740994"; }, "REVIEWER_INVALID"],
  ["reviewer identity", (_e, o) => { o.authorization.reviewer.userId = "3"; }, "REVIEWER_INVALID"],
  ["reviewer scope version", (_e, o) => { o.authorization.reviewer.scope.rowVersion = "0000000000000009"; }, "REVIEWER_INVALID"],
  ["scope Dataset", (e, o) => { e.reviewer.scope.datasetId = o.authorization.reviewer.scope.datasetId = "3"; }, "REVIEWER_INVALID"],
  ["self review", (_e, o) => { o.snapshot.proposedByUserId = "2"; }, "REVIEWER_INVALID"],
  ["expired evidence boundary", (e, o) => { o.now = e.expiresAt; }, "TIME_INVALID"],
  ["future evidence", (e) => { e.evidenceAt = "2026-10-22T00:31:00.000Z"; }, "TIME_INVALID"],
  ["Source identity", (_e, o) => { o.source.identity = uuid("9"); }, "SOURCE_CONFLICT"],
  ["Source generation", (_e, o) => { o.source.schemaGeneration = "0000000000000009"; }, "SOURCE_CONFLICT"],
  ["lease identity", (_e, o) => { o.source.lease.identity = uuid("9"); }, "LEASE_INVALID"],
  ["lease generation", (_e, o) => { o.source.lease.schemaGeneration = "0000000000000009"; }, "LEASE_INVALID"],
  ["lease ID", (_e, o) => { o.source.leaseId = uuid("9"); }, "LEASE_INVALID"],
  ["lease version", (_e, o) => { o.source.leaseVersion = "0000000000000009"; }, "LEASE_INVALID"],
  ["expired lease boundary", (_e, o) => { o.source.lease.validUntil = o.now; }, "LEASE_INVALID"],
  ["lease starts after evidence", (_e, o) => { o.source.lease.validFrom = "2026-10-22T00:01:00.000Z"; }, "LEASE_INVALID"],
];
for (const [label, change, reason] of conflicts) test(`fail closed: ${label}`, () => {
  const { envelope: e, observations: o } = fixture(); change(e, o); refused(e, o, reason);
});

test("AuthorizationEpoch detects A to B to A even with restored permissions and matching content digests", () => {
  const { envelope: e, observations: o } = fixture();
  o.authorization.reviewNativeType = false; o.authorization.authorizationEpoch = "0000000000000008";
  refused(e, o);
  o.authorization.reviewNativeType = true; o.authorization.authorizationEpoch = "0000000000000009";
  refused(e, o, "AUTHORIZATION_CONFLICT");
  assert.equal(e.sql.digest, o.snapshot.sql.digest);
});

test("matching native digests do not excuse duplicate names or expanded-list collisions", () => {
  const { envelope: e, observations: o } = fixture();
  e.nativeTypes.parameters[1]!.name = "P__0";
  e.nativeTypes.digest = digest(JSON.stringify([["P", "BIGINT", null, null, null, "FIXED_LIST", 2],
    ["P__0", "BIT", null, null, null, "SCALAR", null]]));
  o.snapshot.nativeTypes = structuredClone(e.nativeTypes);
  o.snapshot.parameterDefinition.bindings[1]!.name = "P__0"; o.snapshot.sql.tokenNames = ["P", "P__0"];
  refused(e, o, "BINDING_INVALID");
  e.nativeTypes.parameters[1]!.name = "P";
  e.nativeTypes.digest = digest(JSON.stringify([["P", "BIGINT", null, null, null, "FIXED_LIST", 2],
    ["P", "BIT", null, null, null, "SCALAR", null]]));
  o.snapshot.nativeTypes = structuredClone(e.nativeTypes);
  refused(e, o, "BINDING_INVALID");
});

test("unknown, missing, forged and malformed evidence never becomes authority", () => {
  const { envelope: e, observations: o } = fixture();
  for (const state of ["UNKNOWN", "STALE", "MISSING", "VERIFIED", "UNCONFIRMED"]) {
    refused({ ...e, review: { ...e.review, state } }, o);
    refused(e, { ...o, source: { ...o.source, lease: { ...o.source.lease, state } } });
  }
  for (const bad of [null, {}, { ...e, provenance: "FRONTEND_CONFIRMED" }, { ...e, datasetId: 9007199254740993 },
    { ...e, datasetId: "9223372036854775808" }, { ...e, definitionRowVersion: 1 },
    { ...e, authorizationEpoch: "a".repeat(64) }, { ...e, reviewer: { ...e.reviewer, tokenVersion: 1 } },
    { ...e, source: { ...e.source, schemaGeneration: "UNKNOWN" } }, { ...e, review: { ...e.review, stateRowVersion: "0X01" } },
    { ...e, evidenceAt: "2026-02-30T00:00:00.000Z" }, { ...e, unexpected: true },
    { ...e, baseContract: { state: "MISSING", rowVersion: "0000000000000001" } },
    { ...e, nativeTypes: { ...e.nativeTypes, parameters: [...e.nativeTypes.parameters, e.nativeTypes.parameters[0]] } },
    { ...e, nativeTypes: { ...e.nativeTypes, parameters: [{ name: "P", nativeType: { type: "UNKNOWN" }, cardinality: { kind: "SCALAR" } }] } },
    { ...e, nativeTypes: { ...e.nativeTypes, parameters: [{ name: "P", nativeType: { type: "BIGINT" }, cardinality: { kind: "FIXED_LIST", length: 0 } }] } },
  ]) refused(bad, o);
  for (const key of ["collector", "codec", "plan", "driver"]) refused({ ...e, versions: { ...e.versions, [key]: "UNKNOWN_V2" } }, o);
  refused(e, { ...o, provenance: "TRUSTED" });
  refused(e, { ...o, source: undefined });
  refused(e, { ...o, snapshot: { ...o.snapshot, sourceType: "ORACLE" } });
  const { source: _omitted, ...withoutSource } = e;
  refused(withoutSource, o);
});

test("strict descriptor copies reject getters, symbols, hidden keys, sparse arrays, cycles and hooks without evaluating them", () => {
  const { envelope: e, observations: o } = fixture(); let calls = 0;
  refused({ ...e, get datasetId() { calls++; return e.datasetId; } }, o);
  refused({ ...e, reviewer: { ...e.reviewer, get tokenVersion() { calls++; return "1"; } } }, o);
  refused({ ...e, [Symbol("extra")]: true }, o);
  refused(Object.defineProperty({ ...e }, "extra", { value: true }), o);
  refused({ ...e, toJSON() { calls++; return e; } }, o);
  refused(Object.assign(Object.create({ inherited: true }), e), o);
  refused({ ...e, nativeTypes: { ...e.nativeTypes, parameters: Array(2) } }, o);
  const cyclic = { ...e } as Record<string, unknown>; cyclic.self = cyclic; refused(cyclic, o);
  assert.equal(calls, 0);
});

test("empty manifest needs explicit consistent evidence and still grants no delivery", () => {
  const { envelope: e, observations: o } = fixture();
  e.nativeTypes = o.snapshot.nativeTypes = { format: "NATIVE_TYPES_V1", digest: digest("[]"), parameters: [] };
  o.snapshot.sql.tokenNames = []; o.snapshot.parameterDefinition.bindings = [];
  assert.equal(validateNativeTypeReview(e, o).consistent, true);
  refused(e, null);
  o.source.lease.validUntil = o.now;
  refused(e, o);
});

test("audit receipts are canonical exact BIGINT strings, not Number IDs or opaque self-assertions", () => {
  for (const auditId of ["1", "9007199254740993", "9223372036854775807"]) assert.equal(isExactReviewAuditReceipt({ auditId }), true);
  for (const receipt of [null, {}, { auditId: 1 }, { auditId: 9007199254740993 }, { auditId: "01" },
    { auditId: "0" }, { auditId: "9223372036854775808" }, { auditId: "1", verified: true }]) {
    assert.equal(isExactReviewAuditReceipt(receipt), false);
  }
});

test("errors and results do not serialize supplied SQL, inputs or invented credential fields", () => {
  const { envelope: e, observations: o } = fixture();
  const canary = "SYNTHETIC_INPUT_CANARY";
  const r = refused({ ...e, sqlText: canary, rawValues: { P: canary }, password: canary }, o);
  assert.equal((JSON.stringify(r) + inspect(r)).includes(canary), false);
  const valid = validateNativeTypeReview(e, o);
  assert.throws(() => readSqlServerTypedBindPlan(valid as any), /TYPED_BIND_PLAN_INVALID/);
  assert.throws(() => compileSqlServerTypedBindPlan(valid as any), /TYPED_BIND_CONTRACT_INVALID/);
  assert.throws(() => normalizeSqlServerTypedParameters(valid as any), /TYPED_NORMALIZATION_CONTRACT_INVALID/);
});

// Test-local synthetic model, NOT an SQL implementation or a trusted evidence issuer.
class MockFailure extends Error {
  constructor(readonly code: string) { super(code); this.name = "MockReviewFailure"; }
}
type ModelState = { snapshot: ReviewObservations["snapshot"]; decisions: ReviewDecisionRecord[]; audits: string[] };
class SyntheticReviewModel implements ReviewDecisionRepository, ReviewSnapshotReader, MandatoryAuditWriter {
  state: ModelState;
  observations: ReviewObservations;
  reviewers: Set<string>;
  trace: string[] = [];
  failure: "cas" | "decision" | "audit" | "receipt" | "commit" | null = null;
  afterAudit?: () => void;
  #queue: Promise<void> = Promise.resolve();
  #staged = new Map<ReviewTransaction, ModelState>();
  constructor(o: ReviewObservations) { this.observations = structuredClone(o); this.reviewers = new Set([o.authorization.reviewer.userId]);
    this.state = { snapshot: structuredClone(o.snapshot), decisions: [], audits: [] }; }
  #stage(tx: ReviewTransaction) {
    const value = this.#staged.get(tx); if (!value) throw new MockFailure("MOCK_TRANSACTION_INVALID"); return value;
  }
  async transaction<T>(work: (tx: ReviewTransaction) => Promise<T>): Promise<T> {
    const previous = this.#queue; let release!: () => void;
    this.#queue = new Promise<void>(resolve => { release = resolve; }); await previous;
    const tx = Object.freeze({}) as ReviewTransaction;
    this.#staged.set(tx, structuredClone(this.state)); this.trace.push("begin");
    try {
      const answer = await work(tx);
      if (this.failure === "commit") throw new MockFailure("MOCK_COMMIT_FAILED");
      this.state = this.#stage(tx); this.trace.push("commit"); return answer;
    } catch (error) {
      this.trace.push("rollback");
      throw error instanceof MockFailure ? error : new MockFailure("MOCK_PORT_FAILED");
    } finally { this.#staged.delete(tx); release(); }
  }
  async read(reviewId: string, tx: ReviewTransaction) {
    this.trace.push("snapshot"); const snapshot = this.#stage(tx).snapshot;
    if (reviewId !== snapshot.review.reviewId) throw new MockFailure("MOCK_REVIEW_NOT_FOUND");
    return structuredClone(snapshot);
  }
  authorization: AuthorizationEpochProvider = { observe: async (userId, tx) => {
    this.#stage(tx); this.trace.push("authorization");
    if (!this.reviewers.has(userId)) throw new MockFailure("MOCK_REVIEWER_UNKNOWN");
    const a = structuredClone(this.observations.authorization); a.reviewer.userId = userId; return a;
  } };
  source: SourceEvidenceProvider = { observe: async (sourceId, leaseId) => {
    if (sourceId !== this.observations.snapshot.dataSourceId || leaseId !== this.observations.source.leaseId) {
      throw new MockFailure("MOCK_SOURCE_UNKNOWN");
    }
    this.trace.push("source"); return structuredClone(this.observations.source);
  } };
  async compareAndSwap(command: ReviewDecisionCommand, tx: ReviewTransaction): Promise<ReviewCasReceipt> {
    this.trace.push("cas"); const stage = this.#stage(tx), expected = command.envelope.review;
    if (this.failure === "cas" || stage.snapshot.review.reviewId !== expected.reviewId
      || stage.snapshot.review.stateRowVersion !== expected.stateRowVersion || stage.snapshot.review.state !== expected.state) {
      throw new MockFailure("MOCK_CAS_CONFLICT");
    }
    // The minimal model stages only synthetic PENDING -> CONFIRMED. Other future
    // port actions need their own authorization workflow; no terminal-state bypass.
    if (stage.snapshot.review.state !== "PENDING" || command.action !== "CONFIRM") throw new MockFailure("MOCK_TRANSITION_INVALID");
    const stateRowVersion = (BigInt(`0x${expected.stateRowVersion}`) + 1n).toString(16).padStart(16, "0");
    stage.snapshot.review = { ...expected, state: "CONFIRMED", stateRowVersion };
    return { affectedRows: 1, stateRowVersion };
  }
  async appendDecision(decision: ReviewDecisionRecord, tx: ReviewTransaction) {
    this.trace.push("decision"); const stage = this.#stage(tx);
    if (stage.decisions.some(d => d.requestId === decision.requestId)) throw new MockFailure("MOCK_IDEMPOTENCY_CONFLICT");
    if (this.failure === "decision") throw new MockFailure("MOCK_DECISION_FAILED");
    stage.decisions.push(structuredClone(decision));
  }
  async write(_decision: ReviewDecisionRecord, tx: ReviewTransaction): Promise<unknown> {
    this.trace.push("audit");
    if (this.failure === "audit") throw new Error("SYNTHETIC_INPUT_CANARY");
    const receipt = { auditId: this.failure === "receipt" ? 9007199254740993 : "9007199254740993" };
    if (typeof receipt.auditId === "string") this.#stage(tx).audits.push(receipt.auditId);
    this.afterAudit?.(); return receipt;
  }
}

// Orchestration exists ONLY in this test. Source observations make no cross-DB atomicity claim.
async function simulateDecision(model: SyntheticReviewModel, command: ReviewDecisionCommand): Promise<ReviewConsistency> {
  return model.transaction(async tx => {
    const observe = async (): Promise<ReviewObservations> => ({ provenance: "SYNTHETIC_TEST_ONLY", now: model.observations.now,
      snapshot: await model.read(command.envelope.review.reviewId, tx),
      authorization: await model.authorization.observe(command.actorId, tx),
      source: await model.source.observe(command.envelope.dataSourceId, command.envelope.source.leaseId) });
    const first = validateNativeTypeReview(command.envelope, await observe());
    if (!first.consistent) throw new MockFailure("MOCK_CONSISTENCY_FAILED");
    const cas = await model.compareAndSwap(command, tx);
    if (cas.affectedRows !== 1 || !/^[a-f0-9]{16}$/.test(cas.stateRowVersion)) throw new MockFailure("MOCK_CAS_CONFLICT");
    const decision: ReviewDecisionRecord = { requestId: command.requestId, actorId: command.actorId,
      reviewId: command.envelope.review.reviewId, action: command.action,
      previousRowVersion: command.envelope.review.stateRowVersion, stateRowVersion: cas.stateRowVersion };
    await model.appendDecision(decision, tx);
    if (!isExactReviewAuditReceipt(await model.write(decision, tx))) throw new MockFailure("MOCK_RECEIPT_INVALID");
    const current = await observe();
    const expected = structuredClone(command.envelope);
    // Validate the newly staged version while also checking its exact action-derived state.
    expected.review = { ...expected.review, state: "CONFIRMED", stateRowVersion: cas.stateRowVersion };
    if (current.snapshot.review.state !== expected.review.state || current.snapshot.review.stateRowVersion !== cas.stateRowVersion) {
      throw new MockFailure("MOCK_CAS_CONFLICT");
    }
    const final = validateNativeTypeReview(expected, current);
    if (!final.consistent) throw new MockFailure("MOCK_CONSISTENCY_FAILED");
    return final;
  });
}
const commandFor = (e: ReviewEvidenceEnvelope): ReviewDecisionCommand => ({ requestId: uuid("4"), actorId: e.reviewer.userId, envelope: e, action: "CONFIRM" });

test("synthetic transaction models authorization, CAS, decision, mandatory audit and final revalidation order", async () => {
  const { envelope: e, observations: o } = fixture(), model = new SyntheticReviewModel(o);
  const answer = await simulateDecision(model, commandFor(e));
  assert.deepEqual(model.trace, ["begin", "snapshot", "authorization", "source", "cas", "decision", "audit",
    "snapshot", "authorization", "source", "commit"]);
  assert.equal(model.state.decisions.length, 1); assert.equal(model.state.audits.length, 1);
  assert.equal(model.state.snapshot.review.state, "CONFIRMED");
  assert.equal(answer.deliveryAllowed, false); assert.equal(answer.runtimeBindVerified, false); assert.equal(answer.authority, "NONE");
});

for (const failure of ["cas", "decision", "audit", "receipt", "commit"] as const) test(`synthetic staged rollback on ${failure} failure`, async () => {
  const { envelope: e, observations: o } = fixture(), model = new SyntheticReviewModel(o); model.failure = failure;
  const before = structuredClone(model.state);
  await assert.rejects(simulateDecision(model, commandFor(e)), error => {
    assert.ok(error instanceof MockFailure); assert.equal(inspect(error).includes("SYNTHETIC_INPUT_CANARY"), false); return true;
  });
  assert.deepEqual(model.state, before); assert.equal(model.trace.at(-1), "rollback"); assert.equal(model.trace.includes("commit"), false);
});

test("authorization revoked after audit prevents synthetic commit", async () => {
  const { envelope: e, observations: o } = fixture(), model = new SyntheticReviewModel(o);
  model.afterAudit = () => { model.observations.authorization.scopeAllowed = false; };
  await assert.rejects(simulateDecision(model, commandFor(e)), /MOCK_CONSISTENCY_FAILED/);
  assert.equal(model.state.snapshot.review.state, "PENDING"); assert.equal(model.state.audits.length, 0);
});

test("two synthetic reviewers with stale versions cannot both commit", async () => {
  const { envelope: e, observations: o } = fixture(), model = new SyntheticReviewModel(o);
  model.reviewers.add("3");
  const other = structuredClone(e); other.reviewer.userId = "3";
  const results = await Promise.allSettled([simulateDecision(model, commandFor(e)),
    simulateDecision(model, { ...commandFor(other), requestId: uuid("5") })]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(results.filter(r => r.status === "rejected").length, 1);
  assert.equal(model.state.decisions.length, 1); assert.equal(model.state.audits.length, 1);
});

test("idempotency key bound to an earlier action cannot overwrite a decision or stage a new state", async () => {
  const { envelope: e, observations: o } = fixture(), model = new SyntheticReviewModel(o);
  const command = commandFor(e);
  model.state.decisions.push({ requestId: command.requestId, reviewId: uuid("9"), actorId: "3", action: "REJECT",
    previousRowVersion: "0000000000000008", stateRowVersion: "0000000000000009" });
  const before = structuredClone(model.state);
  await assert.rejects(simulateDecision(model, command), /MOCK_IDEMPOTENCY_CONFLICT/);
  assert.deepEqual(model.state, before);
});

test("unknown synthetic reviewer and stale replay are rejected without producing audit success", async () => {
  const { envelope: e, observations: o } = fixture(), model = new SyntheticReviewModel(o);
  const forged = structuredClone(e); forged.reviewer.userId = "4";
  await assert.rejects(simulateDecision(model, commandFor(forged)), /MOCK_REVIEWER_UNKNOWN/);
  await simulateDecision(model, commandFor(e));
  await assert.rejects(simulateDecision(model, commandFor(e)), /MOCK_CONSISTENCY_FAILED/);
  assert.equal(model.state.audits.length, 1);
});

for (const [label, change] of [
  ["epoch", (o: ReviewObservations) => { o.authorization.authorizationEpoch = "0000000000000009"; }],
  ["reviewer token", (o: ReviewObservations) => { o.authorization.reviewer.tokenVersion = "3"; }],
  ["source generation", (o: ReviewObservations) => { o.source.schemaGeneration = "0000000000000009"; }],
  ["lease expiration", (o: ReviewObservations) => { o.source.lease.validUntil = o.now; }],
] as const) test(`final synthetic revalidation rejects changed ${label}`, async () => {
  const { envelope: e, observations: o } = fixture(), model = new SyntheticReviewModel(o);
  model.afterAudit = () => change(model.observations);
  await assert.rejects(simulateDecision(model, commandFor(e)), /MOCK_CONSISTENCY_FAILED/);
  assert.equal(model.state.snapshot.review.state, "PENDING"); assert.equal(model.state.decisions.length, 0); assert.equal(model.state.audits.length, 0);
});
