import type { DatasetParameterRecord } from "../modules/dataset/parameter.repository.js";
import { defaultDateFormat, formatParameterDate, isDynamicDateExpression,
  resolveDynamicDateExpression } from "../modules/dataset/dateParameter.js";
import { compileSqlServerTypedBindPlan, readSqlServerTypedBindPlan, TypedBindPlanError,
  type CompileTypedBindPlanInput, type SqlServerTypeDeclarations } from "./sqlServerTypedBindPlan.js";
import type { DescriptionParameterType } from "./queryDescription.js";

/** Explicit backend projection, not an API payload or authenticated evidence. */
export type NormalizationDefinition = Readonly<Pick<DatasetParameterRecord,
  "name" | "dataType" | "controlType" | "isRequired" | "defaultValue" | "dateOutputMode" | "dateCalendar" | "dateFormat">>;
export type NormalizeTypedParametersInput = Readonly<{
  scope: "ISOLATED_TEST_ONLY";
  sql: string;
  definitions: readonly NormalizationDefinition[];
  declarations: SqlServerTypeDeclarations;
  expectedVersion: string;
  rawValues: Readonly<Record<string, unknown>>;
  /** Required only for STRING dynamic expressions; never read the wall clock. */
  now?: Date;
}>;
type ErrorCode = "TYPED_NORMALIZATION_CONTRACT_INVALID" | "TYPED_NORMALIZATION_VERSION_MISMATCH"
  | "TYPED_NORMALIZATION_REQUIRED" | "TYPED_NORMALIZATION_VALUE_INVALID"
  | "TYPED_NORMALIZATION_LIST_UNSUPPORTED" | "TYPED_NORMALIZATION_NATIVE_DATE_REQUIRED";
export class TypedParameterNormalizationError extends Error {
  constructor(readonly code: ErrorCode) { super(code); this.name = "TypedParameterNormalizationError"; }
}
const fail = (code: ErrorCode): never => { throw new TypedParameterNormalizationError(code); };

// Read descriptors before values: no accessors, inherited fields, symbols or
// unknown contract options. Do not serialize user-controlled objects to validate.
function record(value: unknown, keys?: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    return fail("TYPED_NORMALIZATION_CONTRACT_INVALID");
  }
  const result: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (typeof key !== "string" || (keys && !keys.includes(key)) || !Object.hasOwn(descriptor, "value")) {
      return fail("TYPED_NORMALIZATION_CONTRACT_INVALID");
    }
    result[key] = descriptor.value;
  }
  return result;
}
function denseArray(value: unknown, limit = 2000): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
    || value.length > limit || Reflect.ownKeys(value).length !== value.length + 1) return fail("TYPED_NORMALIZATION_CONTRACT_INVALID");
  const copy: unknown[] = [];
  for (let i = 0; i < value.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
    if (!descriptor || !Object.hasOwn(descriptor, "value")) return fail("TYPED_NORMALIZATION_CONTRACT_INVALID");
    copy.push(descriptor.value);
  }
  return copy;
}
function declarationsSnapshot(value: unknown): SqlServerTypeDeclarations {
  const declaration = record(value, ["state", "origin", "version", "parameters"]);
  const parameters = denseArray(declaration.parameters).map(item => {
    const p = record(item, ["name", "nativeType", "cardinality"]);
    const native = record(p.nativeType);
    const cardinality = record(p.cardinality);
    record(p.cardinality, cardinality.kind === "SCALAR" ? ["kind"] : ["kind", "length"]);
    return { ...p, nativeType: { ...native }, cardinality: { ...cardinality } };
  });
  return { ...declaration, parameters } as unknown as SqlServerTypeDeclarations;
}

