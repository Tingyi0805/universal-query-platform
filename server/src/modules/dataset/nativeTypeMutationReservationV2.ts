import { types } from "node:util";
import { z } from "zod";

// Closed synthetic model only. No C2 import, SQL adapter, transaction opener or trusted issuer.
const object = <S extends z.ZodRawShape>(s: S) => z.object(s).strict();
const id = z.string().regex(/^[1-9][0-9]{0,18}$/).pipe(z.string().refine(v => BigInt(v) <= 9223372036854775807n));
const ref = z.union([id, z.literal("$NEW")]);
const rv = z.string().regex(/^[0-9a-f]{16}$/).refine(v => v !== "0000000000000000");
const uuid = z.string().uuid().regex(/^[0-9a-f-]+$/);
const name = z.string().regex(/^SYN_[A-Z0-9_]{1,24}$/);
const resources = ["Permission", "Role", "RolePermission", "AppUser", "UserRole", "Dataset", "Parameter", "Query",
  "Dashboard", "ManagedSource", "RoleACL", "UserACL"] as const;
const resource = z.enum(resources);
type Resource = typeof resources[number];
const row = { id: ref, revision: rv }, flags = { canView: z.boolean(), canExecute: z.boolean(), canExport: z.boolean() };
const nodeSchema = z.discriminatedUnion("resource", [
  object({ resource: z.literal("Dataset"), ...row, active: z.boolean(), archived: z.boolean() }),
  object({ resource: z.literal("Query"), ...row, datasetId: ref, active: z.boolean(), archived: z.boolean(), published: z.boolean(), publishedByUserId: ref.nullable() }),
  object({ resource: z.literal("Parameter"), ...row, datasetId: ref, name, lookupDatasetId: ref.nullable() }),
  object({ resource: z.literal("AppUser"), ...row, username: name, active: z.boolean(), tokenVersion: id }),
  object({ resource: z.literal("Role"), ...row, code: name, active: z.boolean(), systemAdmin: z.boolean() }),
  object({ resource: z.literal("Permission"), ...row, code: z.enum(["MODEL_ADMIN", "MODEL_DESIGN"]) }),
  object({ resource: z.literal("UserRole"), userId: ref, roleId: ref, revision: rv }),
  object({ resource: z.literal("RolePermission"), roleId: ref, permissionId: ref, revision: rv }),
  object({ resource: z.literal("RoleACL"), queryId: ref, roleId: ref, ...flags, revision: rv }),
  object({ resource: z.literal("UserACL"), queryId: ref, userId: ref, ...flags, revision: rv }),
  object({ resource: z.literal("Dashboard"), ...row, queryId: ref, creatorId: ref, active: z.boolean(),
    mode: z.enum(["LEGACY", "QUERY_ONLY"]), management: z.enum(["MANAGED", "LEGACY_ONLY"]), approvalPresent: z.boolean() }),
  object({ resource: z.literal("ManagedSource"), ...row, dashboardId: ref, sourceKey: name,
    storedHistoricalDatasetId: ref, effectiveQueryDatasetId: ref.nullable(), queryId: ref.nullable(),
    approvalPresent: z.boolean(), referenced: z.boolean(), bindingRevision: rv }),
]);
export type MutationNodeV2 = z.infer<typeof nodeSchema>;
const stateSchema = object({ format: z.literal("SYNTHETIC_STATE_V2"), domainId: uuid, incarnation: uuid,
  generation: rv, authorizationEpoch: rv, nodes: z.array(nodeSchema).max(96),
  retainedReferences: z.array(object({ kind: z.enum(["AUDIT", "DECISION", "VERSION_AUTHOR", "FAVORITE", "OTHER_USER_FK"]), userId: id, id })).max(32),
});
export type MutationStateV2 = z.infer<typeof stateSchema>;
const expected = object({ generation: rv, authorizationEpoch: rv, targetRevision: rv });
const common = { targetId: id, expected };
const uniqueIds = z.array(id).max(8).refine(v => new Set(v).size === v.length);
const deltaSchema = z.discriminatedUnion("operation", [
  object({ operation: z.literal("QUERY_REBIND"), ...common, datasetId: id }),
  object({ operation: z.literal("PARAMETER_ADD"), ...common, name, lookupDatasetId: id.nullable() }),
  object({ operation: z.literal("PARAMETER_DELETE"), ...common }),
  object({ operation: z.literal("PARAMETER_LOOKUP"), ...common, lookupDatasetId: id.nullable() }),
  object({ operation: z.literal("CREATE_USER"), expected, username: name, roleIds: uniqueIds }),
  object({ operation: z.literal("CREATE_ROLE"), expected, code: name, permissionIds: uniqueIds }),
  object({ operation: z.literal("USER_ROLE"), ...common, roleId: id, grant: z.boolean() }),
  object({ operation: z.literal("ROLE_PERMISSION"), ...common, permissionId: id, grant: z.boolean() }),
  object({ operation: z.literal("ACL_REPLACE"), ...common,
    roles: z.array(object({ roleId: id, ...flags })).max(8), users: z.array(object({ userId: id, ...flags })).max(8) }),
  object({ operation: z.literal("DELETE_USER"), ...common }),
  object({ operation: z.literal("SOURCE_REBIND"), ...common, queryId: id }),
]);
export type MutationDeltaV2 = z.infer<typeof deltaSchema>;
const contextSchema = object({ ownerId: uuid, transactionId: uuid, gateId: uuid, actorId: id, actorTokenVersion: id });
const requestSchema = object({ scope: z.literal("SYNTHETIC_TEST_ONLY"), format: z.literal("MUTATION_REQUEST_V2"),
  requestId: uuid, context: contextSchema, current: stateSchema, delta: deltaSchema });
