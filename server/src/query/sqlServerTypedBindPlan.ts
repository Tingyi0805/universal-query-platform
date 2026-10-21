import type { DatasetParameterRecord } from "../modules/dataset/parameter.repository.js";
import { compileDescription, type DescriptionParameterType } from "./queryDescription.js";

export type TypedParameterDefinition = Readonly<Pick<DatasetParameterRecord,
  "name" | "dataType" | "controlType" | "isRequired" | "dateOutputMode">>;
export type TypedParameterDeclaration = Readonly<{
  name: string;
  nativeType: DescriptionParameterType;
  cardinality: { kind: "SCALAR" } | { kind: "FIXED_LIST"; length: number };
}>;
// This is an external precondition, not an authority issued by this compiler.
// The current UNCONFIRMED Repository cannot supply it. No API accepts it.
export type SqlServerTypeDeclarations = Readonly<{
  state: "CONFIRMED";
  origin: "EXPLICIT_RUNTIME_BIND";
  version: string;
  parameters: readonly TypedParameterDeclaration[];
}>;
export type CompileTypedBindPlanInput = Readonly<{
  sql: string;
  definitions: readonly TypedParameterDefinition[];
  declarations: SqlServerTypeDeclarations;
  values: Readonly<Record<string, unknown>>;
}>;
type TypedBindErrorCode = "TYPED_BIND_CONTRACT_INVALID" | "TYPED_BIND_DEFINITION_MISMATCH"
  | "TYPED_BIND_SQL_UNSUPPORTED" | "TYPED_BIND_VALUE_INVALID" | "TYPED_BIND_PRECISION_UNSUPPORTED"
  | "TYPED_BIND_LIST_UNSUPPORTED" | "TYPED_BIND_PLAN_INVALID" | "TYPED_BIND_REQUEST_INVALID"
  | "TYPED_BIND_UTC_REQUIRED" | "TYPED_BIND_REQUEST_FAILED";