function exactDecimal(value: unknown, precision: number, scale: number): string {
  if (typeof value === "bigint" || (typeof value === "number" && Number.isSafeInteger(value))) value = String(value);
  if (typeof value !== "string" || value.length > 80 || !/^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(value)) {
    return fail("TYPED_NORMALIZATION_VALUE_INVALID");
  }
  const [whole = "", fraction = ""] = value.replace(/^-/, "").split(".");
  if (fraction.length > scale || BigInt(whole + fraction.padEnd(scale, "0")) >= 10n ** BigInt(precision)) {
    return fail("TYPED_NORMALIZATION_VALUE_INVALID");
  }
  return value;
}
function boolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (value === 0 || value === 1) return value === 1;
  if (typeof value === "string") {
    const text = value.trim().toLowerCase();
    if (["true", "1", "yes", "y"].includes(text)) return true;
    if (["false", "0", "no", "n"].includes(text)) return false;
  }
  return fail("TYPED_NORMALIZATION_VALUE_INVALID");
}
function stringDate(definition: NormalizationDefinition, value: unknown, now: unknown): string {
  if (typeof value !== "string") return fail("TYPED_NORMALIZATION_VALUE_INVALID");
  let date: Date;
  if (isDynamicDateExpression(value)) {
    if (!(now instanceof Date) || !Number.isFinite(Date.prototype.getTime.call(now))) {
      return fail("TYPED_NORMALIZATION_VALUE_INVALID");
    }
    date = resolveDynamicDateExpression(value, new Date(Date.prototype.getTime.call(now)));
  } else {
    // Match legacy STRING pass-through of already formatted ROC/custom text.
    const canonical = definition.dataType === "DATE" ? /^\d{4}-\d{2}-\d{2}$/ : /^\d{4}-\d{2}-\d{2}T/;
    if (!canonical.test(value)) return value;
    if (definition.dataType === "DATE") {
      date = new Date(`${value}T00:00:00.000Z`);
      if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
        return fail("TYPED_NORMALIZATION_VALUE_INVALID");
      }
    } else {
      // No-zone UI datetimes and permissive Date parsing have ambiguous semantics.
      // Only a strict explicit UTC representation is formatted in this stage.
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
        return fail("TYPED_NORMALIZATION_VALUE_INVALID");
      }
      date = new Date(value);
      if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) return fail("TYPED_NORMALIZATION_VALUE_INVALID");
    }
  }
  if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() < 1 || date.getUTCFullYear() > 9999) {
    return fail("TYPED_NORMALIZATION_VALUE_INVALID");
  }
  return formatParameterDate(date, definition.dateCalendar,
    definition.dateFormat || defaultDateFormat(definition.dataType as "DATE" | "DATETIME", definition.dateCalendar));
}
function scalar(definition: NormalizationDefinition, type: DescriptionParameterType, raw: unknown, now: unknown): unknown {
  let value = raw;
  if (value === undefined || value === null || value === "") {
    if (definition.defaultValue !== null && definition.defaultValue !== "") value = definition.defaultValue;
    else return definition.isRequired ? fail("TYPED_NORMALIZATION_REQUIRED") : null;
  }
  if (definition.dataType === "DATE" || definition.dataType === "DATETIME") {
    if (definition.dateOutputMode === "STRING") value = stringDate(definition, value, now);
    else if (!(value instanceof Date)) return fail("TYPED_NORMALIZATION_NATIVE_DATE_REQUIRED");
  }
  if (type.type === "VARBINARY") return fail("TYPED_NORMALIZATION_VALUE_INVALID");
  if (type.type === "BIT") value = boolean(value);
  if (type.type === "DECIMAL") return exactDecimal(value, type.precision, type.scale);
  // Reuse the bind compiler's exact integer, Unicode, range and temporal checks.
  // No Number conversion occurs before its BIGINT parser.
  const plan = compileSqlServerTypedBindPlan({ sql: "SELECT {{P}}", definitions: [{ ...definition, name: "P", controlType: "TEXT" }],
    declarations: { state: "CONFIRMED", origin: "EXPLICIT_RUNTIME_BIND", version: "0000000000000000",
      parameters: [{ name: "P", nativeType: type, cardinality: { kind: "SCALAR" } }] }, values: { P: value } });
  return readSqlServerTypedBindPlan(plan).binds[0]!.value;
}

