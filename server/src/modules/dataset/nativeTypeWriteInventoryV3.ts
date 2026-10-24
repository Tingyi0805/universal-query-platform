import { createHash } from "node:crypto";
import { types } from "node:util";
import { z } from "zod";
import { prepareSyntheticMutationV2, validateSyntheticMutationV2, type MutationRequestV2,
  type MutationNodeV2, type MutationAllocationV2 } from "./nativeTypeMutationReservationV2.js";

// SYNTHETIC_TEST_ONLY: fixed model writes, not SQL statements or a trusted observer/issuer.
const obj = <S extends z.ZodRawShape>(s: S) => z.object(s).strict();
const id = z.string().regex(/^[1-9][0-9]{0,18}$/).pipe(z.string().refine(v => BigInt(v) <= 9223372036854775807n));
const ref = z.union([id, z.literal("$NEW")]);
const rv = z.string().regex(/^[0-9a-f]{16}$/).refine(v => v !== "0000000000000000");
const uuid = z.string().uuid().regex(/^[0-9a-f-]+$/);
const resources = ["Dataset", "Query", "Parameter", "AppUser", "Role", "Permission", "UserRole", "RolePermission",
  "RoleACL", "UserACL", "Dashboard", "ManagedSource", "AuthorizationEpoch", "Generation", "AuditIntent"] as const;
const domains = ["AE", "Q", "D", "S", "TOKEN_VERSION", "DASHBOARD_BINDING", "DASHBOARD_APPROVAL", "MODEL_GENERATION", "MODEL_ROW"] as const;
const operations = ["QUERY_REBIND", "PARAMETER_ADD", "PARAMETER_DELETE", "PARAMETER_LOOKUP", "CREATE_USER", "CREATE_ROLE",
  "USER_ROLE", "ROLE_PERMISSION", "ACL_REPLACE", "DELETE_USER", "SOURCE_REBIND"] as const;
const columns = ["id", "revision", "datasetId", "active", "archived", "published", "publishedByUserId", "name", "lookupDatasetId",
  "username", "tokenVersion", "code", "systemAdmin", "userId", "roleId", "permissionId", "queryId", "canView", "canExecute", "canExport",
  "creatorId", "mode", "management", "approvalPresent", "dashboardId", "sourceKey", "storedHistoricalDatasetId", "bindingRevision",
  "requestId", "actorId", "operation", "eventStatus"] as const;
type Resource = typeof resources[number];
type Domain = typeof domains[number];
type Column = typeof columns[number];
type Row = Record<string, string | boolean | null>;
const contextSchema = obj({ requestId: uuid, ownerId: uuid, transactionId: uuid, domainId: uuid, incarnation: uuid });
const identitySchema = obj({ rows: z.array(z.array(ref).min(1).max(2)).max(96),
  predicate: obj({ field: z.enum(["queryId", "userId"]), id: ref }).nullable() });
const image = obj({ format: z.literal("SYNTHETIC_MODEL_IMAGE_SHA256_V1"), digest: z.string().regex(/^[0-9a-f]{64}$/) });
const eventSchema = obj({ eventId: id, context: contextSchema, writerOperation: z.enum(operations),
  eventType: z.enum(["ROW_WRITE", "AUDIT_INTENT"]), resource: z.enum(resources), tableType: z.enum(resources.map(r => `MODEL_${r}`) as [string, ...string[]]),
  action: z.enum(["INSERT", "UPDATE", "DELETE"]), identity: identitySchema, columns: z.array(z.enum(columns)).max(32),
  beforeImage: image, afterImage: image, affectedRows: z.number().int().min(0).max(96),
  revisionDomains: z.array(z.enum(domains)).max(3), effect: z.enum(["PRIMARY", "DECLARED_SIDE_EFFECT", "REVISION_ONLY", "AUDIT_INTENT"]) });
const receiptSchema = obj({ format: z.literal("SYNTHETIC_REVISION_RECEIPT_V1"), receiptId: id,
  origin: z.literal("SYNTHETIC_COUNTER_V1"), context: contextSchema, writerOperation: z.enum(operations),
  domain: z.enum(domains), entity: obj({ resource: z.enum(resources), identity: z.array(ref).min(1).max(2) }),
  beforeRevision: z.union([rv, id]).nullable(), afterRevision: z.union([rv, id]).nullable(),
  affectedRows: z.literal(1), eventIds: z.array(id).length(1) }).superRefine((receipt, ctx) => {
    const codec = receipt.domain === "TOKEN_VERSION" ? id : rv;
    const before = receipt.beforeRevision, after = receipt.afterRevision;
    if (before === null && after === null || [before, after].some(v => v !== null && !codec.safeParse(v).success)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "REVISION_FORMAT_INVALID" }); return;
    }
    if (before !== null && after !== null) {
      const integer = (v: string) => BigInt(receipt.domain === "TOKEN_VERSION" ? v : `0x${v}`);
      if (integer(after) <= integer(before)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "REVISION_NOT_ADVANCED" });
    }
  });
