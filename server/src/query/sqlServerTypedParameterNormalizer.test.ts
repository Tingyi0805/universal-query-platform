import assert from "node:assert/strict";
import test from "node:test";
import { inspect } from "node:util";
import { createRequire } from "node:module";
import sql from "mssql";
import { normalizeSqlServerTypedParameters as normalize, readNormalizedTypedParameters as read,
  type NormalizeTypedParametersInput, type NormalizationDefinition } from "./sqlServerTypedParameterNormalizer.js";
import { compileSqlServerTypedBindPlan, readSqlServerTypedBindPlan } from "./sqlServerTypedBindPlan.js";
import type { DescriptionParameterType } from "./queryDescription.js";
import { prepareSqlServerTypedDescription, prepareSqlServerTypedRuntime } from "../modules/datasource/adapters/sqlServerTypedBindings.js";
import { coerceRuntimeParameters } from "../modules/dataset/parameter.service.js";
import type { DatasetParameterRecord } from "../modules/dataset/parameter.repository.js";

const tedious = createRequire(import.meta.url)("tedious");
const driverTypes = new Map<any, any>([
  [sql.Int, tedious.TYPES.Int], [sql.BigInt, tedious.TYPES.BigInt], [sql.Bit, tedious.TYPES.Bit],
  [sql.Float, tedious.TYPES.Float], [sql.Decimal, tedious.TYPES.Decimal], [sql.Date, tedious.TYPES.Date],
  [sql.DateTime2, tedious.TYPES.DateTime2], [sql.NVarChar, tedious.TYPES.NVarChar], [sql.VarChar, tedious.TYPES.VarChar],
]);

function input(type: DescriptionParameterType, value: unknown,
  patch: Partial<NormalizationDefinition> = {}): NormalizeTypedParametersInput {
  const dataType = ["INT", "BIGINT", "DECIMAL", "FLOAT"].includes(type.type) ? "NUMBER"
    : type.type === "BIT" ? "BOOLEAN" : type.type === "DATE" ? "DATE" : type.type === "DATETIME2" ? "DATETIME" : "STRING";
  return { scope: "ISOLATED_TEST_ONLY", sql: "SELECT {{P}} AS Synthetic", expectedVersion: "0000000000000001",
    definitions: [{ name: "P", dataType, controlType: "TEXT", isRequired: false, defaultValue: null,
      dateOutputMode: "NATIVE", dateCalendar: "GREGORIAN", dateFormat: null, ...patch }],
    declarations: { state: "CONFIRMED", origin: "EXPLICIT_RUNTIME_BIND", version: "0000000000000001",
      parameters: [{ name: "P", nativeType: type, cardinality: { kind: "SCALAR" } }] }, rawValues: { P: value } };
}
const value = (source: NormalizeTypedParametersInput) => read(normalize(source)).values.P;
function prepare(source: NormalizeTypedParametersInput) {
  const normalized = normalize(source), plan = compileSqlServerTypedBindPlan(read(normalized));
  // Real local mssql Request preparation with transport methods replaced by traps.
  const makeRequest = () => {
    const request = new sql.Request({ config: { options: { useUTC: true } } } as any);
    request.query = (() => assert.fail("no SQL execution")) as any;
    request.execute = (() => assert.fail("no RPC execution")) as any;
    return request;
  };
  const description = makeRequest(), runtime = makeRequest();
  const query = prepareSqlServerTypedRuntime(plan, runtime);
  prepareSqlServerTypedDescription(plan, description);
  return { normalized, plan, description: description.parameters as Record<string, any>,
    runtime: runtime.parameters as Record<string, any>, query };
}
function list(values: unknown, length = 2, type: DescriptionParameterType = { type: "BIGINT" }) {
  const source = input(type, values, { controlType: "MULTISELECT" });
  return { ...source, sql: "SELECT 1 WHERE Synthetic IN ({{P}}) OR Synthetic IN ({{P}})",
    declarations: { ...source.declarations, parameters: [{ ...source.declarations.parameters[0]!,
      cardinality: { kind: "FIXED_LIST" as const, length } }] } };
}

