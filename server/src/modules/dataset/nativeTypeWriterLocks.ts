import { types } from "node:util";
import { z } from "zod";

// Isolated logical lock model only: no imports of SQL, repositories, or B2 transaction ports.
export const CANDIDATE_RESOURCE_ORDER = Object.freeze(["AuthorizationEpoch", "Permission", "Role", "RolePermission", "AppUser", "UserRole",
  "DataSource", "Dataset", "DatasetParameter", "QueryDefinition", "Dashboard", "DashboardDataSource", "QueryAcl",
  "Review", "Decision", "Audit"] as const);
const resource = z.enum(CANDIDATE_RESOURCE_ORDER);
const writer = z.enum(["QUERY_ACL", "USER_CREATE", "USER_UPDATE", "DELETE_USER", "ROLE_CREATE", "ROLE_UPDATE",
  "QUERY_REBIND", "QUERY_RESTORE", "QUERY_PUBLISH", "QUERY_AVAILABILITY", "DATASET_UPDATE", "DATASET_RESTORE",
  "PARAMETER_SAVE", "PARAMETER_SYNC", "SOURCE_UPDATE", "LEGACY_BINDINGS", "DASHBOARD_APPROVAL", "MANAGED_DASHBOARD",
  "SENSITIVITY", "REVIEW_READER", "TAIL_EPOCH_PATCH", "MIGRATION", "EXTERNAL_SQL", "MIXED_VERSION"]);
const object = <S extends z.ZodRawShape>(shape: S) => z.object(shape).strict();
const edge = object({ before: resource, after: resource, writer,
  basis: z.enum(["SOURCE_SEQUENCE", "HYPOTHETICAL"]) });
const graphSchema = object({ scope: z.literal("SYNTHETIC_TEST_ONLY"), edges: z.array(edge).max(256),
  unknownWriters: z.array(writer).max(32) });
export type LockDependency = z.infer<typeof edge>;
export type SyntheticLockGraph = z.infer<typeof graphSchema>;
export type LockResource = z.infer<typeof resource>;
const restrictions = { authority: "NONE", runtimeBindVerified: false, deliveryAllowed: false,
  persistence: "NOT_PROVEN" } as const;

function snapshot(input: unknown): unknown {
  let nodes = 0;
  function copy(v: unknown, depth: number): unknown {
    if (++nodes > 20000 || depth > 10) throw new Error();
    if (v === null || typeof v === "boolean" || typeof v === "number") return v;
    if (typeof v === "string") { if (v.length > 128) throw new Error(); return v; }
    if (typeof v !== "object" || types.isProxy(v)) throw new Error();
    const proto = Object.getPrototypeOf(v), descriptors = Object.getOwnPropertyDescriptors(v);
    if (Object.getOwnPropertySymbols(v).length) throw new Error();
    if (Array.isArray(v)) {
      if (proto !== Array.prototype || v.length > 256 || Object.keys(descriptors).length !== v.length + 1) throw new Error();
      return Array.from({ length: v.length }, (_, i) => {
        const d = descriptors[String(i)];
        if (!d || !("value" in d) || !d.enumerable) throw new Error();
        return copy(d.value, depth + 1);
      });
    }
    if (proto !== Object.prototype && proto !== null || Object.keys(descriptors).length > 24) throw new Error();
    const out: Record<string, unknown> = Object.create(null);
    for (const [key, d] of Object.entries(descriptors)) {
      if (!("value" in d) || !d.enumerable) throw new Error();
      out[key] = copy(d.value, depth + 1);
    }
    return out;
  }
  return copy(input, 0);
}

