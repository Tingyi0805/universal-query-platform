import assert from "node:assert/strict";
import test from "node:test";
import { createManagerApprovedQueryDelivery } from "./queryManagerApprovedDelivery.js";
import { QueryDeliveryError } from "./queryDelivery.js";

const version = "0000000000000001";
function fixture() {
  const state = { permissions: ["VIEW_QUERY", "EXECUTE_QUERY", "EXPORT_QUERY"], pin: false,
    published: true, canView: true, canExecute: true, canExport: true,
    datasetActive: true, approvalActive: true, revision: "r1", extraColumn: false,
    revokeDuringSql: false, reads: 0, executions: 0 };
  const identity = async () => ({
    userId: 7, tokenVersion: 1, permissions: [...state.permissions],
    ...(state.pin ? { pinSession: { sessionId: "s", generation: "1", credentialVersion: 1, pinVersion: 1 } } : {}),
  });
  const deps = {
    access: async () => ({ id: 1, datasetId: 2, code: "SYNTH", name: "Synthetic",
      isPublished: state.published, isActive: true, isArchived: false, publishedAtUtc: "synthetic",
      canView: state.canView, canExecute: state.canExecute, canExport: state.canExport, allowExcelExport: true }),
    accessRevision: async () => state.revision,
    dataset: async () => ({ id: 2, dataSourceId: 3, isActive: state.datasetActive, isArchived: false, sqlText: "SELECT TOTAL FROM synthetic" }),
    reports: async () => [{ columnName: "TOTAL", displayLabel: "Total", groupOrder: null, aggregateType: "NONE" }],
    approval: async () => {
      state.reads++;
      if (!state.approvalActive) throw new QueryDeliveryError("QUERY_WHOLE_RESULT_APPROVAL_REQUIRED");
      return { approval: { scope: "INTERNAL_SOURCE_MINIMIZED", datasetId: 2, dataSourceId: 3,
        definitionVersion: version, sourceConfigurationVersion: version, approvedBy: 9, auditLogId: 11,
        columns: ["TOTAL"] }, publicationStamp: "synthetic", datasetDecisionId: "10" };
    },
    execute: async () => {
      state.executions++;
      if (state.revokeDuringSql) state.approvalActive = false;
      return { columns: [{ name: "TOTAL" }, ...(state.extraColumn ? [{ name: "EXTRA" }] : [])],
        rows: [{ TOTAL: 7, ...(state.extraColumn ? { EXTRA: "synthetic" } : {}) }],
        rowCount: 1, truncated: false, elapsedMs: 1 };
    },
  } as unknown as NonNullable<Parameters<typeof createManagerApprovedQueryDelivery>[0]>;
  return { state, identity, delivery: createManagerApprovedQueryDelivery(deps) };
}
const errorCode = (code: string) => (error: unknown) => error instanceof QueryDeliveryError && error.code === code;

test("approved internal query and export use the exact published output without per-column masking settings", async () => {
  const f = fixture();
  for (const action of ["EXECUTE", "EXPORT"] as const) {
    const context = await f.delivery.open(1, action, f.identity);
    const output = await f.delivery.execute(context, {});
    assert.deepEqual(output.result.rows, [{ TOTAL: 7 }]);
    assert.equal(output.disclosureId, null);
  }
  assert.equal(f.state.executions, 2);
});
test("missing publication approval, access denial and PIN fail before SQL", async () => {
  const f = fixture();
  f.state.approvalActive = false;
  await assert.rejects(f.delivery.open(1, "EXECUTE", f.identity), errorCode("QUERY_WHOLE_RESULT_APPROVAL_REQUIRED"));
  f.state.approvalActive = true;
  f.state.canExecute = false;
  await assert.rejects(f.delivery.open(1, "EXECUTE", f.identity), errorCode("QUERY_DELIVERY_FORBIDDEN"));
  f.state.canExecute = true;
  f.state.canExport = false;
  await assert.rejects(f.delivery.open(1, "EXPORT", f.identity), errorCode("QUERY_DELIVERY_FORBIDDEN"));
  f.state.pin = true;
  await assert.rejects(f.delivery.open(1, "VIEW", f.identity), errorCode("PIN_ASSURANCE_REQUIRED"));
  assert.equal(f.state.executions, 0);
});
test("changed output shape and revocation while executing refuse delivery", async () => {
  const f = fixture();
  const context = await f.delivery.open(1, "EXECUTE", f.identity);
  f.state.extraColumn = true;
  await assert.rejects(f.delivery.execute(context, {}), errorCode("WHOLE_RESULT_SHAPE_CHANGED"));
  f.state.extraColumn = false;
  f.state.revokeDuringSql = true;
  await assert.rejects(f.delivery.execute(context, {}), errorCode("QUERY_WHOLE_RESULT_APPROVAL_REQUIRED"));
});
test("metadata-only context cannot execute rows", async () => {
  const f = fixture();
  const context = await f.delivery.open(1, "VIEW", f.identity);
  await assert.rejects(f.delivery.execute(context, {}), errorCode("FORBIDDEN"));
  assert.equal(f.state.executions, 0);
});
