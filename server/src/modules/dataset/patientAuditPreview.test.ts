import test from "node:test";
import assert from "node:assert/strict";
import { createPatientAuditPreview } from "./patientAuditPreview.js";

const identity = async () => ({ userId: 1, tokenVersion: 1, permissions: ["DESIGN_QUERY", "EXECUTE_QUERY"] });
for (const mismatch of ["unsaved", "sql", "source", "version", "after-read"] as const) {
  test(`preview admission rejects ${mismatch} without executing SQL or writing metadata`, async () => {
    let opens = 0;
    const input = { datasetId: 1 as number | undefined, dataSourceId: 2, sqlText: "SELECT MRN FROM synthetic", expectedDefinitionVersion: "0000000000000001" };
    if (mismatch === "unsaved") input.datasetId = undefined;
    if (mismatch === "sql") input.sqlText += " WHERE 1=1";
    if (mismatch === "source") input.dataSourceId = 99;
    const prepare = createPatientAuditPreview({ open: async (_id, _identity, purpose, version) => {
      opens++; assert.equal(purpose, "RAW_DESIGN"); assert.equal(version, input.expectedDefinitionVersion);
      if (mismatch === "version") throw new Error("DATASET_DELIVERY_VERSION_CONFLICT");
      return { dataset: { sqlText: "SELECT MRN FROM synthetic", dataSourceId: 2 },
        revalidate: async () => { if (mismatch === "after-read") throw new Error("DATASET_DELIVERY_VERSION_CONFLICT"); } } as never;
    } });
    await assert.rejects(prepare(input, identity));
    assert.equal(opens, mismatch === "unsaved" ? 0 : 1);
  });
}
test("admitted preview returns saved context; it has no executor or metadata writer", async () => {
  const context = { dataset: { sqlText: "SELECT MRN FROM synthetic", dataSourceId: 2 }, revalidate: async () => {} };
  const prepare = createPatientAuditPreview({ open: async () => context as never });
  assert.equal(await prepare({ datasetId: 1, dataSourceId: 2, sqlText: context.dataset.sqlText,
    expectedDefinitionVersion: "0000000000000001" }, identity), context);
});