export type MutationRequestV2 = z.infer<typeof requestSchema>;
const reservationSchema = object({ kind: z.enum(["ROW", "RANGE", "NATURAL", "COMPOSITE", "ENTITY_SPACE"]),
  resource: z.enum(["AuthorizationEpoch", ...resources]), predicate: z.enum(["IDENTITY", "CATALOG", "BY_PARENT", "NATURAL_KEY", "TUPLE", "ALL_IDENTITIES"]),
  key: z.array(z.string().max(128)).max(3) });
type Reservation = z.infer<typeof reservationSchema>;
const fkSchema = object({ relation: z.string().max(64), key: z.tuple([resource, ref]) });
const slotSchema = object({ slot: z.literal("$NEW"), entity: z.enum(["AppUser", "Role", "Parameter"]),
  naturalKey: z.array(z.string().max(32)).min(1).max(2), parent: id.nullable(), count: z.literal(1), allowedForeignKeys: z.array(fkSchema).max(16) });
type Slot = z.infer<typeof slotSchema>;
const allocationSchema = object({ provenance: z.literal("SYNTHETIC_ALLOCATION_OBSERVATION"), context: contextSchema,
  bindings: z.array(slotSchema.extend({ id })).max(1) });
const observationSchema = object({ provenance: z.literal("SYNTHETIC_POST_OBSERVATION"), context: contextSchema,
  before: stateSchema, actual: stateSchema, acquired: z.array(reservationSchema).max(768),
  cas: object({ generation: rv, targetRevision: rv, affectedRows: z.literal(1) }),
  steps: z.array(z.enum(["GATE", "RESERVE_UNION", "REVALIDATE_CURRENT", "CAS", "MUTATE", "REVISIONS", "FINAL_OBSERVE", "COMMIT"])).length(8),
  outcome: z.enum(["MODEL_COMMITTED", "COMMIT_UNKNOWN", "ROLLBACK_FAILED"]) });
export type MutationObservationV2 = z.infer<typeof observationSchema>;
export type MutationAllocationV2 = z.infer<typeof allocationSchema>;
const restrictions = { authority: "NONE", runtimeBindVerified: false, deliveryAllowed: false, persistence: "NOT_PROVEN", productionSafetyProven: false } as const;
class Invalid extends Error { constructor(readonly code: string) { super("SYNTHETIC_MUTATION_REJECTED"); } }
const reject = (code: string): never => { throw new Invalid(code); };

