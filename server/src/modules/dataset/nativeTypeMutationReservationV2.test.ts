import assert from "node:assert/strict";
import test from "node:test";
import { prepareSyntheticMutationV2, validateSyntheticMutationV2, type MutationStateV2, type MutationNodeV2,
  type MutationRequestV2, type MutationDeltaV2, type MutationObservationV2, type MutationAllocationV2 } from "./nativeTypeMutationReservationV2.js";

const v1 = "0000000000000001", v2 = "0000000000000002", allocated = "9007199254740993";
const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const f = { canView: true, canExecute: true, canExport: false };
function current(): MutationStateV2 {
  return { format: "SYNTHETIC_STATE_V2", domainId: uuid(1), incarnation: uuid(2), generation: v1, authorizationEpoch: v1, retainedReferences: [], nodes: [
    ...["20", "21", "22"].map(id => ({ resource: "Dataset" as const, id, revision: v1, active: true, archived: false })),
    ...[["30", "20"], ["31", "21"], ["32", "22"]].map(([id, datasetId]) => ({ resource: "Query" as const, id: id!, datasetId: datasetId!, revision: v1,
      active: true, archived: false, published: true, publishedByUserId: "1" })),
    { resource: "Parameter", id: "40", revision: v1, datasetId: "20", name: "SYN_P", lookupDatasetId: "21" },
    { resource: "AppUser", id: "1", revision: v1, username: "SYN_OWNER", active: true, tokenVersion: "1" },
    { resource: "AppUser", id: "2", revision: v1, username: "SYN_USER", active: true, tokenVersion: "1" },
    { resource: "Role", id: "10", revision: v1, code: "SYN_ADMIN", active: true, systemAdmin: true },
    { resource: "Role", id: "11", revision: v1, code: "SYN_ROLE", active: true, systemAdmin: false },
    { resource: "Permission", id: "100", revision: v1, code: "MODEL_ADMIN" }, { resource: "Permission", id: "101", revision: v1, code: "MODEL_DESIGN" },
    { resource: "UserRole", userId: "1", roleId: "10", revision: v1 }, { resource: "UserRole", userId: "2", roleId: "11", revision: v1 },
    { resource: "RolePermission", roleId: "10", permissionId: "100", revision: v1 }, { resource: "RolePermission", roleId: "10", permissionId: "101", revision: v1 },
    { resource: "RolePermission", roleId: "11", permissionId: "101", revision: v1 },
    ...["30", "31", "32"].map(queryId => ({ resource: "RoleACL" as const, queryId, roleId: "10", ...f, revision: v1 })),
    { resource: "UserACL", queryId: "30", userId: "2", ...f, revision: v1 },
    { resource: "Dashboard", id: "50", revision: v1, queryId: "30", creatorId: "1", active: false, mode: "LEGACY", management: "MANAGED", approvalPresent: false },
    { resource: "ManagedSource", id: "60", revision: v1, dashboardId: "50", sourceKey: "SYN_EXTRA", storedHistoricalDatasetId: "20",
      effectiveQueryDatasetId: "21", queryId: "31", approvalPresent: false, referenced: false, bindingRevision: v1 },
  ] };
}
const expected = { generation: v1, authorizationEpoch: v1, targetRevision: v1 };
type Vector = { label: string; delta: MutationDeltaV2; updates?: [string, Record<string, unknown>][]; removed?: string[]; added?: MutationNodeV2[]; ae: string };
// Independent golden differences, not snapshots copied from the planner.
const vectors: Vector[] = [
  { label: "Query A to B", delta: { operation: "QUERY_REBIND", targetId: "30", datasetId: "21", expected }, ae: v2,
    updates: [["Query:30", { datasetId: "21", revision: v2, published: false, publishedByUserId: null }]] },
  { label: "Parameter add", delta: { operation: "PARAMETER_ADD", targetId: "20", name: "SYN_NEW", lookupDatasetId: "22", expected }, ae: v1,
    added: [{ resource: "Parameter", id: "$NEW", revision: v1, datasetId: "20", name: "SYN_NEW", lookupDatasetId: "22" }],
    updates: [["Dataset:20", { revision: v2 }], ["Query:30", { revision: v2, published: false, publishedByUserId: null }]] },
  { label: "Parameter delete", delta: { operation: "PARAMETER_DELETE", targetId: "40", expected }, ae: v1, removed: ["Parameter:40"],
    updates: [["Dataset:20", { revision: v2 }], ["Query:30", { revision: v2, published: false, publishedByUserId: null }]] },
  { label: "Parameter lookup A to B", delta: { operation: "PARAMETER_LOOKUP", targetId: "40", lookupDatasetId: "22", expected }, ae: v1,
    updates: [["Parameter:40", { lookupDatasetId: "22", revision: v2 }], ["Dataset:20", { revision: v2 }], ["Query:30", { revision: v2, published: false, publishedByUserId: null }]] },
  { label: "create User slot", delta: { operation: "CREATE_USER", username: "SYN_NEW_USER", roleIds: ["11"], expected }, ae: v2,
    added: [{ resource: "AppUser", id: "$NEW", revision: v1, username: "SYN_NEW_USER", active: true, tokenVersion: "1" }, { resource: "UserRole", userId: "$NEW", roleId: "11", revision: v1 }] },
  { label: "create Role slot", delta: { operation: "CREATE_ROLE", code: "SYN_NEW_ROLE", permissionIds: ["101"], expected }, ae: v2,
    added: [{ resource: "Role", id: "$NEW", revision: v1, code: "SYN_NEW_ROLE", active: true, systemAdmin: false }, { resource: "RolePermission", roleId: "$NEW", permissionId: "101", revision: v1 }] },
  { label: "UserRole grant", delta: { operation: "USER_ROLE", targetId: "2", roleId: "10", grant: true, expected }, ae: v2,
    added: [{ resource: "UserRole", userId: "2", roleId: "10", revision: v1 }], updates: [["AppUser:2", { revision: v2, tokenVersion: "2" }]] },
  { label: "UserRole revoke", delta: { operation: "USER_ROLE", targetId: "2", roleId: "11", grant: false, expected }, ae: v2,
    removed: ["UserRole:2:11"], updates: [["AppUser:2", { revision: v2, tokenVersion: "2" }]] },
  { label: "RolePermission grant", delta: { operation: "ROLE_PERMISSION", targetId: "11", permissionId: "100", grant: true, expected }, ae: v2,
    added: [{ resource: "RolePermission", roleId: "11", permissionId: "100", revision: v1 }], updates: [["Role:11", { revision: v2 }], ["AppUser:2", { revision: v2, tokenVersion: "2" }]] },
  { label: "RolePermission revoke", delta: { operation: "ROLE_PERMISSION", targetId: "11", permissionId: "101", grant: false, expected }, ae: v2,
    removed: ["RolePermission:11:101"], updates: [["Role:11", { revision: v2 }], ["AppUser:2", { revision: v2, tokenVersion: "2" }]] },
  { label: "ACL replace", delta: { operation: "ACL_REPLACE", targetId: "30", roles: [{ roleId: "11", ...f }], users: [{ userId: "1", ...f }], expected }, ae: v2,
    removed: ["RoleACL:30:10", "UserACL:30:2"], added: [{ resource: "RoleACL", queryId: "30", roleId: "11", ...f, revision: v1 }, { resource: "UserACL", queryId: "30", userId: "1", ...f, revision: v1 }],
    updates: [["Dashboard:50", { revision: v2 }]] },
  { label: "delete User closed effects", delta: { operation: "DELETE_USER", targetId: "2", expected }, ae: v2,
    removed: ["AppUser:2", "UserRole:2:11", "UserACL:30:2"], updates: [["Dashboard:50", { revision: v2 }]] },
  { label: "managed Source rebind", delta: { operation: "SOURCE_REBIND", targetId: "60", queryId: "32", expected }, ae: v1,
    updates: [["ManagedSource:60", { queryId: "32", effectiveQueryDatasetId: "22", bindingRevision: v2, revision: v2 }], ["Dashboard:50", { revision: v2 }]] },
];
function key(n: MutationNodeV2) {
  if ("id" in n) return `${n.resource}:${n.id}`;
  return n.resource === "UserRole" ? `UserRole:${n.userId}:${n.roleId}` : n.resource === "RolePermission" ? `RolePermission:${n.roleId}:${n.permissionId}`
    : n.resource === "RoleACL" ? `RoleACL:${n.queryId}:${n.roleId}` : `UserACL:${n.queryId}:${n.userId}`;
}
function find(s: MutationStateV2, k: string) { const n = s.nodes.find(n => key(n) === k); if (!n) throw new Error("TEST_VECTOR_INVALID"); return n; }
function request(v = vectors[0]!): MutationRequestV2 {
  return { scope: "SYNTHETIC_TEST_ONLY", format: "MUTATION_REQUEST_V2", requestId: uuid(3),
    context: { ownerId: uuid(4), transactionId: uuid(5), gateId: uuid(6), actorId: "1", actorTokenVersion: "1" }, current: current(), delta: structuredClone(v.delta) };
}
function golden(v: Vector): MutationStateV2 {
  const s = current(); s.generation = v2; s.authorizationEpoch = v.ae;
  s.nodes = s.nodes.filter(n => !v.removed?.includes(key(n)));
  for (const [k, fields] of v.updates ?? []) Object.assign(find(s, k), fields);
  s.nodes.push(...structuredClone(v.added ?? [])); return s;
}
function prepared(r: MutationRequestV2) {
  const p = prepareSyntheticMutationV2(r); if (!("expected" in p)) throw new Error("TEST_PLAN_INVALID"); return p;
}
function subject(v = vectors[0]!) {
  const r = request(v), p = prepared(r), actual = golden(v);
  for (const n of actual.nodes) for (const [k, x] of Object.entries(n)) if (x === "$NEW") (n as unknown as Record<string, unknown>)[k] = allocated;
  const allocation: MutationAllocationV2 = { provenance: "SYNTHETIC_ALLOCATION_OBSERVATION", context: structuredClone(r.context),
    bindings: p.slots.map(s => ({ ...structuredClone(s), id: allocated })) };
  const observation: MutationObservationV2 = { provenance: "SYNTHETIC_POST_OBSERVATION", context: structuredClone(r.context),
    before: structuredClone(r.current), actual, acquired: structuredClone(p.reservations),
    cas: { generation: v1, targetRevision: v1, affectedRows: 1 },
    steps: ["GATE", "RESERVE_UNION", "REVALIDATE_CURRENT", "CAS", "MUTATE", "REVISIONS", "FINAL_OBSERVE", "COMMIT"], outcome: "MODEL_COMMITTED" };
  return { request: r, allocation, observation };
}
function restricted(r: { authority: string; runtimeBindVerified: boolean; deliveryAllowed: boolean; persistence: string; productionSafetyProven: boolean }) {
  assert.equal(r.authority, "NONE"); assert.equal(r.runtimeBindVerified, false); assert.equal(r.deliveryAllowed, false);
  assert.equal(r.persistence, "NOT_PROVEN"); assert.equal(r.productionSafetyProven, false); assert.equal(Object.isFrozen(r), true);
}
for (const v of vectors) test(`${v.label}: independently specified E and observed P are MODEL_CONSISTENT only`, () => {
  const p = prepared(request(v)), expected = golden(v);
  assert.deepEqual(new Map(p.expected.nodes.map(n => [key(n), n])), new Map(expected.nodes.map(n => [key(n), n])));
  assert.equal(p.expected.generation, expected.generation); assert.equal(p.expected.authorizationEpoch, expected.authorizationEpoch);
  const result = validateSyntheticMutationV2(subject(v)); assert.equal(result.classification, "MODEL_CONSISTENT"); restricted(result); restricted(p);
});
test("C is not mutated and reordered snapshots remain equivalent", () => {
  const s = subject(), before = structuredClone(s.request);
  prepareSyntheticMutationV2(s.request); assert.deepEqual(s.request, before);
  s.request.current.nodes.reverse(); s.observation.before.nodes.reverse(); s.observation.actual.nodes.reverse();
  assert.equal(validateSyntheticMutationV2(s).classification, "MODEL_CONSISTENT");
});
test("U retains deleted old ROW/composite scopes and newly empty predicates", () => {
  for (const v of [vectors[2]!, vectors[7]!, vectors[9]!, vectors[11]!]) {
    const p = prepared(request(v));
    assert.ok(p.reservations.some(r => r.kind === "RANGE" && r.predicate === "CATALOG"));
    for (const deleted of v.removed ?? []) {
      const n = find(current(), deleted);
      assert.ok(p.reservations.some(r => r.kind === "ROW" && r.resource === n.resource && `${r.resource}:${r.key.join(":")}` === deleted));
    }
    assert.ok(p.reservations.some(r => r.kind === "RANGE" && r.resource === "Parameter" && r.key.includes("20")));
  }
});
test("before/after Query and historical/effective Dataset closures are all reserved", () => {
  const p = prepared(request(vectors[12]!));
  for (const k of ["20", "21", "22"]) assert.ok(p.reservations.some(r => r.resource === "Dataset" && r.kind === "ROW" && r.key[0] === k));
  for (const field of ["storedHistoricalDatasetId", "effectiveQueryDatasetId"]) assert.ok(p.reservations.some(r => r.resource === "ManagedSource" && r.key.includes(field)));
  const source = find(p.expected, "ManagedSource:60"); assert.ok(source.resource === "ManagedSource");
  assert.equal(source.storedHistoricalDatasetId, "20"); assert.equal(source.effectiveQueryDatasetId, "22");
});
test("new symbolic entities reserve natural/composite keys and identity space before ROW", () => {
  for (const v of [vectors[1]!, vectors[4]!, vectors[5]!]) {
    const p = prepared(request(v)), slot = p.slots[0]!;
    assert.equal(slot.count, 1); assert.equal(slot.slot, "$NEW");
    assert.ok(p.reservations.some(r => r.kind === "NATURAL" && r.resource === slot.entity && JSON.stringify(r.key) === JSON.stringify(slot.naturalKey)));
    assert.ok(p.reservations.findIndex(r => r.resource === slot.entity && r.kind === "ENTITY_SPACE") < p.reservations.findIndex(r => r.resource === slot.entity && r.kind === "ROW"));
    assert.ok(p.expected.nodes.some(n => "id" in n && n.id === "$NEW"));
  }
});
test("BIGINT rows sort exactly, and ID assignment can be below old IDs only in the synthetic entity reservation", () => {
  const r = request(vectors[4]!);
  r.current.nodes.push(...["9007199254740994", "9007199254740992", "9007199254740993"].map(id => ({ resource: "Dataset" as const, id, revision: v1, active: true, archived: false })));
  const p = prepared(r);
  assert.deepEqual(p.reservations.filter(x => x.resource === "Dataset" && x.kind === "ROW").map(x => x.key[0]), ["20", "21", "22", "9007199254740992", "9007199254740993", "9007199254740994"]);
  const s = subject(vectors[4]!); s.allocation.bindings[0]!.id = "3";
  for (const n of s.observation.actual.nodes) for (const [k, x] of Object.entries(n)) if (x === allocated) (n as unknown as Record<string, unknown>)[k] = "3";
  assert.equal(validateSyntheticMutationV2(s).classification, "MODEL_CONSISTENT");
});
const illegalInputs: [string, (r: MutationRequestV2) => void][] = [
  ["caller E", r => { Object.assign(r, { expectedPostState: current() }); }],
  ["caller U", r => { Object.assign(r, { union: [] }); }],
  ["complete", r => { Object.assign(r, { complete: true }); }],
  ["unknown operation", r => { Object.assign(r.delta, { operation: "RAW_SQL" }); }],
  ["desired unknown field", r => { Object.assign(r.delta, { grantAll: true }); }],
  ["Number ID", r => { Object.assign(r.delta, { targetId: 9007199254740993 }); }],
  ["leading zero ID", r => { Object.assign(r.delta, { targetId: "030" }); }],
  ["overflow ID", r => { Object.assign(r.delta, { targetId: "9223372036854775808" }); }],
  ["guessed current slot", r => { Object.assign(r.current.nodes[0]!, { id: "$NEW" }); }],
  ["missing FK", r => { Object.assign(find(r.current, "Query:30"), { datasetId: "999" }); }],
  ["duplicate row", r => { r.current.nodes.push(structuredClone(r.current.nodes[0]!)); }],
  ["unknown retained FK", r => { r.current.retainedReferences.push({ kind: "OTHER_USER_FK", userId: "999", id: "1" }); }],
  ["unsafe natural codec", r => { r.delta = { operation: "CREATE_USER", username: "actual-user", roleIds: [], expected }; }],
  ["budget", r => { r.current.nodes = Array.from({ length: 97 }, (_, i) => ({ resource: "Dataset", id: `${i + 1}`, revision: v1, active: true, archived: false })); }],
];
for (const [label, mutate] of illegalInputs) test(`reject ${label} without accepting E/U authority`, () => {
  const r = request(); mutate(r); const result = prepareSyntheticMutationV2(r); assert.equal(result.classification, "MODEL_REJECTED"); restricted(result);
});
for (const domain of ["generation", "authorizationEpoch", "targetRevision"] as const) test(`CAS rejects stale ${domain}`, () => {
  const r = request(); r.delta.expected[domain] = v2;
  assert.equal(prepareSyntheticMutationV2(r).classification, "MODEL_REJECTED");
  const s = subject(); Object.assign(s.observation.cas, { [domain === "authorizationEpoch" ? "generation" : domain]: v2 });
  assert.equal(validateSyntheticMutationV2(s).classification, "MODEL_REJECTED");
});
const drifts: [string, (s: ReturnType<typeof subject>) => void][] = [
  ["new Dataset", s => { s.observation.actual.nodes.push({ resource: "Dataset", id: "99", revision: v1, active: true, archived: false }); }],
  ["new Query", s => { s.observation.actual.nodes.push({ resource: "Query", id: "99", revision: v1, datasetId: "20", active: true, archived: false, published: false, publishedByUserId: null }); }],
  ["new Role", s => { s.observation.actual.nodes.push({ resource: "Role", id: "99", revision: v1, code: "SYN_EXTRA", active: true, systemAdmin: false }); }],
  ["new ACL", s => { s.observation.actual.nodes.push({ resource: "UserACL", queryId: "32", userId: "2", ...f, revision: v1 }); }],
  ["removed untouched row", s => { s.observation.actual.nodes = s.observation.actual.nodes.filter(n => key(n) !== "Parameter:40"); }],
  ["undeclared side effect", s => { Object.assign(find(s.observation.actual, "Dataset:22"), { active: false }); }],
  ["old binding restored", s => { Object.assign(find(s.observation.actual, "Query:30"), { datasetId: "20" }); }],
  ["A to B to A version", s => { find(s.observation.actual, "Dataset:22").revision = "0000000000000003"; }],
  ["global epoch drift", s => { s.observation.actual.authorizationEpoch = "0000000000000003"; }],
  ["incarnation drift", s => { s.observation.actual.incarnation = uuid(99); }],
  ["before scope drift", s => { find(s.observation.before, "Dataset:22").revision = v2; }],
  ["missing range", s => { s.observation.acquired = s.observation.acquired.filter(r => r.kind !== "RANGE"); }],
  ["missing identity space", s => { s.observation.acquired = s.observation.acquired.filter(r => r.resource !== "Dataset"); }],
  ["missing AE guard", s => { s.observation.acquired = s.observation.acquired.slice(1); }],
  ["reordered reservation", s => { s.observation.acquired.reverse(); }],
  ["Owner mismatch", s => { s.observation.context.ownerId = uuid(55); }],
  ["transaction mismatch", s => { s.observation.context.transactionId = uuid(55); }],
  ["Gate mismatch", s => { s.observation.context.gateId = uuid(55); }],
  ["wrong order", s => { s.observation.steps.reverse(); }],
  ["CAS no row", s => { Object.assign(s.observation.cas, { affectedRows: 0 }); }],
];
for (const [label, mutate] of drifts) test(`independent observation rejects ${label}; P cannot repair E`, () => {
  const s = subject(); mutate(s); const result = validateSyntheticMutationV2(s); assert.equal(result.classification, "MODEL_REJECTED"); restricted(result);
});
test("tampered planner preview is never accepted as authoritative E", () => {
  const s = subject(), p = structuredClone(prepared(s.request));
  Object.assign(find(p.expected, "Dataset:22"), { active: false }); s.observation.actual = p.expected;
  assert.equal(validateSyntheticMutationV2(s).classification, "MODEL_REJECTED");
  Object.assign(s, { plan: p }); assert.equal(validateSyntheticMutationV2(s).classification, "MODEL_REJECTED");
});
const badSlots: [string, (s: ReturnType<typeof subject>) => void][] = [
  ["duplicate slot", s => { s.allocation.bindings.push(structuredClone(s.allocation.bindings[0]!)); }],
  ["missing slot", s => { s.allocation.bindings = []; }],
  ["wrong entity", s => { s.allocation.bindings[0]!.entity = "Role"; }],
  ["wrong parent", s => { s.allocation.bindings[0]!.parent = "20"; }],
  ["wrong natural key", s => { s.allocation.bindings[0]!.naturalKey = ["SYN_OTHER"]; }],
  ["wrong count", s => { Object.assign(s.allocation.bindings[0]!, { count: 2 }); }],
  ["extra FK", s => { s.allocation.bindings[0]!.allowedForeignKeys.push({ relation: "UserRole.roleId", key: ["Role", "10"] }); }],
  ["missing FK", s => { s.allocation.bindings[0]!.allowedForeignKeys = []; }],
  ["unsafe numeric binding", s => { Object.assign(s.allocation.bindings[0]!, { id: 9007199254740993 }); }],
  ["collision", s => { s.allocation.bindings[0]!.id = "2"; }],
  ["unobserved actual ID", s => { Object.assign(find(s.observation.actual, `AppUser:${allocated}`), { id: "77" }); }],
  ["allocation transaction", s => { s.allocation.context.transactionId = uuid(88); }],
  ["unreserved earlier identity stage", s => { s.observation.acquired = s.observation.acquired.filter(r => r.kind !== "ENTITY_SPACE"); }],
];
for (const [label, mutate] of badSlots) test(`symbolic binding rejects ${label}`, () => {
  const s = subject(vectors[4]!); mutate(s); const result = validateSyntheticMutationV2(s); assert.equal(result.classification, "MODEL_REJECTED"); restricted(result);
});
test("additional created row or FK not in the slot is rejected", () => {
  const s = subject(vectors[4]!);
  s.observation.actual.nodes.push({ resource: "UserRole", userId: allocated, roleId: "10", revision: v1 });
  assert.equal(validateSyntheticMutationV2(s).classification, "MODEL_REJECTED");
  const p = subject(vectors[4]!); p.observation.actual.nodes.push({ resource: "AppUser", id: "999", username: "SYN_UNDECLARED", active: true, tokenVersion: "1", revision: v1 });
  assert.equal(validateSyntheticMutationV2(p).classification, "MODEL_REJECTED");
});
test("historical Dataset is immutable even when it differs from effective Dataset", () => {
  const s = subject(vectors[12]!); assert.equal(validateSyntheticMutationV2(s).classification, "MODEL_CONSISTENT");
  Object.assign(find(s.observation.actual, "ManagedSource:60"), { storedHistoricalDatasetId: "22" });
  assert.equal(validateSyntheticMutationV2(s).classification, "MODEL_REJECTED");
});
const sourceGuards: [string, (r: MutationRequestV2) => void][] = [
  ["approval", r => { Object.assign(find(r.current, "ManagedSource:60"), { approvalPresent: true }); }],
  ["source in use", r => { Object.assign(find(r.current, "ManagedSource:60"), { referenced: true }); }],
  ["active dashboard", r => { Object.assign(find(r.current, "Dashboard:50"), { active: true }); }],
  ["QUERY_ONLY", r => { Object.assign(find(r.current, "Dashboard:50"), { mode: "QUERY_ONLY" }); }],
  ["legacy-only writer guard", r => { Object.assign(find(r.current, "Dashboard:50"), { management: "LEGACY_ONLY" }); }],
  ["pending conversion mismatch", r => { Object.assign(find(r.current, "ManagedSource:60"), { queryId: null, effectiveQueryDatasetId: null }); }],
  ["unpublished Query", r => { Object.assign(find(r.current, "Query:32"), { published: false }); }],
  ["Query ACL revoked", r => { r.current.nodes = r.current.nodes.filter(n => key(n) !== "RoleACL:32:10"); }],
];
for (const [label, mutate] of sourceGuards) test(`Source preserves ${label} refusal`, () => {
  const r = request(vectors[12]!); mutate(r); assert.equal(prepareSyntheticMutationV2(r).classification, "MODEL_REJECTED");
});
test("matching pending conversion is supported without replacing historical Dataset", () => {
  const r = request(vectors[12]!); Object.assign(find(r.current, "ManagedSource:60"), { queryId: null, effectiveQueryDatasetId: null, storedHistoricalDatasetId: "22" });
  const p = prepared(r); const source = find(p.expected, "ManagedSource:60"); assert.ok(source.resource === "ManagedSource"); assert.equal(source.storedHistoricalDatasetId, "22");
});
for (const kind of ["AUDIT", "DECISION", "VERSION_AUTHOR", "FAVORITE", "OTHER_USER_FK"] as const) test(`deleteUser BLOCKED for unmodelled ${kind} effects`, () => {
  const r = request(vectors[11]!); r.current.retainedReferences.push({ kind, userId: "2", id: "90" });
  const p = prepareSyntheticMutationV2(r); assert.equal(p.classification, "MODEL_REJECTED"); if ("reason" in p) assert.equal(p.reason, "DELETE_SIDE_EFFECTS_BLOCKED");
});
test("deleteUser cannot hide published Query or Dashboard owner references", () => {
  for (const [k, field] of [["Query:31", "publishedByUserId"], ["Dashboard:50", "creatorId"]]) {
    const r = request(vectors[11]!); Object.assign(find(r.current, k!), { [field!]: "2" }); assert.equal(prepareSyntheticMutationV2(r).classification, "MODEL_REJECTED");
  }
});
test("SYSTEM_ADMIN, last-admin and self revocation remain fail closed", () => {
  const r = request(vectors[8]!); r.delta = { operation: "ROLE_PERMISSION", targetId: "10", permissionId: "100", grant: false, expected };
  assert.equal(prepareSyntheticMutationV2(r).classification, "MODEL_REJECTED");
  r.delta = { operation: "DELETE_USER", targetId: "1", expected }; assert.equal(prepareSyntheticMutationV2(r).classification, "MODEL_REJECTED");
  r.delta = { operation: "USER_ROLE", targetId: "1", roleId: "10", grant: false, expected }; assert.equal(prepareSyntheticMutationV2(r).classification, "MODEL_REJECTED");
  const c = request(); c.current.nodes = c.current.nodes.filter(n => key(n) !== "UserRole:1:10"); assert.equal(prepareSyntheticMutationV2(c).classification, "MODEL_REJECTED");
});
test("lookup cycles, no-op, duplicate ACL and revision/token overflow reject", () => {
  const r = request(vectors[3]!); r.delta = { operation: "PARAMETER_LOOKUP", targetId: "40", lookupDatasetId: "20", expected };
  assert.equal(prepareSyntheticMutationV2(r).classification, "MODEL_REJECTED");
  r.delta = { operation: "QUERY_REBIND", targetId: "30", datasetId: "20", expected }; assert.equal(prepareSyntheticMutationV2(r).classification, "MODEL_REJECTED");
  const a = request(vectors[10]!); if (a.delta.operation === "ACL_REPLACE") a.delta.roles.push(structuredClone(a.delta.roles[0]!));
  assert.equal(prepareSyntheticMutationV2(a).classification, "MODEL_REJECTED");
  const o = request(); o.current.generation = "ffffffffffffffff"; o.delta.expected.generation = "ffffffffffffffff";
  assert.equal(prepareSyntheticMutationV2(o).classification, "MODEL_REJECTED");
  const t = request(vectors[6]!); Object.assign(find(t.current, "AppUser:2"), { tokenVersion: "9223372036854775807" }); assert.equal(prepareSyntheticMutationV2(t).classification, "MODEL_REJECTED");
});
for (const outcome of ["COMMIT_UNKNOWN", "ROLLBACK_FAILED"] as const) test(`${outcome} never becomes production or model success`, () => {
  const s = subject(); s.observation.outcome = outcome;
  const p = validateSyntheticMutationV2(s); assert.equal(p.classification, "MODEL_REJECTED"); restricted(p);
});
test("both applied and unapplied commit unknown reject; unchanged P is no rollback proof", () => {
  for (const applied of [true, false]) {
    const s = subject(); s.observation.outcome = "COMMIT_UNKNOWN";
    if (!applied) s.observation.actual = structuredClone(s.request.current);
    const p = validateSyntheticMutationV2(s); assert.equal(p.classification, "MODEL_REJECTED"); assert.equal(p.reason, "COMMIT_UNKNOWN"); restricted(p);
  }
});
test("unsafe getters/proxies/hooks never execute; errors never echo sensitive input", () => {
  let called = 0;
  const accessor = Object.defineProperty({}, "scope", { enumerable: true, get() { called++; throw new Error("SYNTHETIC_SECRET"); } });
  const proxy = new Proxy({}, { ownKeys() { called++; throw new Error("SYNTHETIC_SECRET"); } });
  const hidden = Object.defineProperty(request(), "hidden", { value: "SYNTHETIC_SECRET" });
  const symbol = Object.assign(request(), { [Symbol("hidden")]: "SYNTHETIC_SECRET" });
  const hook = Object.assign(request(), { toJSON() { called++; throw new Error("SYNTHETIC_SECRET"); } });
  const payload = Object.assign(request(), { sql: "SYNTHETIC_SQL", credentials: "SYNTHETIC_SECRET", patient: "SYNTHETIC_PATIENT" });
  for (const input of [accessor, proxy, hidden, symbol, hook, payload, Object.assign(Object.create({}), request())]) {
    const a = prepareSyntheticMutationV2(input), b = validateSyntheticMutationV2(input);
    for (const p of [a, b]) { assert.equal(p.classification, "MODEL_REJECTED"); assert.equal(/SYNTHETIC_(SQL|SECRET|PATIENT)/.test(JSON.stringify(p)), false); }
  }
  assert.equal(called, 0);
});
test("cyclic graphs and sparse/extra-property arrays fail safely", () => {
  const r = request(); Object.assign(r.current, { cycle: r }); assert.equal(prepareSyntheticMutationV2(r).classification, "MODEL_REJECTED");
  for (const nodes of [new Array(1), Object.assign([], { extra: true })]) {
    const r = request(); r.current.nodes = nodes; assert.equal(prepareSyntheticMutationV2(r).classification, "MODEL_REJECTED");
  }
});
