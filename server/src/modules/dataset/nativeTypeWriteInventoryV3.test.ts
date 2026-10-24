import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { prepareSyntheticMutationV2, type MutationRequestV2, type MutationStateV2, type MutationNodeV2,
  type MutationDeltaV2, type MutationAllocationV2, type MutationObservationV2 } from "./nativeTypeMutationReservationV2.js";
import { prepareSyntheticWriteInventoryV3, validateSyntheticWriteInventoryV3, type SyntheticWriteEventV3,
  type SyntheticRevisionReceiptV3, type SyntheticWriteObservationV3, type SyntheticRevisionObservationV3 } from "./nativeTypeWriteInventoryV3.js";

const r1 = "0000000000000001", r2 = "0000000000000002", large = "9007199254740993";
const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const flags = { canView: true, canExecute: true, canExport: false };
const expected = { generation: r1, authorizationEpoch: r1, targetRevision: r1 };
type Resource = SyntheticWriteEventV3["resource"];
type Fields = [string, SyntheticRevisionReceiptV3["domain"]][];
type Spec = { resource: Resource; action: SyntheticWriteEventV3["action"]; key: string[];
  columns?: SyntheticWriteEventV3["columns"]; fields: Fields; effect: SyntheticWriteEventV3["effect"];
  predicate?: { field: "queryId" | "userId"; id: string } };
const w = (resource: Resource, action: Spec["action"], key: string[], fields: Fields, columns?: Spec["columns"], effect: Spec["effect"] = "PRIMARY"): Spec =>
  ({ resource, action, key, fields, columns, effect });
const qfields: Fields = [["revision", "Q"]], rowfields: Fields = [["revision", "MODEL_ROW"]];
const userfields: Fields = [["revision", "MODEL_ROW"], ["tokenVersion", "TOKEN_VERSION"]];
const dash = () => w("Dashboard", "UPDATE", ["50"], [["revision", "DASHBOARD_APPROVAL"]], ["revision"], "DECLARED_SIDE_EFFECT");
const batch = (resource: Resource, field: "queryId" | "userId", id: string): Spec => ({ ...w(resource, "DELETE", [], rowfields), predicate: { field, id } });
const qcols: Spec["columns"] = ["published", "publishedByUserId", "revision"];
function current(): MutationStateV2 {
  return { format: "SYNTHETIC_STATE_V2", domainId: uuid(1), incarnation: uuid(2), generation: r1, authorizationEpoch: r1, retainedReferences: [], nodes: [
    ...["20", "21", "22"].map(id => ({ resource: "Dataset" as const, id, revision: r1, active: true, archived: false })),
    ...[["30", "20"], ["31", "21"], ["32", "22"]].map(([id, datasetId]) => ({ resource: "Query" as const, id: id!, datasetId: datasetId!, revision: r1,
      active: true, archived: false, published: true, publishedByUserId: "1" })),
    { resource: "Parameter", id: "40", revision: r1, datasetId: "20", name: "SYN_P", lookupDatasetId: "21" },
    ...[["1", "SYN_OWNER"], ["2", "SYN_USER"]].map(([id, username]) => ({ resource: "AppUser" as const, id: id!, username: username!, revision: r1, tokenVersion: "1", active: true })),
    { resource: "Role", id: "10", code: "SYN_ADMIN", revision: r1, active: true, systemAdmin: true },
    { resource: "Role", id: "11", code: "SYN_ROLE", revision: r1, active: true, systemAdmin: false },
    { resource: "Permission", id: "100", code: "MODEL_ADMIN", revision: r1 }, { resource: "Permission", id: "101", code: "MODEL_DESIGN", revision: r1 },
    { resource: "UserRole", userId: "1", roleId: "10", revision: r1 }, { resource: "UserRole", userId: "2", roleId: "11", revision: r1 },
    { resource: "RolePermission", roleId: "10", permissionId: "100", revision: r1 }, { resource: "RolePermission", roleId: "10", permissionId: "101", revision: r1 },
    { resource: "RolePermission", roleId: "11", permissionId: "101", revision: r1 },
    ...["30", "31", "32"].map(queryId => ({ resource: "RoleACL" as const, queryId, roleId: "10", ...flags, revision: r1 })),
    { resource: "UserACL", queryId: "30", userId: "2", ...flags, revision: r1 },
    { resource: "Dashboard", id: "50", revision: r1, queryId: "30", creatorId: "1", active: false, mode: "LEGACY", management: "MANAGED", approvalPresent: false },
    { resource: "ManagedSource", id: "60", revision: r1, dashboardId: "50", sourceKey: "SYN_EXTRA", storedHistoricalDatasetId: "20", effectiveQueryDatasetId: "21",
      queryId: "31", approvalPresent: false, referenced: false, bindingRevision: r1 },
  ] };
}
function identity(n: Record<string, unknown>): string[] {
  return "id" in n ? [n.id as string] : n.resource === "UserRole" ? [n.userId as string, n.roleId as string]
    : n.resource === "RolePermission" ? [n.roleId as string, n.permissionId as string]
    : [n.queryId as string, (n.resource === "RoleACL" ? n.roleId : n.userId) as string];
}
function edit(s: MutationStateV2, kind: string, ids: string[], changes: Record<string, unknown>) {
  const n = s.nodes.find(n => n.resource === kind && JSON.stringify(identity(n)) === JSON.stringify(ids));
  if (!n) throw new Error("INVALID_GOLDEN_FIXTURE"); Object.assign(n, changes);
}
function del(s: MutationStateV2, kind: string, ids: string[]) { s.nodes = s.nodes.filter(n => !(n.resource === kind && JSON.stringify(identity(n)) === JSON.stringify(ids))); }
type Case = { label: string; delta: MutationDeltaV2; ae: string; post: (s: MutationStateV2) => void; writes: Spec[] };
const unpublish = { published: false, publishedByUserId: null, revision: r2 };
const paramEffects = [w("Dataset", "UPDATE", ["20"], [["revision", "D"]], ["revision"], "DECLARED_SIDE_EFFECT"),
  w("Query", "UPDATE", ["30"], qfields, qcols, "DECLARED_SIDE_EFFECT")];