function snapshot(input: unknown): unknown {
  let nodes = 0;
  function copy(v: unknown, depth: number): unknown {
    if (++nodes > 80000 || depth > 16) reject("RESOURCE_BUDGET");
    if (v === null || typeof v === "boolean" || typeof v === "number") return v;
    if (typeof v === "string") { if (v.length > 128) reject("FORMAT_INVALID"); return v; }
    if (typeof v !== "object" || types.isProxy(v)) return reject("FORMAT_INVALID");
    const p = Object.getPrototypeOf(v), ds = Object.getOwnPropertyDescriptors(v);
    if (Object.getOwnPropertySymbols(v).length) reject("FORMAT_INVALID");
    if (Array.isArray(v)) {
      if (p !== Array.prototype || v.length > 768 || Object.keys(ds).length !== v.length + 1) reject("FORMAT_INVALID");
      return Array.from({ length: v.length }, (_, i) => {
        const d = ds[String(i)]; if (!d || !("value" in d) || !d.enumerable) return reject("FORMAT_INVALID"); return copy(d.value, depth + 1);
      });
    }
    if (p !== Object.prototype && p !== null || Object.keys(ds).length > 24) reject("FORMAT_INVALID");
    const out: Record<string, unknown> = Object.create(null);
    for (const [k, d] of Object.entries(ds)) { if (!("value" in d) || !d.enumerable) reject("FORMAT_INVALID"); out[k] = copy(d.value, depth + 1); }
    return out;
  }
  return copy(input, 0);
}
function freeze<T>(v: T): Readonly<T> { if (v && typeof v === "object") { Object.values(v).forEach(x => freeze(x)); Object.freeze(v); } return v; }
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const bump = (v: string) => { const n = BigInt(`0x${v}`) + 1n; if (n > 0xffffffffffffffffn) return reject("REVISION_OVERFLOW"); return n.toString(16).padStart(16, "0"); };
const tokenBump = (v: string) => { const n = BigInt(v) + 1n; if (n > 9223372036854775807n) return reject("TOKEN_OVERFLOW"); return n.toString(); };
const scalarOrder = (a: string, b: string) => a === b ? 0 : /^[1-9][0-9]*$/.test(a) && /^[1-9][0-9]*$/.test(b) ? BigInt(a) < BigInt(b) ? -1 : 1 : a < b ? -1 : 1;
function tupleOrder(a: readonly string[], b: readonly string[]) { for (let i = 0; i < Math.min(a.length, b.length); i++) { const c = scalarOrder(a[i]!, b[i]!); if (c) return c; } return a.length - b.length; }
function keys(n: MutationNodeV2): string[] {
  if ("id" in n) return [n.id];
  if (n.resource === "UserRole") return [n.userId, n.roleId];
  if (n.resource === "RolePermission") return [n.roleId, n.permissionId];
  if (n.resource === "RoleACL") return [n.queryId, n.roleId];
  return [n.queryId, n.userId];
}
const nodeOrder = (a: MutationNodeV2, b: MutationNodeV2) => resources.indexOf(a.resource) - resources.indexOf(b.resource) || tupleOrder(keys(a), keys(b));
function canonical(s: MutationStateV2): MutationStateV2 {
  return { ...s, nodes: s.nodes.map(n => nodeSchema.parse(n)).sort(nodeOrder), retainedReferences: [...s.retainedReferences].sort((a, b) => scalarOrder(a.kind, b.kind) || scalarOrder(a.userId, b.userId) || scalarOrder(a.id, b.id)) };
}
function get<K extends Resource>(s: MutationStateV2, kind: K, value: string): Extract<MutationNodeV2, { resource: K }> {
  const n = s.nodes.find(n => n.resource === kind && "id" in n && n.id === value);
  if (!n) return reject("MISSING_REFERENCE"); return n as Extract<MutationNodeV2, { resource: K }>;
}
function foreignKeys(n: MutationNodeV2): { relation: string; resource: Resource; key: string }[] {
  const f = (field: string, resource: Resource, key: string | null) => key === null ? [] : [{ relation: `${n.resource}.${field}`, resource, key }];
  switch (n.resource) {
    case "Query": return [...f("datasetId", "Dataset", n.datasetId), ...f("publishedByUserId", "AppUser", n.publishedByUserId)];
    case "Parameter": return [...f("datasetId", "Dataset", n.datasetId), ...f("lookupDatasetId", "Dataset", n.lookupDatasetId)];
    case "UserRole": return [...f("userId", "AppUser", n.userId), ...f("roleId", "Role", n.roleId)];
    case "RolePermission": return [...f("roleId", "Role", n.roleId), ...f("permissionId", "Permission", n.permissionId)];
    case "RoleACL": return [...f("queryId", "Query", n.queryId), ...f("roleId", "Role", n.roleId)];
    case "UserACL": return [...f("queryId", "Query", n.queryId), ...f("userId", "AppUser", n.userId)];
    case "Dashboard": return [...f("queryId", "Query", n.queryId), ...f("creatorId", "AppUser", n.creatorId)];
    case "ManagedSource": return [...f("dashboardId", "Dashboard", n.dashboardId), ...f("storedHistoricalDatasetId", "Dataset", n.storedHistoricalDatasetId),
      ...f("effectiveQueryDatasetId", "Dataset", n.effectiveQueryDatasetId), ...f("queryId", "Query", n.queryId)];
    default: return [];
  }
}
function validateState(s: MutationStateV2, symbolic = false) {
  if (s.nodes.length > 96 || s.retainedReferences.length > 32) reject("RESOURCE_BUDGET");
  const seen = new Set<string>(), naturals = new Set<string>();
  for (const n of s.nodes) {
    if (!symbolic && Object.values(n).includes("$NEW")) reject("UNBOUND_IDENTITY");
    const key = JSON.stringify([n.resource, keys(n)]); if (seen.has(key)) reject("DUPLICATE_ROW"); seen.add(key);
    const natural = n.resource === "AppUser" ? [n.username] : n.resource === "Role" ? [n.code] : n.resource === "Permission" ? [n.code]
      : n.resource === "Parameter" ? [n.datasetId, n.name] : n.resource === "ManagedSource" ? [n.dashboardId, n.sourceKey] : null;
    if (natural) { const k = JSON.stringify([n.resource, natural]); if (naturals.has(k)) reject("NATURAL_KEY_CONFLICT"); naturals.add(k); }
    for (const fk of foreignKeys(n)) get(s, fk.resource, fk.key);
    if (n.resource === "ManagedSource" && n.effectiveQueryDatasetId !== (n.queryId === null ? null : get(s, "Query", n.queryId).datasetId)) reject("EFFECTIVE_DATASET_CONFLICT");
  }
  if (s.nodes.filter(n => n.resource === "Role" && n.systemAdmin).length !== 1) reject("ADMIN_MODEL_INVALID");
  for (const r of s.retainedReferences) get(s, "AppUser", r.userId);
  let visits = 0;
  function walk(d: string, path: Set<string>) {
    if (++visits > 2048 || path.size > 12 || path.has(d)) reject("LOOKUP_CYCLE_OR_BUDGET");
    const next = new Set(path).add(d);
    for (const p of s.nodes) if (p.resource === "Parameter" && p.datasetId === d && p.lookupDatasetId !== null) walk(p.lookupDatasetId, next);
  }
  for (const n of s.nodes) if (n.resource === "Dataset") walk(n.id, new Set());
  if (!s.nodes.some(n => n.resource === "AppUser" && n.active && s.nodes.some(m => m.resource === "UserRole" && m.userId === n.id
    && get(s, "Role", m.roleId).systemAdmin && get(s, "Role", m.roleId).active))) reject("LAST_ADMIN");
}
function hasPermission(s: MutationStateV2, actor: string, code: string) {
  return s.nodes.some(n => n.resource === "UserRole" && n.userId === actor && get(s, "Role", n.roleId).active
    && s.nodes.some(p => p.resource === "RolePermission" && p.roleId === n.roleId && get(s, "Permission", p.permissionId).code === code));
}
function access(s: MutationStateV2, actor: string, q: string) {
  const grants = s.nodes.filter(n => n.resource === "UserACL" && n.userId === actor && n.queryId === q || n.resource === "RoleACL" && n.queryId === q
    && get(s, "Role", n.roleId).active && s.nodes.some(m => m.resource === "UserRole" && m.userId === actor && m.roleId === n.roleId));
  return grants.some(n => "canView" in n && n.canView) && grants.some(n => "canExecute" in n && n.canExecute);
}
function authorize(r: MutationRequestV2, s: MutationStateV2) {
  const a = get(s, "AppUser", r.context.actorId);
  if (!a.active || a.tokenVersion !== r.context.actorTokenVersion || !hasPermission(s, a.id, "MODEL_ADMIN")) reject("AUTHORIZATION_DRIFT");
  if (r.delta.operation === "SOURCE_REBIND") {
    const source = get(s, "ManagedSource", r.delta.targetId), dashboard = get(s, "Dashboard", source.dashboardId);
    if (!hasPermission(s, a.id, "MODEL_DESIGN") || !access(s, a.id, dashboard.queryId) || !access(s, a.id, r.delta.queryId)) reject("SOURCE_ACCESS_DENIED");
  }
}
function target(r: MutationRequestV2): MutationNodeV2 | null {
  const d = r.delta;
  switch (d.operation) {
    case "CREATE_USER": case "CREATE_ROLE": return null;
    case "QUERY_REBIND": case "ACL_REPLACE": return get(r.current, "Query", d.targetId);
    case "PARAMETER_ADD": return get(r.current, "Dataset", d.targetId);
    case "PARAMETER_DELETE": case "PARAMETER_LOOKUP": return get(r.current, "Parameter", d.targetId);
    case "USER_ROLE": case "DELETE_USER": return get(r.current, "AppUser", d.targetId);
    case "ROLE_PERMISSION": return get(r.current, "Role", d.targetId);
    case "SOURCE_REBIND": return get(r.current, "ManagedSource", d.targetId);
  }
}
function derive(r: MutationRequestV2) {
  validateState(r.current); authorize(r, r.current);
  const d = r.delta, c = canonical(r.current), t = target(r);
  if (d.expected.generation !== c.generation || d.expected.authorizationEpoch !== c.authorizationEpoch
    || d.expected.targetRevision !== (t?.revision ?? c.generation)) reject("CAS_CONFLICT");
  const e = structuredClone(c), initial = "0000000000000001";
  let entity: Slot["entity"] | null = null, naturalKey: string[] = [], parent: string | null = null;
  const touch = (n: MutationNodeV2) => { n.revision = bump(n.revision); };
  const userToken = (userId: string) => { const u = get(e, "AppUser", userId); u.tokenVersion = tokenBump(u.tokenVersion); touch(u); };
  const unpublish = (dataset: string) => { for (const q of e.nodes) if (q.resource === "Query" && q.datasetId === dataset && q.published) { q.published = false; q.publishedByUserId = null; touch(q); } };
  const evidence = (queries: string[]) => { for (const n of e.nodes) if (n.resource === "Dashboard" && (queries.includes(n.queryId)
    || e.nodes.some(s => s.resource === "ManagedSource" && s.dashboardId === n.id && s.queryId !== null && queries.includes(s.queryId)))) touch(n); };
  const datasetAvailable = (key: string) => { const n = get(e, "Dataset", key); if (!n.active || n.archived) reject("DATASET_UNAVAILABLE"); };
  const add = (n: MutationNodeV2) => { e.nodes.push(n); };
  switch (d.operation) {
    case "QUERY_REBIND": {
      const q = get(e, "Query", d.targetId); datasetAvailable(d.datasetId);
      if (q.archived || q.datasetId === d.datasetId) reject("NOOP_OR_ARCHIVED");
      if (e.nodes.some(n => n.resource === "Dashboard" && n.queryId === q.id && n.approvalPresent
        || n.resource === "ManagedSource" && n.queryId === q.id && n.approvalPresent)) reject("BINDING_CHANGE_GUARD");
      q.datasetId = d.datasetId; q.published = false; q.publishedByUserId = null; touch(q);
      for (const s of e.nodes) if (s.resource === "ManagedSource" && s.queryId === q.id) s.effectiveQueryDatasetId = d.datasetId;
      break;
    }
    case "PARAMETER_ADD": case "PARAMETER_DELETE": case "PARAMETER_LOOKUP": {
      let owner: string;
      if (d.operation === "PARAMETER_ADD") {
        owner = d.targetId; entity = "Parameter"; naturalKey = [owner, d.name]; parent = owner;
        if (d.lookupDatasetId !== null) datasetAvailable(d.lookupDatasetId);
        add({ resource: "Parameter", id: "$NEW", revision: initial, datasetId: owner, name: d.name, lookupDatasetId: d.lookupDatasetId });
      } else {
        const p = get(e, "Parameter", d.targetId); owner = p.datasetId;
        if (d.operation === "PARAMETER_DELETE") e.nodes = e.nodes.filter(n => n !== p);
        else { if (p.lookupDatasetId === d.lookupDatasetId) reject("NOOP"); if (d.lookupDatasetId !== null) datasetAvailable(d.lookupDatasetId); p.lookupDatasetId = d.lookupDatasetId; touch(p); }
      }
      datasetAvailable(owner); touch(get(e, "Dataset", owner)); unpublish(owner); break;
    }
    case "CREATE_USER": {
      entity = "AppUser"; naturalKey = [d.username];
      add({ resource: "AppUser", id: "$NEW", username: d.username, active: true, revision: initial, tokenVersion: "1" });
      for (const roleId of [...d.roleIds].sort(scalarOrder)) { if (!get(e, "Role", roleId).active) reject("ROLE_INACTIVE"); add({ resource: "UserRole", userId: "$NEW", roleId, revision: initial }); } break;
    }
    case "CREATE_ROLE": {
      entity = "Role"; naturalKey = [d.code];
      add({ resource: "Role", id: "$NEW", code: d.code, active: true, systemAdmin: false, revision: initial });
      for (const permissionId of [...d.permissionIds].sort(scalarOrder)) { get(e, "Permission", permissionId); add({ resource: "RolePermission", roleId: "$NEW", permissionId, revision: initial }); } break;
    }
    case "USER_ROLE": {
      if (d.targetId === r.context.actorId) reject("SELF_MUTATION_BLOCKED");
      if (!get(e, "Role", d.roleId).active) reject("ROLE_INACTIVE");
      const old = e.nodes.find(n => n.resource === "UserRole" && n.userId === d.targetId && n.roleId === d.roleId);
      if (!!old === d.grant) reject("NOOP");
      if (d.grant) add({ resource: "UserRole", userId: d.targetId, roleId: d.roleId, revision: initial }); else e.nodes = e.nodes.filter(n => n !== old);
      userToken(d.targetId); break;
    }
    case "ROLE_PERMISSION": {
      const role = get(e, "Role", d.targetId);
      if (role.systemAdmin || e.nodes.some(n => n.resource === "UserRole" && n.roleId === role.id && n.userId === r.context.actorId)) reject("SYSTEM_OR_SELF_ROLE_BLOCKED");
      get(e, "Permission", d.permissionId);
      const old = e.nodes.find(n => n.resource === "RolePermission" && n.roleId === role.id && n.permissionId === d.permissionId);
      if (!!old === d.grant) reject("NOOP");
      if (d.grant) add({ resource: "RolePermission", roleId: role.id, permissionId: d.permissionId, revision: initial }); else e.nodes = e.nodes.filter(n => n !== old);
      touch(role); for (const n of e.nodes) if (n.resource === "UserRole" && n.roleId === role.id) userToken(n.userId); break;
    }
    case "ACL_REPLACE": {
      if (new Set(d.roles.map(x => x.roleId)).size !== d.roles.length || new Set(d.users.map(x => x.userId)).size !== d.users.length) reject("DUPLICATE_ACL");
      for (const a of d.roles) get(e, "Role", a.roleId); for (const a of d.users) get(e, "AppUser", a.userId);
      e.nodes = e.nodes.filter(n => !((n.resource === "RoleACL" || n.resource === "UserACL") && n.queryId === d.targetId));
      for (const a of d.roles) { const old = c.nodes.find(n => n.resource === "RoleACL" && n.queryId === d.targetId && n.roleId === a.roleId); add({ resource: "RoleACL", queryId: d.targetId, ...a, revision: old ? bump(old.revision) : initial }); }
      for (const a of d.users) { const old = c.nodes.find(n => n.resource === "UserACL" && n.queryId === d.targetId && n.userId === a.userId); add({ resource: "UserACL", queryId: d.targetId, ...a, revision: old ? bump(old.revision) : initial }); }
      evidence([d.targetId]); break;
    }
    case "DELETE_USER": {
      if (d.targetId === r.context.actorId || e.retainedReferences.some(x => x.userId === d.targetId)
        || e.nodes.some(n => n.resource === "Dashboard" && n.creatorId === d.targetId || n.resource === "Query" && n.publishedByUserId === d.targetId)) reject("DELETE_SIDE_EFFECTS_BLOCKED");
      const qs = e.nodes.filter(n => n.resource === "UserACL" && n.userId === d.targetId).map(n => (n as Extract<MutationNodeV2, { resource: "UserACL" }>).queryId);
      e.nodes = e.nodes.filter(n => !(n.resource === "AppUser" && n.id === d.targetId || (n.resource === "UserRole" || n.resource === "UserACL") && n.userId === d.targetId));
      evidence(qs); break;
    }
    case "SOURCE_REBIND": {
      const s = get(e, "ManagedSource", d.targetId), dashboard = get(e, "Dashboard", s.dashboardId), q = get(e, "Query", d.queryId);
      if (dashboard.active || dashboard.mode !== "LEGACY" || dashboard.management !== "MANAGED") reject("DASHBOARD_MODE_GUARD");
      if (!q.active || q.archived || !q.published) reject("QUERY_UNAVAILABLE"); datasetAvailable(q.datasetId);
      if (s.queryId === d.queryId) reject("NOOP");
      if (s.approvalPresent || s.queryId !== null && s.referenced) reject("BINDING_CHANGE_GUARD");
      if (s.queryId === null && s.storedHistoricalDatasetId !== q.datasetId) reject("PENDING_CONVERSION_MISMATCH");
      s.queryId = q.id; s.effectiveQueryDatasetId = q.datasetId; s.bindingRevision = bump(s.bindingRevision); touch(s); touch(dashboard);
      const related = [dashboard.queryId, ...e.nodes.filter(n => n.resource === "ManagedSource" && n.dashboardId === dashboard.id && n.queryId !== null)
        .map(n => (n as Extract<MutationNodeV2, { resource: "ManagedSource" }>).queryId!)];
      for (const key of related) { const target = get(e, "Query", key); if (!target.active || target.archived || !target.published || !access(e, r.context.actorId, key)) reject("QUERY_UNAVAILABLE"); datasetAvailable(target.datasetId); }
      break;
    }
  }
  e.generation = bump(e.generation);
  if (!["PARAMETER_ADD", "PARAMETER_DELETE", "PARAMETER_LOOKUP", "SOURCE_REBIND"].includes(d.operation)) e.authorizationEpoch = bump(e.authorizationEpoch);
  validateState(e, true); authorize(r, e);
  const slots: Slot[] = entity === null ? [] : [{ slot: "$NEW", entity, naturalKey, parent, count: 1,
    allowedForeignKeys: e.nodes.flatMap(n => { const fks = foreignKeys(n); return ("id" in n && n.id === "$NEW" || fks.some(f => f.key === "$NEW"))
      ? fks.map(f => ({ relation: f.relation, key: [f.resource, f.key] as [Resource, string] })) : []; })
      .sort((a, b) => scalarOrder(a.relation, b.relation) || tupleOrder(a.key, b.key)) }];
  return { c, e: canonical(e), slots };
}