const eventObservation = obj({ format: z.literal("SYNTHETIC_WRITE_EVENT_OBSERVATION_V1"),
  provenance: z.literal("SYNTHETIC_TEST_ONLY"), context: contextSchema, events: z.array(eventSchema).max(256) });
const revisionObservation = obj({ format: z.literal("SYNTHETIC_REVISION_OBSERVATION_V1"),
  provenance: z.literal("SYNTHETIC_TEST_ONLY"), context: contextSchema, receipts: z.array(receiptSchema).max(384) });
export type SyntheticWriteEventV3 = z.infer<typeof eventSchema>;
export type SyntheticRevisionReceiptV3 = z.infer<typeof receiptSchema>;
export type SyntheticWriteObservationV3 = z.infer<typeof eventObservation>;
export type SyntheticRevisionObservationV3 = z.infer<typeof revisionObservation>;
const restrictions = { authority: "NONE", runtimeBindVerified: false, deliveryAllowed: false,
  persistence: "NOT_PROVEN", productionSafetyProven: false } as const;
const blocked = ["REAL_DML_OBSERVATION", "DB_GENERATED_REVISIONS", "PRODUCTION_COLUMNS_HISTORY_CASCADE_TRIGGER",
  "REAL_AUDIT_PERSISTENCE", "SQL_OWNER_RESERVATION", "AE_Q_WRITER_COVERAGE", "SOURCE_GENERATION_LEASE"] as const;
class Invalid extends Error { constructor(readonly code: string) { super("SYNTHETIC_WRITE_REJECTED"); } }
const fail = (code: string): never => { throw new Invalid(code); };
function snapshot(input: unknown): unknown {
  let budget = 0;
  function copy(v: unknown, depth: number): unknown {
    if (++budget > 100000 || depth > 18) fail("RESOURCE_BUDGET");
    if (v === null || typeof v === "number" || typeof v === "boolean") return v;
    if (typeof v === "string") { if (v.length > 128) fail("FORMAT_INVALID"); return v; }
    if (typeof v !== "object" || types.isProxy(v)) return fail("FORMAT_INVALID");
    const p = Object.getPrototypeOf(v), ds = Object.getOwnPropertyDescriptors(v);
    if (Object.getOwnPropertySymbols(v).length) fail("FORMAT_INVALID");
    if (Array.isArray(v)) {
      if (p !== Array.prototype || v.length > 768 || Object.keys(ds).length !== v.length + 1) fail("FORMAT_INVALID");
      return Array.from({ length: v.length }, (_, i) => { const d = ds[String(i)];
        if (!d || !("value" in d) || !d.enumerable) return fail("FORMAT_INVALID"); return copy(d.value, depth + 1); });
    }
    if (p !== Object.prototype && p !== null || Object.keys(ds).length > 24) fail("FORMAT_INVALID");
    const out = Object.create(null) as Record<string, unknown>;
    for (const [k, d] of Object.entries(ds)) { if (!("value" in d) || !d.enumerable) fail("FORMAT_INVALID"); out[k] = copy(d.value, depth + 1); }
    return out;
  }
  return copy(input, 0);
}
function canonical(v: unknown): string {
  const sorted = (x: unknown): unknown => Array.isArray(x) ? x.map(sorted) : x && typeof x === "object"
    ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => [k, sorted(v)])) : x;
  return JSON.stringify(sorted(v));
}
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
function freeze<T>(v: T): Readonly<T> { if (v && typeof v === "object") { Object.values(v).forEach(freeze); Object.freeze(v); } return v; }
const digest = (rows: Row[]) => ({ format: "SYNTHETIC_MODEL_IMAGE_SHA256_V1" as const,
  digest: createHash("sha256").update(canonical(rows), "utf8").digest("hex") });
