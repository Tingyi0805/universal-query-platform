import assert from "node:assert/strict";
import test from "node:test";
import { analyzeSyntheticLockGraph, validateSyntheticWriterTransaction, CANDIDATE_RESOURCE_ORDER, OBSERVED_LOCK_GRAPH,
  type LockResource, type SyntheticLockGraph, type SyntheticWriterTransaction, type SyntheticWriterProfile } from "./nativeTypeWriterLocks.js";

function graph(edges: SyntheticLockGraph["edges"] = [], unknownWriters: SyntheticLockGraph["unknownWriters"] = []): SyntheticLockGraph {
  return { scope: "SYNTHETIC_TEST_ONLY", edges, unknownWriters };
}
function dependency(before: LockResource, after: LockResource, writer: SyntheticLockGraph["edges"][number]["writer"] = "QUERY_ACL") {
  return { before, after, writer, basis: "HYPOTHETICAL" as const };
}
function restrictions(result: { authority: string; runtimeBindVerified: boolean; deliveryAllowed: boolean; persistence: string }) {
  assert.equal(result.authority, "NONE"); assert.equal(result.runtimeBindVerified, false);
  assert.equal(result.deliveryAllowed, false); assert.equal(result.persistence, "NOT_PROVEN");
}
test("acyclic known subgraph gives a candidate partial order, not authority", () => {
  const input = graph([dependency("Dataset", "Dashboard"), dependency("Dashboard", "QueryAcl"), dependency("AppUser", "Dataset")]);
  const result = analyzeSyntheticLockGraph(input);
  assert.equal(result.analysis, "KNOWN_SUBGRAPH_ACYCLIC"); assert.ok(result.order);
  for (const e of input.edges) assert.ok(result.order.indexOf(e.before) < result.order.indexOf(e.after));
  restrictions(result); assert.equal(Object.isFrozen(result.order), true);
});
test("multiple writers and duplicate edges sharing resources have one consistent ordering", () => {
  const input = graph([dependency("Dataset", "Dashboard", "LEGACY_BINDINGS"), dependency("Dashboard", "QueryAcl"),
    dependency("Dashboard", "QueryAcl", "DASHBOARD_APPROVAL"), dependency("Dataset", "QueryAcl", "PARAMETER_SAVE")]);
  const result = analyzeSyntheticLockGraph(input); assert.equal(result.analysis, "KNOWN_SUBGRAPH_ACYCLIC");
  assert.equal(new Set(result.order).size, CANDIDATE_RESOURCE_ORDER.length);
});
test("topological order follows dependencies even if they reverse the proposed candidate", () => {
  const result = analyzeSyntheticLockGraph(graph([dependency("AppUser", "Role")]));
  assert.ok(result.order); assert.ok(result.order.indexOf("AppUser") < result.order.indexOf("Role"));
});
test("known source graph remains BLOCKED with concrete cycles and unknown writers", () => {
  const result = analyzeSyntheticLockGraph(OBSERVED_LOCK_GRAPH);
  assert.equal(result.analysis, "CYCLE"); assert.equal(result.order, null); assert.ok(result.cycle.length >= 2);
  assert.ok(result.unknownWriters.includes("EXTERNAL_SQL")); restrictions(result);
  result.cycle.forEach((e, i) => assert.equal(e.after, result.cycle[(i + 1) % result.cycle.length]!.before));
});
test("conditional sensitivity path retains Dataset to Dashboard dependency and unresolved lock behavior", () => {
  assert.ok(OBSERVED_LOCK_GRAPH.edges.some(e => e.writer === "SENSITIVITY" && e.before === "Dataset" && e.after === "Dashboard"));
  assert.ok(OBSERVED_LOCK_GRAPH.unknownWriters.includes("SENSITIVITY"));
});
for (const writers of [["QUERY_REBIND", "DATASET_UPDATE"], ["QUERY_RESTORE", "PARAMETER_SAVE"], ["USER_UPDATE", "ROLE_UPDATE"]]) {
  test(`source cycle identifies involved writers ${writers.join("/")}`, () => {
    const result = analyzeSyntheticLockGraph(graph(OBSERVED_LOCK_GRAPH.edges.filter(e => writers.includes(e.writer))));
    assert.equal(result.analysis, "CYCLE");
    for (const writer of writers) assert.ok(result.cycle.some(e => e.writer === writer));
  });
}
test("tail AE patch opposes AE-first Review Reader and reports both writers", () => {
  const result = analyzeSyntheticLockGraph(graph([
    dependency("AuthorizationEpoch", "QueryAcl", "REVIEW_READER"), dependency("QueryAcl", "AuthorizationEpoch", "TAIL_EPOCH_PATCH"),
  ]));
  assert.equal(result.analysis, "CYCLE");
  assert.deepEqual(new Set(result.cycle.map(e => e.writer)), new Set(["REVIEW_READER", "TAIL_EPOCH_PATCH"]));
});
test("self-loop is a cycle, not an empty result", () => {
  const result = analyzeSyntheticLockGraph(graph([dependency("Review", "Review", "REVIEW_READER")]));
  assert.equal(result.analysis, "CYCLE"); assert.equal(result.cycle.length, 1);
});
for (const writer of ["EXTERNAL_SQL", "MIXED_VERSION", "MIGRATION", "QUERY_PUBLISH"] as const) {
  test(`unknown ${writer} never becomes globally acyclic`, () => {
    const result = analyzeSyntheticLockGraph(graph([], [writer]));
    assert.equal(result.analysis, "INCOMPLETE"); assert.ok(result.order); restrictions(result);
  });
}
test("hypothetical common order preserves Dataset to Dashboard to ACL but does not fix source cycles", () => {
  const edges = CANDIDATE_RESOURCE_ORDER.slice(1).map((next, i) => dependency(CANDIDATE_RESOURCE_ORDER[i]!, next, "REVIEW_READER"));
  const candidate = analyzeSyntheticLockGraph(graph(edges)); assert.equal(candidate.analysis, "KNOWN_SUBGRAPH_ACYCLIC");
  assert.ok(candidate.order!.indexOf("Dataset") < candidate.order!.indexOf("Dashboard"));
  assert.ok(candidate.order!.indexOf("Dashboard") < candidate.order!.indexOf("QueryAcl"));
  assert.equal(analyzeSyntheticLockGraph(graph([...edges, ...OBSERVED_LOCK_GRAPH.edges], OBSERVED_LOCK_GRAPH.unknownWriters)).analysis, "CYCLE");
});
test("graph does not echo arbitrary writer names or input payloads", () => {
  const input = graph([dependency("Dataset", "Dashboard")]); Object.assign(input.edges[0]!, { writer: "SYNTHETIC_SECRET" });
  const result = analyzeSyntheticLockGraph(input);
  assert.equal(result.analysis, "FORMAT_INVALID"); assert.equal(JSON.stringify(result).includes("SYNTHETIC_SECRET"), false);
});