test("BIGINT preserves exact text/bigint and never recovers an unsafe Number", () => {
  for (const raw of ["9007199254740993", "9223372036854775807", "-9223372036854775808", 9007199254740993n, 42]) {
    assert.equal(value(input({ type: "BIGINT" }, raw)), BigInt(raw));
    assert.equal(prepare(input({ type: "BIGINT" }, raw)).runtime.P.value, BigInt(raw));
  }
  for (const raw of [9007199254740993, "9223372036854775808", "-9223372036854775809", "01", "1e3", " 1", 1.1]) {
    assert.throws(() => value(input({ type: "BIGINT" }, raw)));
  }
  const source = input({ type: "BIGINT" }, "9007199254740993");
  const legacy = coerceRuntimeParameters(source.definitions as DatasetParameterRecord[], { ...source.rawValues });
  assert.equal(legacy.P, 9007199254740992);
  assert.throws(() => normalize({ ...source, rawValues: legacy }));
});

test("DECIMAL normalization keeps exact decimal text independently of driver limitations", () => {
  const nativeType = { type: "DECIMAL", precision: 38, scale: 8 } as const;
  for (const raw of ["9007199254740993.12345678", "-0.00000001", "123.45000000", 12n, 12]) {
    assert.equal(value(input(nativeType, raw)), String(raw));
  }
  const source = read(normalize(input(nativeType, "9007199254740993.12345678")));
  assert.throws(() => compileSqlServerTypedBindPlan(source), /TYPED_BIND_PRECISION_UNSUPPORTED/);
  for (const raw of [0.1, 0.1 + 0.2, 9007199254740993, "1e2", "1.", ".1", "01.1", "1.123456789", "9".repeat(31)]) {
    assert.throws(() => value(input(nativeType, raw)));
  }
  assert.equal(value(input({ type: "DECIMAL", precision: 3, scale: 3 }, "0.999")), "0.999");
  assert.throws(() => value(input({ type: "DECIMAL", precision: 3, scale: 3 }, "1.000")));
});

test("missing, undefined, null and empty scalar values use only a nonempty saved default", () => {
  for (const raw of [undefined, null, ""]) {
    assert.equal(value(input({ type: "BIGINT" }, raw)), null);
    assert.equal(value(input({ type: "BIGINT" }, raw, { defaultValue: "9007199254740993", isRequired: true })), 9007199254740993n);
    assert.throws(() => value(input({ type: "BIGINT" }, raw, { isRequired: true })), /TYPED_NORMALIZATION_REQUIRED/);
    assert.equal(value(input({ type: "NVARCHAR", length: 30 }, raw, { defaultValue: "" })), null);
  }
  const source = input({ type: "INT" }, undefined, { defaultValue: "0" });
  assert.equal(value({ ...source, rawValues: {} }), 0);
  assert.equal(value(input({ type: "BIT" }, false, { defaultValue: "true" })), false);
  assert.equal(value(input({ type: "INT" }, 0, { defaultValue: "1" })), 0);
  assert.equal(value(input({ type: "NVARCHAR", length: 3 }, " ", { isRequired: true })), " ");
  assert.throws(() => value(input({ type: "INT" }, null, { defaultValue: "invalid" })));
});

test("BOOLEAN accepts documented flags and refuses generic numeric truthiness", () => {
  for (const raw of [true, 1, "true", " TRUE ", "1", "yes", "Y"]) assert.equal(value(input({ type: "BIT" }, raw)), true);
  for (const raw of [false, 0, "false", " FALSE ", "0", "no", "N"]) assert.equal(value(input({ type: "BIT" }, raw)), false);
  for (const raw of [2, -1, NaN, Infinity, {}, [], "on", " "]) assert.throws(() => value(input({ type: "BIT" }, raw)));
  assert.equal(value(input({ type: "BIT" }, null, { defaultValue: "false" })), false);
});

