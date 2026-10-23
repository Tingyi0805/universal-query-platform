import { createHash } from "node:crypto";
import { types } from "node:util";
import { z } from "zod";
import { candidateDescription, compileDescription, type CandidateQueryDescription, type DescribeQueryInput } from "../../query/queryDescription.js";
import { computeParameterSnapshotDigest, computeSqlSnapshotDigest } from "./canonicalSnapshotDigest.js";
import { isExactReviewAuditReceipt } from "./nativeTypeReview.js";
import type { SourceEvidenceProvider } from "./nativeTypeReview.ports.js";

// Collection subflow only. No production composition, HTTP route, persistence,
// classification issuer, binding verification, or access to query-row execution.
const object = <S extends z.ZodRawShape>(shape: S) => z.object(shape).strict();
const scope = z.literal("SYNTHETIC_TEST_ONLY");
const id = z.string().regex(/^[1-9][0-9]{0,18}$(?![\s\S])/u).refine(v => BigInt(v) <= 9223372036854775807n);
const rv = z.string().regex(/^[a-f0-9]{16}$(?![\s\S])/u).refine(v => v !== "0000000000000000");
const uuid = z.string().uuid().regex(/^[a-f0-9-]+$(?![\s\S])/u);
const instant = z.string().regex(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$(?![\s\S])/u)
  .refine(v => Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v);
const sourceReference = object({ identity: uuid, schemaGeneration: rv, leaseId: uuid, leaseVersion: rv });
const observationSchema = object({ provenance: scope, ...sourceReference.shape, lease: object({
  state: z.literal("SYNTHETIC_VALIDATED"), ...sourceReference.shape, validFrom: instant, validUntil: instant,
}) });
const commandSchema = object({ scope, datasetId: id, actorId: id, requestId: uuid,
  expectedDefinitionRowVersion: rv, expectedConfigurationRowVersion: rv });
const snapshotSchema = object({ scope, datasetId: id, dataSourceId: id, definitionRowVersion: rv, configurationRowVersion: rv,
  datasetActive: z.literal(true), datasetArchived: z.literal(false), sourceActive: z.literal(true),
  sourceType: z.string().max(32), engineMajor: z.number().int().positive(), sql: z.string().min(1).max(200000),
  parameters: z.array(z.unknown()).max(2000), source: sourceReference,
  baseContract: z.discriminatedUnion("state", [object({ state: z.literal("MISSING") }),
    object({ state: z.literal("UNCONFIRMED"), rowVersion: rv })]),
});
const authorizationSchema = object({ scope, actorId: id, datasetId: id, dataSourceId: id,
  active: z.literal(true), designQuery: z.literal(true), executeQuery: z.literal(true),
  scopeAllowed: z.literal(true), tokenVersion: id, authorizationEpoch: rv, scopeRowVersion: rv });
const columnSchema = object({ name: z.string().min(1).max(128), dataType: z.string().min(1).max(100), ordinal: z.number().int().min(1).max(4096) });
const candidateSchema = object({ trust: z.literal("UNBOUND_CANDIDATE"), evidenceType: z.literal("SQLSERVER_DESCRIBE_FIRST_RESULT_SET"),
  requiresExecutionComparison: z.literal(true), columns: z.array(columnSchema).min(1).max(4096) });
type Command = z.infer<typeof commandSchema>;
export type SavedMetadataFixtureSnapshot = z.infer<typeof snapshotSchema>;
export type MetadataFixtureAuthorization = z.infer<typeof authorizationSchema>;
export interface SavedMetadataCollectionPorts {
  readSaved(datasetId: string): Promise<unknown>;
  authorize(actorId: string, datasetId: string): Promise<unknown>;
  source: Pick<SourceEvidenceProvider, "observe">;
  describe(dataSourceId: string, input: DescribeQueryInput): Promise<CandidateQueryDescription>;
  /** Synthetic attempt observation only, never a durable decision/SUCCESS receipt. */
  recordAttempt(event: Readonly<Record<string, unknown>>): Promise<unknown>;
  now(): string;
}
export class SavedMetadataCollectionError extends Error {
  constructor(readonly code: "METADATA_COLLECTION_INVALID" | "METADATA_COLLECTION_CONFLICT" | "METADATA_COLLECTION_LEASE_INVALID"
    | "METADATA_COLLECTION_BINDING_UNPROVEN" | "METADATA_COLLECTION_COLUMN_UNSUPPORTED" | "METADATA_COLLECTION_FAILED"
    | "METADATA_COLLECTION_SOURCE_UNSUPPORTED" | "METADATA_COLLECTION_SQL_UNSUPPORTED" | "METADATA_COLLECTION_AUTHORIZATION_REQUIRED") {
    super(code); this.name = "SavedMetadataCollectionError";
  }
}
const fail = (code: SavedMetadataCollectionError["code"]): never => { throw new SavedMetadataCollectionError(code); };

