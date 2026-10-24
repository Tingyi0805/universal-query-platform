import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { inspect } from "node:util";
import { computeSqlSnapshotDigest as sqlDigest, computeParameterSnapshotDigest as parameterDigest,
  CanonicalSnapshotDigestError, type SyntheticStoredParameter } from "./canonicalSnapshotDigest.js";
import { validateNativeTypeReview, type ReviewEvidenceEnvelope, type ReviewObservations } from "./nativeTypeReview.js";
import { extractParameterNames } from "../../query/queryCompiler.js";

const datasetId = "9223372036854775807", scope = "SYNTHETIC_TEST_ONLY";
const row = (patch: Partial<SyntheticStoredParameter> = {}): SyntheticStoredParameter => ({
  id: "9007199254740993", datasetId, name: "P", label: "合成💡", dataType: "NUMBER", controlType: "TEXT",
  isRequired: false, defaultValue: null, dateOutputMode: "NATIVE", dateCalendar: "GREGORIAN", dateFormat: null,
  displayOrder: 0, placeholder: null, helpText: null, optionMode: "NONE", fixedOptionsJson: null,
  lookupDatasetId: null, lookupValueField: null, lookupLabelField: null, ...patch,
});
const parameters = (values: readonly SyntheticStoredParameter[] = [row()], id = datasetId) => parameterDigest({ scope, datasetId: id, parameters: values });
const sql = (value: string) => sqlDigest({ scope, sql: value });
function rejected(run: () => unknown) {
  assert.throws(run, error => {
    assert.ok(error instanceof CanonicalSnapshotDigestError);
    assert.equal(error.message, "CANONICAL_SNAPSHOT_INPUT_INVALID");
    assert.equal(error.code, "CANONICAL_SNAPSHOT_INPUT_INVALID");
    assert.equal(error.cause, undefined);
    return true;
  });
}

test("independent UTF-8 and canonical tuple golden vectors are stable", () => {
  // Expected hashes computed independently with Python hashlib + compact UTF-8 JSON.
  assert.equal(sql("SELECT {{P}} AS 合成💡\r\n").integrity.digest, "6c543a399f3aa82b68045e69a20677ec10ab3ade9f252451aecadcb5df2f0a5c");
  assert.equal(parameters().integrity.digest, "bca71280a3960101aaf34e53a88d654f26cc302af29684825712fd1aa335c36a");
  assert.deepEqual(parameters(), parameters());
});

