import { createHash } from "node:crypto";
import { z } from "zod";

// Backend-only, synthetic contract consistency. No database, issuer or runtime gate.
const object = <S extends z.ZodRawShape>(shape: S) => z.object(shape).strict();
const id = z.string().regex(/^[1-9][0-9]{0,18}$/).refine(v => BigInt(v) <= 9223372036854775807n);
const rv = z.string().regex(/^[a-f0-9]{16}$/).refine(v => v !== "0000000000000000");
const uuid = z.string().uuid().regex(/^[a-f0-9-]+$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const name = z.string().regex(/^[A-Z][A-Z0-9_]{0,126}$/);
const instant = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  .refine(v => Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v && !v.startsWith("0000"));
const provenance = z.literal("SYNTHETIC_TEST_ONLY");
const baseContract = z.discriminatedUnion("state", [object({ state: z.literal("MISSING") }),
  object({ state: z.literal("PRESENT"), rowVersion: rv })]);
const reviewState = z.enum(["PENDING", "CONFIRMED", "REJECTED", "REVOKED", "INVALIDATED"]);
const review = object({ reviewId: uuid, state: reviewState, stateRowVersion: rv });
const scope = object({ datasetId: id, dataSourceId: id, rowVersion: rv });
const reviewer = object({ userId: id, tokenVersion: id, scope });
const nativeType = z.union([
  object({ type: z.enum(["INT", "BIGINT", "BIT", "FLOAT", "DATE", "DATETIME2"]) }),
  object({ type: z.enum(["NVARCHAR", "VARCHAR", "VARBINARY"]), length: z.union([z.literal("MAX"), z.number().int().min(1).max(8000)]) })
    .refine(v => v.type !== "NVARCHAR" || v.length === "MAX" || v.length <= 4000),
  object({ type: z.literal("DECIMAL"), precision: z.number().int().min(1).max(38), scale: z.number().int().min(0).max(38) })
    .refine(v => v.scale <= v.precision),
]);
const declaration = object({ name, nativeType, cardinality: z.discriminatedUnion("kind", [
  object({ kind: z.literal("SCALAR") }), object({ kind: z.literal("FIXED_LIST"), length: z.number().int().min(1).max(128) }),
]) });
const declarations = z.array(declaration).max(2000);
const sqlIntegrity = object({ format: z.literal("SQL_UTF8_EXACT_V1"), digest: hash });
const parameterIntegrity = object({ format: z.literal("SAVED_PARAMETER_SNAPSHOT_V1"), digest: hash });
const nativeIntegrity = object({ format: z.literal("NATIVE_TYPES_V1"), digest: hash, parameters: declarations });
const versions = object({ collector: z.literal("SYNTHETIC_COLLECTOR_V1"), codec: z.literal("A3_ISOLATED_V1"),
  plan: z.literal("A2_ISOLATED_V1"), driver: z.literal("SYNTHETIC_MSSQL11_V1") });
const sourceReference = object({ identity: uuid, schemaGeneration: rv, leaseId: uuid, leaseVersion: rv });
const envelopeSchema = object({ format: z.literal("NATIVE_TYPE_REVIEW_V1"), provenance,
  datasetId: id, dataSourceId: id, definitionRowVersion: rv, configurationRowVersion: rv,
  baseContract, authorizationEpoch: rv, review, sql: sqlIntegrity, parameterDefinition: parameterIntegrity,
  nativeTypes: nativeIntegrity, source: sourceReference, reviewer, versions, evidenceAt: instant, expiresAt: instant });
const binding = object({ name, dataType: z.enum(["STRING", "NUMBER", "BOOLEAN", "DATE", "DATETIME"]),
  controlType: z.enum(["TEXT", "NUMBER", "DATE", "DATETIME", "SELECT", "MULTISELECT", "CHECKBOX"]),
  dateOutputMode: z.enum(["STRING", "NATIVE"]) });
const snapshotSchema = object({ provenance, datasetId: id, dataSourceId: id,
  datasetActive: z.boolean(), datasetArchived: z.boolean(), sourceActive: z.boolean(), sourceType: z.literal("SQLSERVER"),
  definitionRowVersion: rv, configurationRowVersion: rv, baseContract, review,
  sql: sqlIntegrity.extend({ tokenNames: z.array(name).max(2000) }).strict(),
  parameterDefinition: parameterIntegrity.extend({ bindings: z.array(binding).max(2000) }).strict(),
  nativeTypes: nativeIntegrity, proposedByUserId: id, versions });
const authorizationSchema = object({ provenance, authorizationEpoch: rv, reviewer,
  active: z.boolean(), interactive: z.boolean(), designQuery: z.boolean(), reviewNativeType: z.boolean(), scopeAllowed: z.boolean() });
const sourceSchema = object({ provenance, ...sourceReference.shape,
  lease: object({ state: z.literal("SYNTHETIC_VALIDATED"), identity: uuid, schemaGeneration: rv,
    leaseId: uuid, leaseVersion: rv, validFrom: instant, validUntil: instant }) });
const observationsSchema = object({ provenance, now: instant, snapshot: snapshotSchema,
  authorization: authorizationSchema, source: sourceSchema });

export type ReviewEvidenceEnvelope = z.infer<typeof envelopeSchema>;
export type ReviewSnapshot = z.infer<typeof snapshotSchema>;
export type AuthorizationObservation = z.infer<typeof authorizationSchema>;
export type SourceObservation = z.infer<typeof sourceSchema>;
export type ReviewObservations = z.infer<typeof observationsSchema>;
export type NativeReviewReason = "FORMAT_INVALID" | "STATE_UNUSABLE" | "DATASET_CONFLICT" | "SOURCE_CONFLICT"
  | "CONTRACT_CONFLICT" | "REVIEW_CONFLICT" | "INTEGRITY_CONFLICT" | "BINDING_INVALID" | "AUTHORIZATION_CONFLICT"
  | "REVIEWER_INVALID" | "TIME_INVALID" | "LEASE_INVALID";
export type ReviewConsistency = Readonly<{ kind: "ISOLATED_REVIEW_CONSISTENCY"; consistent: boolean;
  reason: NativeReviewReason | null; authority: "NONE"; runtimeBindVerified: false; deliveryAllowed: false }>;
function result(reason: NativeReviewReason | null): ReviewConsistency {
  return Object.freeze({ kind: "ISOLATED_REVIEW_CONSISTENCY", consistent: reason === null, reason,
    authority: "NONE", runtimeBindVerified: false, deliveryAllowed: false });
}

// Copy descriptors before schema parsing. No getters, custom prototypes, symbols,
// toJSON hooks or unbounded object graphs; never expose schema issues or raw causes.
function dataSnapshot(input: unknown): unknown {
  let budget = 40000;
  const copy = (value: unknown, depth: number): unknown => {
    if (--budget < 0 || depth > 16) throw new Error();
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "string" && value.length <= 4096) return value;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (!value || typeof value !== "object") throw new Error();
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype || value.length > 2000
        || Reflect.ownKeys(value).length !== value.length + 1) throw new Error();
      return Array.from({ length: value.length }, (_, i) => {
        const d = Object.getOwnPropertyDescriptor(value, String(i));
        if (!d || !Object.hasOwn(d, "value")) throw new Error();
        return copy(d.value, depth + 1);
      });
    }
    if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error();
    const keys = Reflect.ownKeys(value);
    if (keys.length > 64) throw new Error();
    const output: Record<string, unknown> = Object.create(null);
    for (const key of keys) {
      const d = Object.getOwnPropertyDescriptor(value, key)!;
      if (typeof key !== "string" || !Object.hasOwn(d, "value")) throw new Error();
      output[key] = copy(d.value, depth + 1);
    }
    return output;
  };
  return copy(input, 0);
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function nativeDigest(parameters: ReviewEvidenceEnvelope["nativeTypes"]["parameters"]): string {
  const tuples = [...parameters].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0).map(p => [
    p.name, p.nativeType.type, "length" in p.nativeType ? p.nativeType.length : null,
    "precision" in p.nativeType ? p.nativeType.precision : null, "scale" in p.nativeType ? p.nativeType.scale : null,
    p.cardinality.kind, p.cardinality.kind === "FIXED_LIST" ? p.cardinality.length : null,
  ]);
  return createHash("sha256").update(JSON.stringify(tuples), "utf8").digest("hex");
}
function bindingsValid(e: ReviewEvidenceEnvelope, s: ReviewSnapshot): boolean {
  const parameters = e.nativeTypes.parameters, bindings = s.parameterDefinition.bindings;
  const names = parameters.map(p => p.name);
  if (new Set(names).size !== names.length || new Set(s.sql.tokenNames).size !== s.sql.tokenNames.length
    || new Set(bindings.map(b => b.name)).size !== bindings.length || names.length !== bindings.length
    || names.length !== s.sql.tokenNames.length || names.some(n => !s.sql.tokenNames.includes(n))) return false;
  const generated = new Set<string>();
  for (const p of parameters) {
    const b = bindings.find(b => b.name === p.name);
    if (!b || (b.controlType === "MULTISELECT") !== (p.cardinality.kind === "FIXED_LIST")) return false;
    const allowed = b.dataType === "NUMBER" ? ["INT", "BIGINT", "FLOAT", "DECIMAL"] : b.dataType === "BOOLEAN" ? ["BIT"]
      : b.dataType === "STRING" || b.dateOutputMode === "STRING" ? ["NVARCHAR", "VARCHAR"]
      : [b.dataType === "DATE" ? "DATE" : "DATETIME2"];
    if (!allowed.includes(p.nativeType.type)) return false;
    const count = p.cardinality.kind === "FIXED_LIST" ? p.cardinality.length : 1;
    for (let i = 0; i < count; i++) {
      const expanded = p.cardinality.kind === "FIXED_LIST" ? `${p.name}__${i}` : p.name;
      if (expanded.length > 127 || generated.has(expanded) || generated.size >= 2000) return false;
      generated.add(expanded);
    }
  }
  return true;
}

