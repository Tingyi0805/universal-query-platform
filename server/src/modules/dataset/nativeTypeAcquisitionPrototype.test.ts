import assert from "node:assert/strict";
import test from "node:test";
import { discoverSyntheticAcquisitionScope, evaluateSyntheticAcquisition,
  type SyntheticAcquisitionEvent, type SyntheticAcquisitionNode, type SyntheticScopeRequest } from "./nativeTypeAcquisitionPrototype.js";

const uid = (i: number) => `00000000-0000-4000-8000-${i.toString(16).padStart(12, "0")}`;
const revision = "0000000000000001", nextRevision = "0000000000000002";
const predicateNames = ["DATASET_QUERIES", "DATASET_PARAMETERS", "LOOKUP_PARAMETERS", "USER_MEMBERSHIPS", "ROLE_MEMBERSHIPS",
  "ROLE_PERMISSIONS", "PERMISSION_ROLES", "QUERY_DASHBOARDS", "DASHBOARD_SOURCES", "QUERY_SOURCES", "QUERY_ROLE_ACL",
  "ROLE_QUERY_ACL", "QUERY_USER_ACL", "USER_QUERY_ACL", "SYSTEM_ADMIN_ROLES", "PERMISSION_CATALOG", "LAST_ADMIN"] as const;
function fixture(profile: SyntheticScopeRequest["profile"] = "QUERY_DATASET"): SyntheticScopeRequest {
  return { scope: "SYNTHETIC_TEST_ONLY", format: "ACQUISITION_GRAPH_V1", profile,
    roots: [{ resource: profile === "USER_ROLE" ? "AppUser" : profile === "DASHBOARD_ACL" ? "Dashboard" : "Query",
      id: profile === "USER_ROLE" ? "40" : profile === "DASHBOARD_ACL" ? "90" : "20" }],
    graph: { domainId: uid(99), incarnation: uid(98), revision, authorizationEpoch: revision,
      writers: ["QUERY_DATASET", "USER_ROLE", "DASHBOARD_ACL"],
      predicateRevisions: Object.fromEntries(predicateNames.map(k => [k, revision])),
      nodes: [
        { resource: "Dataset", id: "10", revision }, { resource: "Dataset", id: "11", revision },
        { resource: "Query", id: "20", datasetId: "10", revision }, { resource: "Query", id: "21", datasetId: "11", revision },
        { resource: "Parameter", id: "30", datasetId: "10", lookupDatasetId: "11", revision },
        { resource: "AppUser", id: "40", active: true, revision }, { resource: "AppUser", id: "41", active: true, revision },
        { resource: "Role", id: "50", active: true, systemAdmin: true, revision }, { resource: "Role", id: "51", active: true, systemAdmin: false, revision },
        { resource: "Permission", id: "60", revision }, { resource: "Permission", id: "61", revision }, { resource: "Permission", id: "62", revision },
        { resource: "UserRole", id: "70", userId: "40", roleId: "50", revision }, { resource: "UserRole", id: "71", userId: "41", roleId: "51", revision },
        { resource: "RolePermission", id: "80", roleId: "50", permissionId: "60", revision },
        { resource: "RolePermission", id: "81", roleId: "51", permissionId: "61", revision },
        { resource: "Dashboard", id: "90", queryId: "20", revision },
        { resource: "DashboardDataSource", id: "100", dashboardId: "90", queryId: "21", datasetId: "11", revision },
        { resource: "RoleQueryAccess", id: "110", queryId: "20", roleId: "51", revision },
        { resource: "UserQueryAccess", id: "120", queryId: "21", userId: "40", revision },
      ] } };
}
function find<K extends SyntheticAcquisitionNode["resource"]>(r: SyntheticScopeRequest, resource: K, id: string) {
  const n = r.graph.nodes.find(n => n.resource === resource && n.id === id);
  if (!n) throw new Error("TEST_FIXTURE_INVALID"); return n as Extract<SyntheticAcquisitionNode, { resource: K }>;
}
function hint(r: SyntheticScopeRequest) {
  const result = discoverSyntheticAcquisitionScope(r); if (!result.ok) throw new Error("TEST_FIXTURE_INVALID"); return result.hint;
}
function restricted(r: { authority: string; runtimeBindVerified: boolean; deliveryAllowed: boolean; persistence: string }) {
  assert.equal(r.authority, "NONE"); assert.equal(r.runtimeBindVerified, false); assert.equal(r.deliveryAllowed, false); assert.equal(r.persistence, "NOT_PROVEN");
}
function trace(r = fixture(), offset = 0) {
  const binding = { ownerId: uid(offset + 1), transactionId: uid(offset + 2), actor: "OWNER" as const, ticketId: uid(offset + 3) };
  const events: SyntheticAcquisitionEvent[] = [
    { type: "DISCOVER", ownerId: binding.ownerId, requestId: uid(offset + 4), request: structuredClone(r) },
    { type: "BEGIN", ...binding, modelRevision: revision },
    { type: "ACQUIRE_GATE", ...binding, outcome: "ACQUIRED" },
    { type: "PRELOCK", ...binding, plan: structuredClone(hint(r).locks) },
    { type: "REVALIDATE", ...binding, request: structuredClone(r) },
    { type: "CAS", ...binding, expected: revision, observed: revision, affectedRows: 1 },
    { type: "MUTATE", ...binding, outcome: "SUCCESS" },
    { type: "REVISION", ...binding, next: nextRevision, outcome: "SUCCESS" },
    { type: "FINAL_REVALIDATE", ...binding, request: structuredClone(r), observedModelRevision: nextRevision },
    { type: "COMMIT", ...binding, outcome: "COMMITTED" },
    { type: "RELEASE_GATE", ...binding, outcome: "RELEASED" },
  ];
  // BEGIN is strict and has no ticket: omit the fixture's shared convenience property.
  Reflect.deleteProperty(events[1]!, "ticketId");
  return { scope: "SYNTHETIC_TEST_ONLY" as const, format: "ACQUISITION_TRACE_V1" as const, domainId: r.graph.domainId, events };
}
function event<K extends SyntheticAcquisitionEvent["type"]>(t: ReturnType<typeof trace>, type: K) {
  return t.events.find(e => e.type === type) as Extract<SyntheticAcquisitionEvent, { type: K }>;
}
function cleanup(t: ReturnType<typeof trace>, after: SyntheticAcquisitionEvent["type"], failed = false) {
  const b = event(t, "ACQUIRE_GATE");
  t.events = t.events.slice(0, t.events.findIndex(e => e.type === after) + 1);
  t.events.push({ type: "ROLLBACK", ownerId: b.ownerId, transactionId: b.transactionId, actor: "OWNER", outcome: failed ? "FAILED" : "ROLLED_BACK" });
  if (!failed) t.events.push({ type: "RELEASE_GATE", ownerId: b.ownerId, transactionId: b.transactionId, actor: "OWNER", ticketId: b.ticketId, outcome: "RELEASED" });
}