/** SOURCE_SEQUENCE means retained-lock/next-access dependency, NOT optimizer lock chronology. */
export function analyzeSyntheticLockGraph(input: unknown) {
  const result = (analysis: "FORMAT_INVALID" | "CYCLE" | "INCOMPLETE" | "KNOWN_SUBGRAPH_ACYCLIC",
    order: LockResource[] | null, cycle: LockDependency[], unknownWriters: z.infer<typeof writer>[]) => Object.freeze({
    kind: "ISOLATED_LOCK_GRAPH_V1" as const, analysis, order: order && Object.freeze(order),
    cycle: Object.freeze(cycle.map(e => Object.freeze(e))), unknownWriters: Object.freeze(unknownWriters), ...restrictions,
  });
  try {
    const parsed = graphSchema.safeParse(snapshot(input));
    if (!parsed.success) return result("FORMAT_INVALID", null, [], []);
    const { edges, unknownWriters } = parsed.data;
    const color = new Map<LockResource, number>(), path: LockResource[] = [], trail: LockDependency[] = [];
    let cycle: LockDependency[] = [];
    function visit(node: LockResource): boolean {
      color.set(node, 1); path.push(node);
      for (const e of edges.filter(e => e.before === node)) {
        if (color.get(e.after) === 1) { cycle = [...trail.slice(path.indexOf(e.after)), e]; return true; }
        if (!color.get(e.after)) { trail.push(e); if (visit(e.after)) return true; trail.pop(); }
      }
      path.pop(); color.set(node, 2); return false;
    }
    for (const node of CANDIDATE_RESOURCE_ORDER) if (!color.get(node) && visit(node)) return result("CYCLE", null, cycle, unknownWriters);
    const order: LockResource[] = [], pending = new Set<LockResource>(CANDIDATE_RESOURCE_ORDER);
    while (pending.size) {
      const next = CANDIDATE_RESOURCE_ORDER.find(n => pending.has(n) && !edges.some(e => e.after === n && pending.has(e.before)));
      if (!next) return result("FORMAT_INVALID", null, [], unknownWriters);
      order.push(next); pending.delete(next);
    }
    return result(unknownWriters.length ? "INCOMPLETE" : "KNOWN_SUBGRAPH_ACYCLIC", order, [], unknownWriters);
  } catch { return result("FORMAT_INVALID", null, [], []); }
}

// Traceable source dependencies; see B3-B3 matrix for lines, conditions and omitted SQL-plan locks.
export const OBSERVED_LOCK_GRAPH: SyntheticLockGraph = {
  scope: "SYNTHETIC_TEST_ONLY",
  edges: [
    { before: "QueryDefinition", after: "Dataset", writer: "QUERY_REBIND", basis: "SOURCE_SEQUENCE" },
    { before: "QueryDefinition", after: "Dataset", writer: "QUERY_RESTORE", basis: "SOURCE_SEQUENCE" },
    { before: "Dataset", after: "QueryDefinition", writer: "DATASET_UPDATE", basis: "SOURCE_SEQUENCE" },
    { before: "Dataset", after: "DataSource", writer: "DATASET_RESTORE", basis: "SOURCE_SEQUENCE" },
    { before: "Dataset", after: "DatasetParameter", writer: "PARAMETER_SAVE", basis: "SOURCE_SEQUENCE" },
    { before: "DatasetParameter", after: "QueryDefinition", writer: "PARAMETER_SAVE", basis: "SOURCE_SEQUENCE" },
    { before: "Dataset", after: "DatasetParameter", writer: "PARAMETER_SYNC", basis: "SOURCE_SEQUENCE" },
    { before: "DatasetParameter", after: "QueryDefinition", writer: "PARAMETER_SYNC", basis: "SOURCE_SEQUENCE" },
    { before: "Dataset", after: "Dashboard", writer: "LEGACY_BINDINGS", basis: "SOURCE_SEQUENCE" },
    { before: "Dataset", after: "Dashboard", writer: "SENSITIVITY", basis: "SOURCE_SEQUENCE" },
    { before: "Dashboard", after: "QueryDefinition", writer: "LEGACY_BINDINGS", basis: "SOURCE_SEQUENCE" },
    { before: "QueryDefinition", after: "DashboardDataSource", writer: "LEGACY_BINDINGS", basis: "SOURCE_SEQUENCE" },
    { before: "Dashboard", after: "QueryAcl", writer: "QUERY_ACL", basis: "SOURCE_SEQUENCE" },
    { before: "DashboardDataSource", after: "AppUser", writer: "DASHBOARD_APPROVAL", basis: "SOURCE_SEQUENCE" },
    { before: "DashboardDataSource", after: "QueryAcl", writer: "DASHBOARD_APPROVAL", basis: "SOURCE_SEQUENCE" },
    { before: "AppUser", after: "Role", writer: "USER_UPDATE", basis: "SOURCE_SEQUENCE" },
    { before: "Role", after: "RolePermission", writer: "ROLE_UPDATE", basis: "SOURCE_SEQUENCE" },
    { before: "RolePermission", after: "AppUser", writer: "ROLE_UPDATE", basis: "SOURCE_SEQUENCE" },
    { before: "AppUser", after: "QueryDefinition", writer: "DELETE_USER", basis: "SOURCE_SEQUENCE" },
    { before: "AppUser", after: "QueryAcl", writer: "DELETE_USER", basis: "SOURCE_SEQUENCE" },
    { before: "QueryAcl", after: "UserRole", writer: "DELETE_USER", basis: "SOURCE_SEQUENCE" },
    { before: "Dashboard", after: "DashboardDataSource", writer: "MANAGED_DASHBOARD", basis: "SOURCE_SEQUENCE" },
    { before: "DashboardDataSource", after: "QueryDefinition", writer: "MANAGED_DASHBOARD", basis: "SOURCE_SEQUENCE" },
  ],
  unknownWriters: writer.options.filter(w => w !== "TAIL_EPOCH_PATCH"),
};