test("INT/FLOAT and text keep declared types, Unicode, UTF-16 bounds and injection as data", () => {
  assert.equal(value(input({ type: "INT" }, "2147483647")), 2147483647);
  assert.throws(() => value(input({ type: "INT" }, "2147483648")));
  assert.equal(value(input({ type: "FLOAT" }, 0.125)), 0.125);
  for (const raw of ["0.125", Infinity, Number.MIN_VALUE, 9007199254740993]) assert.throws(() => value(input({ type: "FLOAT" }, raw)));
  assert.equal(value(input({ type: "NVARCHAR", length: 4 }, "合成😀")), "合成😀");
  for (const [type, raw] of [[{ type: "NVARCHAR", length: 3 }, "合成😀"], [{ type: "NVARCHAR", length: 3 }, "\ud800"],
    [{ type: "VARCHAR", length: 3 }, "合成"], [{ type: "NVARCHAR", length: 3 }, 123],
    [{ type: "VARBINARY", length: 3 }, Buffer.from([1])]] as [DescriptionParameterType, unknown][]) {
    assert.throws(() => value(input(type, raw)));
  }
  const raw = "合成'); DELETE FROM Synthetic; --";
  const prepared = prepare(input({ type: "NVARCHAR", length: "MAX" }, raw));
  assert.equal(prepared.runtime.P.value, raw);
  assert.equal(prepared.query.sql, "SELECT @P AS Synthetic");
});

test("STRING dates preserve ROC/custom text and format strict canonical values and saved defaults", () => {
  const date = (raw: unknown, patch: Partial<NormalizationDefinition> = {}) => input({ type: "NVARCHAR", length: 60 }, raw,
    { dataType: "DATE", dateOutputMode: "STRING", dateCalendar: "ROC", ...patch });
  assert.equal(value(date("115/10/21")), "115/10/21");
  assert.equal(value(date("2026-10-21")), "115/10/21");
  assert.equal(value(date("2026-10-21", { dateFormat: "yyyMMdd" })), "1151021");
  assert.equal(value(date(undefined, { defaultValue: "2026-10-21" })), "115/10/21");
  assert.equal(value(date("custom-date-text")), "custom-date-text");
  assert.throws(() => value(date("2026-02-30")));
  assert.throws(() => value(date(new Date("2026-10-21T00:00:00Z"))));
  assert.throws(() => value(date("2026-10-21", { dateFormat: "x".repeat(61) })));
  const dynamic = date("$TODAY");
  assert.throws(() => value(dynamic));
  assert.equal(value({ ...dynamic, now: new Date("2026-10-21T12:00:00Z") }), "115/10/21");
  assert.equal(value({ ...date("$TODAY+1"), now: new Date("2026-10-21T12:00:00Z") }), "115/10/22");
  const datetime = (raw: string) => date(raw, { dataType: "DATETIME", dateCalendar: "GREGORIAN" });
  assert.equal(value(datetime("2026-10-21T12:34:56.789Z")), "2026-10-21 12:34:56");
  for (const raw of ["2026-10-21T12:34", "2026-02-30T00:00:00.000Z", "2026-10-21T12:34:56.000+08:00"]) {
    assert.throws(() => value(datetime(raw)));
  }
});

test("NATIVE dates accept only valid existing Dates without parsing strings or dynamic defaults", () => {
  for (const type of [{ type: "DATE" }, { type: "DATETIME2" }] as DescriptionParameterType[]) {
    const raw = new Date("2026-10-21T00:00:00Z");
    assert.deepEqual(value(input(type, raw)), raw);
    for (const value of ["2026-10-21", "115/10/21", "$TODAY", "2026-10-21T00:00:00.000Z"]) {
      assert.throws(() => normalize(input(type, value)), /TYPED_NORMALIZATION_NATIVE_DATE_REQUIRED/);
    }
    for (const raw of [new Date(NaN), new Date("0000-01-01T00:00:00Z"), new Date("+010000-01-01T00:00:00Z")]) {
      assert.throws(() => normalize(input(type, raw)));
    }
    assert.throws(() => normalize(input(type, undefined, { defaultValue: "$TODAY" })));
    const prepared = prepare(input(type, null));
    assert.equal(prepared.runtime.P.value, null);
  }
  assert.throws(() => normalize(input({ type: "DATE" }, new Date("2026-10-21T00:00:00.001Z"))));
});

