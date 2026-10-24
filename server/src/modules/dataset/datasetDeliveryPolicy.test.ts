import assert from "node:assert/strict";
import test from "node:test";
import {
  applyDatasetDeliveryPolicy,
  DatasetDeliveryPolicyError,
  type ConfirmedDatasetDeliveryPolicy,
} from "./datasetDeliveryPolicy.js";

const confirmed = (
  rules: ConfirmedDatasetDeliveryPolicy["rules"] = [],
  patientAuditOnlyColumns: readonly string[] = [],
): ConfirmedDatasetDeliveryPolicy => ({ state: "CONFIRMED", version: "1", rules, patientAuditOnlyColumns });

test("applies Dataset CUSTOM masking to a patient name", () => {
  const result = applyDatasetDeliveryPolicy({
    policy: confirmed([{ columnName: "NAME", mode: "CUSTOM", customMask: { prefix: 1, suffix: 1, symbol: "○" } }]),
    columns: [{ name: "NAME" }],
    rows: [{ NAME: "王小明" }],
  });
  assert.deepEqual(result.rows, [{ NAME: "王○明" }]);
});

test("supports prefix, suffix, custom Unicode symbols, null, empty, and short values", () => {
  const policy = confirmed([{ columnName: "VALUE", mode: "CUSTOM", customMask: { prefix: 1, suffix: 2, symbol: "🔒" } }]);
  const result = applyDatasetDeliveryPolicy({
    policy,
    columns: [{ name: "VALUE" }],
    rows: [{ VALUE: "A1234" }, { VALUE: "短字" }, { VALUE: "" }, { VALUE: null }],
  });
  assert.deepEqual(result.rows, [
    { VALUE: "A🔒🔒34" },
    { VALUE: "🔒🔒" },
    { VALUE: "" },
    { VALUE: null },
  ]);
});

test("OMIT removes the column, every row value, and related delivery metadata", () => {
  const result = applyDatasetDeliveryPolicy({
    policy: confirmed([{ columnName: "MRN", mode: "OMIT" }, { columnName: "ROOM", mode: "NONE" }]),
    columns: [{ name: "MRN", dataType: "string" }, { name: "ROOM", dataType: "string" }],
    rows: [{ mrn: "synthetic-001", ROOM: "R1" }],
    metadata: {
      reportColumns: [
        { columnName: "MRN", displayLabel: "identifier" },
        { columnName: "ROOM", displayLabel: "room" },
      ],
      exportColumns: [{ columnName: "mrn" }, { columnName: "ROOM" }],
    },
  });
  assert.deepEqual(result, {
    columns: [{ name: "ROOM", dataType: "string" }],
    rows: [{ ROOM: "R1" }],
    metadata: {
      reportColumns: [{ columnName: "ROOM", displayLabel: "room" }],
      exportColumns: [{ columnName: "ROOM" }],
    },
  });
});

test("unconfigured columns are omitted until explicitly configured", () => {
  const result = applyDatasetDeliveryPolicy({
    policy: confirmed([{ columnName: "HIDDEN", mode: "OMIT" }]),
    columns: [{ name: "ROOM" }],
    rows: [{ ROOM: "R1" }],
  });
  assert.deepEqual(result.columns, []);
  assert.deepEqual(result.rows, [{}]);
});

test("an explicitly confirmed empty policy is distinct from a missing policy", () => {
  const input = { columns: [{ name: "ROOM" }], rows: [{ ROOM: "R1" }] } as const;
  assert.deepEqual(applyDatasetDeliveryPolicy({ ...input, policy: confirmed() }).rows, [{}]);
  assert.throws(() => applyDatasetDeliveryPolicy({ ...input, policy: null }), /DATASET_DELIVERY_POLICY_REQUIRED/);
  assert.throws(() => applyDatasetDeliveryPolicy({ ...input, policy: undefined }), /DATASET_DELIVERY_POLICY_REQUIRED/);
});