// Validate descriptors before schemas: never invoke getters/Proxy/toJSON hooks.
function dataOnly(value: unknown): unknown {
  let nodes = 50000, bytes = 4 * 1024 * 1024;
  const copy = (v: unknown, depth: number): unknown => {
    if (--nodes < 0 || depth > 12) return fail("METADATA_COLLECTION_INVALID");
    if (typeof v === "string") {
      bytes -= Buffer.byteLength(v); if (v.length > 200000 || bytes < 0) return fail("METADATA_COLLECTION_INVALID");
      return v;
    }
    if (v === null || typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v))) return v;
    if (!v || typeof v !== "object" || types.isProxy(v)) return fail("METADATA_COLLECTION_INVALID");
    const array = Array.isArray(v), keys = Reflect.ownKeys(v);
    if (array ? Object.getPrototypeOf(v) !== Array.prototype || v.length > 4096 || keys.length !== v.length + 1
      : ![Object.prototype, null].includes(Object.getPrototypeOf(v)) || keys.length > 64) return fail("METADATA_COLLECTION_INVALID");
    const out: Record<string, unknown> = Object.create(null);
    for (const key of keys) {
      if (array && key === "length") continue;
      const d = Object.getOwnPropertyDescriptor(v, key)!;
      if (typeof key !== "string" || !d.enumerable || !Object.hasOwn(d, "value")) return fail("METADATA_COLLECTION_INVALID");
      out[key] = copy(d.value, depth + 1);
    }
    if (array) return Array.from({ length: v.length }, (_, i) => {
      if (!Object.hasOwn(out, String(i))) return fail("METADATA_COLLECTION_INVALID"); return out[String(i)];
    });
    return out;
  };
  return copy(value, 0);
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
function columnType(type: string): boolean {
  if (/^(int|bigint|bit|date)$/u.test(type)) return true;
  if (/^datetime2\([0-7]\)$/u.test(type)) return true;
  const size = /^(nvarchar|varchar)\((max|[1-9][0-9]{0,3})\)$/u.exec(type);
  if (size) return size[2] === "max" || Number(size[2]) <= (size[1] === "nvarchar" ? 4000 : 8000);
  const decimal = /^decimal\(([1-9][0-9]?),\s?([0-9]{1,2})\)$/u.exec(type);
  return !!decimal && Number(decimal[1]) <= 38 && Number(decimal[2]) <= Number(decimal[1]);
}