const compare = (a: string[], b: string[]) => { for (let i = 0; i < Math.min(a.length, b.length); i++) {
  const x = a[i]!, y = b[i]!; if (x === y) continue;
  return x === "$NEW" ? -1 : y === "$NEW" ? 1 : BigInt(x) < BigInt(y) ? -1 : 1;
} return a.length - b.length; };
function keys(resource: Resource, n: Row): string[] {
  const fields = resource === "UserRole" ? ["userId", "roleId"] : resource === "RolePermission" ? ["roleId", "permissionId"]
    : resource === "RoleACL" ? ["queryId", "roleId"] : resource === "UserACL" ? ["queryId", "userId"] : ["id"];
  return fields.map(k => n[k] as string);
}
function row(n: MutationNodeV2): Row {
  // Effective dataset is a JOIN projection, never a stored source-column write.
  return Object.fromEntries(Object.entries(n).filter(([k]) => k !== "resource" && k !== "effectiveQueryDatasetId")) as Row;
}
function revisionFields(resource: Resource): [string, Domain][] {
  if (resource === "AuditIntent") return [];
  const domain: Domain = resource === "Query" ? "Q" : resource === "Dataset" ? "D" : resource === "Dashboard" ? "DASHBOARD_APPROVAL"
    : resource === "AuthorizationEpoch" ? "AE" : resource === "Generation" ? "MODEL_GENERATION" : "MODEL_ROW";
  return [["revision", domain], ...(resource === "AppUser" ? [["tokenVersion", "TOKEN_VERSION"] as [string, Domain]] : []),
    ...(resource === "ManagedSource" ? [["bindingRevision", "DASHBOARD_BINDING"] as [string, Domain]] : [])];
}
function derive(mutation: unknown, assigned?: string) {
  const plan = prepareSyntheticMutationV2(mutation); if (!("expected" in plan)) return fail("C4_CONTRACT_REJECTED");
  const m = mutation as MutationRequestV2, d = m.delta;
  const context = { requestId: m.requestId, ownerId: m.context.ownerId, transactionId: m.context.transactionId,
    domainId: m.current.domainId, incarnation: m.current.incarnation };
  const bind = (n: MutationNodeV2) => Object.fromEntries(Object.entries(n).map(([k, v]) => [k, v === "$NEW" && assigned ? assigned : v])) as MutationNodeV2;
  const expectedNodes = plan.expected.nodes.map(bind), currentNodes = m.current.nodes;
  const initial = new Map<Resource, Row[]>(), final = new Map<Resource, Row[]>();
  for (const kind of resources) {
    initial.set(kind, currentNodes.filter(n => n.resource === kind).map(row).sort((a, b) => compare(keys(kind, a), keys(kind, b))));
    final.set(kind, expectedNodes.filter(n => n.resource === kind).map(row).sort((a, b) => compare(keys(kind, a), keys(kind, b))));
  }
  for (const [kind, field] of [["AuthorizationEpoch", "authorizationEpoch"], ["Generation", "generation"]] as const) {
    initial.set(kind, [{ id: "1", revision: m.current[field] }]); final.set(kind, [{ id: "1", revision: plan.expected[field] }]);
  }
  const audit: Row = { id: "1", requestId: m.requestId, actorId: m.context.actorId, operation: d.operation, eventStatus: "MODEL_COMMITTED" };
  final.set("AuditIntent", [audit]);
  const work = structuredClone(initial), inventory: SyntheticWriteEventV3[] = [], receipts: SyntheticRevisionReceiptV3[] = [];
  const selected = (map: Map<Resource, Row[]>, kind: Resource, ids: string[]) => map.get(kind)!.filter(n => same(keys(kind, n), ids));
  function write(kind: Resource, action: SyntheticWriteEventV3["action"], ids: string[], requestedColumns: Column[] | null,
    effect: SyntheticWriteEventV3["effect"], predicate: z.infer<typeof identitySchema>["predicate"] = null) {
    const before = predicate ? work.get(kind)!.filter(n => n[predicate.field] === predicate.id) : action === "INSERT" ? [] : selected(work, kind, ids);
    const after = action === "DELETE" ? [] : selected(final, kind, ids);
    if (!predicate && (action !== "INSERT" && before.length !== 1 || action !== "DELETE" && after.length !== 1)
      || action === "INSERT" && selected(work, kind, ids).length) fail("WRITE_PLAN_INVALID");
    const cols = requestedColumns ?? Object.keys(before[0] ?? after[0] ?? (kind === "UserRole" ? { userId: null, roleId: null, revision: null }
      : { queryId: null, [kind === "RoleACL" ? "roleId" : "userId"]: null, canView: null, canExecute: null, canExport: null, revision: null })) as Column[];
    if (action === "UPDATE") for (const field of Object.keys(after[0]!)) {
      if (!same(before[0]![field], after[0]![field]) && !cols.includes(field as Column)) fail("UNDECLARED_MODEL_EFFECT");
    }
    const eventId = (BigInt(inventory.length) + 1n).toString(), beforeKeys = before.map(n => keys(kind, n));
    const rows = action === "INSERT" ? after.map(n => keys(kind, n)) : beforeKeys;
    const fields = revisionFields(kind);
    const event: SyntheticWriteEventV3 = { eventId, context, writerOperation: d.operation, eventType: kind === "AuditIntent" ? "AUDIT_INTENT" : "ROW_WRITE",
      resource: kind, tableType: `MODEL_${kind}`, action, identity: { rows, predicate }, columns: [...cols].sort(), beforeImage: digest(before), afterImage: digest(after),
      affectedRows: action === "DELETE" ? before.length : 1, revisionDomains: fields.map(([, domain]) => domain), effect };
    inventory.push(event);
    for (const n of action === "DELETE" ? before : after) for (const [field, domain] of fields) {
      const old = before.find(b => same(keys(kind, b), keys(kind, n))), next = after.find(b => same(keys(kind, b), keys(kind, n)));
      const previous = old?.[field] as string | undefined, following = next?.[field] as string | undefined;
      if (previous === following) fail("MODEL_REVISION_NOT_ADVANCED");
      receipts.push({ format: "SYNTHETIC_REVISION_RECEIPT_V1", receiptId: (BigInt(receipts.length) + 1n).toString(), origin: "SYNTHETIC_COUNTER_V1",
        context, writerOperation: d.operation, domain, entity: { resource: kind, identity: keys(kind, n) }, beforeRevision: previous ?? null,
        afterRevision: following ?? null, affectedRows: 1, eventIds: [eventId] });
    }
    work.set(kind, [...work.get(kind)!.filter(n => !beforeKeys.some(k => same(keys(kind, n), k))), ...after]
      .sort((a, b) => compare(keys(kind, a), keys(kind, b))));
  }
  const insert = (k: Resource, ids: string[], effect: SyntheticWriteEventV3["effect"] = "PRIMARY") => write(k, "INSERT", ids, null, effect);
  const update = (k: Resource, ids: string[], c: Column[], effect: SyntheticWriteEventV3["effect"] = "PRIMARY") => write(k, "UPDATE", ids, c, effect);
  const remove = (k: Resource, ids: string[]) => write(k, "DELETE", ids, null, "PRIMARY");
  const batchDelete = (k: Resource, field: "queryId" | "userId", value: string) => write(k, "DELETE", [], null, "PRIMARY", { field, id: value });
  const dashboards = () => { for (const n of final.get("Dashboard")!) {
    const old = selected(initial, "Dashboard", keys("Dashboard", n))[0]!;
    if (old.revision !== n.revision) update("Dashboard", keys("Dashboard", n), ["revision"], "DECLARED_SIDE_EFFECT");
  } };
  const newId = assigned ?? "$NEW";
  switch (d.operation) {
    case "QUERY_REBIND": update("Query", [d.targetId], ["datasetId", "published", "publishedByUserId", "revision"]); break;
    case "PARAMETER_ADD": case "PARAMETER_DELETE": case "PARAMETER_LOOKUP": {
      const owner = d.operation === "PARAMETER_ADD" ? d.targetId : selected(initial, "Parameter", [d.targetId])[0]!.datasetId as string;
      if (d.operation === "PARAMETER_ADD") insert("Parameter", [newId]);
      else if (d.operation === "PARAMETER_DELETE") remove("Parameter", [d.targetId]);
      else update("Parameter", [d.targetId], ["lookupDatasetId", "revision"]);
      update("Dataset", [owner], ["revision"], "DECLARED_SIDE_EFFECT");
      for (const q of initial.get("Query")!) if (q.datasetId === owner && q.published)
        update("Query", keys("Query", q), ["published", "publishedByUserId", "revision"], "DECLARED_SIDE_EFFECT");
      break;
    }
    case "CREATE_USER": insert("AppUser", [newId]); for (const role of [...d.roleIds].sort((a, b) => compare([a], [b]))) insert("UserRole", [newId, role], "DECLARED_SIDE_EFFECT"); break;
    case "CREATE_ROLE": insert("Role", [newId]); for (const p of [...d.permissionIds].sort((a, b) => compare([a], [b]))) insert("RolePermission", [newId, p], "DECLARED_SIDE_EFFECT"); break;
    case "USER_ROLE":
      if (d.grant) insert("UserRole", [d.targetId, d.roleId]); else remove("UserRole", [d.targetId, d.roleId]);
      update("AppUser", [d.targetId], ["tokenVersion", "revision"], "DECLARED_SIDE_EFFECT"); break;
    case "ROLE_PERMISSION":
      update("Role", [d.targetId], ["revision"]);
      if (d.grant) insert("RolePermission", [d.targetId, d.permissionId]); else remove("RolePermission", [d.targetId, d.permissionId]);
      for (const member of initial.get("UserRole")!) if (member.roleId === d.targetId)
        update("AppUser", [member.userId as string], ["tokenVersion", "revision"], "DECLARED_SIDE_EFFECT"); break;
    case "ACL_REPLACE":
      dashboards(); batchDelete("RoleACL", "queryId", d.targetId); batchDelete("UserACL", "queryId", d.targetId);
      for (const r of [...d.roles].sort((a, b) => compare([a.roleId], [b.roleId]))) insert("RoleACL", [d.targetId, r.roleId]);
      for (const u of [...d.users].sort((a, b) => compare([a.userId], [b.userId]))) insert("UserACL", [d.targetId, u.userId]); break;
    case "DELETE_USER": dashboards(); batchDelete("UserACL", "userId", d.targetId); batchDelete("UserRole", "userId", d.targetId); remove("AppUser", [d.targetId]); break;
    case "SOURCE_REBIND": update("ManagedSource", [d.targetId], ["queryId", "bindingRevision", "revision"]); dashboards(); break;
  }
  if (m.current.authorizationEpoch !== plan.expected.authorizationEpoch) update("AuthorizationEpoch", ["1"], ["revision"], "REVISION_ONLY");
  update("Generation", ["1"], ["revision"], "REVISION_ONLY"); insert("AuditIntent", ["1"], "AUDIT_INTENT");
  if (!same([...work], [...final])) fail("UNDECLARED_MODEL_EFFECT");
  if (inventory.length > 256 || receipts.length > 384) fail("RESOURCE_BUDGET");
  // Schema-check our output too; receipt origins never accept DB_GENERATED or Audit receipt formats.
  return { context, inventory: inventory.map(e => eventSchema.parse(e)), receipts: receipts.map(e => receiptSchema.parse(e)) };
}
function rejected(e: unknown) { return freeze({ classification: "MODEL_REJECTED" as const,
  reason: e instanceof Invalid ? e.code : "FORMAT_INVALID", ...restrictions }); }