test("missing or untrusted revision evidence fails closed", () => {
  const input = { columns: [{ name: "ROOM" }], rows: [{ ROOM: "R1" }] } as const;
  for (const version of ["", "0", "01", "-1", "1.5", "unsafe"]) {
    assert.throws(() => applyDatasetDeliveryPolicy({
      ...input,
      policy: { state: "CONFIRMED", version, rules: [] },
    }), /DATASET_DELIVERY_POLICY_INVALID/);
  }
  assert.throws(() => applyDatasetDeliveryPolicy({
    ...input,
    policy: { state: "UNCONFIRMED", version: "1", rules: [] } as never,
  }), /DATASET_DELIVERY_POLICY_REQUIRED/);
});

test("unknown modes and invalid CUSTOM settings fail closed", () => {
  const input = { columns: [{ name: "NAME" }], rows: [{ NAME: "synthetic" }] } as const;
  const invalidRules = [
    [{ columnName: "NAME", mode: "UNRECOGNIZED" }],
    [{ columnName: "NAME", mode: "CUSTOM" }],
    [{ columnName: "NAME", mode: "CUSTOM", customMask: { prefix: -1, suffix: 1, symbol: "*" } }],
    [{ columnName: "NAME", mode: "CUSTOM", customMask: { prefix: 1, suffix: 1, symbol: "**" } }],
    [{ columnName: "NAME", mode: "OMIT", customMask: { prefix: 1, suffix: 1, symbol: "*" } }],
    [{ columnName: "NAME", mode: "FULL", customMask: { prefix: 0, suffix: 0, symbol: "*" } }],
  ];
  for (const rules of invalidRules) {
    assert.throws(() => applyDatasetDeliveryPolicy({ ...input, policy: confirmed(rules as never) }), /DATASET_DELIVERY_POLICY_INVALID/);
  }
});

test("case-insensitive duplicate result columns and policy rules are rejected", () => {
  assert.throws(() => applyDatasetDeliveryPolicy({
    policy: confirmed(),
    columns: [{ name: "MRN" }, { name: "mrn" }],
    rows: [],
  }), /DATASET_DELIVERY_COLUMNS_AMBIGUOUS/);
  assert.throws(() => applyDatasetDeliveryPolicy({
    policy: confirmed([{ columnName: "MRN", mode: "OMIT" }, { columnName: "mrn", mode: "OMIT" }]),
    columns: [{ name: "MRN" }],
    rows: [],
  }), /DATASET_DELIVERY_POLICY_INVALID/);
});

test("does not mutate source rows, columns, metadata, or a shared snapshot", () => {
  const columns = Object.freeze([Object.freeze({ name: "NAME" }), Object.freeze({ name: "MRN" })]);
  const rows = Object.freeze([Object.freeze({ NAME: "王小明", MRN: "synthetic-001" })]);
  const reportColumns = Object.freeze([
    Object.freeze({ columnName: "NAME", label: "name" }),
    Object.freeze({ columnName: "MRN", label: "identifier" }),
  ]);
  const before = JSON.stringify({ columns, rows, reportColumns });
  const result = applyDatasetDeliveryPolicy({
    policy: confirmed([
      { columnName: "NAME", mode: "CUSTOM", customMask: { prefix: 1, suffix: 1, symbol: "○" } },
      { columnName: "MRN", mode: "OMIT" },
    ]),
    columns,
    rows,
    metadata: { reportColumns },
  });
  assert.equal(JSON.stringify({ columns, rows, reportColumns }), before);
  assert.deepEqual(rows, [{ NAME: "王小明", MRN: "synthetic-001" }]);
  assert.deepEqual(result.rows, [{ NAME: "王○明" }]);
  assert.notEqual(result.rows[0], rows[0]);
  assert.notEqual(result.columns[0], columns[0]);
});

test("does not restore OMIT fields when no visible columns remain", () => {
  const result = applyDatasetDeliveryPolicy({
    policy: confirmed([{ columnName: "MRN", mode: "OMIT" }]),
    columns: [{ name: "MRN" }],
    rows: [{ MRN: "synthetic-001" }],
    metadata: { reportColumns: [{ columnName: "MRN" }] },
  });
  assert.deepEqual(result, { columns: [], rows: [{}], metadata: { reportColumns: [] } });
});

