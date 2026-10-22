import { createHash } from "node:crypto";
import { types } from "node:util";
import type { DatasetParameterRecord } from "./parameter.repository.js";

/** Explicit synthetic projection; never feed the Number-based repository mapper into this contract. */
export type SyntheticStoredParameter = Readonly<Omit<DatasetParameterRecord, "id" | "datasetId" | "lookupDatasetId"> & {
  id: string; datasetId: string; lookupDatasetId: string | null;
}>;
type Format = "SQL_UTF8_EXACT_V1" | "SAVED_PARAMETER_SNAPSHOT_V1";
export type IsolatedCanonicalDigest<F extends Format> = Readonly<{
  kind: "ISOLATED_CANONICAL_DIGEST"; integrity: Readonly<{ format: F; digest: string }>;
  authority: "NONE"; runtimeBindVerified: false; deliveryAllowed: false;
}>;
export class CanonicalSnapshotDigestError extends Error {
  readonly code = "CANONICAL_SNAPSHOT_INPUT_INVALID";
  constructor() { super("CANONICAL_SNAPSHOT_INPUT_INVALID"); this.name = "CanonicalSnapshotDigestError"; }
}
const fail = (): never => { throw new CanonicalSnapshotDigestError(); };
const scope = "SYNTHETIC_TEST_ONLY";
const maxSnapshotBytes = 4 * 1024 * 1024;
type Budget = { remaining: number };
type Primitive = string | number | boolean | null;
type Validator = (value: unknown, budget: Budget) => Primitive;

function record(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || types.isProxy(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return fail();
  const keys = Reflect.ownKeys(value);
  if (keys.length !== fields.length || keys.some(k => typeof k !== "string" || !fields.includes(k))) return fail();
  const copy: Record<string, unknown> = Object.create(null);
  for (const field of fields) {
    const d = Object.getOwnPropertyDescriptor(value, field);
    if (!d || !d.enumerable || !Object.hasOwn(d, "value")) return fail();
    copy[field] = d.value;
  }
  return copy;
}
function rows(value: unknown): unknown[] {
  if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype
    || value.length > 2000 || Reflect.ownKeys(value).length !== value.length + 1) return fail();
  const copy: unknown[] = [];
  for (let i = 0; i < value.length; i++) {
    const d = Object.getOwnPropertyDescriptor(value, String(i));
    if (!d || !d.enumerable || !Object.hasOwn(d, "value")) return fail();
    copy.push(d.value);
  }
  return copy;
}
function text(value: unknown, maxUnits: number, budget: Budget, maxBytes = maxSnapshotBytes): string {
  if (typeof value !== "string" || value.length > maxUnits) return fail();
  for (const char of value) {
    const point = char.codePointAt(0)!;
    // Buffer UTF-8 encoding would otherwise replace lone surrogates, conflating inputs.
    if (point >= 0xd800 && point <= 0xdfff) return fail();
  }
  const bytes = Buffer.byteLength(value, "utf8");
  if (bytes > maxBytes || bytes > budget.remaining) return fail();
  budget.remaining -= bytes;
  return value;
}
const string = (max: number): Validator => (value, budget) => text(value, max, budget);
const nullable = (validate: Validator): Validator => (value, budget) => value === null ? null : validate(value, budget);
const enumValue = (choices: readonly string[]): Validator => (value, budget) => {
  const result = text(value, 32, budget);
  return choices.includes(result) ? result : fail();
};
const id: Validator = (value, budget) => {
  const result = text(value, 19, budget);
  return /^[1-9][0-9]{0,18}$/.test(result) && BigInt(result) <= 9223372036854775807n ? result : fail();
};
const fields = ["id", "datasetId", "name", "label", "dataType", "controlType", "isRequired", "defaultValue",
  "dateOutputMode", "dateCalendar", "dateFormat", "displayOrder", "placeholder", "helpText", "optionMode",
  "fixedOptionsJson", "lookupDatasetId", "lookupValueField", "lookupLabelField"] as const satisfies readonly (keyof SyntheticStoredParameter)[];