// Golden post-state changes AND event specs authored independently of the V3 planner.
const cases: Case[] = [
  { label: "Query rebind", delta: { operation: "QUERY_REBIND", targetId: "31", datasetId: "22", expected }, ae: r2,
    post(s) { edit(s, "Query", ["31"], { ...unpublish, datasetId: "22" }); edit(s, "ManagedSource", ["60"], { effectiveQueryDatasetId: "22" }); },
    writes: [w("Query", "UPDATE", ["31"], qfields, ["datasetId", ...qcols])] },
  { label: "Parameter add", delta: { operation: "PARAMETER_ADD", targetId: "20", name: "SYN_NEW", lookupDatasetId: "22", expected }, ae: r1,
    post(s) { s.nodes.push({ resource: "Parameter", id: large, revision: r1, datasetId: "20", name: "SYN_NEW", lookupDatasetId: "22" }); edit(s, "Dataset", ["20"], { revision: r2 }); edit(s, "Query", ["30"], unpublish); },
    writes: [w("Parameter", "INSERT", [large], rowfields), ...paramEffects] },
  { label: "Parameter delete", delta: { operation: "PARAMETER_DELETE", targetId: "40", expected }, ae: r1,
    post(s) { del(s, "Parameter", ["40"]); edit(s, "Dataset", ["20"], { revision: r2 }); edit(s, "Query", ["30"], unpublish); },
    writes: [w("Parameter", "DELETE", ["40"], rowfields), ...paramEffects] },
  { label: "Parameter lookup", delta: { operation: "PARAMETER_LOOKUP", targetId: "40", lookupDatasetId: "22", expected }, ae: r1,
    post(s) { edit(s, "Parameter", ["40"], { lookupDatasetId: "22", revision: r2 }); edit(s, "Dataset", ["20"], { revision: r2 }); edit(s, "Query", ["30"], unpublish); },
    writes: [w("Parameter", "UPDATE", ["40"], rowfields, ["lookupDatasetId", "revision"]), ...paramEffects] },
  { label: "Create User", delta: { operation: "CREATE_USER", username: "SYN_NEW_USER", roleIds: ["11"], expected }, ae: r2,
    post(s) { s.nodes.push({ resource: "AppUser", id: large, username: "SYN_NEW_USER", revision: r1, tokenVersion: "1", active: true }, { resource: "UserRole", userId: large, roleId: "11", revision: r1 }); },
    writes: [w("AppUser", "INSERT", [large], userfields), w("UserRole", "INSERT", [large, "11"], rowfields, undefined, "DECLARED_SIDE_EFFECT")] },
  { label: "Create Role", delta: { operation: "CREATE_ROLE", code: "SYN_NEW_ROLE", permissionIds: ["101"], expected }, ae: r2,
    post(s) { s.nodes.push({ resource: "Role", id: large, code: "SYN_NEW_ROLE", revision: r1, active: true, systemAdmin: false }, { resource: "RolePermission", roleId: large, permissionId: "101", revision: r1 }); },
    writes: [w("Role", "INSERT", [large], rowfields), w("RolePermission", "INSERT", [large, "101"], rowfields, undefined, "DECLARED_SIDE_EFFECT")] },
  ...[true, false].map(grant => ({ label: `UserRole ${grant ? "grant" : "revoke"}`, delta: { operation: "USER_ROLE", targetId: "2", roleId: grant ? "10" : "11", grant, expected } as MutationDeltaV2, ae: r2,
    post(s: MutationStateV2) { if (grant) s.nodes.push({ resource: "UserRole", userId: "2", roleId: "10", revision: r1 }); else del(s, "UserRole", ["2", "11"]); edit(s, "AppUser", ["2"], { tokenVersion: "2", revision: r2 }); },
    writes: [w("UserRole", grant ? "INSERT" : "DELETE", ["2", grant ? "10" : "11"], rowfields), w("AppUser", "UPDATE", ["2"], userfields, ["tokenVersion", "revision"], "DECLARED_SIDE_EFFECT")] })),
  ...[true, false].map(grant => ({ label: `RolePermission ${grant ? "grant" : "revoke"}`, delta: { operation: "ROLE_PERMISSION", targetId: "11", permissionId: grant ? "100" : "101", grant, expected } as MutationDeltaV2, ae: r2,
    post(s: MutationStateV2) { if (grant) s.nodes.push({ resource: "RolePermission", roleId: "11", permissionId: "100", revision: r1 }); else del(s, "RolePermission", ["11", "101"]); edit(s, "Role", ["11"], { revision: r2 }); edit(s, "AppUser", ["2"], { tokenVersion: "2", revision: r2 }); },
    writes: [w("Role", "UPDATE", ["11"], rowfields, ["revision"]), w("RolePermission", grant ? "INSERT" : "DELETE", ["11", grant ? "100" : "101"], rowfields), w("AppUser", "UPDATE", ["2"], userfields, ["tokenVersion", "revision"], "DECLARED_SIDE_EFFECT")] })),
  { label: "ACL rewrite unchanged grants", delta: { operation: "ACL_REPLACE", targetId: "30", roles: [{ roleId: "10", ...flags }], users: [{ userId: "2", ...flags }], expected }, ae: r2,
    post(s) { edit(s, "RoleACL", ["30", "10"], { revision: r2 }); edit(s, "UserACL", ["30", "2"], { revision: r2 }); edit(s, "Dashboard", ["50"], { revision: r2 }); },
    writes: [dash(), batch("RoleACL", "queryId", "30"), batch("UserACL", "queryId", "30"), w("RoleACL", "INSERT", ["30", "10"], rowfields), w("UserACL", "INSERT", ["30", "2"], rowfields)] },
  { label: "Delete User", delta: { operation: "DELETE_USER", targetId: "2", expected }, ae: r2,
    post(s) { del(s, "UserACL", ["30", "2"]); del(s, "UserRole", ["2", "11"]); del(s, "AppUser", ["2"]); edit(s, "Dashboard", ["50"], { revision: r2 }); },
    writes: [dash(), batch("UserACL", "userId", "2"), batch("UserRole", "userId", "2"), w("AppUser", "DELETE", ["2"], userfields)] },
  { label: "Source rebind", delta: { operation: "SOURCE_REBIND", targetId: "60", queryId: "32", expected }, ae: r1,
    post(s) { edit(s, "ManagedSource", ["60"], { queryId: "32", effectiveQueryDatasetId: "22", revision: r2, bindingRevision: r2 }); edit(s, "Dashboard", ["50"], { revision: r2 }); },
    writes: [w("ManagedSource", "UPDATE", ["60"], [["revision", "MODEL_ROW"], ["bindingRevision", "DASHBOARD_BINDING"]], ["queryId", "bindingRevision", "revision"]), dash()] },
];
function stable(x: unknown): string {
  return JSON.stringify(x, (_k, v: unknown) => v && typeof v === "object" && !Array.isArray(v)
    ? Object.fromEntries(Object.keys(v).sort().map(k => [k, (v as Record<string, unknown>)[k]])) : v);
}
function hash(x: unknown) { return { format: "SYNTHETIC_MODEL_IMAGE_SHA256_V1" as const, digest: createHash("sha256").update(stable(x)).digest("hex") }; }
function fixture(c = cases[0]!, setup?: (s: MutationStateV2) => void) {
  const mutation: MutationRequestV2 = { scope: "SYNTHETIC_TEST_ONLY", format: "MUTATION_REQUEST_V2", requestId: uuid(3),
    context: { ownerId: uuid(4), transactionId: uuid(5), gateId: uuid(6), actorId: "1", actorTokenVersion: "1" }, current: current(), delta: structuredClone(c.delta) };
  setup?.(mutation.current);
  const actual = structuredClone(mutation.current); actual.generation = r2; actual.authorizationEpoch = c.ae; c.post(actual);
  const p = prepareSyntheticMutationV2(mutation); if (!("expected" in p)) throw new Error("INVALID_GOLDEN_FIXTURE");
  const allocation: MutationAllocationV2 = { provenance: "SYNTHETIC_ALLOCATION_OBSERVATION", context: structuredClone(mutation.context), bindings: p.slots.map(s => ({ ...structuredClone(s), id: large })) };
  const post: MutationObservationV2 = { provenance: "SYNTHETIC_POST_OBSERVATION", context: structuredClone(mutation.context), before: structuredClone(mutation.current), actual,
    acquired: structuredClone(p.reservations), cas: { generation: r1, targetRevision: r1, affectedRows: 1 },
    steps: ["GATE", "RESERVE_UNION", "REVALIDATE_CURRENT", "CAS", "MUTATE", "REVISIONS", "FINAL_OBSERVE", "COMMIT"], outcome: "MODEL_COMMITTED" };
  const context = { requestId: mutation.requestId, ownerId: uuid(4), transactionId: uuid(5), domainId: uuid(1), incarnation: uuid(2) };
  const events: SyntheticWriteEventV3[] = [], receipts: SyntheticRevisionReceiptV3[] = [];
  const specs = [...c.writes, ...(c.ae === r2 ? [w("AuthorizationEpoch", "UPDATE", ["1"], [["revision", "AE"]], ["revision"], "REVISION_ONLY")] : []),
    w("Generation", "UPDATE", ["1"], [["revision", "MODEL_GENERATION"]], ["revision"], "REVISION_ONLY"), w("AuditIntent", "INSERT", ["1"], [], undefined, "AUDIT_INTENT")];
  for (const spec of specs) {
    function read(s: MutationStateV2) {
      if (spec.resource === "AuthorizationEpoch") return [{ id: "1", revision: s.authorizationEpoch }];
      if (spec.resource === "Generation") return [{ id: "1", revision: s.generation }];
      if (spec.resource === "AuditIntent") return [{ id: "1", requestId: mutation.requestId, actorId: "1", operation: mutation.delta.operation, eventStatus: "MODEL_COMMITTED" }];
      return s.nodes.filter(n => n.resource === spec.resource && (spec.predicate ? (n as unknown as Record<string, unknown>)[spec.predicate.field] === spec.predicate.id
        : JSON.stringify(identity(n)) === JSON.stringify(spec.key))).sort((a, b) => {
        const left = identity(a), right = identity(b);
        for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) return BigInt(left[i]!) < BigInt(right[i]!) ? -1 : 1;
        return 0;
      }).map(n => Object.fromEntries(Object.entries(n).filter(([k]) => k !== "resource" && k !== "effectiveQueryDatasetId")));
    }
    const before = spec.action === "INSERT" ? [] : read(mutation.current), after = spec.action === "DELETE" ? [] : read(actual);
    const getKey = (n: Record<string, unknown>) => identity({ ...n, resource: spec.resource });
    const cols = spec.columns ?? Object.keys(before[0] ?? after[0] ?? { queryId: null,
      [spec.resource === "RoleACL" ? "roleId" : "userId"]: null, canView: null, canExecute: null, canExport: null, revision: null });
    const event: SyntheticWriteEventV3 = { eventId: (BigInt(events.length) + 1n).toString(), context, writerOperation: mutation.delta.operation,
      eventType: spec.resource === "AuditIntent" ? "AUDIT_INTENT" : "ROW_WRITE", resource: spec.resource, tableType: `MODEL_${spec.resource}`, action: spec.action,
      identity: { rows: (spec.action === "INSERT" ? after : before).map(getKey), predicate: spec.predicate ?? null }, columns: [...cols].sort() as SyntheticWriteEventV3["columns"],
      beforeImage: hash(before), afterImage: hash(after), affectedRows: spec.action === "DELETE" ? before.length : 1,
      revisionDomains: spec.fields.map(([, domain]) => domain), effect: spec.effect };
    events.push(event);
    for (const n of spec.action === "DELETE" ? before : after) for (const [field, domain] of spec.fields) receipts.push({
      format: "SYNTHETIC_REVISION_RECEIPT_V1", receiptId: (BigInt(receipts.length) + 1n).toString(), origin: "SYNTHETIC_COUNTER_V1", context,
      writerOperation: mutation.delta.operation, domain, entity: { resource: spec.resource, identity: getKey(n) },
      beforeRevision: (before.find(b => JSON.stringify(getKey(b)) === JSON.stringify(getKey(n)))?.[field] as string | undefined) ?? null,
      afterRevision: (after.find(b => JSON.stringify(getKey(b)) === JSON.stringify(getKey(n)))?.[field] as string | undefined) ?? null, affectedRows: 1, eventIds: [event.eventId] });
  }
  const eventObservation: SyntheticWriteObservationV3 = { format: "SYNTHETIC_WRITE_EVENT_OBSERVATION_V1", provenance: "SYNTHETIC_TEST_ONLY", context, events };
  const revisionObservation: SyntheticRevisionObservationV3 = { format: "SYNTHETIC_REVISION_OBSERVATION_V1", provenance: "SYNTHETIC_TEST_ONLY", context, receipts };
  // Detached observations; the expected inventory is never used to construct these fixtures.
  return structuredClone({ scope: "SYNTHETIC_TEST_ONLY" as const, mutation, allocation, post, eventObservation, revisionObservation });
}
function restricted(p: ReturnType<typeof validateSyntheticWriteInventoryV3>) {
  assert.equal(p.authority, "NONE"); assert.equal(p.deliveryAllowed, false); assert.equal(p.runtimeBindVerified, false);
  assert.equal(p.persistence, "NOT_PROVEN"); assert.equal(p.productionSafetyProven, false); assert.equal(Object.isFrozen(p), true);
}
for (const c of cases) test(`${c.label}: independent operation inventory, observation and receipts agree only in model`, () => {
  const s = fixture(c), p = prepareSyntheticWriteInventoryV3(s.mutation);
  assert.equal(p.classification, "MODEL_CONSISTENT"); const result = validateSyntheticWriteInventoryV3(s);
  assert.equal(result.classification, "MODEL_CONSISTENT"); restricted(result);
  if ("inventory" in p && !s.allocation.bindings.length) {
    assert.deepEqual(p.inventory, s.eventObservation.events); assert.deepEqual(p.receipts, s.revisionObservation.receipts);
  }
});
type Subject = ReturnType<typeof fixture>;
const invalid: [string, (s: Subject) => void][] = [
  ["missing event", s => { s.eventObservation.events.shift(); }],
  ["duplicate same-row UPDATE", s => { s.eventObservation.events.splice(1, 0, structuredClone(s.eventObservation.events[0]!)); }],
  ["wrong action DELETE plus INSERT", s => { s.eventObservation.events[0]!.action = "DELETE"; s.eventObservation.events.splice(1, 0, { ...structuredClone(s.eventObservation.events[0]!), action: "INSERT" }); }],
  ["missing column", s => { s.eventObservation.events[0]!.columns.pop(); }],
  ["extra allowed column", s => { s.eventObservation.events[0]!.columns.push("active"); }],
  ["unknown column", s => { Object.assign(s.eventObservation.events[0]!, { columns: ["SQL_TEXT"] }); }],
  ["unknown field", s => { Object.assign(s.eventObservation.events[0]!, { complete: true }); }],
  ["wrong before digest", s => { s.eventObservation.events[0]!.beforeImage.digest = "f".repeat(64); }],
  ["wrong after digest", s => { s.eventObservation.events[0]!.afterImage.digest = "f".repeat(64); }],
  ["affectedRows zero", s => { s.eventObservation.events[0]!.affectedRows = 0; }],
  ["affectedRows multiple", s => { s.eventObservation.events[0]!.affectedRows = 2; }],
  ["event order", s => { s.eventObservation.events.reverse(); }],
  ["event Owner", s => { s.eventObservation.events[0]!.context = { ...s.eventObservation.events[0]!.context, ownerId: uuid(99) }; }],
  ["event Transaction", s => { s.eventObservation.events[0]!.context = { ...s.eventObservation.events[0]!.context, transactionId: uuid(99) }; }],
  ["event request", s => { s.eventObservation.events[0]!.context = { ...s.eventObservation.events[0]!.context, requestId: uuid(99) }; }],
  ["numeric identity", s => { Object.assign(s.eventObservation.events[0]!.identity, { rows: [[9007199254740993]] }); }],
  ["unsafe receipt identity", s => { Object.assign(s.revisionObservation.receipts[0]!.entity, { identity: [Number(large)] }); }],
  ["receipt Owner", s => { s.revisionObservation.receipts[0]!.context = { ...s.revisionObservation.receipts[0]!.context, ownerId: uuid(99) }; }],
  ["receipt Transaction", s => { s.revisionObservation.receipts[0]!.context = { ...s.revisionObservation.receipts[0]!.context, transactionId: uuid(99) }; }],
  ["receipt event link", s => { s.revisionObservation.receipts[0]!.eventIds = ["99"]; }],
  ["receipt affectedRows", s => { Object.assign(s.revisionObservation.receipts[0]!, { affectedRows: 2 }); }],
  ["missing receipt", s => { s.revisionObservation.receipts.pop(); }],
  ["extra receipt", s => { s.revisionObservation.receipts.push(structuredClone(s.revisionObservation.receipts[0]!)); }],
  ["revision rollback", s => { s.revisionObservation.receipts[0]!.afterRevision = r1; }],
  ["revision ABA", s => { s.revisionObservation.receipts[0]!.afterRevision = "0000000000000003"; }],
  ["revision overflow", s => { s.revisionObservation.receipts[0]!.afterRevision = "10000000000000000"; }],
  ["DB-generated claim", s => { Object.assign(s.revisionObservation.receipts[0]!, { origin: "DB_GENERATED" }); }],
  ["Audit receipt substitution", s => { Object.assign(s.revisionObservation.receipts[0]!, { auditId: large }); }],
  ["wrong observation version", s => { Object.assign(s.eventObservation, { format: "SYNTHETIC_WRITE_EVENT_OBSERVATION_V2" }); }],
  ["unknown production provenance", s => { Object.assign(s.eventObservation, { provenance: "TRUSTED_SQL_COLLECTOR" }); }],
  ["extra Audit side effect", s => { s.eventObservation.events.push({ ...structuredClone(s.eventObservation.events.at(-1)!), eventId: "99" }); }],
  ["missing Audit intent", s => { s.eventObservation.events.pop(); }],
  ["unknown Receipt field", s => { Object.assign(s.revisionObservation.receipts[0]!, { durable: true }); }],
];
for (const [label, mutate] of invalid) test(`reject ${label} with unchanged expected P`, () => {
  const s = fixture(); mutate(s); const result = validateSyntheticWriteInventoryV3(s); assert.equal(result.classification, "MODEL_REJECTED"); restricted(result);
});
for (const domain of ["AE", "Q", "D", "S", "TOKEN_VERSION", "DASHBOARD_BINDING", "DASHBOARD_APPROVAL", "MODEL_GENERATION"] as const)
  test(`receipt domain ${domain} cannot replace MODEL_ROW/other domain`, () => {
    const s = fixture(cases[1]!); s.revisionObservation.receipts[0]!.domain = domain;
    assert.equal(validateSyntheticWriteInventoryV3(s).classification, "MODEL_REJECTED");
  });
