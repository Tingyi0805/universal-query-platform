import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { inspect } from "node:util";
import sql from "mssql";
import { compileSqlServerTypedBindPlan, readSqlServerTypedBindPlan, TypedBindPlanError,
  type CompileTypedBindPlanInput, type TypedParameterDefinition } from "./sqlServerTypedBindPlan.js";
import type { DescriptionParameterType } from "./queryDescription.js";
import { prepareSqlServerTypedDescription, prepareSqlServerTypedRuntime, type TypedBindRequest } from "../modules/datasource/adapters/sqlServerTypedBindings.js";
import { coerceRuntimeParameters } from "../modules/dataset/parameter.service.js";
import type { DatasetParameterRecord } from "../modules/dataset/parameter.repository.js";

const require = createRequire(import.meta.url);
// Local serialization only: no driver connection or query is made.
const driverRequire = createRequire(require.resolve("mssql"));
const tedious = driverRequire("tedious");
const WritableBuffer = driverRequire("tedious/lib/tracking-buffer/writable-tracking-buffer.js");
const driverTypes = new Map<any, any>([
  [sql.Int, tedious.TYPES.Int], [sql.BigInt, tedious.TYPES.BigInt], [sql.Bit, tedious.TYPES.Bit],
  [sql.Float, tedious.TYPES.Float], [sql.Decimal, tedious.TYPES.Decimal], [sql.Date, tedious.TYPES.Date],
  [sql.DateTime2, tedious.TYPES.DateTime2], [sql.NVarChar, tedious.TYPES.NVarChar],
  [sql.VarChar, tedious.TYPES.VarChar], [sql.VarBinary, tedious.TYPES.VarBinary],
]);

