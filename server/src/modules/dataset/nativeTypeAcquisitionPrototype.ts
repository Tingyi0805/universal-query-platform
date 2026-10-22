import { createHash } from "node:crypto";
import { types } from "node:util";
import { z } from "zod";

// Pure synthetic graph/trace evaluator. No SQL adapter, shared mutex, issuer or runtime gate.
const object = <S extends z.ZodRawShape>(s: S) => z.object(s).strict();
const id = z.string().regex(/^[1-9][0-9]{0,18}$/).pipe(z.string().refine(v => BigInt(v) <= 9223372036854775807n));
const rv = z.string().regex(/^[a-f0-9]{16}$/).refine(v => v !== "0000000000000000");
const uuid = z.string().uuid().regex(/^[a-f0-9-]+$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const profiles = ["QUERY_DATASET", "USER_ROLE", "DASHBOARD_ACL"] as const;
const resources = ["Permission", "Role", "RolePermission", "AppUser", "UserRole", "Dataset", "Parameter", "Query",
  "Dashboard", "DashboardDataSource", "RoleQueryAccess", "UserQueryAccess"] as const;
type Resource = typeof resources[number];
const common = { id, revision: rv };
const nodeSchema = z.discriminatedUnion("resource", [
  object({ resource: z.literal("Query"), ...common, datasetId: id }),
  object({ resource: z.literal("Dataset"), ...common }),
  object({ resource: z.literal("Parameter"), ...common, datasetId: id, lookupDatasetId: id.nullable() }),
  object({ resource: z.literal("AppUser"), ...common, active: z.boolean() }),
  object({ resource: z.literal("Role"), ...common, active: z.boolean(), systemAdmin: z.boolean() }),
  object({ resource: z.literal("Permission"), ...common }),
  object({ resource: z.literal("UserRole"), ...common, userId: id, roleId: id }),
  object({ resource: z.literal("RolePermission"), ...common, roleId: id, permissionId: id }),
  object({ resource: z.literal("Dashboard"), ...common, queryId: id }),
  object({ resource: z.literal("DashboardDataSource"), ...common, dashboardId: id, queryId: id, datasetId: id }),
  object({ resource: z.literal("RoleQueryAccess"), ...common, queryId: id, roleId: id }),
  object({ resource: z.literal("UserQueryAccess"), ...common, queryId: id, userId: id }),
]);
export type SyntheticAcquisitionNode = z.infer<typeof nodeSchema>;
const predicates = ["DATASET_QUERIES", "DATASET_PARAMETERS", "LOOKUP_PARAMETERS", "USER_MEMBERSHIPS", "ROLE_MEMBERSHIPS",
  "ROLE_PERMISSIONS", "PERMISSION_ROLES", "QUERY_DASHBOARDS", "DASHBOARD_SOURCES", "QUERY_SOURCES", "QUERY_ROLE_ACL",
  "ROLE_QUERY_ACL", "QUERY_USER_ACL", "USER_QUERY_ACL", "SYSTEM_ADMIN_ROLES", "PERMISSION_CATALOG", "LAST_ADMIN"] as const;
type Predicate = typeof predicates[number];
const predicateSubject: Record<Predicate, Resource> = {
  DATASET_QUERIES: "Query", DATASET_PARAMETERS: "Parameter", LOOKUP_PARAMETERS: "Parameter", USER_MEMBERSHIPS: "UserRole",
  ROLE_MEMBERSHIPS: "UserRole", ROLE_PERMISSIONS: "RolePermission", PERMISSION_ROLES: "RolePermission", QUERY_DASHBOARDS: "Dashboard",
  DASHBOARD_SOURCES: "DashboardDataSource", QUERY_SOURCES: "DashboardDataSource", QUERY_ROLE_ACL: "RoleQueryAccess",
  ROLE_QUERY_ACL: "RoleQueryAccess", QUERY_USER_ACL: "UserQueryAccess", USER_QUERY_ACL: "UserQueryAccess",
  SYSTEM_ADMIN_ROLES: "Role", PERMISSION_CATALOG: "Permission", LAST_ADMIN: "AppUser",
};
const root = object({ resource: z.enum(resources), id });
const requestSchema = object({ scope: z.literal("SYNTHETIC_TEST_ONLY"), format: z.literal("ACQUISITION_GRAPH_V1"),
  profile: z.enum(profiles), roots: z.array(root).min(1).max(8),
  graph: object({ domainId: uuid, incarnation: uuid, revision: rv, authorizationEpoch: rv,
    writers: z.array(z.enum(profiles)).length(3).refine(v => new Set(v).size === 3),
    predicateRevisions: z.record(z.enum(predicates), rv).refine(v => Object.keys(v).length === predicates.length),
    nodes: z.array(nodeSchema).max(128) }),
});
export type SyntheticScopeRequest = z.infer<typeof requestSchema>;
const rowLock = object({ kind: z.literal("ROW"), resource: z.enum(["AuthorizationEpoch", ...resources]), key: id,
  revision: rv, integrity: hash });
const rangeLock = object({ kind: z.literal("RANGE"), predicate: z.enum(predicates), key: z.union([id, z.literal("ALL")]),
  revision: rv, members: z.array(root).max(128) });
const lockSchema = z.union([rowLock, rangeLock]);
export type SyntheticPrelock = z.infer<typeof lockSchema>;
const restrictions = { authority: "NONE", runtimeBindVerified: false, deliveryAllowed: false, persistence: "NOT_PROVEN" } as const;
type ScopeReason = "FORMAT_INVALID" | "RELATIONSHIP_INVALID" | "CYCLE_OR_BUDGET" | "ROOT_INVALID";
class Invalid extends Error { constructor(readonly code: ScopeReason) { super("SYNTHETIC_ACQUISITION_INVALID"); } }

// Copy own data only, before Zod/JSON operations; never invoke caller hooks or proxy traps.
function snapshot(input: unknown): unknown {
  let count = 0;
  function copy(v: unknown, depth: number): unknown {
    if (++count > 100000 || depth > 18) throw new Invalid("CYCLE_OR_BUDGET");
    if (v === null || typeof v === "number" || typeof v === "boolean") return v;
    if (typeof v === "string") { if (v.length > 128) throw new Invalid("FORMAT_INVALID"); return v; }
    if (typeof v !== "object" || types.isProxy(v)) throw new Invalid("FORMAT_INVALID");
    const proto = Object.getPrototypeOf(v), ds = Object.getOwnPropertyDescriptors(v);
    if (Object.getOwnPropertySymbols(v).length) throw new Invalid("FORMAT_INVALID");
    if (Array.isArray(v)) {
      if (proto !== Array.prototype || v.length > 256 || Object.keys(ds).length !== v.length + 1) throw new Invalid("FORMAT_INVALID");
      return Array.from({ length: v.length }, (_, i) => {
        const d = ds[String(i)]; if (!d || !("value" in d) || !d.enumerable) throw new Invalid("FORMAT_INVALID");
        return copy(d.value, depth + 1);
      });
    }
    if (proto !== Object.prototype && proto !== null || Object.keys(ds).length > 24) throw new Invalid("FORMAT_INVALID");
    const out: Record<string, unknown> = Object.create(null);
    for (const [k, d] of Object.entries(ds)) {
      if (!("value" in d) || !d.enumerable) throw new Invalid("FORMAT_INVALID"); out[k] = copy(d.value, depth + 1);
    }
    return out;
  }
  return copy(input, 0);
}
function freeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object") { Object.values(value).forEach(v => freeze(v)); Object.freeze(value); } return value;
}
const keyOf = (resource: Resource, key: string) => `${resource}:${key}`;
const digest = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const numeric = (a: string, b: string) => a === b ? 0 : a === "ALL" ? -1 : b === "ALL" ? 1 : BigInt(a) < BigInt(b) ? -1 : 1;
const rootOrder = (a: z.infer<typeof root>, b: z.infer<typeof root>) => resources.indexOf(a.resource) - resources.indexOf(b.resource) || numeric(a.id, b.id);