for (const profile of ["QUERY_DATASET", "USER_ROLE", "DASHBOARD_ACL"] as const) test(`${profile} derives deterministic synthetic scope without authority`, () => {
  const input = fixture(profile), a = hint(input); input.graph.nodes.reverse(); input.graph.writers.reverse();
  assert.equal(JSON.stringify(hint(input)), JSON.stringify(a)); restricted(a); assert.ok(Object.isFrozen(a.locks));
  assert.equal(a.locks[0]!.kind, "ROW");
  assert.ok(a.locks.some(l => l.kind === "RANGE" && l.members.length === 0));
  const result = evaluateSyntheticAcquisition(trace(input)); assert.equal(result.success, true); restricted(result);
});
test("Query closure includes forward lookup and reverse affected Queries", () => {
  const r = fixture(); r.graph.nodes.push({ resource: "Dataset", id: "12", revision },
    { resource: "Query", id: "22", datasetId: "12", revision }, { resource: "Parameter", id: "31", datasetId: "12", lookupDatasetId: "10", revision });
  const rows = hint(r).locks.filter(l => l.kind === "ROW");
  for (const [resource, key] of [["Dataset", "10"], ["Dataset", "11"], ["Dataset", "12"], ["Query", "22"], ["Parameter", "31"]])
    assert.ok(rows.some(l => l.kind === "ROW" && l.resource === resource && l.key === key));
});
test("last-admin, complete permission catalog and dual membership predicates are derived", () => {
  const h = hint(fixture("USER_ROLE"));
  for (const predicate of ["LAST_ADMIN", "PERMISSION_CATALOG", "ROLE_MEMBERSHIPS", "USER_MEMBERSHIPS", "ROLE_PERMISSIONS"])
    assert.ok(h.locks.some(l => l.kind === "RANGE" && l.predicate === predicate));
  const admins = h.locks.find(l => l.kind === "RANGE" && l.predicate === "LAST_ADMIN");
  assert.ok(admins?.kind === "RANGE"); assert.deepEqual(admins.members.map(v => v.id), ["40"]);
});
test("Dashboard closure includes supplemental bindings, ACL bypass references and principals", () => {
  const h = hint(fixture("DASHBOARD_ACL"));
  for (const resource of ["Dashboard", "DashboardDataSource", "Query", "Dataset", "RoleQueryAccess", "UserQueryAccess", "AppUser", "Role"])
    assert.ok(h.locks.some(l => l.kind === "ROW" && l.resource === resource));
  const r = fixture("DASHBOARD_ACL"); r.roots = [{ resource: "AppUser", id: "40" }];
  assert.ok(hint(r).locks.some(l => l.kind === "ROW" && l.resource === "UserQueryAccess" && l.key === "120"));
});
test("BIGINT row scopes sort exactly beyond 2^53; roots deduplicate", () => {
  const r = fixture(); r.graph.nodes.push(...["9007199254740994", "9007199254740992", "9007199254740993"].map(id => ({ resource: "Dataset" as const, id, revision })));
  r.roots = [{ resource: "Dataset", id: "9007199254740994" }, { resource: "Dataset", id: "9007199254740993" },
    { resource: "Dataset", id: "9007199254740992" }, { resource: "Dataset", id: "9007199254740993" }];
  const h = hint(r); assert.equal(h.roots.length, 3);
  assert.deepEqual(h.locks.filter(l => l.kind === "ROW" && l.resource === "Dataset").map(l => l.key), ["9007199254740992", "9007199254740993", "9007199254740994"]);
});
const invalid: [string, (r: SyntheticScopeRequest) => void][] = [
  ["Number ID", r => { Object.assign(r.graph.nodes[0]!, { id: 9007199254740993 }); }],
  ["leading zero ID", r => { r.graph.nodes[0]!.id = "010"; }],
  ["overflow ID", r => { r.graph.nodes[0]!.id = "9223372036854775808"; }],
  ["unknown writer", r => { Object.assign(r.graph, { writers: ["QUERY_DATASET", "USER_ROLE", "DIRECT_SQL"] }); }],
  ["extra writer", r => { r.graph.writers.push("QUERY_DATASET"); }],
  ["unknown predicate", r => { Object.assign(r.graph.predicateRevisions, { UNKNOWN_PREDICATE: revision }); }],
  ["missing predicate", r => { Reflect.deleteProperty(r.graph.predicateRevisions, "DATASET_QUERIES"); }],
  ["caller complete claim", r => { Object.assign(r, { complete: true }); }],
  ["missing reference", r => { find(r, "Query", "20").datasetId = "999"; }],
  ["duplicate identity", r => { r.graph.nodes.push(structuredClone(r.graph.nodes[0]!)); }],
  ["duplicate membership", r => { r.graph.nodes.push({ ...find(r, "UserRole", "70"), id: "72" }); }],
  ["inconsistent supplemental binding", r => { find(r, "DashboardDataSource", "100").datasetId = "10"; }],
  ["invalid root profile", r => { r.roots = [{ resource: "Permission", id: "60" }]; }],
  ["disconnected malformed reference", r => { r.graph.nodes.push({ resource: "UserRole", id: "73", userId: "999", roleId: "50", revision }); }],
  ["lookup cycle", r => { r.graph.nodes.push({ resource: "Parameter", id: "31", datasetId: "11", lookupDatasetId: "10", revision }); }],
  ["self lookup", r => { find(r, "Parameter", "30").lookupDatasetId = "10"; }],
  ["node budget", r => { r.graph.nodes = Array.from({ length: 129 }, (_, i) => ({ resource: "Dataset", id: `${i + 1}`, revision })); }],
];
for (const [label, mutate] of invalid) test(`scope fails closed for ${label}`, () => {
  const r = fixture(); mutate(r); const result = discoverSyntheticAcquisitionScope(r);
  assert.equal(result.ok, false); restricted(result);
});
test("lookup depth and highly branching traversal budgets reject", () => {
  const r = fixture(); r.graph.nodes = [];
  for (let i = 1; i <= 15; i++) {
    r.graph.nodes.push({ resource: "Dataset", id: `${i}`, revision });
    if (i < 15) r.graph.nodes.push({ resource: "Parameter", id: `${i}`, datasetId: `${i}`, lookupDatasetId: `${i + 1}`, revision });
  }
  r.roots = [{ resource: "Dataset", id: "1" }];
  const result = discoverSyntheticAcquisitionScope(r); assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "CYCLE_OR_BUDGET");
  r.graph.nodes = [];
  for (let i = 1; i <= 13; i++) r.graph.nodes.push({ resource: "Dataset", id: `${i}`, revision });
  let n = 1;
  for (let a = 1; a <= 13; a++) for (let b = a + 1; b <= 13; b++)
    r.graph.nodes.push({ resource: "Parameter", id: `${n++}`, datasetId: `${a}`, lookupDatasetId: `${b}`, revision });
  assert.equal(discoverSyntheticAcquisitionScope(r).ok, false);
});

