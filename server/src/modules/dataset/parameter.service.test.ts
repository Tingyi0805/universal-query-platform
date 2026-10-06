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