test("MULTISELECT requires fixed dense homogeneous arrays and never expands CSV, empty or default lists", () => {
  assert.deepEqual(value(list(["9007199254740993", "2"])), [9007199254740993n, 2n]);
  assert.deepEqual(value(list(["1", null])), [1n, null]);
  const source = list(["1", null]);
  assert.throws(() => normalize({ ...source, definitions: [{ ...source.definitions[0]!, isRequired: true }] }));
  for (const raw of [[], ["1"], ["1", "2", "3"], "1,2", null, undefined, [1, "2"], [1n, 2], ["1", ""], ["1", undefined], Array(2), [true, false], ["1", "oops"]]) {
    assert.throws(() => normalize(list(raw)));
  }
  for (const length of [0, 1, 129, 1.5]) assert.throws(() => normalize(list(["1", "2"], length)));
  assert.throws(() => normalize({ ...source, definitions: [{ ...source.definitions[0]!, defaultValue: "1" }] }));
  const accessor = ["1", "2"];
  let getterCalls = 0;
  Object.defineProperty(accessor, 0, { get() { getterCalls++; return "1"; } });
  assert.throws(() => normalize(list(accessor)));
  assert.equal(getterCalls, 0);
});

test("saved names, tokens, declarations, version and native options must agree exactly", () => {
  const source = input({ type: "INT" }, 1);
  for (const patch of [
    { sql: "SELECT {{OTHER}}" }, { sql: "SELECT 1" }, { sql: "SELECT '{{P}}'" }, { sql: "SELECT @P" },
    { rawValues: { P: 1, OTHER: 2 } }, { rawValues: Object.create({ P: 1 }) },
    { definitions: [...source.definitions, ...source.definitions] }, { definitions: [] },
    { definitions: [{ ...source.definitions[0], name: "p" }] },
    { definitions: [{ ...source.definitions[0], dataType: "STRING" }] },
    { definitions: [{ ...source.definitions[0], isRequired: "false" }] },
    { definitions: [{ ...source.definitions[0], defaultValue: 1 }] },
    { definitions: [{ ...source.definitions[0], dateCalendar: "UNKNOWN" }] },
    { expectedVersion: "0000000000000002" }, { expectedVersion: "invalid" }, { scope: "PRODUCTION" },
  ]) assert.throws(() => normalize({ ...source, ...patch } as any));
  for (const declarations of [undefined, { ...source.declarations, state: "VERIFIED" }, { ...source.declarations, state: "UNCONFIRMED" },
    { ...source.declarations, origin: "FRONTEND" }, { ...source.declarations, extra: true },
    { ...source.declarations, parameters: [] }, { ...source.declarations, parameters: [...source.declarations.parameters, ...source.declarations.parameters] }]) {
    assert.throws(() => normalize({ ...source, declarations } as any));
  }
  for (const nativeType of [{ type: "UNKNOWN" }, { type: "NUMBER" }, { type: "INT", extra: true },
    { type: "DECIMAL", precision: 39, scale: 0 }, { type: "NVARCHAR", length: 4001 }]) {
    assert.throws(() => normalize(input(nativeType as any, null)));
  }
  for (const cardinality of [{ kind: "DYNAMIC" }, { kind: "SCALAR", length: 1 }, { kind: "SCALAR", verified: true }]) {
    assert.throws(() => normalize({ ...source, declarations: { ...source.declarations,
      parameters: [{ ...source.declarations.parameters[0], cardinality }] } } as any));
  }
  let getterCalls = 0;
  assert.throws(() => normalize({ ...source, rawValues: { get P() { getterCalls++; return 1; } } }));
  assert.throws(() => normalize({ ...source, definitions: [{ ...source.definitions[0]!, get defaultValue() { getterCalls++; return null; } }] }));
  const nativeType = { get type() { getterCalls++; return "INT" as const; } };
  assert.throws(() => normalize({ ...source, declarations: { ...source.declarations,
    parameters: [{ ...source.declarations.parameters[0]!, nativeType }] } }));
  assert.equal(getterCalls, 0);
  assert.throws(() => normalize({ ...source, rawValues: { P: 1, [Symbol("extra")]: 2 } }));
});