export function prepareSyntheticWriteInventoryV3(input: unknown) {
  try { const expected = derive(snapshot(input)); return freeze({ classification: "MODEL_CONSISTENT" as const,
    format: "SYNTHETIC_WRITE_INVENTORY_V3" as const, ...expected, blockedProductionEffects: blocked, ...restrictions }); }
  catch (e) { return rejected(e); }
}
export function validateSyntheticWriteInventoryV3(input: unknown) {
  try {
    const v = obj({ scope: z.literal("SYNTHETIC_TEST_ONLY"), mutation: z.unknown(), allocation: z.unknown(), post: z.unknown(),
      eventObservation, revisionObservation }).parse(snapshot(input));
    const post = validateSyntheticMutationV2({ request: v.mutation, allocation: v.allocation, observation: v.post });
    if (post.classification !== "MODEL_CONSISTENT") fail("C4_POST_REJECTED");
    // C4 already validated the exact allocation; no identity or expectation is taken from P/events.
    const allocation = v.allocation as MutationAllocationV2;
    const expected = derive(v.mutation, allocation.bindings[0]?.id);
    if (!same(v.eventObservation.context, expected.context) || !same(v.revisionObservation.context, expected.context)) fail("OWNER_CONTEXT_MISMATCH");
    if (!same(v.eventObservation.events, expected.inventory)) fail("WRITE_INVENTORY_MISMATCH");
    if (!same(v.revisionObservation.receipts, expected.receipts)) fail("REVISION_RECEIPT_MISMATCH");
    return freeze({ classification: "MODEL_CONSISTENT" as const, reason: null, ...restrictions });
  } catch (e) { return rejected(e); }
}
