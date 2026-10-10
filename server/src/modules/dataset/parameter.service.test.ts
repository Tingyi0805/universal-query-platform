import assert from "node:assert/strict";
import test from "node:test";
import { coerceRuntimeParameters } from "./parameter.service.js";
import type { DatasetParameterRecord } from "./parameter.repository.js";

function parameter(
  patch: Partial<DatasetParameterRecord> & Pick<DatasetParameterRecord, "name" | "dataType" | "controlType">,
): DatasetParameterRecord {
  return {
    id: 1,
    datasetId: 1,
    label: patch.name,
    isRequired: false,
    defaultValue: null,
    dateOutputMode: "NATIVE",
    dateCalendar: "GREGORIAN",
    dateFormat: null,
    displayOrder: 0,
    placeholder: null,
    helpText: null,
    optionMode: "NONE",
    fixedOptionsJson: null,
    lookupDatasetId: null,
    lookupValueField: null,
    lookupLabelField: null,
    ...patch,
  };
}

test("coerces number and boolean parameters", () => {
  const result = coerceRuntimeParameters(
    [
      parameter({ name: "AGE", dataType: "NUMBER", controlType: "NUMBER" }),
      parameter({ name: "ACTIVE", dataType: "BOOLEAN", controlType: "CHECKBOX" }),
    ],
    { AGE: "47", ACTIVE: "true" },
  );

  assert.equal(result.AGE, 47);
  assert.equal(result.ACTIVE, true);
});

test("coerces date to Date object", () => {
  const result = coerceRuntimeParameters(
    [parameter({ name: "D", dataType: "DATE", controlType: "DATE" })],
    { D: "2026-10-06" },
  );

  assert.ok(result.D instanceof Date);
});

test("enforces required parameters", () => {
  assert.throws(
    () => coerceRuntimeParameters(
      [parameter({
        name: "MRN",
        dataType: "STRING",
        controlType: "TEXT",
        isRequired: true,
      })],
      {},
    ),
    /PARAMETER_REQUIRED:MRN/,
  );
});

test("coerces multi-select values", () => {
  const result = coerceRuntimeParameters(
    [parameter({
      name: "CODES",
      dataType: "STRING",
      controlType: "MULTISELECT",
    })],
    { CODES: ["A", "B"] },
  );

  assert.deepEqual(result.CODES, ["A", "B"]);
});


test("resolves dynamic TODAY default", () => {
  const result = coerceRuntimeParameters(
    [parameter({
      name: "D",
      dataType: "DATE",
      controlType: "DATE",
      defaultValue: "$TODAY",
    })],
    {},
  );

  assert.ok(result.D instanceof Date);
});

test("formats date parameter as Gregorian string", () => {
  const result = coerceRuntimeParameters(
    [parameter({
      name: "D",
      dataType: "DATE",
      controlType: "DATE",
      dateOutputMode: "STRING",
      dateCalendar: "GREGORIAN",
      dateFormat: "yyyyMMdd",
    })],
    { D: "2026-10-10" },
  );

  assert.equal(result.D, "20261010");
});

test("formats date parameter as ROC string", () => {
  const result = coerceRuntimeParameters(
    [parameter({
      name: "D",
      dataType: "DATE",
      controlType: "DATE",
      dateOutputMode: "STRING",
      dateCalendar: "ROC",
      dateFormat: "yyyMMdd",
    })],
    { D: "2026-10-10" },
  );

  assert.equal(result.D, "1151010");
});