test("unchanged ACL permission content still requires DELETE/INSERT; UPDATE disguise and no-op omit fail", () => {
  const s = fixture(cases[10]!); const original = structuredClone(s);
  s.eventObservation.events = s.eventObservation.events.filter(e => !(e.resource === "RoleACL" || e.resource === "UserACL"));
  assert.equal(validateSyntheticWriteInventoryV3(s).classification, "MODEL_REJECTED");
  const disguised = structuredClone(original); disguised.eventObservation.events[1]!.action = "UPDATE";
  assert.equal(validateSyntheticWriteInventoryV3(disguised).classification, "MODEL_REJECTED");
});
test("extra net-zero A to B to A and same-image UPDATE fail even when P stays E", () => {
  const s = fixture(); const event = structuredClone(s.eventObservation.events[0]!);
  event.beforeImage = event.afterImage; event.afterImage = hash([{ id: "31", datasetId: "20" }]);
  s.eventObservation.events.splice(1, 0, event, { ...structuredClone(event), beforeImage: event.afterImage, afterImage: event.beforeImage });
  assert.equal(validateSyntheticWriteInventoryV3(s).classification, "MODEL_REJECTED");
  const noOp = fixture(); const extra = structuredClone(noOp.eventObservation.events[0]!); extra.beforeImage = extra.afterImage;
  noOp.eventObservation.events.push(extra); assert.equal(validateSyntheticWriteInventoryV3(noOp).classification, "MODEL_REJECTED");
});
test("C=P plus extra writes never passes; legal unchanged SET fields are still inventoried", () => {
  const s = fixture(); s.post.actual = structuredClone(s.mutation.current);
  assert.equal(validateSyntheticWriteInventoryV3(s).classification, "MODEL_REJECTED");
  const unchanged = fixture(cases[0]!, c => edit(c, "Query", ["31"], { published: false, publishedByUserId: null }));
  assert.equal(validateSyntheticWriteInventoryV3(unchanged).classification, "MODEL_CONSISTENT");
  assert.ok(unchanged.eventObservation.events[0]!.columns.includes("published"));
});
test("empty DELETE requires its zero-row event; exact multi-row DELETE count is allowed", () => {
  const clear: Case = { label: "Clear ACL", delta: { operation: "ACL_REPLACE", targetId: "30", roles: [], users: [], expected }, ae: r2,
    post(s) { s.nodes = s.nodes.filter(n => !((n.resource === "UserACL" || n.resource === "RoleACL") && n.queryId === "30")); edit(s, "Dashboard", ["50"], { revision: r2 }); },
    writes: [dash(), batch("RoleACL", "queryId", "30"), batch("UserACL", "queryId", "30")] };
  const empty = fixture(clear, c => { c.nodes = c.nodes.filter(n => !((n.resource === "RoleACL" || n.resource === "UserACL") && n.queryId === "30")); });
  assert.equal(empty.eventObservation.events[1]!.affectedRows, 0); assert.equal(empty.eventObservation.events[2]!.affectedRows, 0);
  assert.equal(validateSyntheticWriteInventoryV3(empty).classification, "MODEL_CONSISTENT");
  empty.eventObservation.events[1]!.affectedRows = 1; assert.equal(validateSyntheticWriteInventoryV3(empty).classification, "MODEL_REJECTED");
  const many = fixture(clear, c => { c.nodes.push({ resource: "UserACL", queryId: "30", userId: "1", ...flags, revision: r1 }); });
  assert.equal(many.eventObservation.events[2]!.affectedRows, 2); assert.equal(validateSyntheticWriteInventoryV3(many).classification, "MODEL_CONSISTENT");
});
for (const outcome of ["COMMIT_UNKNOWN", "ROLLBACK_FAILED"] as const) test(`${outcome} has no persistence inference`, () => {
  const s = fixture(); s.post.outcome = outcome; const result = validateSyntheticWriteInventoryV3(s);
  assert.equal(result.classification, "MODEL_REJECTED"); restricted(result);
});
test("derived effective Dataset is no stored write; history is absent from UPDATE columns", () => {
  const query = prepareSyntheticWriteInventoryV3(fixture().mutation); assert.ok("inventory" in query);
  assert.equal(query.inventory.some(e => e.resource === "ManagedSource"), false);
  const source = prepareSyntheticWriteInventoryV3(fixture(cases[12]!).mutation); assert.ok("inventory" in source);
  assert.deepEqual(source.inventory[0]!.columns, ["bindingRevision", "queryId", "revision"]);
});
test("symbolic slots and >2^53 bound receipts remain exact", () => {
  const s = fixture(cases[4]!), p = prepareSyntheticWriteInventoryV3(s.mutation); assert.ok("inventory" in p);
  assert.deepEqual(p.inventory[0]!.identity.rows, [["$NEW"]]);
  assert.equal(s.revisionObservation.receipts[0]!.entity.identity[0], large);
  assert.equal(validateSyntheticWriteInventoryV3(s).classification, "MODEL_CONSISTENT");
  s.revisionObservation.receipts[0]!.entity.identity[0] = "9007199254740992";
  assert.equal(validateSyntheticWriteInventoryV3(s).classification, "MODEL_REJECTED");
});
test("TokenVersion above 2^53 advances as an exact decimal string; Numbers never repair it", () => {
  const grant = cases[6]!;
  const c: Case = { ...grant, post(s) { grant.post(s); edit(s, "AppUser", ["2"], { tokenVersion: "9007199254740994" }); } };
  const s = fixture(c, s => edit(s, "AppUser", ["2"], { tokenVersion: large }));
  assert.equal(validateSyntheticWriteInventoryV3(s).classification, "MODEL_CONSISTENT");
  const receipt = s.revisionObservation.receipts.find(r => r.domain === "TOKEN_VERSION")!;
  assert.equal(receipt.beforeRevision, large); assert.equal(receipt.afterRevision, "9007199254740994");
  Object.assign(receipt, { afterRevision: Number(receipt.afterRevision) });
  assert.equal(validateSyntheticWriteInventoryV3(s).classification, "MODEL_REJECTED");
});
test("input/output budgets reject unknown event floods and synthetic revision overflow", () => {
  const s = fixture(); s.eventObservation.events = Array.from({ length: 257 }, () => s.eventObservation.events[0]!);
  assert.equal(validateSyntheticWriteInventoryV3(s).classification, "MODEL_REJECTED");
  const m = fixture().mutation; m.current.generation = "ffffffffffffffff"; m.delta.expected.generation = "ffffffffffffffff";
  assert.equal(prepareSyntheticWriteInventoryV3(m).classification, "MODEL_REJECTED");
});
test("unsafe nested getters/Proxy/hooks never run or leak through errors", () => {
  let calls = 0; const proxy = new Proxy({}, { ownKeys() { calls++; throw new Error("PRIVATE_SQL_CREDENTIAL_PATIENT"); } });
  const getter = Object.defineProperty({}, "events", { enumerable: true, get() { calls++; throw new Error("PRIVATE_SQL_CREDENTIAL_PATIENT"); } });
  const hook = { toJSON() { calls++; throw new Error("PRIVATE_SQL_CREDENTIAL_PATIENT"); } };
  for (const unsafe of [proxy, getter, hook]) {
    const s = fixture(); Object.assign(s, { eventObservation: unsafe });
    for (const r of [validateSyntheticWriteInventoryV3(s), prepareSyntheticWriteInventoryV3(unsafe)]) {
      assert.equal(r.classification, "MODEL_REJECTED"); assert.equal(/PRIVATE|SQL_CREDENTIAL_PATIENT/.test(JSON.stringify(r)), false); restricted(r);
    }
  }
  const s = fixture(); Object.assign(s.eventObservation.events[0]!, { sql: "PRIVATE_SQL_CREDENTIAL_PATIENT" });
  assert.equal(/PRIVATE/.test(JSON.stringify(validateSyntheticWriteInventoryV3(s))), false); assert.equal(calls, 0);
});