/** Deterministic consistency only. Identical forged provider inputs cannot be authenticated here. */
export function validateNativeTypeReview(envelope: unknown, observations: unknown): ReviewConsistency {
  try {
    const e = envelopeSchema.parse(dataSnapshot(envelope));
    const o = observationsSchema.parse(dataSnapshot(observations));
    const s = o.snapshot, a = o.authorization, source = o.source, lease = source.lease;
    if (!["PENDING", "CONFIRMED"].includes(e.review.state) || !["PENDING", "CONFIRMED"].includes(s.review.state)) return result("STATE_UNUSABLE");
    if (!s.datasetActive || s.datasetArchived || e.datasetId !== s.datasetId || e.definitionRowVersion !== s.definitionRowVersion) return result("DATASET_CONFLICT");
    if (!s.sourceActive || e.dataSourceId !== s.dataSourceId || e.configurationRowVersion !== s.configurationRowVersion) return result("SOURCE_CONFLICT");
    if (!same(e.baseContract, s.baseContract)) return result("CONTRACT_CONFLICT");
    if (!same(e.review, s.review)) return result("REVIEW_CONFLICT");
    if (e.sql.digest !== s.sql.digest || e.parameterDefinition.digest !== s.parameterDefinition.digest
      || e.nativeTypes.digest !== s.nativeTypes.digest || e.nativeTypes.digest !== nativeDigest(e.nativeTypes.parameters)
      || s.nativeTypes.digest !== nativeDigest(s.nativeTypes.parameters) || !same(e.versions, s.versions)) return result("INTEGRITY_CONFLICT");
    if (!bindingsValid(e, s)) return result("BINDING_INVALID");
    if (e.authorizationEpoch !== a.authorizationEpoch) return result("AUTHORIZATION_CONFLICT");
    if (!a.active || !a.interactive || !a.designQuery || !a.reviewNativeType || !a.scopeAllowed || !same(e.reviewer, a.reviewer)
      || e.reviewer.userId === s.proposedByUserId || e.reviewer.scope.datasetId !== e.datasetId
      || e.reviewer.scope.dataSourceId !== e.dataSourceId) return result("REVIEWER_INVALID");
    if (!(e.evidenceAt <= o.now && o.now < e.expiresAt)) return result("TIME_INVALID");
    if (e.source.identity !== source.identity || e.source.schemaGeneration !== source.schemaGeneration) return result("SOURCE_CONFLICT");
    if (!same(e.source, { identity: lease.identity, schemaGeneration: lease.schemaGeneration,
      leaseId: lease.leaseId, leaseVersion: lease.leaseVersion }) || e.source.leaseId !== source.leaseId
      || e.source.leaseVersion !== source.leaseVersion || !(lease.validFrom <= e.evidenceAt && lease.validFrom <= o.now
        && o.now < lease.validUntil && e.expiresAt <= lease.validUntil)) return result("LEASE_INVALID");
    return result(null);
  } catch { return result("FORMAT_INVALID"); }
}

/** Receipts are exact positive SQL BIGINT strings only, never Number IDs. */
export function isExactReviewAuditReceipt(receipt: unknown): receipt is { auditId: string } {
  try { return object({ auditId: id }).safeParse(dataSnapshot(receipt)).success; }
  catch { return false; }
}