function plan(writer: SyntheticWriterProfile = "QUERY_ACL", domains: ("AE" | "Q" | "D" | "S")[] = ["AE"],
  resources: LockResource[] = ["AuthorizationEpoch", "QueryDefinition", "Dashboard", "QueryAcl"]): SyntheticWriterTransaction {
  const expected = { AE: "0000000000000001", Q: "0000000000000011", D: "0000000000000021", S: "0000000000000031" };
  const after = { ...expected }; for (const d of domains) after[d] = (BigInt(`0x${expected[d]}`) + 1n).toString(16).padStart(16, "0");
  return { scope: "SYNTHETIC_TEST_ONLY", format: "WRITER_TRANSACTION_MODEL_V1", writer, ownership: "OWNED", isolation: "SERIALIZABLE",
    isolationEvidence: "SYNTHETIC_OWNER_OBSERVATION", xactAbort: true, rollbackResponsibility: "OWNER", lockCoverage: "SYNTHETIC_COMPLETE",
    transactionReferences: Object.fromEntries(["owner", "read", "cas", "mutation", "revision", "finalRevalidation", "commit"]
      .map(key => [key, "11111111-1111-4111-8111-111111111111"])) as SyntheticWriterTransaction["transactionReferences"],
    locks: resources.map(resource => ({ resource, key: "1", coverage: "ROW", result: "PRESENT" })),
    expected, observed: { ...expected }, after, affectedRows: 1,
    steps: ["BEGIN", "VERIFY_ISOLATION", "XACT_ABORT_ON", "ACQUIRE_LOCKS", "CAS", "MUTATE", "ADVANCE_REVISIONS", "FINAL_AUTHORIZATION", "FINAL_VERSIONS", "FINAL_DECISION_GATE", "COMMIT"],
    finalAuthorizationValid: true, finalVersionsValid: true, outcome: "SIMULATED_COMMIT" };
}
test("owned synthetic serializable trace passes without granting delivery", () => {
  const result = validateSyntheticWriterTransaction(plan()); assert.equal(result.consistent, true); restrictions(result);
  assert.equal(Object.isFrozen(result), true);
});
test("reverse Dashboard ACL or late Epoch lock fails", () => {
  for (const resources of [["AuthorizationEpoch", "QueryDefinition", "QueryAcl", "Dashboard"], ["QueryDefinition", "Dashboard", "QueryAcl", "AuthorizationEpoch"]] as LockResource[][]) {
    assert.equal(validateSyntheticWriterTransaction(plan("QUERY_ACL", ["AE"], resources)).reason, "LOCK_ORDER_INVALID");
  }
});
test("same-resource IDs use exact ascending BIGINT ordering across multiple writers", () => {
  for (const writer of ["QUERY_REBIND", "QUERY_RESTORE_REBIND"] as const) {
    const input = plan(writer, ["AE", "Q"], ["AuthorizationEpoch", "Dataset", "Dataset", "QueryDefinition"]);
    input.locks[1]!.key = "9007199254740993"; input.locks[2]!.key = "9007199254740994";
    assert.equal(validateSyntheticWriterTransaction(input).consistent, true);
    input.locks[2]!.key = "9007199254740992";
    assert.equal(validateSyntheticWriterTransaction(input).reason, "LOCK_ORDER_INVALID");
  }
});
test("duplicate lock key does not pretend to lock a second scope", () => {
  const input = plan(); input.locks.splice(2, 0, structuredClone(input.locks[1]!));
  assert.equal(validateSyntheticWriterTransaction(input).reason, "LOCK_ORDER_INVALID");
});
test("empty lookup needs a range scope; missing Epoch singleton always rejects", () => {
  const input = plan(); input.locks[2]!.result = "EMPTY";
  assert.equal(validateSyntheticWriterTransaction(input).reason, "LOCK_SCOPE_INCOMPLETE");
  input.locks[2]!.coverage = "RANGE"; assert.equal(validateSyntheticWriterTransaction(input).consistent, true);
  input.locks[0]!.result = "EMPTY"; input.locks[0]!.coverage = "RANGE";
  assert.equal(validateSyntheticWriterTransaction(input).reason, "LOCK_SCOPE_INCOMPLETE");
});
test("an empty target cannot coexist with an affected-row CAS success", () => {
  const input = plan(); input.locks[1]!.result = "EMPTY"; input.locks[1]!.coverage = "RANGE";
  assert.equal(validateSyntheticWriterTransaction(input).reason, "LOCK_SCOPE_INCOMPLETE");
});
test("deleteUser cannot skip ACL range or Epoch advancement", () => {
  const input = plan("DELETE_USER", ["AE"], ["AuthorizationEpoch", "Role", "AppUser", "UserRole", "QueryDefinition", "QueryAcl"]);
  assert.equal(validateSyntheticWriterTransaction(input).consistent, true);
  input.after.AE = input.observed.AE; assert.equal(validateSyntheticWriterTransaction(input).reason, "REVISION_INVALID");
  input.after.AE = "0000000000000002"; input.locks.pop();
  assert.equal(validateSyntheticWriterTransaction(input).reason, "LOCK_SCOPE_INCOMPLETE");
});
const profileCases: [SyntheticWriterProfile, ("AE" | "Q" | "D" | "S")[], LockResource[]][] = [
  ["USER_SECURITY", ["AE"], ["AuthorizationEpoch", "Role", "AppUser", "UserRole"]],
  ["ROLE_SECURITY", ["AE"], ["AuthorizationEpoch", "Role", "RolePermission", "AppUser", "UserRole"]],
  ["QUERY_REBIND", ["AE", "Q"], ["AuthorizationEpoch", "Dataset", "QueryDefinition"]],
  ["QUERY_RESTORE_REBIND", ["AE", "Q"], ["AuthorizationEpoch", "Dataset", "QueryDefinition"]],
  ["QUERY_AVAILABILITY", ["Q"], ["Dataset", "QueryDefinition"]],
  ["DATASET", ["D", "Q"], ["Dataset", "QueryDefinition"]],
  ["PARAMETER", ["D", "Q"], ["Dataset", "DatasetParameter", "QueryDefinition"]],
  ["DATASET_ONLY", ["D"], ["Dataset", "QueryDefinition"]],
  ["PARAMETER_ONLY", ["D"], ["Dataset", "DatasetParameter", "QueryDefinition"]],
  ["SOURCE", ["S"], ["DataSource"]],
];
for (const [writer, domains, locks] of profileCases) test(`${writer} advances only its required mutation domains`, () => {
  const input = plan(writer, domains, locks); assert.equal(validateSyntheticWriterTransaction(input).consistent, true);
  const d = domains[0]!; input.after[d] = input.observed[d];
  assert.equal(validateSyntheticWriterTransaction(input).reason, "REVISION_INVALID");
});
test("parameter and Dataset changes do not arbitrarily advance global Epoch", () => {
  for (const [writer, domains, locks] of profileCases.filter(([w]) => ["PARAMETER", "DATASET", "SOURCE"].includes(w))) {
    const input = plan(writer, domains, locks); input.after.AE = "0000000000000002";
    assert.equal(validateSyntheticWriterTransaction(input).reason, "REVISION_INVALID");
  }
});
test("no affected Query keeps Q unchanged while locking its empty relationship range", () => {
  const input = plan("PARAMETER_ONLY", ["D"], ["Dataset", "DatasetParameter", "QueryDefinition"]);
  input.locks[2]!.coverage = "RANGE"; input.locks[2]!.result = "EMPTY";
  assert.equal(validateSyntheticWriterTransaction(input).consistent, true); assert.equal(input.after.Q, input.observed.Q);
});
test("CAS rejects changes to every expected revision, even an unrelated domain", () => {
  for (const domain of ["AE", "Q", "D", "S"] as const) {
    const input = plan(); input.observed[domain] = "0000000000000099";
    assert.equal(validateSyntheticWriterTransaction(input).reason, "CAS_CONFLICT");
  }
});
test("A to B to A cannot restore an earlier mutation revision", () => {
  const first = plan(), second = plan();
  second.expected.AE = first.after.AE; second.observed.AE = first.after.AE; second.after.AE = "0000000000000003";
  assert.equal(validateSyntheticWriterTransaction(first).consistent, true); assert.equal(validateSyntheticWriterTransaction(second).consistent, true);
  second.after.AE = first.expected.AE; assert.equal(validateSyntheticWriterTransaction(second).reason, "REVISION_INVALID");
});
const unverified: Partial<SyntheticWriterTransaction>[] = [
  { ownership: "EXTERNAL" }, { isolation: "UNKNOWN" }, { isolation: "READ_COMMITTED" },
  { isolationEvidence: "UNVERIFIED" }, { xactAbort: false }, { rollbackResponsibility: "UNKNOWN" },
];
unverified.forEach((patch, i) => test(`unverified transaction precondition ${i} fails closed`, () => {
  const input = Object.assign(plan(), patch); assert.equal(validateSyntheticWriterTransaction(input).reason, "TRANSACTION_UNVERIFIED");
}));
test("unknown lock coverage and writer cannot become trusted by a transaction brand", () => {
  const input = plan(); input.lockCoverage = "UNKNOWN";
  assert.equal(validateSyntheticWriterTransaction(input).reason, "LOCK_SCOPE_INCOMPLETE");
  Object.assign(input, { writer: "UNTRACKED_SQL_WRITER", transactionBrand: "SAFE" });
  assert.equal(validateSyntheticWriterTransaction(input).reason, "FORMAT_INVALID");
});
test("read, CAS, mutation, epoch, revalidation and commit cannot claim different transaction scopes", () => {
  for (const phase of ["read", "cas", "mutation", "revision", "finalRevalidation", "commit"] as const) {
    const input = plan(); input.transactionReferences[phase] = "22222222-2222-4222-8222-222222222222";
    assert.equal(validateSyntheticWriterTransaction(input).reason, "TRANSACTION_SCOPE_MISMATCH");
  }
});
test("numeric revisions, zero affected rows and unknown fields reject", () => {
  const inputs = [plan(), plan(), plan()];
  Object.assign(inputs[0]!.expected, { AE: 1 }); Object.assign(inputs[1]!, { affectedRows: 0 }); Object.assign(inputs[2]!, { secret: "SYNTHETIC_SECRET" });
  for (const input of inputs) assert.equal(validateSyntheticWriterTransaction(input).reason, "FORMAT_INVALID");
});
test("late or omitted final revalidation and wrong step order reject", () => {
  for (const patch of [{ finalAuthorizationValid: false }, { finalVersionsValid: false }]) {
    assert.equal(validateSyntheticWriterTransaction(Object.assign(plan(), patch)).reason, "FINAL_REVALIDATION_FAILED");
  }
  const input = plan(); input.steps.reverse(); assert.equal(validateSyntheticWriterTransaction(input).reason, "STEP_ORDER_INVALID");
  input.steps = plan().steps.filter(s => s !== "FINAL_VERSIONS");
  assert.equal(validateSyntheticWriterTransaction(input).reason, "STEP_ORDER_INVALID");
});
for (const outcome of ["DEADLOCK", "TIMEOUT", "MUTATION_FAILED", "REVISION_FAILED", "ROLLBACK_FAILED", "COMMIT_UNKNOWN"] as const) {
  test(`${outcome} never returns synthetic success or delivery`, () => {
    const input = plan(); input.outcome = outcome;
    const result = validateSyntheticWriterTransaction(input); assert.equal(result.reason, "OUTCOME_UNSAFE"); restrictions(result);
  });
}