function scopeFrom(r: SyntheticScopeRequest) {
  const { nodes } = r.graph, index = new Map<string, SyntheticAcquisitionNode>();
  const get = (resource: Resource, id: string) => {
    const n = index.get(keyOf(resource, id)); if (!n) throw new Invalid("RELATIONSHIP_INVALID"); return n;
  };
  for (const n of nodes) {
    if (index.has(keyOf(n.resource, n.id))) throw new Invalid("RELATIONSHIP_INVALID"); index.set(keyOf(n.resource, n.id), n);
  }
  // Validate the entire supplied finite dataset, including disconnected FK errors and duplicate relationships.
  const unique = new Set<string>();
  for (const n of nodes) {
    const pair = n.resource === "Parameter" ? [n.datasetId, n.id] : n.resource === "UserRole" ? [n.userId, n.roleId]
      : n.resource === "RolePermission" ? [n.roleId, n.permissionId] : n.resource === "RoleQueryAccess" ? [n.queryId, n.roleId]
        : n.resource === "UserQueryAccess" ? [n.queryId, n.userId] : [n.id];
    const signature = JSON.stringify([n.resource, pair]);
    if (unique.has(signature)) throw new Invalid("RELATIONSHIP_INVALID"); unique.add(signature);
    if ("datasetId" in n) get("Dataset", n.datasetId);
    if ("lookupDatasetId" in n && n.lookupDatasetId !== null) get("Dataset", n.lookupDatasetId);
    if ("queryId" in n) get("Query", n.queryId);
    if ("roleId" in n) get("Role", n.roleId);
    if ("userId" in n) get("AppUser", n.userId);
    if ("permissionId" in n) get("Permission", n.permissionId);
    if (n.resource === "DashboardDataSource") {
      get("Dashboard", n.dashboardId);
      if ((get("Query", n.queryId) as Extract<SyntheticAcquisitionNode, { resource: "Query" }>).datasetId !== n.datasetId)
        throw new Invalid("RELATIONSHIP_INVALID");
    }
  }
  if (nodes.filter(n => n.resource === "Role" && n.systemAdmin).length > 1) throw new Invalid("RELATIONSHIP_INVALID");
  // Expected reverse references are visited once; directed lookup cycles are forbidden.
  let lookupVisits = 0;
  function lookupWalk(datasetId: string, path: Set<string>, depth: number) {
    if (++lookupVisits > 4096 || path.has(datasetId) || depth > 12) throw new Invalid("CYCLE_OR_BUDGET");
    const next = new Set(path).add(datasetId);
    for (const n of nodes) if (n.resource === "Parameter" && n.datasetId === datasetId && n.lookupDatasetId !== null)
      lookupWalk(n.lookupDatasetId, next, depth + 1);
  }
  for (const n of nodes) if (n.resource === "Dataset") lookupWalk(n.id, new Set(), 0);
  const allowed: Record<typeof profiles[number], readonly Resource[]> = {
    QUERY_DATASET: ["Query", "Dataset"], USER_ROLE: ["AppUser", "Role", "Permission"], DASHBOARD_ACL: ["Query", "Dashboard", "AppUser", "Role"],
  };
  if (r.roots.some(v => !allowed[r.profile].includes(v.resource))) throw new Invalid("ROOT_INVALID");
  const roots = [...new Map(r.roots.map(v => [keyOf(v.resource, v.id), v])).values()].sort(rootOrder);
  const seen = new Map<string, SyntheticAcquisitionNode>(), ranges = new Map<string, z.infer<typeof rangeLock>>();
  const queue: { n: SyntheticAcquisitionNode; depth: number }[] = roots.map(v => ({ n: get(v.resource, v.id), depth: 0 }));
  const add = (resource: Resource, id: string, depth: number) => queue.push({ n: get(resource, id), depth });
  const range = (predicate: Predicate, key: string, members: SyntheticAcquisitionNode[], depth: number) => {
    ranges.set(`${predicate}:${key}`, { kind: "RANGE", predicate, key, revision: r.graph.predicateRevisions[predicate]!,
      members: members.map(n => ({ resource: n.resource, id: n.id })).sort(rootOrder) });
    for (const n of members) add(n.resource, n.id, depth);
  };
  const identity = r.profile !== "QUERY_DATASET", dashboard = r.profile === "DASHBOARD_ACL";
  if (identity) {
    range("PERMISSION_CATALOG", "ALL", nodes.filter(n => n.resource === "Permission"), 0);
    const admins = nodes.filter(n => n.resource === "Role" && n.systemAdmin);
    range("SYSTEM_ADMIN_ROLES", "ALL", admins, 0);
    range("LAST_ADMIN", "ALL", nodes.filter(n => n.resource === "AppUser" && n.active && nodes.some(m => m.resource === "UserRole"
      && m.userId === n.id && admins.some(a => a.id === m.roleId && a.resource === "Role" && a.active))), 0);
  }
  let walks = 0;
  for (let i = 0; i < queue.length; i++) {
    if (++walks > 4096) throw new Invalid("CYCLE_OR_BUDGET");
    const { n, depth } = queue[i]!; if (seen.has(keyOf(n.resource, n.id))) continue;
    if (depth > 12) throw new Invalid("CYCLE_OR_BUDGET"); seen.set(keyOf(n.resource, n.id), n);
    if (n.resource === "Query") {
      add("Dataset", n.datasetId, depth + 1);
      if (dashboard) for (const [p, kind] of [["QUERY_DASHBOARDS", "Dashboard"], ["QUERY_SOURCES", "DashboardDataSource"],
        ["QUERY_ROLE_ACL", "RoleQueryAccess"], ["QUERY_USER_ACL", "UserQueryAccess"]] as const)
        range(p, n.id, nodes.filter(v => v.resource === kind && v.queryId === n.id), depth + 1);
    } else if (n.resource === "Dataset") {
      range("DATASET_QUERIES", n.id, nodes.filter(v => v.resource === "Query" && v.datasetId === n.id), depth + 1);
      range("DATASET_PARAMETERS", n.id, nodes.filter(v => v.resource === "Parameter" && v.datasetId === n.id), depth + 1);
      range("LOOKUP_PARAMETERS", n.id, nodes.filter(v => v.resource === "Parameter" && v.lookupDatasetId === n.id), depth + 1);
    } else if (n.resource === "Parameter") {
      add("Dataset", n.datasetId, depth + 1); if (n.lookupDatasetId !== null) add("Dataset", n.lookupDatasetId, depth + 1);
    } else if (n.resource === "AppUser" && identity) {
      range("USER_MEMBERSHIPS", n.id, nodes.filter(v => v.resource === "UserRole" && v.userId === n.id), depth + 1);
      if (dashboard) range("USER_QUERY_ACL", n.id, nodes.filter(v => v.resource === "UserQueryAccess" && v.userId === n.id), depth + 1);
    } else if (n.resource === "Role" && identity) {
      range("ROLE_MEMBERSHIPS", n.id, nodes.filter(v => v.resource === "UserRole" && v.roleId === n.id), depth + 1);
      range("ROLE_PERMISSIONS", n.id, nodes.filter(v => v.resource === "RolePermission" && v.roleId === n.id), depth + 1);
      if (dashboard) range("ROLE_QUERY_ACL", n.id, nodes.filter(v => v.resource === "RoleQueryAccess" && v.roleId === n.id), depth + 1);
    } else if (n.resource === "Permission" && identity) {
      range("PERMISSION_ROLES", n.id, nodes.filter(v => v.resource === "RolePermission" && v.permissionId === n.id), depth + 1);
    } else if (n.resource === "UserRole") { add("AppUser", n.userId, depth + 1); add("Role", n.roleId, depth + 1);
    } else if (n.resource === "RolePermission") { add("Role", n.roleId, depth + 1); add("Permission", n.permissionId, depth + 1);
    } else if (n.resource === "Dashboard") {
      add("Query", n.queryId, depth + 1);
      range("DASHBOARD_SOURCES", n.id, nodes.filter(v => v.resource === "DashboardDataSource" && v.dashboardId === n.id), depth + 1);
    } else if (n.resource === "DashboardDataSource") { add("Dashboard", n.dashboardId, depth + 1); add("Query", n.queryId, depth + 1); add("Dataset", n.datasetId, depth + 1);
    } else if (n.resource === "RoleQueryAccess") { add("Query", n.queryId, depth + 1); add("Role", n.roleId, depth + 1);
    } else if (n.resource === "UserQueryAccess") { add("Query", n.queryId, depth + 1); add("AppUser", n.userId, depth + 1); }
  }
  const locks: SyntheticPrelock[] = [{ kind: "ROW", resource: "AuthorizationEpoch", key: "1", revision: r.graph.authorizationEpoch,
    integrity: digest(["SYNTHETIC_AE_GUARD", r.graph.authorizationEpoch]) }, ...[...seen.values()].map(n => ({ kind: "ROW" as const,
    resource: n.resource, key: n.id, revision: n.revision, integrity: digest(n) })), ...ranges.values()];
  const subject = (l: SyntheticPrelock) => l.kind === "ROW" ? l.resource : predicateSubject[l.predicate];
  const rank = (l: SyntheticPrelock) => subject(l) === "AuthorizationEpoch" ? -1 : resources.indexOf(subject(l) as Resource);
  locks.sort((a, b) => rank(a) - rank(b) || numeric(a.key, b.key) || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1
    : a.kind === "RANGE" && b.kind === "RANGE" ? predicates.indexOf(a.predicate) - predicates.indexOf(b.predicate) : 0));
  if (locks.length > 256) throw new Invalid("CYCLE_OR_BUDGET");
  return freeze({ kind: "ISOLATED_SCOPE_HINT_V1" as const, profile: r.profile, domainId: r.graph.domainId, incarnation: r.graph.incarnation,
    graphRevision: r.graph.revision, roots, locks, ...restrictions });
}
export function discoverSyntheticAcquisitionScope(input: unknown) {
  try { return freeze({ ok: true as const, hint: scopeFrom(requestSchema.parse(snapshot(input))), ...restrictions }); }
  catch (e) { return freeze({ ok: false as const, reason: e instanceof Invalid ? e.code : "FORMAT_INVALID", ...restrictions }); }
}