/** Only a synthetic saved-snapshot/RPC composition is supplied in this stage. */
export function createSavedDatasetMetadataCollection(ports: SavedMetadataCollectionPorts) {
  return async (input: unknown) => {
    try {
      const command: Command = commandSchema.parse(dataOnly(input));
      const read = async () => {
        const snapshot = snapshotSchema.parse(dataOnly(await ports.readSaved(command.datasetId)));
        if (snapshot.sourceType !== "SQLSERVER" || snapshot.engineMajor !== 15) return fail("METADATA_COLLECTION_SOURCE_UNSUPPORTED");
        if (snapshot.datasetId !== command.datasetId || snapshot.definitionRowVersion !== command.expectedDefinitionRowVersion
          || snapshot.configurationRowVersion !== command.expectedConfigurationRowVersion) return fail("METADATA_COLLECTION_CONFLICT");
        const checkedAuthorization = authorizationSchema.safeParse(dataOnly(await ports.authorize(command.actorId, command.datasetId)));
        if (!checkedAuthorization.success) return fail("METADATA_COLLECTION_AUTHORIZATION_REQUIRED");
        const authorization = checkedAuthorization.data;
        if (authorization.actorId !== command.actorId || authorization.datasetId !== snapshot.datasetId
          || authorization.dataSourceId !== snapshot.dataSourceId) return fail("METADATA_COLLECTION_CONFLICT");
        const sql = computeSqlSnapshotDigest({ scope: "SYNTHETIC_TEST_ONLY", sql: snapshot.sql }).integrity;
        const parameters = computeParameterSnapshotDigest({ scope: "SYNTHETIC_TEST_ONLY", datasetId: snapshot.datasetId,
          parameters: snapshot.parameters }).integrity;
        // Even an empty parameter set does not establish a verified bind contract.
        // 921 cannot provide trustworthy native types/list arity: reject before RPC.
        if (snapshot.parameters.length) return fail("METADATA_COLLECTION_BINDING_UNPROVEN");
        try { compileDescription({ sql: snapshot.sql, parameters: [], timeoutSec: 10 }, "SQLSERVER"); }
        catch { return fail("METADATA_COLLECTION_SQL_UNSUPPORTED"); }
        const observation = observationSchema.parse(dataOnly(await ports.source.observe(snapshot.dataSourceId, snapshot.source.leaseId)));
        const { provenance: _, lease, ...reference } = observation;
        const { state: _state, validFrom, validUntil, ...leaseReference } = lease;
        const now = instant.parse(ports.now());
        if (!same(snapshot.source, reference) || !same(reference, leaseReference) || !(validFrom <= now && now < validUntil))
          return fail("METADATA_COLLECTION_LEASE_INVALID");
        return { snapshot, authorization, sql, parameters, observation };
      };
      const initial = await read();
      const revalidate = async () => { if (!same(initial, await read())) return fail("METADATA_COLLECTION_CONFLICT"); };
      await revalidate();
      const raw = candidateSchema.parse(dataOnly(await ports.describe(initial.snapshot.dataSourceId,
        { sql: initial.snapshot.sql, parameters: [], timeoutSec: 10 })));
      const candidate = candidateDescription(raw.evidenceType, raw.columns);
      if (candidate.columns.some(c => /[\x00-\x1f\x7f\ud800-\udfff]/u.test(c.name) || !columnType(c.dataType)))
        return fail("METADATA_COLLECTION_COLUMN_UNSUPPORTED");
      await revalidate();
      const binding = { datasetId: initial.snapshot.datasetId, dataSourceId: initial.snapshot.dataSourceId,
        definitionRowVersion: initial.snapshot.definitionRowVersion, configurationRowVersion: initial.snapshot.configurationRowVersion,
        baseContract: Object.freeze(initial.snapshot.baseContract), sql: initial.sql, parameterDefinition: initial.parameters,
        parameterExpansion: "PARAMETER_FREE_DESCRIPTION_ONLY_V1" as const, source: Object.freeze(initial.snapshot.source),
        sourceLeaseValidUntil: initial.observation.lease.validUntil };
      const receipt = dataOnly(await ports.recordAttempt(Object.freeze({ eventType: "SYNTHETIC_METADATA_CANDIDATE_COLLECTED",
        requestId: command.requestId, actorId: command.actorId, datasetId: command.datasetId,
        bindingDigest: hash(binding), columnsDigest: hash(candidate.columns) })));
      if (!isExactReviewAuditReceipt(receipt)) return fail("METADATA_COLLECTION_INVALID");
      await revalidate();
      return Object.freeze({ kind: "SAVED_METADATA_COLLECTION_FIXTURE_V1", scope: "SYNTHETIC_TEST_ONLY", binding: Object.freeze(binding),
        candidate, auditId: receipt.auditId, metadataState: "NOT_INITIALIZED", classificationState: "UNCONFIRMED",
        authority: "NONE", runtimeBindVerified: false, deliveryAllowed: false, persistence: "NOT_PROVEN", productionSafetyProven: false,
        blockers: Object.freeze(["TRUSTED_SOURCE_PROVIDER_MISSING", "METADATA_PERSISTENCE_SCHEMA_MISSING",
          "CLASSIFICATION_CONFIRMATION_MISSING", "EXECUTION_COMPARISON_MISSING", "SQL_LOCK_VERIFICATION_MISSING"]) });
    } catch (error) {
      if (error instanceof SavedMetadataCollectionError) throw error;
      if (error instanceof z.ZodError) throw new SavedMetadataCollectionError("METADATA_COLLECTION_INVALID");
      // No driver/schema/canonical-parser cause or input may escape.
      throw new SavedMetadataCollectionError("METADATA_COLLECTION_FAILED");
    }
  };
}