// Test-only staged-copy model. It neither opens SQL transactions nor proves rollback/lock behavior.
class SyntheticWriterModel {
  content: "A" | "B" = "A";
  epoch = "0000000000000001";
  trace: string[] = [];
  run(next: "A" | "B", fail?: "MUTATION_FAILED" | "REVISION_FAILED" | "DEADLOCK" | "TIMEOUT" | "ROLLBACK_FAILED" | "COMMIT_UNKNOWN",
    ambiguousCommitApplied = false) {
    const input = plan(); input.expected.AE = this.epoch; input.observed.AE = this.epoch;
    input.after.AE = (BigInt(`0x${this.epoch}`) + 1n).toString(16).padStart(16, "0");
    this.trace = ["read", "locks", "cas", "mutate"];
    const stagedContent = next, stagedEpoch = input.after.AE;
    if (fail) {
      input.outcome = fail;
      if (fail !== "MUTATION_FAILED") this.trace.push("advance-epoch");
      this.trace.push(fail === "COMMIT_UNKNOWN" ? "commit-outcome-unknown" : fail === "ROLLBACK_FAILED" ? "rollback-unproven" : "discard-staged-copies");
      if (fail === "COMMIT_UNKNOWN" && ambiguousCommitApplied) { this.content = stagedContent; this.epoch = stagedEpoch; }
    } else {
      this.trace.push("advance-epoch", "final-auth", "final-versions", "simulated-commit");
      this.content = stagedContent; this.epoch = stagedEpoch;
    }
    return validateSyntheticWriterTransaction(input);
  }
}
for (const fail of ["MUTATION_FAILED", "REVISION_FAILED", "DEADLOCK", "TIMEOUT"] as const) test(`model ${fail} discards both content and epoch`, () => {
  const model = new SyntheticWriterModel(), result = model.run("B", fail);
  assert.equal(result.consistent, false); assert.equal(model.content, "A"); assert.equal(model.epoch, "0000000000000001");
  assert.equal(model.trace.at(-1), "discard-staged-copies"); restrictions(result);
});
test("model A to B to A preserves changed epoch despite identical content", () => {
  const model = new SyntheticWriterModel(); assert.equal(model.run("B").consistent, true);
  assert.equal(model.run("A").consistent, true); assert.equal(model.content, "A"); assert.equal(model.epoch, "0000000000000003");
});
test("commit ambiguity rejects whether both changes applied or neither applied", () => {
  for (const applied of [true, false]) {
    const model = new SyntheticWriterModel(), result = model.run("B", "COMMIT_UNKNOWN", applied);
    assert.equal(result.consistent, false); restrictions(result);
    assert.equal(model.content, applied ? "B" : "A"); assert.equal(model.epoch, applied ? "0000000000000002" : "0000000000000001");
    assert.equal(model.trace.includes("discard-staged-copies"), false);
  }
});
test("rollback failure is reported as unproven, without a rollback guarantee", () => {
  const model = new SyntheticWriterModel(), result = model.run("B", "ROLLBACK_FAILED");
  assert.equal(result.consistent, false); assert.equal(model.trace.at(-1), "rollback-unproven"); restrictions(result);
});
test("unsafe hooks and sensitive payloads are never executed or returned", () => {
  let called = 0;
  const getter = Object.defineProperty({}, "scope", { enumerable: true, get() { called++; return "SYNTHETIC_TEST_ONLY"; } });
  const proxy = new Proxy({}, { ownKeys() { called++; throw new Error("SYNTHETIC_SECRET"); } });
  for (const input of [getter, proxy, Object.assign(plan(), { sql: "SYNTHETIC_SQL", parameters: "SYNTHETIC_PATIENT", credentials: "SYNTHETIC_SECRET" })]) {
    const result = validateSyntheticWriterTransaction(input); assert.equal(result.consistent, false);
    assert.equal(/SYNTHETIC_(SQL|PATIENT|SECRET)/.test(JSON.stringify(result)), false);
    assert.equal(analyzeSyntheticLockGraph(input).analysis, "FORMAT_INVALID");
  }
  assert.equal(called, 0);
});