const actor = z.enum(["OWNER", "HELPER"]), tx = { ownerId: uuid, transactionId: uuid, actor };
const protectedTx = { ...tx, ticketId: uuid };
const eventSchema = z.discriminatedUnion("type", [
  object({ type: z.literal("DISCOVER"), ownerId: uuid, requestId: uuid, request: requestSchema }),
  object({ type: z.literal("BEGIN"), ...tx, modelRevision: rv }),
  object({ type: z.literal("ACQUIRE_GATE"), ...protectedTx, outcome: z.enum(["ACQUIRED", "TIMEOUT", "DENIED"]) }),
  object({ type: z.literal("PRELOCK"), ...protectedTx, plan: z.array(lockSchema).max(256) }),
  object({ type: z.literal("REVALIDATE"), ...protectedTx, request: requestSchema }),
  object({ type: z.literal("CAS"), ...protectedTx, expected: rv, observed: rv, affectedRows: z.number().int().min(0).max(2) }),
  object({ type: z.literal("MUTATE"), ...protectedTx, outcome: z.enum(["SUCCESS", "FAILED"]) }),
  object({ type: z.literal("REVISION"), ...protectedTx, next: rv, outcome: z.enum(["SUCCESS", "FAILED"]) }),
  object({ type: z.literal("FINAL_REVALIDATE"), ...protectedTx, request: requestSchema, observedModelRevision: rv }),
  object({ type: z.literal("COMMIT"), ...protectedTx, outcome: z.enum(["COMMITTED", "UNKNOWN", "FAILED"]) }),
  object({ type: z.literal("ROLLBACK"), ...tx, outcome: z.enum(["ROLLED_BACK", "FAILED"]) }),
  object({ type: z.literal("RELEASE_GATE"), ...protectedTx, outcome: z.enum(["RELEASED", "UNKNOWN"]) }),
  object({ type: z.literal("LOSE_GATE"), ...protectedTx }),
]);
export type SyntheticAcquisitionEvent = z.infer<typeof eventSchema>;
const traceSchema = object({ scope: z.literal("SYNTHETIC_TEST_ONLY"), format: z.literal("ACQUISITION_TRACE_V1"), domainId: uuid,
  events: z.array(eventSchema).min(1).max(128) });
