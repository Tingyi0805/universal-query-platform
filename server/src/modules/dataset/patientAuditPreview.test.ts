import test from "node:test";
import assert from "node:assert/strict";
import { createPatientAuditPreview } from "./patientAuditPreview.js";

for (const failure of ["none", "execution", "sync", "record"] as const)
  test(`preview provenance uses executor aliases only; ${failure} failure never returns success`, async () => {
    const calls: string[] = [];
    const input = { datasetId: 1, dataSourceId: 2, sqlText: "SELECT MRN FROM synthetic", values: { WARD: "synthetic" }, maxRows: 10 };
    const run = createPatientAuditPreview({
      execute: async actual => { assert.equal(actual, input); calls.push("execute"); if (failure === "execution") throw new Error("synthetic");
        return { columns: [{ name: "MRN" }], rows: [{ MRN: "synthetic-1" }], rowCount: 1, elapsedMs: 1, truncated: false }; },
      sync: async () => { calls.push("sync"); if (failure === "sync") throw new Error("synthetic"); },
      record: async (id, definition, aliases) => { calls.push("record"); assert.equal(id, 1);
        assert.deepEqual(definition, { dataSourceId: 2, sqlText: input.sqlText }); assert.deepEqual(aliases, ["MRN"]);
        assert.ok(!JSON.stringify([definition, aliases]).includes("synthetic-1"));
        if (failure === "record") throw new Error("synthetic"); },
    });
    if (failure === "none") assert.equal((await run(input, 3, {})).rows.length, 1);
    else await assert.rejects(run(input, 3, {}));
    assert.deepEqual(calls, failure === "execution" ? ["execute"] : failure === "sync" ? ["execute", "sync"] : ["execute", "sync", "record"]);
  });
test("unbound unsaved preview cannot establish any Dataset proof", async () => {
  const run = createPatientAuditPreview({ execute: async () => ({ columns: [{ name: "MRN" }], rows: [], rowCount: 0, elapsedMs: 1, truncated: false }),
    sync: async () => { assert.fail("unbound preview must not sync"); }, record: async () => { assert.fail("unbound preview must not create proof"); } });
  await run({ dataSourceId: 2, sqlText: "SELECT MRN FROM synthetic", values: {}, maxRows: 10 }, 3, {});
});