const drifts: [string, SyntheticScopeRequest["profile"], (r: SyntheticScopeRequest) => void][] = [
  ["Query rebind", "QUERY_DATASET", r => { find(r, "Query", "20").datasetId = "11"; }],
  ["lookup addition", "QUERY_DATASET", r => { r.graph.nodes.push({ resource: "Dataset", id: "12", revision }, { resource: "Parameter", id: "31", datasetId: "11", lookupDatasetId: "12", revision }); }],
  ["scope reduction", "QUERY_DATASET", r => { r.graph.nodes = r.graph.nodes.filter(n => n.resource !== "Parameter"); }],
  ["new affected Query", "QUERY_DATASET", r => { r.graph.nodes.push({ resource: "Query", id: "22", datasetId: "10", revision }); }],
  ["UserRole member", "USER_ROLE", r => { r.graph.nodes.push({ resource: "AppUser", id: "42", active: true, revision }, { resource: "UserRole", id: "72", userId: "42", roleId: "50", revision }); }],
  ["RolePermission grant", "USER_ROLE", r => { r.graph.nodes.push({ resource: "RolePermission", id: "82", roleId: "51", permissionId: "60", revision }); }],
  ["last-admin state", "USER_ROLE", r => { find(r, "AppUser", "40").active = false; }],
  ["Dashboard binding", "DASHBOARD_ACL", r => { r.graph.nodes.push({ resource: "Dashboard", id: "91", queryId: "20", revision }); }],
  ["supplemental source", "DASHBOARD_ACL", r => { r.graph.nodes.push({ resource: "DashboardDataSource", id: "101", dashboardId: "90", queryId: "20", datasetId: "10", revision }); }],
  ["ACL bypass", "DASHBOARD_ACL", r => { r.graph.nodes.push({ resource: "UserQueryAccess", id: "121", queryId: "20", userId: "41", revision }); }],
  ["ACL removal", "DASHBOARD_ACL", r => { r.graph.nodes = r.graph.nodes.filter(n => n.resource !== "UserQueryAccess"); }],
  ["row revision", "QUERY_DATASET", r => { find(r, "Query", "20").revision = nextRevision; }],
  ["predicate revision", "QUERY_DATASET", r => { r.graph.predicateRevisions.DATASET_PARAMETERS = nextRevision; }],
  ["graph revision", "QUERY_DATASET", r => { r.graph.revision = nextRevision; }],
  ["AuthorizationEpoch", "USER_ROLE", r => { r.graph.authorizationEpoch = nextRevision; }],
  ["incarnation", "QUERY_DATASET", r => { r.graph.incarnation = uid(97); }],
  ["domain identity", "QUERY_DATASET", r => { r.graph.domainId = uid(97); }],
];
for (const [label, profile, mutate] of drifts) test(`revalidation aborts on ${label}, with no repair locks in original transaction`, () => {
  const t = trace(fixture(profile)); mutate(event(t, "REVALIDATE").request); cleanup(t, "REVALIDATE");
  const result = evaluateSyntheticAcquisition(t); assert.equal(result.reason, "SCOPE_OR_REVISION_DRIFT"); assert.equal(result.success, false);
  assert.equal(result.owners[0]!.phase, "ROLLED_BACK_MODEL"); assert.equal(result.gateHolder, null); restricted(result);
});
test("unknown dependency during revalidation still permits only cleanup", () => {
  const t = trace(); find(event(t, "REVALIDATE").request, "Query", "20").datasetId = "999"; cleanup(t, "REVALIDATE");
  const result = evaluateSyntheticAcquisition(t); assert.equal(result.reason, "RELATIONSHIP_INVALID"); assert.equal(result.owners[0]!.phase, "ROLLED_BACK_MODEL");
});
test("A to B to A content cannot hide a new predicate revision", () => {
  const t = trace(), r = event(t, "REVALIDATE").request;
  find(r, "Query", "20").datasetId = "11"; find(r, "Query", "20").datasetId = "10";
  r.graph.predicateRevisions.DATASET_QUERIES = "0000000000000003"; cleanup(t, "REVALIDATE");
  assert.equal(evaluateSyntheticAcquisition(t).reason, "SCOPE_OR_REVISION_DRIFT");
});
test("fully restored fabricated versions cannot be authenticated by a pure model", () => {
  const result = evaluateSyntheticAcquisition(trace()); assert.equal(result.success, true); restricted(result);
});
test("final scope and model revision are independently revalidated", () => {
  const t = trace(); find(event(t, "FINAL_REVALIDATE").request, "Query", "20").revision = nextRevision; cleanup(t, "FINAL_REVALIDATE");
  assert.equal(evaluateSyntheticAcquisition(t).reason, "SCOPE_OR_REVISION_DRIFT");
  const v = trace(); event(v, "FINAL_REVALIDATE").observedModelRevision = revision; cleanup(v, "FINAL_REVALIDATE");
  assert.equal(evaluateSyntheticAcquisition(v).reason, "SCOPE_OR_REVISION_DRIFT");
});
test("missing or reordered ROW/RANGE/AE prelocks rejects", () => {
  for (const mutate of [
    (e: Extract<SyntheticAcquisitionEvent, { type: "PRELOCK" }>) => { e.plan = e.plan.filter(p => p.kind !== "RANGE"); },
    (e: Extract<SyntheticAcquisitionEvent, { type: "PRELOCK" }>) => { e.plan = e.plan.slice(1); },
    (e: Extract<SyntheticAcquisitionEvent, { type: "PRELOCK" }>) => { e.plan.reverse(); },
  ]) {
    const t = trace(); mutate(event(t, "PRELOCK")); cleanup(t, "PRELOCK");
    assert.equal(evaluateSyntheticAcquisition(t).reason, "PRELOCK_INVALID");
  }
});
test("Gate must precede business locks, and cannot be added at the tail", () => {
  const t = trace(); [t.events[2], t.events[3]] = [t.events[3]!, t.events[2]!];
  assert.equal(evaluateSyntheticAcquisition(t).reason, "GATE_NOT_HELD");
});
test("Gate reentry and reused tickets fail", () => {
  const t = trace(); t.events.splice(3, 0, structuredClone(event(t, "ACQUIRE_GATE")));
  assert.equal(evaluateSyntheticAcquisition(t).reason, "GATE_ORDER_OR_REENTRY");
  const a = trace(), b = trace(fixture(), 10); event(b, "ACQUIRE_GATE").ticketId = event(a, "ACQUIRE_GATE").ticketId;
  assert.equal(evaluateSyntheticAcquisition({ ...a, events: [...a.events, ...b.events] }).reason, "GATE_ORDER_OR_REENTRY");
});
for (const step of ["BEGIN", "ACQUIRE_GATE", "COMMIT", "ROLLBACK", "RELEASE_GATE"] as const) test(`Helper may not control ${step}`, () => {
  const t = trace(); if (step === "ROLLBACK") cleanup(t, "PRELOCK"); event(t, step).actor = "HELPER";
  assert.equal(evaluateSyntheticAcquisition(t).success, false);
});
test("Helper can use exactly the owner's live context, never a detached transaction", () => {
  const t = trace(); event(t, "MUTATE").actor = "HELPER";
  assert.equal(evaluateSyntheticAcquisition(t).success, true);
  event(t, "MUTATE").transactionId = uid(55); assert.equal(evaluateSyntheticAcquisition(t).reason, "OWNER_TRANSACTION_MISMATCH");
  const v = trace(); event(v, "CAS").ownerId = uid(55); assert.equal(evaluateSyntheticAcquisition(v).reason, "OWNER_MISSING");
});
test("empty or unknown Owner/trace cannot return success", () => {
  const t = trace(); t.events = []; assert.equal(evaluateSyntheticAcquisition(t).success, false);
  Object.assign(t, { transactionProof: true }); assert.equal(evaluateSyntheticAcquisition(t).reason, "FORMAT_INVALID");
});
test("rollback and release are required before retrying the same request with a new Owner", () => {
  const a = trace(), b = trace(fixture(), 10); event(b, "DISCOVER").requestId = event(a, "DISCOVER").requestId;
  find(event(a, "REVALIDATE").request, "Query", "20").revision = nextRevision; cleanup(a, "REVALIDATE");
  const beforeRelease = { ...a, events: [...a.events.slice(0, -1), ...b.events] };
  assert.equal(evaluateSyntheticAcquisition(beforeRelease).owners.length, 1);
  const afterRelease = evaluateSyntheticAcquisition({ ...a, events: [...a.events, ...b.events] });
  assert.deepEqual(afterRelease.owners.map(o => o.phase), ["ROLLED_BACK_MODEL", "COMMITTED_MODEL"]); restricted(afterRelease);
});
test("a retry cannot reuse its RequestId for a different profile or target", () => {
  const a = trace(), b = trace(fixture("USER_ROLE"), 10); cleanup(a, "PRELOCK");
  event(b, "DISCOVER").requestId = event(a, "DISCOVER").requestId;
  const result = evaluateSyntheticAcquisition({ ...a, events: [...a.events, ...b.events] });
  assert.equal(result.success, false); assert.equal(result.owners.length, 1);
});