test("patient audit-only evidence requires an OMIT rule and cannot be weakened", () => {
  const input = { columns: [{ name: "MRN" }], rows: [{ MRN: "synthetic-001" }] } as const;
  assert.deepEqual(applyDatasetDeliveryPolicy({
    ...input,
    policy: confirmed([{ columnName: "MRN", mode: "OMIT" }], ["mrn"]),
  }).rows, [{}]);
  assert.throws(() => applyDatasetDeliveryPolicy({
    ...input,
    policy: confirmed([{ columnName: "MRN", mode: "CUSTOM", customMask: { prefix: 0, suffix: 2, symbol: "*" } }], ["MRN"]),
  }), /DATASET_DELIVERY_POLICY_INVALID/);
  assert.throws(() => applyDatasetDeliveryPolicy({ ...input, policy: confirmed([], ["MRN"]) }), /DATASET_DELIVERY_POLICY_INVALID/);
  assert.throws(() => applyDatasetDeliveryPolicy({ ...input,
    policy: confirmed([{ columnName: "MRN", mode: "FULL" }], ["MRN"]) }), /DATASET_DELIVERY_POLICY_INVALID/);
});

test("invalid result shape fails with a data-free error code", () => {
  const secret = "synthetic-patient-value";
  assert.throws(() => applyDatasetDeliveryPolicy({
    policy: confirmed(),
    columns: [{ name: "ROOM" }],
    rows: [{ ROOM: "R1", UNDECLARED: secret }],
  }), (error) => {
    assert.ok(error instanceof DatasetDeliveryPolicyError);
    assert.equal(error.code, "DATASET_DELIVERY_RESULT_INVALID");
    assert.equal(error.message.includes(secret), false);
    return true;
  });
});

test("user-selected FULL mask preserves fixed length for standard-looking and opaque aliases", () => {
  for (const name of ["NAME", "MRN", "PHONE", "OPAQUE_7"]) {
    const result = applyDatasetDeliveryPolicy({
      policy: confirmed([{ columnName: name, mode: "FULL" }]),
      columns: [{ name }], rows: [{ [name]: "synthetic" }, { [name]: "x" }, { [name]: null }],
    });
    assert.deepEqual(result.rows, [{ [name]: "○○○○" }, { [name]: "○○○○" }, { [name]: null }]);
  }
});

test("explicit raw display is name-independent, while unknown fields never inherit a raw grant", () => {
  for (const name of ["NAME", "MRN", "PHONE", "OPAQUE_7"]) {
    const result = applyDatasetDeliveryPolicy({ policy: confirmed([{ columnName: name, mode: "NONE" }]),
      columns: [{ name }, { name: "EXTRA" }], rows: [{ [name]: "synthetic-original", EXTRA: "synthetic-private" }] });
    assert.deepEqual(result.rows, [{ [name]: "synthetic-original" }]);
    assert.deepEqual(result.columns, [{ name }]);
  }
});

test("range config is strictly validated by the common policy engine", () => {
  const input = { columns: [{ name: "VALUE" }], rows: [{ VALUE: "甲乙丙丁" }] };
  const config = { prefix: 0, suffix: 0, symbol: "*", start: 2, end: 3 };
  assert.deepEqual(applyDatasetDeliveryPolicy({ ...input,
    policy: confirmed([{ columnName: "VALUE", mode: "CUSTOM", customMask: config }]) }).rows, [{ VALUE: "甲**丁" }]);
  for (const extra of [{ start: 0 }, { start: 4, end: 2 }, { unexpected: true }]) {
    assert.throws(() => applyDatasetDeliveryPolicy({ ...input,
      policy: confirmed([{ columnName: "VALUE", mode: "CUSTOM", customMask: { ...config, ...extra } }]) }), /DATASET_DELIVERY_POLICY_INVALID/);
  }
});