type Phase = "DISCOVERED" | "BEGUN" | "GATED" | "PRELOCKED" | "REVALIDATED" | "CAS_OK" | "MUTATED" | "REVISIONED"
  | "FINAL_OK" | "COMMITTED_PENDING_RELEASE" | "ROLLED_BACK_PENDING_RELEASE" | "COMMITTED_MODEL" | "ROLLED_BACK_MODEL"
  | "ABORT_REQUIRED" | "ROLLBACK_UNKNOWN" | "COMMIT_UNKNOWN";
type Owner = { phase: Phase; requestId: string; hint: ReturnType<typeof scopeFrom>; transactionId?: string; ticketId?: string; revision?: string; next?: string };

export function evaluateSyntheticAcquisition(input: unknown) {
  const owners = new Map<string, Owner>(), requests = new Map<string, Owner>(), transactions = new Set<string>(), tickets = new Set<string>();
  let holder: string | null = null, poisoned = false, reason: string | null = null;
  const result = () => freeze({ kind: "ISOLATED_ACQUISITION_TRACE_V1" as const,
    success: reason === null && holder === null && !poisoned && owners.size > 0 && [...owners.values()].every(o => o.phase === "COMMITTED_MODEL"),
    reason, gateHolder: holder, quarantined: poisoned, owners: [...owners].map(([ownerId, o]) => ({ ownerId, phase: o.phase })), ...restrictions });
  const fail = (code: string, o?: Owner) => { reason ??= code; if (o && !["COMMITTED_PENDING_RELEASE", "COMMITTED_MODEL", "ROLLED_BACK_MODEL", "ROLLBACK_UNKNOWN", "COMMIT_UNKNOWN"].includes(o.phase)) o.phase = "ABORT_REQUIRED"; };
  try {
    const parsed = traceSchema.safeParse(snapshot(input)); if (!parsed.success) { fail("FORMAT_INVALID"); return result(); }
    for (const e of parsed.data.events) {
      let o = owners.get(e.ownerId);
      if (e.type === "DISCOVER") {
        if (o) { fail("OWNER_REUSE", o); continue; }
        const previous = requests.get(e.requestId);
        if (previous && (previous.phase !== "ROLLED_BACK_MODEL" || poisoned)) { fail("RETRY_BEFORE_RELEASE"); continue; }
        let hint: ReturnType<typeof scopeFrom>;
        try { hint = scopeFrom(e.request); } catch (error) { fail(error instanceof Invalid ? error.code : "FORMAT_INVALID"); continue; }
        if (hint.domainId !== parsed.data.domainId) { fail("DOMAIN_MISMATCH"); continue; }
        if (previous && (previous.hint.profile !== hint.profile || previous.hint.incarnation !== hint.incarnation
          || JSON.stringify(previous.hint.roots) !== JSON.stringify(hint.roots))) { fail("REQUEST_COLLISION"); continue; }
        o = { phase: "DISCOVERED", requestId: e.requestId, hint }; owners.set(e.ownerId, o); requests.set(e.requestId, o); continue;
      }
      if (!o) { fail("OWNER_MISSING"); continue; }
      if (e.type === "BEGIN") {
        if (e.actor !== "OWNER" || o.phase !== "DISCOVERED" || transactions.has(e.transactionId)) { fail("OWNER_BEGIN_INVALID", o); continue; }
        o.transactionId = e.transactionId; o.revision = e.modelRevision; o.phase = "BEGUN"; transactions.add(e.transactionId); continue;
      }
      if (e.transactionId !== o.transactionId) { fail("OWNER_TRANSACTION_MISMATCH", o); continue; }
      if (["ACQUIRE_GATE", "COMMIT", "ROLLBACK", "RELEASE_GATE", "LOSE_GATE"].includes(e.type) && e.actor !== "OWNER") {
        fail("HELPER_TRANSACTION_FORBIDDEN", o); continue;
      }
      if (e.type === "ROLLBACK") {
        if (["COMMITTED_PENDING_RELEASE", "COMMITTED_MODEL", "ROLLED_BACK_MODEL", "COMMIT_UNKNOWN", "ROLLBACK_UNKNOWN"].includes(o.phase)) { fail("ROLLBACK_NOT_PROVEN", o); continue; }
        if (e.outcome === "FAILED") { o.phase = "ROLLBACK_UNKNOWN"; poisoned = true; fail("ROLLBACK_UNKNOWN"); }
        else { o.phase = holder === e.ownerId ? "ROLLED_BACK_PENDING_RELEASE" : "ROLLED_BACK_MODEL"; reason ??= "MODEL_ABORTED"; }
        continue;
      }
      if (e.type === "ACQUIRE_GATE") {
        if (poisoned || o.phase !== "BEGUN" || tickets.has(e.ticketId)) { fail("GATE_ORDER_OR_REENTRY", o); continue; }
        if (e.outcome !== "ACQUIRED") { fail(e.outcome === "TIMEOUT" ? "GATE_TIMEOUT" : "GATE_DENIED", o); continue; }
        if (holder !== null) { fail("GATE_CONFLICT", o); continue; }
        holder = e.ownerId; o.ticketId = e.ticketId; tickets.add(e.ticketId); o.phase = "GATED"; continue;
      }
      if (e.type === "RELEASE_GATE") {
        if (holder !== e.ownerId || e.ticketId !== o.ticketId) { poisoned = true; fail("GATE_OWNERSHIP_LOST", o); continue; }
        if (e.outcome !== "RELEASED" || !["COMMITTED_PENDING_RELEASE", "ROLLED_BACK_PENDING_RELEASE"].includes(o.phase)) {
          holder = null; poisoned = true;
          if (o.phase === "COMMITTED_PENDING_RELEASE") o.phase = "COMMIT_UNKNOWN";
          else if (o.phase === "ROLLED_BACK_PENDING_RELEASE") o.phase = "ROLLBACK_UNKNOWN";
          fail("GATE_RELEASE_UNSAFE", o); continue;
        }
        holder = null; o.phase = o.phase === "COMMITTED_PENDING_RELEASE" ? "COMMITTED_MODEL" : "ROLLED_BACK_MODEL"; continue;
      }
      if (e.type === "LOSE_GATE") {
        if (holder === e.ownerId && e.ticketId === o.ticketId) holder = null;
        poisoned = true; fail("GATE_OWNERSHIP_LOST", o); continue;
      }
      if (holder !== e.ownerId || e.ticketId !== o.ticketId || poisoned) { fail("GATE_NOT_HELD", o); continue; }
      if (e.type === "PRELOCK") {
        if (o.phase !== "GATED" || JSON.stringify(e.plan) !== JSON.stringify(o.hint.locks)) { fail("PRELOCK_INVALID", o); continue; }
        o.phase = "PRELOCKED";
      } else if (e.type === "REVALIDATE" || e.type === "FINAL_REVALIDATE") {
        if (o.phase !== (e.type === "REVALIDATE" ? "PRELOCKED" : "REVISIONED")) { fail("REVALIDATION_ORDER", o); continue; }
        let observed: ReturnType<typeof scopeFrom>;
        try { observed = scopeFrom(e.request); } catch (error) { fail(error instanceof Invalid ? error.code : "FORMAT_INVALID", o); continue; }
        if (JSON.stringify(observed) !== JSON.stringify(o.hint)
          || e.type === "FINAL_REVALIDATE" && e.observedModelRevision !== o.next) { fail("SCOPE_OR_REVISION_DRIFT", o); continue; }
        o.phase = e.type === "REVALIDATE" ? "REVALIDATED" : "FINAL_OK";
      } else if (e.type === "CAS") {
        if (o.phase !== "REVALIDATED" || e.affectedRows !== 1 || e.expected !== o.revision || e.observed !== o.revision) { fail("CAS_CONFLICT", o); continue; }
        o.phase = "CAS_OK";
      } else if (e.type === "MUTATE") {
        if (o.phase !== "CAS_OK" || e.outcome !== "SUCCESS") { fail("MUTATION_FAILED", o); continue; } o.phase = "MUTATED";
      } else if (e.type === "REVISION") {
        if (o.phase !== "MUTATED" || e.outcome !== "SUCCESS" || BigInt(`0x${e.next}`) <= BigInt(`0x${o.revision}`)) { fail("REVISION_FAILED", o); continue; }
        o.next = e.next; o.phase = "REVISIONED";
      } else if (e.type === "COMMIT") {
        if (o.phase !== "FINAL_OK") { fail("COMMIT_ORDER", o); continue; }
        if (e.outcome === "UNKNOWN") { o.phase = "COMMIT_UNKNOWN"; poisoned = true; fail("COMMIT_UNKNOWN"); }
        else if (e.outcome === "FAILED") fail("COMMIT_FAILED", o); else o.phase = "COMMITTED_PENDING_RELEASE";
      }
    }
    if (holder !== null || [...owners.values()].some(o => !["COMMITTED_MODEL", "ROLLED_BACK_MODEL", "COMMIT_UNKNOWN", "ROLLBACK_UNKNOWN"].includes(o.phase))) reason ??= "INCOMPLETE_TRACE";
  } catch (e) { fail(e instanceof Invalid ? e.code : "FORMAT_INVALID"); }
  return result();
}