function single(nativeType: DescriptionParameterType, value: unknown): CompileTypedBindPlanInput {
  const dataType: TypedParameterDefinition["dataType"] = ["INT", "BIGINT", "FLOAT", "DECIMAL"].includes(nativeType.type) ? "NUMBER"
    : nativeType.type === "BIT" ? "BOOLEAN" : nativeType.type === "DATE" ? "DATE" : nativeType.type === "DATETIME2" ? "DATETIME" : "STRING";
  return { sql: "SELECT {{P}} AS Synthetic", definitions: [{ name: "P", dataType, controlType: "TEXT", isRequired: false, dateOutputMode: "NATIVE" }],
    declarations: { state: "CONFIRMED", origin: "EXPLICIT_RUNTIME_BIND", version: "0000000000000001",
      parameters: [{ name: "P", nativeType, cardinality: { kind: "SCALAR" } }] }, values: { P: value } };
}
function request(useUTC: boolean | undefined = true) {
  const parent = { config: { options: { useUTC } } };
  const native = new sql.Request(parent as any);
  // Preparing must not start any SQL operation, including the describe RPC.
  native.query = (() => assert.fail("must not execute rows")) as any;
  native.execute = (() => assert.fail("must not execute a procedure")) as any;
  const target: TypedBindRequest = { parameters: native.parameters, parent,
    input(name, type, value) { return native.input(name, type as any, value); } };
  return { native, target, parameters: native.parameters as Record<string, any> };
}
function prepare(input: CompileTypedBindPlanInput) {
  const plan = compileSqlServerTypedBindPlan(input);
  const runtime = request(), description = request();
  const query = prepareSqlServerTypedRuntime(plan, runtime.target);
  const procedure = prepareSqlServerTypedDescription(plan, description.target);
  return { plan, runtime, description, query, procedure };
}
function normalizeDeclaration(value: string): string {
  return value.toLowerCase().replace(/\bdatetime2\b(?!\()/g, "datetime2(7)").replace(/\s/g, "");
}

const samples: [DescriptionParameterType, unknown][] = [
  [{ type: "INT" }, 42], [{ type: "BIGINT" }, "9223372036854775807"], [{ type: "BIT" }, true],
  [{ type: "FLOAT" }, 0.125], [{ type: "DECIMAL", precision: 8, scale: 2 }, "1234.56"],
  [{ type: "DATE" }, new Date("2026-10-21T00:00:00.000Z")],
  [{ type: "DATETIME2" }, new Date("2026-10-21T12:34:56.789Z")],
  [{ type: "NVARCHAR", length: 20 }, "合成○😀"], [{ type: "VARCHAR", length: 20 }, "ASCII synthetic"],
  [{ type: "VARBINARY", length: 20 }, Buffer.from([0, 1, 255])],
];
for (const [type, value] of samples) for (const nullable of [false, true]) {
  test(`${type.type} ${nullable ? "null" : "value"}: descriptor declaration matches actual explicitly typed mssql Request`, () => {
    const result = prepare(single(type, nullable ? null : value));
    const bound = result.runtime.parameters.P;
    const declaration = driverTypes.get(bound.type).declaration(bound);
    assert.equal(normalizeDeclaration(result.description.parameters.params.value), `@p${normalizeDeclaration(declaration)}`);
    assert.equal(result.procedure.procedure, "sys.sp_describe_first_result_set");
    assert.equal(result.description.parameters.tsql.value, result.query.sql);
    assert.equal(result.query.sql, "SELECT @P AS Synthetic");
    if (nullable) assert.equal(bound.value, null);
    if (type.type === "DATETIME2") assert.equal(bound.scale, 7);
    if (type.type === "DECIMAL") { assert.equal(bound.precision, type.precision); assert.equal(bound.scale, type.scale); }
    assert.equal(result.plan.deliveryAllowed, false);
  });
}

test("BIGINT preserves both signed boundaries through actual Tedious local TDS serialization", () => {
  for (const value of ["9223372036854775807", "-9223372036854775808", "9007199254740993", 42n]) {
    const { runtime } = prepare(single({ type: "BIGINT" }, value));
    const parameter = runtime.parameters.P;
    assert.equal(parameter.type, sql.BigInt);
    assert.equal(parameter.value, BigInt(value));
    const validated = tedious.TYPES.BigInt.validate(parameter.value);
    const buffer = new WritableBuffer();
    tedious.TYPES.BigInt.writeValue(buffer, { ...parameter, value: validated });
    assert.equal(buffer.data.readBigInt64LE(1), BigInt(value));
  }
});

test("DECIMAL preserves the requested scaled integer through actual driver validation and wire encoding", () => {
  const cases: [number, number, string, bigint][] = [
    [9, 2, "1234.56", 123456n], [18, 4, "-1234.5678", 12345678n],
    [28, 10, "0.1234567890", 1234567890n], [38, 38, `0.${"0".repeat(37)}1`, 1n],
  ];
  for (const [precision, scale, value, expected] of cases) {
    const { runtime } = prepare(single({ type: "DECIMAL", precision, scale }, value));
    const parameter = runtime.parameters.P;
    const buffer = new WritableBuffer();
    tedious.TYPES.Decimal.writeValue(buffer, { ...parameter, value: tedious.TYPES.Decimal.validate(parameter.value) });
    const bytes: Buffer = buffer.data;
    let magnitude = 0n;
    for (let index = bytes.length - 1; index >= 2; index--) magnitude = magnitude * 256n + BigInt(bytes[index]!);
    assert.equal(magnitude, expected);
    assert.equal(bytes[1], value.startsWith("-") ? 0 : 1);
  }
});

for (const [type, values] of [
  [{ type: "INT" }, [2147483648, -2147483649, 1.1, NaN, Infinity, "1e2", " 1", true]],
  [{ type: "BIGINT" }, [9007199254740993, "9223372036854775808", "-9223372036854775809", "01", "1.0", undefined]],
  [{ type: "BIT" }, [0, 1, "true", "false", {}, undefined]],
  [{ type: "FLOAT" }, [NaN, Infinity, -Infinity, 9007199254740993, Number.MIN_VALUE, "0.125"]],
  [{ type: "DECIMAL", precision: 5, scale: 2 }, ["1000.00", "1.234", "1.230", 1.23, "1e2", "NaN"]],
  [{ type: "NVARCHAR", length: 2 }, ["abc", "😀a", "\ud800", 42, undefined]],
  [{ type: "VARCHAR", length: 2 }, ["abc", "合成", "é", "😀", 42]],
  [{ type: "VARBINARY", length: 2 }, [Buffer.alloc(3), "00", new Uint8Array([1]), {}, undefined]],
  [{ type: "DATE" }, ["2026-10-21", new Date(NaN), new Date("2026-10-21T01:00:00Z"), new Date("0000-01-01T00:00:00Z")]],
  [{ type: "DATETIME2" }, ["2026-10-21T00:00:00Z", new Date(NaN), new Date("+010000-01-01T00:00:00Z")]],
] as [DescriptionParameterType, unknown[]][]) {
  test(`${type.type}: invalid, ambiguous, overflowing or unsupported values fail closed`, () => {
    for (const value of values) assert.throws(() => compileSqlServerTypedBindPlan(single(type, value)), TypedBindPlanError);
  });
}

test("high precision DECIMAL rejects unrepresentable scaled magnitudes instead of rounding", () => {
  for (const value of ["9007199254740993.00", "123456789012345678901234567890.12345678"]) {
    assert.throws(() => compileSqlServerTypedBindPlan(single({ type: "DECIMAL", precision: 38, scale: 8 }, value)), /TYPED_BIND_PRECISION_UNSUPPORTED/);
  }
});

test("null, empty strings, Unicode UTF-16 lengths and binary emptiness remain explicit", () => {
  for (const type of [{ type: "NVARCHAR", length: "MAX" }, { type: "VARCHAR", length: "MAX" }, { type: "VARBINARY", length: "MAX" }] as DescriptionParameterType[]) {
    const value = type.type === "VARBINARY" ? Buffer.alloc(0) : "";
    assert.deepEqual(prepare(single(type, value)).runtime.parameters.P.value, value);
  }
  assert.equal(prepare(single({ type: "NVARCHAR", length: 2 }, "😀")).runtime.parameters.P.value, "😀");
  const required = single({ type: "NVARCHAR", length: 2 }, null);
  assert.throws(() => compileSqlServerTypedBindPlan({ ...required, definitions: [{ ...required.definitions[0]!, isRequired: true }] }), /TYPED_BIND_VALUE_INVALID/);
});

function list(values: unknown[], length = 2): CompileTypedBindPlanInput {
  const input = single({ type: "BIGINT" }, null);
  return { ...input, sql: "SELECT 1 WHERE Synthetic IN ({{P}}) OR Synthetic IN ({{P}})",
    definitions: [{ ...input.definitions[0]!, controlType: "MULTISELECT" }], values: { P: values },
    declarations: { ...input.declarations, parameters: [{ ...input.declarations.parameters[0]!, cardinality: { kind: "FIXED_LIST", length } }] } };
}
test("fixed list arity and repeated tokens share identical descriptor/runtime names and explicit types", () => {
  const { runtime, description, query } = prepare(list(["9007199254740993", null]));
  assert.equal(query.sql, "SELECT 1 WHERE Synthetic IN (@P__0, @P__1) OR Synthetic IN (@P__0, @P__1)");
  assert.deepEqual(Object.keys(runtime.parameters), ["P__0", "P__1"]);
  assert.equal(runtime.parameters.P__0.value, 9007199254740993n);
  assert.equal(runtime.parameters.P__1.value, null);
  assert.equal(runtime.parameters.P__0.type, sql.BigInt);
  assert.equal(description.parameters.params.value, "@P__0 bigint, @P__1 bigint");
});

test("changed/empty/sparse lists, missing cardinality and dynamic lists are rejected", () => {
  for (const input of [list([]), list([1]), list([1, 2, 3]), list([], 0), list(Array(2)), list([1], 129),
    { ...list([1, 2]), declarations: { ...list([1, 2]).declarations, parameters: [{ name: "P", nativeType: { type: "BIGINT" }, cardinality: { kind: "DYNAMIC" } }] } },
    { ...list([1, 2]), declarations: { ...list([1, 2]).declarations, parameters: [{ name: "P", nativeType: { type: "BIGINT" } }] } }]) {
    assert.throws(() => compileSqlServerTypedBindPlan(input as any), /TYPED_BIND_LIST_UNSUPPORTED|TYPED_BIND_VALUE_INVALID/);
  }
  assert.throws(() => compileSqlServerTypedBindPlan({ ...single({ type: "INT" }, [1, 2]) }), /TYPED_BIND_LIST_UNSUPPORTED/);
});

test("list-generated names cannot collide with independently declared parameters", () => {
  const input = list([1, 2]);
  assert.throws(() => compileSqlServerTypedBindPlan({ ...input, sql: `${input.sql} OR Synthetic={{P__0}}`,
    definitions: [...input.definitions, { ...input.definitions[0]!, name: "P__0", controlType: "TEXT" }],
    declarations: { ...input.declarations, parameters: [...input.declarations.parameters, { name: "P__0", nativeType: { type: "INT" }, cardinality: { kind: "SCALAR" } }] },
    values: { P: [1, 2], P__0: 3 } }), /TYPED_BIND_LIST_UNSUPPORTED/);
});

test("SQL tokens, Dataset definitions, native declarations and actual values must have identical unique names", () => {
  const input = single({ type: "INT" }, 1);
  for (const patch of [
    { sql: "SELECT {{OTHER}}" }, { sql: "SELECT 1" }, { values: {} }, { values: { P: 1, OTHER: 2 } },
    { definitions: [...input.definitions, ...input.definitions] }, { definitions: [] },
    { declarations: { ...input.declarations, parameters: [...input.declarations.parameters, ...input.declarations.parameters] } },
    { declarations: { ...input.declarations, parameters: [{ ...input.declarations.parameters[0]!, name: "OTHER" }] } },
    { definitions: [{ ...input.definitions[0]!, name: "p" }] },
    { definitions: [{ ...input.definitions[0]!, dataType: "STRING" }] },
    { definitions: [{ ...input.definitions[0]!, dateOutputMode: "UNKNOWN" }] },
  ]) assert.throws(() => compileSqlServerTypedBindPlan({ ...input, ...patch } as any), TypedBindPlanError);
  const hidden = Object.defineProperty({ P: 1 }, "EXTRA", { value: 2 });
  assert.throws(() => compileSqlServerTypedBindPlan({ ...input, values: hidden }), /TYPED_BIND_DEFINITION_MISMATCH/);
  const getter = { get P() { return assert.fail("input getters must not be evaluated"); } };
  assert.throws(() => compileSqlServerTypedBindPlan({ ...input, values: getter }), /TYPED_BIND_DEFINITION_MISMATCH/);
});

test("unconfirmed/missing type evidence, unknown native types and invalid precision/length are rejected", () => {
  const input = single({ type: "INT" }, null);
  for (const declarations of [null, { ...input.declarations, state: "UNCONFIRMED" }, { ...input.declarations, state: "MISSING" },
    { ...input.declarations, origin: "INFERRED_FROM_NUMBER" }, { ...input.declarations, version: 9007199254740993 },
    { ...input.declarations, version: "1" }]) {
    assert.throws(() => compileSqlServerTypedBindPlan({ ...input, declarations } as any), /TYPED_BIND_CONTRACT_INVALID/);
  }
  for (const nativeType of [{ type: "UNKNOWN" }, { type: "NUMBER" }, { type: "INT", length: 1 },
    { type: "NVARCHAR", length: 4001 }, { type: "VARCHAR", length: 0 }, { type: "DECIMAL", precision: 39, scale: 0 },
    { type: "DECIMAL", precision: 3, scale: 4 }, { type: "DATETIME2", scale: 3 }]) {
    assert.throws(() => compileSqlServerTypedBindPlan(single(nativeType as any, null)), /TYPED_BIND_CONTRACT_INVALID/);
  }
});

test("unsafe SQL and ambiguous native/quoted tokens are refused without value interpolation", () => {
  const input = single({ type: "NVARCHAR", length: "MAX" }, "synthetic'); DELETE FROM T; --");
  const { runtime, description, query } = prepare(input);
  assert.equal(runtime.parameters.P.value, input.values.P);
  assert.equal(query.sql.includes(String(input.values.P)), false);
  assert.equal(description.parameters.tsql.value, "SELECT @P AS Synthetic");
  for (const sql of ["DELETE FROM T", "SELECT '{{P}}'", "SELECT @P", "SELECT :P", "SELECT 1; SELECT {{P}}", "SELECT /*{{P}}*/ 1"]) {
    assert.throws(() => compileSqlServerTypedBindPlan({ ...input, sql }), /TYPED_BIND_SQL_UNSUPPORTED/);
  }
});

test("DATE/DATETIME2 require explicit UTC Request context and preserve UTC instants", () => {
  const date = new Date("2026-10-21T08:30:00.123+08:00");
  const input = single({ type: "DATETIME2" }, date);
  const plan = compileSqlServerTypedBindPlan(input);
  for (const context of [false, undefined]) {
    const target = request(false).target; target.parent!.config!.options!.useUTC = context;
    assert.throws(() => prepareSqlServerTypedRuntime(plan, target), /TYPED_BIND_UTC_REQUIRED/);
    assert.deepEqual(target.parameters, {});
  }
  assert.equal(prepare(input).runtime.parameters.P.value.toISOString(), "2026-10-21T00:30:00.123Z");
});

test("STRING date mode preserves the formatted string and cannot silently become native DATE", () => {
  const input = single({ type: "NVARCHAR", length: 32 }, "115/10/21");
  const definition = { ...input.definitions[0]!, dataType: "DATE" as const, dateOutputMode: "STRING" as const };
  const result = prepare({ ...input, definitions: [definition] });
  assert.equal(result.runtime.parameters.P.value, "115/10/21");
  assert.throws(() => compileSqlServerTypedBindPlan({ ...single({ type: "DATE" }, new Date("2026-10-21T00:00:00Z")), definitions: [definition] }), /TYPED_BIND_DEFINITION_MISMATCH/);
});

test("plan snapshots mutable inputs; each Request gets independent Date and Buffer copies", () => {
  for (const [type, value] of [[{ type: "VARBINARY", length: 2 }, Buffer.from([1, 2])],
    [{ type: "DATETIME2" }, new Date("2026-10-21T00:00:00Z")]] as [DescriptionParameterType, Buffer | Date][]) {
    const input = single(type, value); const plan = compileSqlServerTypedBindPlan(input);
    const original = value instanceof Date ? value.getTime() : Buffer.from(value);
    if (value instanceof Date) value.setTime(0); else value.fill(9);
    const first = request(); prepareSqlServerTypedRuntime(plan, first.target);
    if (first.parameters.P.value instanceof Date) first.parameters.P.value.setTime(1); else first.parameters.P.value.fill(8);
    const second = request(); prepareSqlServerTypedRuntime(plan, second.target);
    const actual = second.parameters.P.value;
    assert.deepEqual(actual instanceof Date ? actual.getTime() : actual, original);
  }
  const input = single({ type: "NVARCHAR", length: 20 }, "synthetic");
  const plan = compileSqlServerTypedBindPlan(input);
  (input.declarations.parameters[0]!.nativeType as any).length = 1;
  const result = request(); prepareSqlServerTypedRuntime(plan, result.target);
  assert.equal(result.parameters.P.length, 20);
});

test("opaque plans and sanitized errors do not expose SQL, raw values or synthetic secrets", () => {
  const input = single({ type: "NVARCHAR", length: "MAX" }, "SYNTHETIC_PATIENT_PASSWORD");
  const plan = compileSqlServerTypedBindPlan(input);
  assert.doesNotMatch(JSON.stringify(plan) + inspect(plan), /SELECT|SYNTHETIC_PATIENT_PASSWORD|@P/);
  assert.throws(() => readSqlServerTypedBindPlan(JSON.parse(JSON.stringify(plan))), /TYPED_BIND_PLAN_INVALID/);
  for (const prepareRequest of [prepareSqlServerTypedRuntime, prepareSqlServerTypedDescription]) {
    const broken = request(); broken.target.input = () => { throw new Error(`${input.sql} ${input.values.P}`); };
    assert.throws(() => prepareRequest(plan, broken.target), error => {
      assert.ok(error instanceof TypedBindPlanError);
      assert.equal(error.message, "TYPED_BIND_REQUEST_FAILED");
      assert.equal(error.cause, undefined);
      return true;
    });
    const preloaded = request(); preloaded.target.input("EXTRA", sql.Int, 1);
    assert.throws(() => prepareRequest(plan, preloaded.target), /TYPED_BIND_REQUEST_INVALID/);
  }
});

test("legacy NUMBER coercion loss is detected rather than blessed as native type evidence", () => {
  const input = single({ type: "BIGINT" }, "9007199254740993");
  const definition = { ...input.definitions[0]!, defaultValue: null } as DatasetParameterRecord;
  const legacy = coerceRuntimeParameters([definition], input.values as Record<string, unknown>);
  assert.equal(legacy.P, 9007199254740992);
  assert.throws(() => compileSqlServerTypedBindPlan({ ...input, values: legacy }), /TYPED_BIND_VALUE_INVALID/);
  assert.equal(prepare(input).runtime.parameters.P.value, 9007199254740993n);
});

test("zero parameters require explicit declaration confirmation and produce no inferred bindings", () => {
  const base = single({ type: "INT" }, 1);
  const input = { ...base, sql: "SELECT 1 AS Synthetic", definitions: [], values: {},
    declarations: { ...base.declarations, parameters: [] } };
  const { runtime, description } = prepare(input);
  assert.deepEqual(runtime.parameters, {});
  assert.equal(description.parameters.params.value, null);
  assert.throws(() => compileSqlServerTypedBindPlan({ ...input, declarations: undefined } as any), /TYPED_BIND_CONTRACT_INVALID/);
});

test("plan enforces an aggregate parameter bound before preparing a Request", () => {
  const base = single({ type: "INT" }, 1);
  const names = Array.from({ length: 2001 }, (_value, index) => `P${index}`);
  const input = { ...base, sql: "SELECT 1 WHERE " + names.map(name => `1={{${name}}}`).join(" OR "),
    definitions: names.map(name => ({ ...base.definitions[0]!, name })),
    declarations: { ...base.declarations, parameters: names.map(name => ({ ...base.declarations.parameters[0]!, name })) },
    values: Object.fromEntries(names.map(name => [name, 1])) };
  assert.throws(() => compileSqlServerTypedBindPlan(input), /TYPED_BIND_LIST_UNSUPPORTED/);
});

test("canonical runtime dates retain native DATE/DATETIME2 typed contracts; ROC strings remain NVARCHAR", () => {
  for (const [dataType, nativeType, text] of [
    ["DATE", { type: "DATE" }, "2026-10-27"],
    ["DATETIME", { type: "DATETIME2" }, "2026-10-27T11:26:47"],
  ] as const) {
    const definition = { name: "P", dataType, controlType: dataType, isRequired: true, defaultValue: null,
      dateOutputMode: "NATIVE", dateCalendar: "ROC", dateFormat: "yyyMMdd" } as DatasetParameterRecord;
    const values = coerceRuntimeParameters([definition], { P: text });
    const { runtime } = prepare({ ...single(nativeType, values.P), values });
    assert.equal(runtime.parameters.P.type, dataType === "DATE" ? sql.Date : sql.DateTime2);
    assert.equal(runtime.parameters.P.value.toISOString(), dataType === "DATE" ? "2026-10-27T00:00:00.000Z" : "2026-10-27T11:26:47.000Z");
    const stringValues = coerceRuntimeParameters([{ ...definition, dateOutputMode: "STRING" }], { P: text });
    const input = { ...single({ type: "NVARCHAR", length: 20 }, stringValues.P),
      definitions: [{ ...definition, dateOutputMode: "STRING" as const }], values: stringValues };
    assert.equal(prepare(input).runtime.parameters.P.value, "1151027");
    assert.throws(() => compileSqlServerTypedBindPlan({ ...input,
      declarations: single(nativeType, null).declarations }), /TYPED_BIND_DEFINITION_MISMATCH/);
  }
});