class TestOnlyExclusiveGate {
  events: SyntheticAcquisitionEvent[] = [];
  holder: string | null = null;
  acquire(t: ReturnType<typeof trace>) {
    this.events.push(...t.events.slice(0, 2)); const e = structuredClone(event(t, "ACQUIRE_GATE"));
    e.outcome = this.holder ? "TIMEOUT" : "ACQUIRED"; this.events.push(e);
    if (!this.holder) this.holder = e.ownerId;
    else this.events.push({ type: "ROLLBACK", ownerId: e.ownerId, transactionId: e.transactionId, actor: "OWNER", outcome: "ROLLED_BACK" });
  }
  finish(t: ReturnType<typeof trace>) { this.events.push(...t.events.slice(3)); this.holder = null; }
}
test("two overlapping Writers share one test-local Exclusive Gate; timeout loser cannot commit", () => {
  const a = trace(), b = trace(fixture("USER_ROLE"), 10), mock = new TestOnlyExclusiveGate();
  mock.acquire(a); mock.acquire(b); mock.finish(a);
  const result = evaluateSyntheticAcquisition({ ...a, events: mock.events });
  assert.equal(result.reason, "GATE_TIMEOUT"); assert.deepEqual(result.owners.map(o => o.phase), ["COMMITTED_MODEL", "ROLLED_BACK_MODEL"]);
  assert.equal(result.gateHolder, null); restricted(result);
});
test("a forged second acquisition cannot coexist with a held Gate", () => {
  const a = trace(), b = trace(fixture(), 10);
  const result = evaluateSyntheticAcquisition({ ...a, events: [...a.events.slice(0, 3), ...b.events.slice(0, 3)] });
  assert.equal(result.reason, "GATE_CONFLICT"); assert.equal(result.gateHolder, uid(1)); restricted(result);
});
test("two sequential Writers may commit only after the first releases", () => {
  const a = trace(), b = trace(fixture(), 10);
  const result = evaluateSyntheticAcquisition({ ...a, events: [...a.events, ...b.events] });
  assert.equal(result.success, true); restricted(result);
});
for (const outcome of ["TIMEOUT", "DENIED"] as const) test(`Gate ${outcome} rejects with owner rollback and no ticket`, () => {
  const t = trace(); event(t, "ACQUIRE_GATE").outcome = outcome; cleanup(t, "ACQUIRE_GATE"); t.events.pop();
  const result = evaluateSyntheticAcquisition(t); assert.equal(result.reason, `GATE_${outcome}`); assert.equal(result.gateHolder, null);
  assert.equal(result.owners[0]!.phase, "ROLLED_BACK_MODEL"); restricted(result);
});
for (const step of ["PRELOCK", "CAS", "MUTATE", "FINAL_REVALIDATE"] as const) test(`wrong ticket at ${step} fails closed`, () => {
  const t = trace(); event(t, step).ticketId = uid(77); cleanup(t, step);
  assert.equal(evaluateSyntheticAcquisition(t).reason, "GATE_NOT_HELD");
});
test("early release, ownership loss and unknown release quarantine the synthetic domain", () => {
  const a = trace(); a.events.splice(3, 0, structuredClone(event(a, "RELEASE_GATE")));
  const lost = trace(), b = event(lost, "ACQUIRE_GATE"); lost.events.splice(4, 0, { type: "LOSE_GATE", ownerId: b.ownerId, transactionId: b.transactionId, actor: "OWNER", ticketId: b.ticketId });
  const unknown = trace(); event(unknown, "RELEASE_GATE").outcome = "UNKNOWN";
  for (const t of [a, lost, unknown]) {
    const result = evaluateSyntheticAcquisition(t); assert.equal(result.success, false); assert.equal(result.quarantined, true); restricted(result);
  }
});
test("an aborted Owner cannot add repair locks, rediscover or reuse its transaction", () => {
  const t = trace(); find(event(t, "REVALIDATE").request, "Query", "20").revision = nextRevision;
  t.events.splice(5, 0, structuredClone(event(t, "PRELOCK")), structuredClone(event(t, "DISCOVER")), structuredClone(event(t, "BEGIN")));
  const result = evaluateSyntheticAcquisition(t); assert.equal(result.success, false); assert.equal(result.owners[0]!.phase, "ABORT_REQUIRED");
});
const failures: [string, (t: ReturnType<typeof trace>) => void, SyntheticAcquisitionEvent["type"]][] = [
  ["CAS conflict", t => { event(t, "CAS").observed = nextRevision; }, "CAS"],
  ["CAS zero rows", t => { event(t, "CAS").affectedRows = 0; }, "CAS"],
  ["CAS multiple rows", t => { event(t, "CAS").affectedRows = 2; }, "CAS"],
  ["Mutation", t => { event(t, "MUTATE").outcome = "FAILED"; }, "MUTATE"],
  ["Revision", t => { event(t, "REVISION").outcome = "FAILED"; }, "REVISION"],
  ["regressed revision", t => { event(t, "REVISION").next = revision; }, "REVISION"],
  ["Commit", t => { event(t, "COMMIT").outcome = "FAILED"; }, "COMMIT"],
];
for (const [label, mutate, after] of failures) test(`${label} failure rolls back only the staged model and releases Gate`, () => {
  const t = trace(); mutate(t); cleanup(t, after);
  const result = evaluateSyntheticAcquisition(t); assert.equal(result.success, false); assert.equal(result.gateHolder, null);
  assert.equal(result.owners[0]!.phase, "ROLLED_BACK_MODEL"); restricted(result);
});
test("rollback failure keeps Gate state unproven and forbids the next Writer", () => {
  const t = trace(); event(t, "MUTATE").outcome = "FAILED"; cleanup(t, "MUTATE", true);
  const b = trace(fixture(), 10), result = evaluateSyntheticAcquisition({ ...t, events: [...t.events, ...b.events] });
  assert.equal(result.success, false); assert.equal(result.quarantined, true); assert.equal(result.owners[0]!.phase, "ROLLBACK_UNKNOWN");
  assert.notEqual(result.owners[1]!.phase, "COMMITTED_MODEL"); restricted(result);
});
test("commit unknown never proves rollback or safe Gate release", () => {
  const t = trace(); event(t, "COMMIT").outcome = "UNKNOWN";
  const result = evaluateSyntheticAcquisition(t); assert.equal(result.reason, "COMMIT_UNKNOWN"); assert.equal(result.quarantined, true);
  assert.equal(result.owners[0]!.phase, "COMMIT_UNKNOWN"); assert.equal(result.success, false); restricted(result);
});
test("unknown release after commit cannot be relabelled as a successful rollback", () => {
  const t = trace(); event(t, "RELEASE_GATE").outcome = "UNKNOWN";
  t.events.push({ type: "ROLLBACK", ownerId: uid(1), transactionId: uid(2), actor: "OWNER", outcome: "ROLLED_BACK" });
  const result = evaluateSyntheticAcquisition(t); assert.equal(result.success, false); assert.equal(result.quarantined, true);
  assert.equal(result.owners[0]!.phase, "COMMIT_UNKNOWN");
});
class TestOnlyStagedWriter {
  value = "A";
  run(t: ReturnType<typeof trace>, commitApplied = false) {
    const staged = "B", result = evaluateSyntheticAcquisition(t);
    if (result.success || commitApplied && result.reason === "COMMIT_UNKNOWN") this.value = staged;
    return result;
  }
}
test("Mock success publishes staged copies but no SQL/persistence/delivery proof", () => {
  const mock = new TestOnlyStagedWriter(), result = mock.run(trace()); assert.equal(mock.value, "B"); assert.equal(result.success, true); restricted(result);
});
test("Mutation/Revision failure publishes no partial staged state", () => {
  for (const step of ["MUTATE", "REVISION"] as const) {
    const t = trace(); event(t, step).outcome = "FAILED"; cleanup(t, step);
    const mock = new TestOnlyStagedWriter(), result = mock.run(t); assert.equal(mock.value, "A"); assert.equal(result.success, false);
  }
});
test("both applied and unapplied commit-unknown fixtures fail closed", () => {
  for (const applied of [false, true]) {
    const t = trace(); event(t, "COMMIT").outcome = "UNKNOWN"; t.events.pop();
    const mock = new TestOnlyStagedWriter(), result = mock.run(t, applied);
    assert.equal(result.success, false); assert.equal(mock.value, applied ? "B" : "A"); restricted(result);
  }
});
test("getters, Proxy traps, symbols, custom prototypes and serialization hooks never execute", () => {
  let calls = 0;
  const getter = Object.defineProperty({}, "scope", { enumerable: true, get() { calls++; throw new Error("SYNTHETIC_SECRET"); } });
  const proxy = new Proxy({}, { ownKeys() { calls++; throw new Error("SYNTHETIC_SECRET"); } });
  const custom = Object.assign(Object.create({}), fixture()), symbol = Object.assign(fixture(), { [Symbol("x")]: "SYNTHETIC_SECRET" });
  const hidden = Object.defineProperty(fixture(), "secret", { value: "SYNTHETIC_SECRET" });
  const hook = Object.assign(fixture(), { toJSON() { calls++; throw new Error("SYNTHETIC_SECRET"); } });
  for (const input of [getter, proxy, custom, symbol, hidden, hook]) {
    assert.equal(discoverSyntheticAcquisitionScope(input).ok, false);
    assert.equal(evaluateSyntheticAcquisition(input).success, false);
  }
  assert.equal(calls, 0);
});
test("malformed inputs and errors never echo SQL, credentials or patient markers", () => {
  const r = fixture(); Object.assign(r.graph.nodes[0]!, { sql: "SYNTHETIC_SQL", credential: "SYNTHETIC_SECRET", patient: "SYNTHETIC_PATIENT" });
  const t = trace(); Object.assign(event(t, "MUTATE"), { payload: "SYNTHETIC_SECRET" });
  for (const result of [discoverSyntheticAcquisitionScope(r), evaluateSyntheticAcquisition(t)])
    assert.equal(/SYNTHETIC_(SQL|SECRET|PATIENT)/.test(JSON.stringify(result)), false);
});
test("cyclic/sparse/extra-property arrays and trace budgets fail safely", () => {
  const cyclic = fixture(); Object.assign(cyclic.graph, { cycle: cyclic });
  assert.equal(discoverSyntheticAcquisitionScope(cyclic).ok, false);
  for (const nodes of [new Array(1), Object.assign([], { extra: true })]) {
    const r = fixture(); r.graph.nodes = nodes; assert.equal(discoverSyntheticAcquisitionScope(r).ok, false);
  }
  const t = trace(); t.events = Array.from({ length: 129 }, () => t.events[0]!);
  assert.equal(evaluateSyntheticAcquisition(t).success, false);
});