test("SQL hashes every original UTF-8 byte without normalization or token-driven rewriting", () => {
  const original = "SELECT {{P}}";
  const bytes = Buffer.from(original, "utf8"), expected = sql(original).integrity.digest;
  for (let i = 0; i < bytes.length; i++) {
    const changed = Buffer.from(bytes); changed[i] = changed[i]! ^ 1;
    assert.notEqual(sql(changed.toString("utf8")).integrity.digest, expected);
  }
  for (const changed of [original + " ", original + "\n", original + "\r\n", original.toLowerCase(), "\ufeff" + original,
    original + "\0", original + " -- 合成", "SELECT '{{P}}'", "SELECT {{P}} AS é", "SELECT {{P}} AS e\u0301"]) {
    assert.notEqual(sql(changed).integrity.digest, expected);
  }
  assert.deepEqual(extractParameterNames(original), extractParameterNames(original + "\r\n"));
  assert.equal(sql("").integrity.digest, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  assert.notEqual(sql("SELECT 'é'").integrity.digest, sql("SELECT 'e\u0301'").integrity.digest);
  // Hashing is not a SELECT-only/template validator.
  assert.equal(sql("{{malformed").deliveryAllowed, false);
});

test("row/property order do not affect canonical encoding; DisplayOrder remains stored content", () => {
  const p = row(), q = row({ id: "9007199254740994", name: "Q", displayOrder: 1 });
  const input = Object.freeze([Object.freeze(p), Object.freeze(q)]);
  const before = structuredClone(input);
  assert.equal(parameters(input).integrity.digest, parameters([q, p]).integrity.digest);
  const reverseProperties = Object.fromEntries(Object.entries(p).reverse()) as SyntheticStoredParameter;
  assert.equal(parameters([reverseProperties, q]).integrity.digest, parameters(input).integrity.digest);
  assert.deepEqual(input, before);
  assert.notEqual(parameters([p, q]).integrity.digest, parameters([p, { ...q, displayOrder: 2 }]).integrity.digest);
});

const changes: Partial<SyntheticStoredParameter>[] = [
  { id: "9007199254740994" }, { name: "Q" }, { label: "其他合成" }, { dataType: "STRING" }, { controlType: "SELECT" },
  { isRequired: true }, { defaultValue: "9007199254740993" }, { dateOutputMode: "STRING" }, { dateCalendar: "ROC" },
  { dateFormat: "yyyMMdd" }, { displayOrder: 1 }, { placeholder: "提示" }, { helpText: "說明" }, { optionMode: "FIXED" },
  { fixedOptionsJson: '[{"value":"合成","label":"選項"}]' }, { lookupDatasetId: "9007199254740993" },
  { lookupValueField: "SyntheticValue" }, { lookupLabelField: "SyntheticLabel" },
];
for (const patch of changes) test(`stored field changes integrity: ${Object.keys(patch)[0]}`, () => {
  assert.notEqual(parameters([row(patch)]).integrity.digest, parameters().integrity.digest);
});
test("Dataset identity is included for populated and empty snapshots", () => {
  assert.notEqual(parameters().integrity.digest, parameters([row({ datasetId: "1" })], "1").integrity.digest);
  assert.notEqual(parameters([]).integrity.digest, parameters([], "1").integrity.digest);
  rejected(() => parameters([row({ datasetId: "1" })]));
});

for (const field of ["defaultValue", "dateFormat", "placeholder", "helpText", "fixedOptionsJson", "lookupValueField", "lookupLabelField"] as const) {
  test(`null, empty and missing remain distinct: ${field}`, () => {
    assert.notEqual(parameters([row({ [field]: "" })]).integrity.digest, parameters([row({ [field]: null })]).integrity.digest);
    const incomplete = { ...row() } as Record<string, unknown>; delete incomplete[field];
    rejected(() => parameters([incomplete as SyntheticStoredParameter]));
    rejected(() => parameters([row({ [field]: undefined })]));
  });
}

test("Unicode, control characters, raw date formats and opaque JSON text are preserved", () => {
  for (const pair of [["é", "e\u0301"], ["\r\n", "\n"], [" ", ""], ["\0", "\\u0000"], ["💡", "💡💡"], ["\u2028", "\u2029"]]) {
    assert.notEqual(parameters([row({ defaultValue: pair[0]! })]).integrity.digest,
      parameters([row({ defaultValue: pair[1]! })]).integrity.digest);
  }
  const value = '"合成\\\t\n\0💡';
  assert.equal(parameters([row({ defaultValue: value, dateFormat: "yyy年MM月dd日" })]).integrity.digest,
    parameters([row({ defaultValue: value, dateFormat: "yyy年MM月dd日" })]).integrity.digest);
  for (const [a, b] of [['[{"value":1,"label":"x"}]', '[{ "value":1,"label":"x"}]'],
    ['{"a":1,"b":2}', '{"b":2,"a":1}'], ['[{"value":9007199254740993}]', '[{"value":9007199254740992}]']]) {
    assert.notEqual(parameters([row({ fixedOptionsJson: a })]).integrity.digest, parameters([row({ fixedOptionsJson: b })]).integrity.digest);
  }
  // Even malformed/empty saved JSON text is content, never interpreted as options.
  assert.equal(parameters([row({ fixedOptionsJson: "{not-json" })]).deliveryAllowed, false);
});

test("all ID fields preserve signed SQL BIGINT positive boundaries and reject Number-based projections", () => {
  for (const id of ["1", "9007199254740992", "9007199254740993", "9223372036854775807"]) {
    assert.equal(parameters([row({ id, datasetId: id, lookupDatasetId: id })], id).deliveryAllowed, false);
  }
  assert.notEqual(parameters([row({ lookupDatasetId: "9007199254740992" })]).integrity.digest,
    parameters([row({ lookupDatasetId: "9007199254740993" })]).integrity.digest);
  for (const bad of [1, 9007199254740993, 1n, "0", "-1", "01", "+1", "1e2", " 1", "9223372036854775808", ""]) {
    for (const field of ["id", "datasetId", "lookupDatasetId"]) {
      rejected(() => parameters([{ ...row(), [field]: bad } as SyntheticStoredParameter]));
    }
    rejected(() => parameterDigest({ scope, datasetId: bad, parameters: [] }));
  }
});

test("duplicate name/ID, unknown fields, incorrect enums/types and all missing fields fail closed", () => {
  rejected(() => parameters([row(), row({ id: "2" })]));
  rejected(() => parameters([row(), row({ name: "Q" })]));
  for (const key of Object.keys(row())) {
    const missing = { ...row() } as Record<string, unknown>; delete missing[key];
    rejected(() => parameters([missing as SyntheticStoredParameter]));
  }
  for (const patch of [{ unknown: true }, { Name: "P" }, { name: "p" }, { name: "Q".repeat(101) }, { label: null },
    { dataType: "UNKNOWN" }, { controlType: "UNKNOWN" }, { dateOutputMode: "UTC" }, { dateCalendar: "UNKNOWN" },
    { optionMode: "UNKNOWN" }, { isRequired: "false" }, { defaultValue: 0.1 }, { defaultValue: new Date() },
    { fixedOptionsJson: [] }, { displayOrder: "1" }, { displayOrder: -0 }, { displayOrder: -1 }, { displayOrder: 1.1 },
    { displayOrder: Infinity }, { displayOrder: Number.MAX_SAFE_INTEGER }, { lookupLabelField: {} }]) {
    rejected(() => parameters([{ ...row(), ...patch } as SyntheticStoredParameter]));
  }
  for (const bad of [null, {}, { scope: "PRODUCTION", datasetId, parameters: [] }, { scope, datasetId, parameters: [], extra: true }]) {
    rejected(() => parameterDigest(bad));
  }
  for (const bad of [null, {}, { scope: "PRODUCTION", sql: "synthetic" }, { scope, sql: Buffer.from("synthetic") },
    { scope, sql: 123 }, { scope, sql: "synthetic", extra: true }]) rejected(() => sqlDigest(bad));
});

test("unsafe objects, accessor arrays, proxies and hooks are rejected without executing caller code", () => {
  let calls = 0;
  rejected(() => sqlDigest({ scope, get sql() { calls++; return "SYNTHETIC_CANARY"; } }));
  rejected(() => parameters([{ ...row(), get defaultValue() { calls++; return "SYNTHETIC_CANARY"; } }]));
  const array = [row()]; Object.defineProperty(array, "0", { get() { calls++; return row(); } }); rejected(() => parameters(array));
  const proxy = new Proxy(row(), { ownKeys() { calls++; throw new Error("SYNTHETIC_CANARY"); } }); rejected(() => parameters([proxy]));
  rejected(() => parameterDigest(new Proxy({}, { getPrototypeOf() { calls++; throw new Error("SYNTHETIC_CANARY"); } })));
  rejected(() => parameters([{ ...row(), toJSON() { calls++; return row(); } } as SyntheticStoredParameter]));
  rejected(() => parameters([Object.assign(Object.create({ inherited: true }), row())]));
  rejected(() => parameters([{ ...row(), [Symbol("extra")]: true }]));
  rejected(() => parameters([Object.defineProperty({ ...row() }, "helpText", { value: null, enumerable: false })]));
  rejected(() => parameters(Array(1)));
  const cyclic = { ...row() } as Record<string, unknown>; cyclic.defaultValue = cyclic; rejected(() => parameters([cyclic as SyntheticStoredParameter]));
  assert.equal(calls, 0);
});

test("unpaired surrogates cannot collapse to the UTF-8 replacement character", () => {
  for (const text of ["\ud800", "\udfff", "A\ud800B"]) {
    rejected(() => sql(text)); rejected(() => parameters([row({ defaultValue: text })]));
  }
  assert.equal(sql("\ufffd💡").deliveryAllowed, false);
});

test("isolated resource bounds reject oversized byte/row inputs", () => {
  assert.equal(sql("a".repeat(1048576)).deliveryAllowed, false);
  rejected(() => sql("a".repeat(1048577)));
  rejected(() => sql("漢".repeat(349526)));
  rejected(() => parameters(Array(2001).fill(row())));
  rejected(() => parameters([row({ fixedOptionsJson: "a".repeat(262145) })]));
  const aggregate = Array.from({ length: 17 }, (_, i) => row({ id: String(i + 1), name: `P${i}`, fixedOptionsJson: "a".repeat(262144) }));
  rejected(() => parameters(aggregate));
  const escaped = Array.from({ length: 3 }, (_, i) => row({ id: String(i + 1), name: `P${i}`, fixedOptionsJson: "\0".repeat(262144) }));
  rejected(() => parameters(escaped));
});

test("output/error serialization contains no SQL, stored values, canonical rows or raw causes", () => {
  const canary = "SYNTHETIC_PRIVATE_CANARY";
  for (const result of [sql(canary), parameters([row({ defaultValue: canary, fixedOptionsJson: canary })])]) {
    assert.equal(Object.isFrozen(result), true); assert.equal(Object.isFrozen(result.integrity), true);
    assert.equal(result.authority, "NONE"); assert.equal(result.runtimeBindVerified, false); assert.equal(result.deliveryAllowed, false);
    assert.equal((JSON.stringify(result) + inspect(result)).includes(canary), false);
  }
  try { parameters([{ ...row(), unknown: canary } as SyntheticStoredParameter]); assert.fail("must reject"); }
  catch (error) {
    assert.ok(error instanceof CanonicalSnapshotDigestError);
    assert.equal((JSON.stringify(error) + inspect(error)).includes(canary), false);
  }
});

function reviewFixture() {
  const digest = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
  const sqlResult = sql("SELECT {{P}} AS Synthetic"), parameterResult = parameters();
  const e: ReviewEvidenceEnvelope = { format: "NATIVE_TYPE_REVIEW_V1", provenance: scope, datasetId, dataSourceId: "1",
    definitionRowVersion: "0000000000000001", configurationRowVersion: "0000000000000002", baseContract: { state: "MISSING" },
    authorizationEpoch: "0000000000000003", review: { reviewId: "00000000-0000-4000-8000-000000000001", state: "PENDING", stateRowVersion: "0000000000000004" },
    sql: sqlResult.integrity, parameterDefinition: parameterResult.integrity,
    nativeTypes: { format: "NATIVE_TYPES_V1", digest: digest('[["P","BIGINT",null,null,null,"SCALAR",null]]'),
      parameters: [{ name: "P", nativeType: { type: "BIGINT" }, cardinality: { kind: "SCALAR" } }] },
    source: { identity: "00000000-0000-4000-8000-000000000002", schemaGeneration: "0000000000000005",
      leaseId: "00000000-0000-4000-8000-000000000003", leaseVersion: "0000000000000006" },
    reviewer: { userId: "2", tokenVersion: "1", scope: { datasetId, dataSourceId: "1", rowVersion: "0000000000000007" } },
    versions: { collector: "SYNTHETIC_COLLECTOR_V1", codec: "A3_ISOLATED_V1", plan: "A2_ISOLATED_V1", driver: "SYNTHETIC_MSSQL11_V1" },
    evidenceAt: "2026-10-22T00:00:00.000Z", expiresAt: "2026-10-22T01:00:00.000Z" };
  const o: ReviewObservations = { provenance: scope, now: "2026-10-22T00:30:00.000Z",
    snapshot: { provenance: scope, datasetId, dataSourceId: "1", datasetActive: true, datasetArchived: false, sourceActive: true,
      sourceType: "SQLSERVER", definitionRowVersion: e.definitionRowVersion, configurationRowVersion: e.configurationRowVersion,
      baseContract: e.baseContract, review: e.review, sql: { ...e.sql, tokenNames: ["P"] },
      parameterDefinition: { ...e.parameterDefinition, bindings: [{ name: "P", dataType: "NUMBER", controlType: "TEXT", dateOutputMode: "NATIVE" }] },
      nativeTypes: e.nativeTypes, proposedByUserId: "1", versions: e.versions },
    authorization: { provenance: scope, authorizationEpoch: e.authorizationEpoch, reviewer: e.reviewer,
      active: true, interactive: true, designQuery: true, reviewNativeType: true, scopeAllowed: true },
    source: { provenance: scope, ...e.source, lease: { state: "SYNTHETIC_VALIDATED", ...e.source,
      validFrom: e.evidenceAt, validUntil: e.expiresAt } } };
  return { e: structuredClone(e), o: structuredClone(o), sqlResult, parameterResult };
}

test("canonical digests feed B2 synthetic integrity without becoming a SnapshotReader or issuer", () => {
  const { e, o, sqlResult, parameterResult } = reviewFixture();
  const consistent = validateNativeTypeReview(e, o);
  assert.equal(consistent.consistent, true);
  for (const output of [consistent, sqlResult, parameterResult]) {
    assert.equal(output.deliveryAllowed, false); assert.equal(output.runtimeBindVerified, false); assert.equal(output.authority, "NONE");
  }
  o.snapshot.sql = { ...sql("SELECT {{P}} AS Synthetic ").integrity, tokenNames: ["P"] };
  assert.equal(validateNativeTypeReview(e, o).reason, "INTEGRITY_CONFLICT");
  o.snapshot.sql = { ...e.sql, tokenNames: ["P"] };
  o.snapshot.parameterDefinition = { ...parameters([row({ defaultValue: "changed" })]).integrity, bindings: o.snapshot.parameterDefinition.bindings };
  assert.equal(validateNativeTypeReview(e, o).reason, "INTEGRITY_CONFLICT");
});

test("A to B to A restores content digest but cannot restore authorization or prevent ABA", () => {
  const { e, o } = reviewFixture();
  const a = parameters(), b = parameters([row({ defaultValue: "changed" })]), again = parameters();
  assert.notEqual(a.integrity.digest, b.integrity.digest); assert.equal(a.integrity.digest, again.integrity.digest);
  o.snapshot.parameterDefinition.digest = again.integrity.digest;
  o.authorization.authorizationEpoch = "0000000000000008";
  assert.equal(validateNativeTypeReview(e, o).reason, "AUTHORIZATION_CONFLICT");
  assert.equal(again.deliveryAllowed, false); assert.equal(again.authority, "NONE");
  o.authorization.authorizationEpoch = e.authorizationEpoch;
  o.source.lease.validUntil = o.now;
  assert.equal(validateNativeTypeReview(e, o).reason, "LEASE_INVALID");
});