// Exhaustive mapped type: a new repository field requires an explicit contract decision.
const validators: Record<keyof SyntheticStoredParameter, Validator> = {
  id, datasetId: id,
  name: (value, budget) => { const result = text(value, 100, budget); return /^[A-Z][A-Z0-9_]{0,99}$/.test(result) ? result : fail(); },
  label: string(200), dataType: enumValue(["STRING", "NUMBER", "DATE", "DATETIME", "BOOLEAN"]),
  controlType: enumValue(["TEXT", "NUMBER", "DATE", "DATETIME", "SELECT", "MULTISELECT", "CHECKBOX"]),
  isRequired: value => typeof value === "boolean" ? value : fail(), defaultValue: nullable(string(1000)),
  dateOutputMode: enumValue(["NATIVE", "STRING"]), dateCalendar: enumValue(["GREGORIAN", "ROC"]),
  dateFormat: nullable(string(100)), displayOrder: value => typeof value === "number" && Number.isSafeInteger(value)
    && !Object.is(value, -0) && value >= 0 && value <= 10000 ? value : fail(),
  placeholder: nullable(string(200)), helpText: nullable(string(500)), optionMode: enumValue(["NONE", "FIXED", "DATASET"]),
  fixedOptionsJson: nullable((value, budget) => text(value, 262144, budget, 262144)),
  lookupDatasetId: nullable(id), lookupValueField: nullable(string(128)), lookupLabelField: nullable(string(128)),
};
function answer<F extends Format>(format: F, digest: string): IsolatedCanonicalDigest<F> {
  return Object.freeze({ kind: "ISOLATED_CANONICAL_DIGEST", integrity: Object.freeze({ format, digest }),
    authority: "NONE", runtimeBindVerified: false, deliveryAllowed: false });
}

/** Hash exactly the original well-formed SQL UTF-8 bytes. No parsing or SQL safety claim. */
export function computeSqlSnapshotDigest(input: unknown): IsolatedCanonicalDigest<"SQL_UTF8_EXACT_V1"> {
  try {
    const source = record(input, ["scope", "sql"]);
    if (source.scope !== scope) return fail();
    const sql = text(source.sql, 1048576, { remaining: 1048576 });
    return answer("SQL_UTF8_EXACT_V1", createHash("sha256").update(sql, "utf8").digest("hex"));
  } catch { throw new CanonicalSnapshotDigestError(); }
}

/** Hash all 19 stored fields with explicit string IDs; never invokes the repository mapper. */
export function computeParameterSnapshotDigest(input: unknown): IsolatedCanonicalDigest<"SAVED_PARAMETER_SNAPSHOT_V1"> {
  try {
    const source = record(input, ["scope", "datasetId", "parameters"]);
    if (source.scope !== scope) return fail();
    const budget = { remaining: maxSnapshotBytes };
    const datasetId = id(source.datasetId, budget);
    const ids = new Set<Primitive>(), names = new Set<Primitive>();
    const tuples = rows(source.parameters).map(item => {
      const row = record(item, fields);
      const tuple = fields.map(field => validators[field](row[field], budget));
      if (tuple[1] !== datasetId || ids.has(tuple[0]!) || names.has(tuple[2]!)) return fail();
      ids.add(tuple[0]!); names.add(tuple[2]!);
      return tuple;
    }).sort((a, b) => a[2]! < b[2]! ? -1 : a[2]! > b[2]! ? 1 : 0);
    const canonical = JSON.stringify(["SAVED_PARAMETER_SNAPSHOT_V1", datasetId, tuples]);
    if (Buffer.byteLength(canonical, "utf8") > maxSnapshotBytes) return fail();
    return answer("SAVED_PARAMETER_SNAPSHOT_V1", createHash("sha256").update(canonical, "utf8").digest("hex"));
  } catch { throw new CanonicalSnapshotDigestError(); }
}