export class TypedBindPlanError extends Error {
  constructor(readonly code: TypedBindErrorCode) { super(code); this.name = "TypedBindPlanError"; }
}
export type SqlServerTypedBindPlan = Readonly<{ kind: "ISOLATED_SQLSERVER_TYPED_PLAN"; deliveryAllowed: false }>;
type TypedValue = null | number | bigint | boolean | string | Date | Buffer;
export type TypedBind = Readonly<{ name: string; nativeType: DescriptionParameterType; value: TypedValue }>;
type PlanData = Readonly<{ sql: string; parameterDeclaration: string | null; binds: readonly TypedBind[] }>;
const fail = (code: TypedBindErrorCode): never => { throw new TypedBindPlanError(code); };
const namePattern = /^[A-Z][A-Z0-9_]{0,126}$/;
const creationKey = Symbol("typed-plan-construction");
class InternalTypedBindPlan implements SqlServerTypedBindPlan {
  readonly kind = "ISOLATED_SQLSERVER_TYPED_PLAN";
  readonly deliveryAllowed = false;
  readonly #data: PlanData;
  constructor(key: symbol, data: PlanData) {
    if (key !== creationKey) fail("TYPED_BIND_PLAN_INVALID");
    this.#data = data;
    Object.freeze(this);
  }
  static read(key: symbol, plan: SqlServerTypedBindPlan): PlanData {
    if (key !== creationKey || !plan || typeof plan !== "object" || !(#data in plan)) return fail("TYPED_BIND_PLAN_INVALID");
    return plan.#data;
  }
}

function nativeType(value: DescriptionParameterType): DescriptionParameterType {
  if (!value || typeof value !== "object") return fail("TYPED_BIND_CONTRACT_INVALID");
  const keys = value.type === "DECIMAL" ? ["type", "precision", "scale"]
    : ["NVARCHAR", "VARCHAR", "VARBINARY"].includes(value.type) ? ["type", "length"] : ["type"];
  if (Reflect.ownKeys(value).length !== keys.length || Reflect.ownKeys(value).some(key => typeof key !== "string" || !keys.includes(key))) {
    return fail("TYPED_BIND_CONTRACT_INVALID");
  }
  const copy = { ...value };
  try {
    // The same canonical declaration validator used by the existing native
    // descriptor; no generic Dataset type or runtime sample is used to infer it.
    compileDescription({ sql: "SELECT {{P}}", parameters: [{ name: "P", nativeType: copy }], timeoutSec: 1 }, "SQLSERVER");
  } catch { return fail("TYPED_BIND_CONTRACT_INVALID"); }
  return Object.freeze(copy);
}

function assertCompatible(definition: TypedParameterDefinition, type: DescriptionParameterType): void {
  let allowed: string[];
  switch (definition.dataType) {
    case "STRING": allowed = ["NVARCHAR", "VARCHAR", "VARBINARY"]; break;
    case "NUMBER": allowed = ["INT", "BIGINT", "FLOAT", "DECIMAL"]; break;
    case "BOOLEAN": allowed = ["BIT"]; break;
    case "DATE": case "DATETIME":
      allowed = definition.dateOutputMode === "STRING" ? ["NVARCHAR", "VARCHAR"]
        : [definition.dataType === "DATE" ? "DATE" : "DATETIME2"];
      break;
    default: return fail("TYPED_BIND_DEFINITION_MISMATCH");
  }
  if (!allowed.includes(type.type)) fail("TYPED_BIND_DEFINITION_MISMATCH");
}

function integer(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
  if (typeof value === "string" && value.length <= 20 && /^-?(0|[1-9][0-9]*)$/.test(value)) return BigInt(value);
  return fail("TYPED_BIND_VALUE_INVALID");
}

function decimal(value: unknown, precision: number, scale: number): number {
  // Fractional JS Numbers may already have lost input precision. Only explicit
  // decimal text or exact integers can establish the intended decimal value.
  if (typeof value === "bigint" || (typeof value === "number" && Number.isSafeInteger(value))) value = String(value);
  if (typeof value !== "string" || value.length > 80 || !/^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(value)) {
    return fail("TYPED_BIND_VALUE_INVALID");
  }
  const text = value.startsWith("-") ? value.slice(1) : value;
  const [whole = "", fraction = ""] = text.split(".");
  if (fraction.length > scale) return fail("TYPED_BIND_VALUE_INVALID");
  const magnitude = BigInt(whole + fraction.padEnd(scale, "0"));
  if (magnitude >= 10n ** BigInt(precision)) return fail("TYPED_BIND_VALUE_INVALID");
  const number = Number(value);
  // Tedious Decimal scales and rounds a Number before encoding. Permit only
  // magnitudes whose wire representation is provably the requested integer.
  const wireMagnitude = Math.round(Math.abs(number * 10 ** scale));
  if (!Number.isFinite(number) || !Number.isSafeInteger(wireMagnitude) || BigInt(wireMagnitude) !== magnitude) {
    return fail("TYPED_BIND_PRECISION_UNSUPPORTED");
  }
  return number;
}

function typedValue(value: unknown, type: DescriptionParameterType, required: boolean): TypedValue {
  if (value === null) return required ? fail("TYPED_BIND_VALUE_INVALID") : null;
  switch (type.type) {
    case "INT": case "BIGINT": {
      const exact = integer(value);
      const low = type.type === "INT" ? -2147483648n : -9223372036854775808n;
      const high = type.type === "INT" ? 2147483647n : 9223372036854775807n;
      if (exact < low || exact > high) return fail("TYPED_BIND_VALUE_INVALID");
      return type.type === "INT" ? Number(exact) : exact;
    }
    case "BIT": return typeof value === "boolean" ? value : fail("TYPED_BIND_VALUE_INVALID");
    case "FLOAT":
      if (typeof value !== "number" || !Number.isFinite(value)
        || (Number.isInteger(value) && !Number.isSafeInteger(value))
        || (value !== 0 && Math.abs(value) < 2.2250738585072014e-308)) return fail("TYPED_BIND_VALUE_INVALID");
      return value;
    case "DECIMAL": return decimal(value, type.precision, type.scale);
    case "DATE": case "DATETIME2": {
      if (!(value instanceof Date)) return fail("TYPED_BIND_VALUE_INVALID");
      const copy = new Date(Date.prototype.getTime.call(value));
      if (!Number.isFinite(copy.getTime()) || copy.getUTCFullYear() < 1 || copy.getUTCFullYear() > 9999
        || (type.type === "DATE" && (copy.getUTCHours() || copy.getUTCMinutes() || copy.getUTCSeconds() || copy.getUTCMilliseconds()))) {
        return fail("TYPED_BIND_VALUE_INVALID");
      }
      return copy;
    }
    case "NVARCHAR": case "VARCHAR": {
      if (typeof value !== "string" || (required && value.length === 0)) return fail("TYPED_BIND_VALUE_INVALID");
      for (const char of value) {
        const point = char.codePointAt(0)!;
        if (point >= 0xd800 && point <= 0xdfff) return fail("TYPED_BIND_VALUE_INVALID");
      }
      // Without authoritative collation/code-page evidence, VARCHAR is limited
      // to ASCII. NVARCHAR length is UTF-16 code units, not code points.
      if (type.type === "VARCHAR" && /[^\x00-\x7f]/u.test(value)) return fail("TYPED_BIND_VALUE_INVALID");
      const limit = type.length === "MAX" ? (type.type === "NVARCHAR" ? 1073741823 : 2147483647) : type.length;
      return value.length <= limit ? value : fail("TYPED_BIND_VALUE_INVALID");
    }
    case "VARBINARY": {
      if (!Buffer.isBuffer(value) || value.length > (type.length === "MAX" ? 2147483647 : type.length)) return fail("TYPED_BIND_VALUE_INVALID");
      return Buffer.from(value);
    }
  }
}

function compile(input: CompileTypedBindPlanInput): SqlServerTypedBindPlan {
  if (!input || !Array.isArray(input.definitions) || !input.declarations || input.declarations.state !== "CONFIRMED"
    || input.declarations.origin !== "EXPLICIT_RUNTIME_BIND" || typeof input.declarations.version !== "string"
    || !/^[a-f0-9]{16}$/.test(input.declarations.version) || !Array.isArray(input.declarations.parameters)
    || !input.values || typeof input.values !== "object" || Array.isArray(input.values)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(input.values))) return fail("TYPED_BIND_CONTRACT_INVALID");
  const declarations = input.declarations.parameters;
  const names = new Set<string>();
  for (const definition of input.definitions) {
    if (!definition || typeof definition.name !== "string" || !namePattern.test(definition.name) || names.has(definition.name)
      || typeof definition.isRequired !== "boolean" || !["NATIVE", "STRING"].includes(definition.dateOutputMode)
      || !["TEXT", "NUMBER", "DATE", "DATETIME", "SELECT", "MULTISELECT", "CHECKBOX"].includes(definition.controlType)) {
      return fail("TYPED_BIND_DEFINITION_MISMATCH");
    }
    names.add(definition.name);
  }
  const valueNames = Reflect.ownKeys(input.values);
  if (valueNames.length !== names.size || valueNames.some(name => typeof name !== "string" || !names.has(name)
    || !Object.hasOwn(Object.getOwnPropertyDescriptor(input.values, name)!, "value")) || declarations.length !== names.size) {
    return fail("TYPED_BIND_DEFINITION_MISMATCH");
  }
  const seen = new Set<string>();
  const normalized = declarations.map(declaration => {
    if (!declaration || !names.has(declaration.name) || seen.has(declaration.name)) return fail("TYPED_BIND_DEFINITION_MISMATCH");
    seen.add(declaration.name);
    return { ...declaration, nativeType: nativeType(declaration.nativeType) };
  });
  // First validate the ORIGINAL tokens/quotes before expanding any list.
  try { compileDescription({ sql: input.sql, parameters: normalized, timeoutSec: 1 }, "SQLSERVER"); }
  catch { return fail("TYPED_BIND_SQL_UNSUPPORTED"); }
  const binds: TypedBind[] = [];
  const expansions = new Map<string, string[]>();
  const bindNames = new Set<string>();
  for (const declaration of normalized) {
    const definition = input.definitions.find(d => d.name === declaration.name)!;
    assertCompatible(definition, declaration.nativeType);
    const value = input.values[declaration.name];
    const cardinality = declaration.cardinality;
    let values: readonly unknown[];
    if (definition.controlType === "MULTISELECT") {
      if (!cardinality || cardinality.kind !== "FIXED_LIST" || !Number.isInteger(cardinality.length)
        || cardinality.length < 1 || cardinality.length > 128 || !Array.isArray(value) || value.length !== cardinality.length) {
        return fail("TYPED_BIND_LIST_UNSUPPORTED");
      }
      values = Array.from(value);
    } else {
      if (!cardinality || cardinality.kind !== "SCALAR" || Array.isArray(value)) return fail("TYPED_BIND_LIST_UNSUPPORTED");
      values = [value];
    }
    const expandedNames = values.map((item, index) => {
      const name = cardinality.kind === "SCALAR" ? declaration.name : `${declaration.name}__${index}`;
      if (!namePattern.test(name) || bindNames.has(name) || binds.length >= 2000) return fail("TYPED_BIND_LIST_UNSUPPORTED");
      bindNames.add(name);
      binds.push(Object.freeze({ name, nativeType: declaration.nativeType, value: typedValue(item, declaration.nativeType, definition.isRequired) }));
      return name;
    });
    expansions.set(declaration.name, expandedNames);
  }
  const expandedSql = input.sql.replace(/\{\{([A-Z][A-Z0-9_]*)\}\}/g,
    (_token, name: string) => expansions.get(name)!.map(bind => `{{${bind}}}`).join(", "));
  let compiled: ReturnType<typeof compileDescription>;
  try { compiled = compileDescription({ sql: expandedSql, parameters: binds, timeoutSec: 1 }, "SQLSERVER"); }
  catch { return fail("TYPED_BIND_SQL_UNSUPPORTED"); }
  return new InternalTypedBindPlan(creationKey, Object.freeze({ sql: compiled.sql,
    parameterDeclaration: compiled.parameterDeclaration, binds: Object.freeze(binds) }));
}

export function compileSqlServerTypedBindPlan(input: CompileTypedBindPlanInput): SqlServerTypedBindPlan {
  try { return compile(input); }
  catch (error) {
    if (error instanceof TypedBindPlanError) throw error;
    throw new TypedBindPlanError("TYPED_BIND_CONTRACT_INVALID");
  }
}

/** Backend-only access for preparation helpers. Never serialize/cache this result. */
export function readSqlServerTypedBindPlan(plan: SqlServerTypedBindPlan): PlanData {
  const data = InternalTypedBindPlan.read(creationKey, plan);
  return Object.freeze({ ...data, binds: Object.freeze(data.binds.map(bind => Object.freeze({ ...bind,
    value: bind.value instanceof Date ? new Date(bind.value.getTime()) : Buffer.isBuffer(bind.value) ? Buffer.from(bind.value) : bind.value,
  }))) });
}
