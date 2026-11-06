import test from "node:test";
import assert from "node:assert/strict";
import { pinQueryPolicyAllows } from "./pinQueryPolicy.js";
import { createQueryDelivery, defaultQueryDeliveryDependencies, type RuntimeIdentity } from "./queryDelivery.js";
import type { ConfirmedDatasetDeliverySnapshot } from "../dataset/datasetDeliveryPolicy.repository.js";
const snapshot: ConfirmedDatasetDeliverySnapshot = {
  datasetId: 7, definitionVersion: "0000000000000001", sensitivityVersion: "1", patientAuditVersion: "0",
  policy: { state: "CONFIRMED", version: "1", rules: [{ columnName: "ROOM", mode: "NONE" }] },
  patientAudit: { configured: false, enabled: false, patientKeyColumn: null },
};
const rules = [{ ColumnName: "ROOM", SensitivityType: "OTHER", Version: "1" }];
test("PIN assurance only accepts complete current explicit nonpatient OTHER policy", () => {
  assert.ok(pinQueryPolicyAllows(snapshot, rules));
  for (const r of [[], [{ ...rules[0]!, Version: "2" }], [{ ...rules[0]!, SensitivityType: "NAME" }],
    [{ ...rules[0]!, ColumnName: "SECRET" }], [...rules, ...rules]]) assert.equal(pinQueryPolicyAllows(snapshot, r), false);
  assert.equal(pinQueryPolicyAllows({ ...snapshot, patientAudit: { ...snapshot.patientAudit, configured: true } }, rules), false);
});
test("restricted QueryDelivery keeps ACL/masking and rejects old session at SQL and final Audit boundaries", async () => {
  const state = { generation: "2", active: true, allowed: true, kind: "OTHER", executes: 0, changeInSql: false };
  const actor: RuntimeIdentity = { userId: 8, tokenVersion: 1, permissions: ["VIEW_QUERY", "EXECUTE_QUERY"],
    pinSession: { sessionId: "B", generation: "2", credentialVersion: 1, pinVersion: 1 } };
  const identity = async () => { if (!state.active) throw new Error("PIN_SESSION_INVALID"); return { ...actor, pinSession: { ...actor.pinSession!, generation: state.generation } }; };
  const delivery = createQueryDelivery({ ...defaultQueryDeliveryDependencies,
    access: async () => ({ id: 4, datasetId: 7, code: "ROOMS", name: "Rooms", isPublished: true, isActive: true, isArchived: false, canView: state.allowed, canExecute: true }) as never,
    accessRevision: async () => "1", snapshot: async () => snapshot,
    pinPolicy: async () => [{ ...rules[0]!, SensitivityType: state.kind }],
    dataset: async () => ({ id: 7, dataSourceId: 1, isActive: true, isArchived: false }) as never,
    reports: async () => [], execute: async () => { state.executes++; if (state.changeInSql) state.generation = "3";
      return { columns: [{ name: "ROOM" }, { name: "UNKNOWN_SECRET" }], rows: [{ ROOM: "R1", UNKNOWN_SECRET: "never deliver" }], rowCount: 1, truncated: false, elapsedMs: 1 }; },
  });
  const context = await delivery.open(4, "EXECUTE", identity);
  const result = await delivery.execute(context, {});
  assert.deepEqual(result.result.rows, [{ ROOM: "R1" }]);
  await assert.rejects(delivery.open(4, "EXPORT", identity), /ASSURANCE/);
  state.kind = "NAME"; await assert.rejects(delivery.open(4, "VIEW", identity), /ASSURANCE/);
  state.kind = "OTHER"; state.allowed = false; await assert.rejects(delivery.open(4, "VIEW", identity), /FORBIDDEN/);
  state.allowed = true; state.changeInSql = true; await assert.rejects(delivery.execute(context, {}), /VERSION_CONFLICT/);
  state.generation = "2"; state.active = false; await assert.rejects(context.revalidate({} as never), /SESSION_INVALID/);
});