export type NormalizedTypedParameters = Readonly<{ kind: "ISOLATED_NORMALIZED_PARAMETERS"; deliveryAllowed: false }>;
const creationKey = Symbol("normalized-parameters");
class Normalized implements NormalizedTypedParameters {
  readonly kind = "ISOLATED_NORMALIZED_PARAMETERS";
  readonly deliveryAllowed = false;
  constructor(key: symbol, readonlyInput: CompileTypedBindPlanInput) {
    if (key !== creationKey) fail("TYPED_NORMALIZATION_CONTRACT_INVALID");
    this.#input = readonlyInput;
    Object.freeze(this);
  }
  readonly #input: CompileTypedBindPlanInput;
  static read(value: NormalizedTypedParameters): CompileTypedBindPlanInput {
    if (!value || typeof value !== "object" || !(#input in value)) return fail("TYPED_NORMALIZATION_CONTRACT_INVALID");
    // structuredClone copies Date, bigint and all nested arrays/contract fields.
    return structuredClone(value.#input);
  }
}
/** Pure, isolated preparation. The state/version supplied here grants no authority. */
export function normalizeSqlServerTypedParameters(input: NormalizeTypedParametersInput): NormalizedTypedParameters {
  try {
    const source = record(input, ["scope", "sql", "definitions", "declarations", "expectedVersion", "rawValues", "now"]);
    if (source.scope !== "ISOLATED_TEST_ONLY") return fail("TYPED_NORMALIZATION_CONTRACT_INVALID");
    const declarations = declarationsSnapshot(source.declarations);
    if (typeof source.expectedVersion !== "string" || !/^[a-f0-9]{16}$/.test(source.expectedVersion)
      || declarations.version !== source.expectedVersion) return fail("TYPED_NORMALIZATION_VERSION_MISMATCH");
    const definitions = denseArray(source.definitions).map(item => {
      const d = record(item, ["name", "dataType", "controlType", "isRequired", "defaultValue", "dateOutputMode", "dateCalendar", "dateFormat"]);
      if (typeof d.isRequired !== "boolean" || !(d.defaultValue === null || typeof d.defaultValue === "string")
        || !["GREGORIAN", "ROC"].includes(d.dateCalendar as string)
        || !(d.dateFormat === null || typeof d.dateFormat === "string")) return fail("TYPED_NORMALIZATION_CONTRACT_INVALID");
      return { ...d } as NormalizationDefinition;
    });
    const rawValues = record(source.rawValues);
    if (Object.keys(rawValues).some(name => !definitions.some(d => d.name === name))) return fail("TYPED_NORMALIZATION_CONTRACT_INVALID");
    // Validate full name/token/native-type/cardinality relationships before defaults
    // or raw values. Placeholder nulls do not infer types or establish evidence.
    const placeholders = Object.fromEntries(definitions.map(d => {
      const c = declarations.parameters.find(p => p.name === d.name)?.cardinality;
      return [d.name, c?.kind === "FIXED_LIST" && Number.isInteger(c.length) && c.length >= 1 && c.length <= 128
        ? Array(c.length).fill(null) : null];
    }));
    compileSqlServerTypedBindPlan({ sql: source.sql as string, definitions: definitions.map(d => ({ ...d, isRequired: false })),
      declarations, values: placeholders });
    const values: Record<string, unknown> = Object.create(null);
    for (const d of definitions) {
      const declaration = declarations.parameters.find(p => p.name === d.name)!;
      const raw = rawValues[d.name];
      if (d.controlType !== "MULTISELECT") values[d.name] = scalar(d, declaration.nativeType, raw, source.now);
      else {
        // A saved scalar default cannot define a fixed-list default contract.
        if (d.defaultValue !== null && d.defaultValue !== "") return fail("TYPED_NORMALIZATION_LIST_UNSUPPORTED");
        const items = denseArray(raw, 128);
        if (declaration.cardinality.kind !== "FIXED_LIST" || items.length !== declaration.cardinality.length) {
          return fail("TYPED_NORMALIZATION_LIST_UNSUPPORTED");
        }
        const kinds = new Set(items.filter(item => item !== null).map(item => typeof item));
        if (kinds.size > 1 || items.some(item => item === undefined || item === "")) return fail("TYPED_NORMALIZATION_LIST_UNSUPPORTED");
        values[d.name] = items.map(item => scalar(d, declaration.nativeType, item, source.now));
      }
    }
    return new Normalized(creationKey, { sql: source.sql as string, definitions, declarations, values });
  } catch (error) {
    if (error instanceof TypedParameterNormalizationError || error instanceof TypedBindPlanError) throw error;
    throw new TypedParameterNormalizationError("TYPED_NORMALIZATION_CONTRACT_INVALID");
  }
}
/** Backend-only compiler input copy. Never return, log, persist or cache it. */
export function readNormalizedTypedParameters(value: NormalizedTypedParameters): CompileTypedBindPlanInput {
  return Normalized.read(value);
}