function union(c: MutationStateV2, e: MutationStateV2, slots: Slot[]): Reservation[] {
  const all = [...c.nodes, ...e.nodes], out = new Map<string, Reservation>();
  const add = (r: Reservation) => out.set(JSON.stringify(r), r);
  add({ kind: "ROW", resource: "AuthorizationEpoch", predicate: "IDENTITY", key: ["1"] });
  for (const kind of resources) add({ kind: "RANGE", resource: kind, predicate: "CATALOG", key: [] });
  for (const n of all) {
    add({ kind: "ROW", resource: n.resource, predicate: "IDENTITY", key: keys(n) });
    if (!("id" in n)) add({ kind: "COMPOSITE", resource: n.resource, predicate: "TUPLE", key: keys(n) });
    const natural = n.resource === "AppUser" ? [n.username] : n.resource === "Role" ? [n.code]
      : n.resource === "Parameter" ? [n.datasetId, n.name] : n.resource === "ManagedSource" ? [n.dashboardId, n.sourceKey] : null;
    if (natural) add({ kind: "NATURAL", resource: n.resource, predicate: "NATURAL_KEY", key: natural });
    // Every known parent gets each incoming FK predicate, including currently empty predicates.
    for (const child of resources) for (const field of incoming[child] ?? []) if (field.parent === n.resource && "id" in n)
      add({ kind: "RANGE", resource: child, predicate: "BY_PARENT", key: [field.field, n.id] });
  }
  for (const slot of slots) add({ kind: "ENTITY_SPACE", resource: slot.entity, predicate: "ALL_IDENTITIES", key: [] });
  const rank = (r: Reservation) => r.resource === "AuthorizationEpoch" ? -1 : resources.indexOf(r.resource);
  const result = [...out.values()].sort((a, b) => rank(a) - rank(b)
    || scalarOrder(a.kind, b.kind) || scalarOrder(a.predicate, b.predicate) || tupleOrder(a.key, b.key));
  if (result.length > 768) reject("RESOURCE_BUDGET"); return result;
}
const incoming: Partial<Record<Resource, { field: string; parent: Resource }[]>> = {
  Query: [{ field: "datasetId", parent: "Dataset" }, { field: "publishedByUserId", parent: "AppUser" }],
  Parameter: [{ field: "datasetId", parent: "Dataset" }, { field: "lookupDatasetId", parent: "Dataset" }],
  UserRole: [{ field: "userId", parent: "AppUser" }, { field: "roleId", parent: "Role" }],
  RolePermission: [{ field: "roleId", parent: "Role" }, { field: "permissionId", parent: "Permission" }],
  Dashboard: [{ field: "queryId", parent: "Query" }, { field: "creatorId", parent: "AppUser" }],
  ManagedSource: [{ field: "dashboardId", parent: "Dashboard" }, { field: "queryId", parent: "Query" },
    { field: "storedHistoricalDatasetId", parent: "Dataset" }, { field: "effectiveQueryDatasetId", parent: "Dataset" }],
  RoleACL: [{ field: "queryId", parent: "Query" }, { field: "roleId", parent: "Role" }],
  UserACL: [{ field: "queryId", parent: "Query" }, { field: "userId", parent: "AppUser" }],
};
function bind(r: MutationRequestV2, e: MutationStateV2, slots: Slot[], allocation: MutationAllocationV2) {
  if (!same(allocation.context, r.context) || allocation.bindings.length !== slots.length) reject("SLOT_BINDING_INVALID");
  const result = structuredClone(e);
  for (let i = 0; i < slots.length; i++) {
    const b = allocation.bindings[i]!, { id: assigned, ...metadata } = b;
    if (!same(metadata, slots[i]) || r.current.nodes.some(n => n.resource === b.entity && "id" in n && n.id === assigned)) reject("SLOT_BINDING_INVALID");
    for (const n of result.nodes) for (const [key, value] of Object.entries(n)) if (value === "$NEW") (n as unknown as Record<string, unknown>)[key] = assigned;
  }
  validateState(result); return canonical(result);
}
function error(e: unknown) { return freeze({ classification: "MODEL_REJECTED" as const, reason: e instanceof Invalid ? e.code : "FORMAT_INVALID", ...restrictions }); }
export function prepareSyntheticMutationV2(input: unknown) {
  try {
    const r = requestSchema.parse(snapshot(input)), p = derive(r), reservations = union(p.c, p.e, p.slots);
    return freeze({ classification: "MODEL_CONSISTENT" as const, kind: "SYNTHETIC_MUTATION_PLAN_V2" as const,
      expected: p.e, reservations, slots: p.slots, ...restrictions });
  } catch (e) { return error(e); }
}
/** Re-derives E/U from C+delta; never consumes a caller plan or derives expectations from P. */
export function validateSyntheticMutationV2(input: unknown) {
  try {
    const parsed = object({ request: requestSchema, allocation: allocationSchema, observation: observationSchema }).parse(snapshot(input));
    const { request: r, allocation, observation: o } = parsed, p = derive(r), reservations = union(p.c, p.e, p.slots);
    if (!same(o.context, r.context)) reject("OWNER_CONTEXT_MISMATCH");
    if (o.outcome !== "MODEL_COMMITTED") reject(o.outcome);
    if (!same(o.steps, ["GATE", "RESERVE_UNION", "REVALIDATE_CURRENT", "CAS", "MUTATE", "REVISIONS", "FINAL_OBSERVE", "COMMIT"])) reject("STEP_ORDER_INVALID");
    validateState(o.before); validateState(o.actual);
    if (!same(canonical(o.before), p.c)) reject("CURRENT_DRIFT");
    if (!same(o.acquired, reservations)) reject("UNION_NOT_RESERVED");
    if (o.cas.generation !== r.delta.expected.generation || o.cas.targetRevision !== r.delta.expected.targetRevision) reject("CAS_CONFLICT");
    const expectedPost = bind(r, p.e, p.slots, allocation);
    if (!same(canonical(o.actual), expectedPost)) reject("UNAUTHORIZED_POST_DRIFT");
    authorize(r, o.actual);
    return freeze({ classification: "MODEL_CONSISTENT" as const, reason: null, ...restrictions });
  } catch (e) { return error(e); }
}