const rv = z.string().regex(/^[a-f0-9]{16}$/).refine(v => v !== "0000000000000000");
const id = z.string().regex(/^[1-9][0-9]{0,18}$/).refine(v => BigInt(v) <= 9223372036854775807n);
const uuid = z.string().uuid().regex(/^[a-f0-9-]+$/);
const revisions = object({ AE: rv, Q: rv, D: rv, S: rv });
type RevisionDomain = keyof z.infer<typeof revisions>;
const profiles = {
  QUERY_ACL: { target: "QueryDefinition", domains: ["AE"], locks: ["AuthorizationEpoch", "QueryDefinition", "Dashboard", "QueryAcl"] },
  USER_SECURITY: { target: "AppUser", domains: ["AE"], locks: ["AuthorizationEpoch", "Role", "AppUser", "UserRole"] },
  DELETE_USER: { target: "AppUser", domains: ["AE"], locks: ["AuthorizationEpoch", "Role", "AppUser", "UserRole", "QueryDefinition", "QueryAcl"] },
  ROLE_SECURITY: { target: "Role", domains: ["AE"], locks: ["AuthorizationEpoch", "Role", "RolePermission", "AppUser", "UserRole"] },
  QUERY_REBIND: { target: "QueryDefinition", domains: ["AE", "Q"], locks: ["AuthorizationEpoch", "Dataset", "QueryDefinition"] },
  QUERY_RESTORE_REBIND: { target: "QueryDefinition", domains: ["AE", "Q"], locks: ["AuthorizationEpoch", "Dataset", "QueryDefinition"] },
  QUERY_AVAILABILITY: { target: "QueryDefinition", domains: ["Q"], locks: ["Dataset", "QueryDefinition"] },
  DATASET: { target: "Dataset", domains: ["D", "Q"], locks: ["Dataset", "QueryDefinition"] },
  DATASET_ONLY: { target: "Dataset", domains: ["D"], locks: ["Dataset", "QueryDefinition"] },
  PARAMETER: { target: "Dataset", domains: ["D", "Q"], locks: ["Dataset", "DatasetParameter", "QueryDefinition"] },
  PARAMETER_ONLY: { target: "Dataset", domains: ["D"], locks: ["Dataset", "DatasetParameter", "QueryDefinition"] },
  SOURCE: { target: "DataSource", domains: ["S"], locks: ["DataSource"] },
} as const satisfies Record<string, { target: LockResource; domains: readonly RevisionDomain[]; locks: readonly LockResource[] }>;
export type SyntheticWriterProfile = keyof typeof profiles;
const step = z.enum(["BEGIN", "VERIFY_ISOLATION", "XACT_ABORT_ON", "ACQUIRE_LOCKS", "CAS", "MUTATE", "ADVANCE_REVISIONS",
  "FINAL_AUTHORIZATION", "FINAL_VERSIONS", "FINAL_DECISION_GATE", "COMMIT"]);
