import assert from "node:assert/strict";
import test from "node:test";
import { assertWholeResultApproval, assertWholeResultShape, WholeResultApprovalError } from "./datasetWholeResultApproval.js";

const current = { datasetId: 1, definitionVersion: "0000000000000001",
  dataSourceId: 2, sourceConfigurationVersion: "0000000000000002" };
const evidence = { ...current, scope: "INTERNAL_SOURCE_MINIMIZED",
  approvedBy: 3, auditLogId: 4, columns: ["ROOM", "TOTAL"] };
function rejects(code: string) {
  return (error: unknown) => error instanceof WholeResultApprovalError && error.code === code;
}

test("whole-result approval checks exact scope and definition without per-column mask configuration", () => {
  const approved = assertWholeResultApproval(evidence, current, "INTERNAL");
  const columns = [{ name: "ROOM" }, { name: "TOTAL" }];
  assert.doesNotThrow(() => assertWholeResultShape(approved, columns, [{ ROOM: "A", TOTAL: 2 }]));
  assert.doesNotThrow(() => assertWholeResultShape(approved, columns, []));
});
for (const use of ["PUBLIC", "DEVICE", "PIN"] as const) {
  test(`whole-result internal approval does not authorize ${use}`, () => {
    assert.throws(() => assertWholeResultApproval(evidence, current, use), rejects("WHOLE_RESULT_SCOPE_FORBIDDEN"));
  });
}
for (const change of [{ datasetId: 9 }, { dataSourceId: 9 },
  { definitionVersion: "0000000000000003" }, { sourceConfigurationVersion: "0000000000000003" }]) {
  test(`approval becomes stale when ${Object.keys(change)[0]} changes`, () => {
    assert.throws(() => assertWholeResultApproval(evidence, { ...current, ...change }, "INTERNAL"),
      rejects("WHOLE_RESULT_APPROVAL_STALE"));
  });
}
test("missing or malformed receipt, empty manifest, duplicate names and additional fields fail closed", () => {
  for (const invalid of [null, { ...evidence, auditLogId: 0 }, { ...evidence, approvedBy: 0 },
    { ...evidence, columns: [] }, { ...evidence, columns: ["ROOM", "room"] },
    { ...evidence, columns: [" ROOM"] }, { ...evidence, extra: true },
    { ...evidence, scope: "PUBLIC" }]) {
    assert.throws(() => assertWholeResultApproval(invalid, current, "INTERNAL"), rejects("WHOLE_RESULT_APPROVAL_INVALID"));
  }
});
test("changed result shape is rejected even when SQL returns no rows", () => {
  const approved = assertWholeResultApproval(evidence, current, "INTERNAL");
  for (const columns of [[{ name: "ROOM" }], [{ name: "ROOM" }, { name: "TOTAL" }, { name: "EXTRA" }],
    [{ name: "TOTAL" }, { name: "ROOM" }], [{ name: "room" }, { name: "TOTAL" }]]) {
    assert.throws(() => assertWholeResultShape(approved, columns, []), rejects("WHOLE_RESULT_SHAPE_CHANGED"));
  }
});
test("unexpected or missing row properties cannot escape the approved manifest", () => {
  const approved = assertWholeResultApproval(evidence, current, "INTERNAL");
  const columns = [{ name: "ROOM" }, { name: "TOTAL" }];
  for (const row of [{ ROOM: "A" }, { ROOM: "A", TOTAL: 2, EXTRA: "synthetic" },
    { room: "A", TOTAL: 2 }]) {
    assert.throws(() => assertWholeResultShape(approved, columns, [row]), rejects("WHOLE_RESULT_SHAPE_CHANGED"));
  }
});