test("same normalized plan prepares matching description/runtime types, including nulls and fixed lists", () => {
  const cases: [DescriptionParameterType, unknown][] = [
    [{ type: "INT" }, "42"], [{ type: "BIGINT" }, "9007199254740993"], [{ type: "BIT" }, "yes"],
    [{ type: "FLOAT" }, 0.125], [{ type: "DECIMAL", precision: 8, scale: 2 }, "1234.50"],
    [{ type: "DATE" }, new Date("2026-10-21T00:00:00Z")], [{ type: "DATETIME2" }, new Date("2026-10-21T12:34:56Z")],
    [{ type: "NVARCHAR", length: 20 }, "合成😀"], [{ type: "VARCHAR", length: 20 }, "synthetic"],
  ];
  for (const [nativeType, raw] of cases) for (const nullable of [false, true]) {
    const result = prepare(input(nativeType, nullable ? null : raw));
    const bound = result.runtime.P;
    const driverDeclaration = driverTypes.get(bound.type).declaration(bound).toLowerCase().replace(/\(7\)|\(53\)/g, "").replace(/\s/g, "");
    assert.equal(result.description.params.value.toLowerCase().replace(/\s/g, ""), `@p${driverDeclaration}`);
    assert.equal(result.description.tsql.value, result.query.sql);
    if (nullable) assert.equal(bound.value, null);
    assert.equal(result.plan.deliveryAllowed, false);
    assert.equal(result.normalized.deliveryAllowed, false);
  }
  const result = prepare(list(["9007199254740993", "2"]));
  assert.equal(result.description.params.value, "@P__0 bigint, @P__1 bigint");
  assert.equal(result.runtime.P__0.type, sql.BigInt);
  assert.equal(result.runtime.P__1.type, sql.BigInt);
  assert.equal(result.query.sql, "SELECT 1 WHERE Synthetic IN (@P__0, @P__1) OR Synthetic IN (@P__0, @P__1)");
});

test("opaque snapshots and sanitized failures cannot create evidence, delivery rights or expose input", () => {
  const raw = new Date("2026-10-21T00:00:00Z"), source = input({ type: "DATE" }, raw);
  const normalized = normalize(source);
  raw.setTime(0);
  const first = read(normalized);
  (first.values.P as Date).setTime(1);
  (first.declarations.parameters[0]!.nativeType as any).type = "BIT";
  assert.equal((read(normalized).values.P as Date).toISOString(), "2026-10-21T00:00:00.000Z");
  assert.equal(read(normalized).declarations.parameters[0]!.nativeType.type, "DATE");
  assert.throws(() => read(JSON.parse(JSON.stringify(normalized))));
  const sensitive = normalize(input({ type: "NVARCHAR", length: "MAX" }, "SYNTHETIC_SECRET"));
  assert.doesNotMatch(JSON.stringify(sensitive) + inspect(sensitive), /SYNTHETIC_SECRET|SELECT|CONFIRMED|VERIFIED/);
  assert.equal(Object.hasOwn(sensitive, "state"), false);
  assert.throws(() => normalize(input({ type: "INT" }, "SYNTHETIC_SECRET")), error => {
    assert.ok(error instanceof Error);
    assert.doesNotMatch(error.message + inspect(error), /SYNTHETIC_SECRET|SELECT/);
    assert.equal(error.cause, undefined);
    return true;
  });
});

test("zero parameter contracts remain isolated and unknown value fields are refused", () => {
  const source = input({ type: "INT" }, 1);
  const empty = { ...source, sql: "SELECT 1 AS Synthetic", definitions: [], rawValues: {},
    declarations: { ...source.declarations, parameters: [] } };
  assert.deepEqual(readSqlServerTypedBindPlan(compileSqlServerTypedBindPlan(read(normalize(empty)))).binds, []);
  assert.throws(() => normalize({ ...empty, rawValues: { EXTRA: null } }));
});