const planSchema = object({
  scope: z.literal("SYNTHETIC_TEST_ONLY"), format: z.literal("WRITER_TRANSACTION_MODEL_V1"),
  writer: z.enum(Object.keys(profiles) as [SyntheticWriterProfile, ...SyntheticWriterProfile[]]),
  ownership: z.enum(["OWNED", "EXTERNAL"]), isolation: z.enum(["SERIALIZABLE", "READ_COMMITTED", "UNKNOWN"]),
  isolationEvidence: z.enum(["SYNTHETIC_OWNER_OBSERVATION", "UNVERIFIED"]), xactAbort: z.boolean(),
  rollbackResponsibility: z.enum(["OWNER", "UNKNOWN"]),
  lockCoverage: z.enum(["SYNTHETIC_COMPLETE", "UNKNOWN"]),
  transactionReferences: object({ owner: uuid, read: uuid, cas: uuid, mutation: uuid, revision: uuid, finalRevalidation: uuid, commit: uuid }),
  locks: z.array(object({ resource, key: id, coverage: z.enum(["ROW", "RANGE"]), result: z.enum(["PRESENT", "EMPTY"]) })).max(128),
  expected: revisions, observed: revisions, after: revisions, affectedRows: z.literal(1),
  steps: z.array(step).max(16), finalAuthorizationValid: z.boolean(), finalVersionsValid: z.boolean(),
  outcome: z.enum(["SIMULATED_COMMIT", "DEADLOCK", "TIMEOUT", "MUTATION_FAILED", "REVISION_FAILED", "ROLLBACK_FAILED", "COMMIT_UNKNOWN"]),
});
export type SyntheticWriterTransaction = z.infer<typeof planSchema>;
export type WriterTransactionReason = "FORMAT_INVALID" | "TRANSACTION_UNVERIFIED" | "LOCK_ORDER_INVALID"
  | "TRANSACTION_SCOPE_MISMATCH" | "LOCK_SCOPE_INCOMPLETE" | "CAS_CONFLICT" | "REVISION_INVALID" | "STEP_ORDER_INVALID"
  | "FINAL_REVALIDATION_FAILED" | "OUTCOME_UNSAFE";

export function validateSyntheticWriterTransaction(input: unknown) {
  const result = (reason: WriterTransactionReason | null) => Object.freeze({ kind: "ISOLATED_WRITER_TRANSACTION_V1" as const,
    consistent: reason === null, reason, ...restrictions });
  try {
    const parsed = planSchema.safeParse(snapshot(input));
    if (!parsed.success) return result("FORMAT_INVALID");
    const p = parsed.data, profile = profiles[p.writer];
    if (p.ownership !== "OWNED" || p.isolation !== "SERIALIZABLE" || p.isolationEvidence !== "SYNTHETIC_OWNER_OBSERVATION"
      || !p.xactAbort || p.rollbackResponsibility !== "OWNER") return result("TRANSACTION_UNVERIFIED");
    if (Object.values(p.transactionReferences).some(ref => ref !== p.transactionReferences.owner)) return result("TRANSACTION_SCOPE_MISMATCH");
    if (p.outcome !== "SIMULATED_COMMIT") return result("OUTCOME_UNSAFE");
    if (p.lockCoverage !== "SYNTHETIC_COMPLETE") return result("LOCK_SCOPE_INCOMPLETE");
    let lastRank = -1, lastKey = 0n;
    const seen = new Set<LockResource>();
    for (const lock of p.locks) {
      const rank = CANDIDATE_RESOURCE_ORDER.indexOf(lock.resource), key = BigInt(lock.key);
      if (rank < lastRank || rank === lastRank && key <= lastKey) return result("LOCK_ORDER_INVALID");
      if (lock.result === "EMPTY" && lock.coverage !== "RANGE"
        || lock.resource === "AuthorizationEpoch" && (lock.key !== "1" || lock.result !== "PRESENT"))
        return result("LOCK_SCOPE_INCOMPLETE");
      lastRank = rank; lastKey = key; seen.add(lock.resource);
    }
    if (profile.locks.some(r => !seen.has(r))) return result("LOCK_SCOPE_INCOMPLETE");
    if (!p.locks.some(lock => lock.resource === profile.target && lock.result === "PRESENT")) return result("LOCK_SCOPE_INCOMPLETE");
    for (const domain of ["AE", "Q", "D", "S"] as const) {
      if (p.expected[domain] !== p.observed[domain]) return result("CAS_CONFLICT");
      const advances = (profile.domains as readonly RevisionDomain[]).includes(domain);
      if (advances ? BigInt(`0x${p.after[domain]}`) <= BigInt(`0x${p.observed[domain]}`) : p.after[domain] !== p.observed[domain])
        return result("REVISION_INVALID");
    }
    if (JSON.stringify(p.steps) !== JSON.stringify(step.options)) return result("STEP_ORDER_INVALID");
    if (!p.finalAuthorizationValid || !p.finalVersionsValid) return result("FINAL_REVALIDATION_FAILED");
    return result(null);
  } catch { return result("FORMAT_INVALID"); }
}
