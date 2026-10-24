import assert from "node:assert/strict";
import test from "node:test";
import { resolveDatasetPublicDisplayMasks } from "./datasetPublicDisplayPolicy.js";
const sensitivity = { version: 3, columns: [
  { columnName: "NAME", sensitivityType: "NAME", deviceMaskMode: "CUSTOM" as const, customMask: { prefix: 1, suffix: 1, symbol: "○" } },
  { columnName: "ROOM", sensitivityType: "OTHER", deviceMaskMode: "NONE" as const },
  { columnName: "SECRET", sensitivityType: "HEALTH", deviceMaskMode: "OMIT" as const },
] };
test("public display always denies absent or unconfirmed grants", () => {
  assert.deepEqual(resolveDatasetPublicDisplayMasks(sensitivity, null, ["NAME"]), {});
  assert.deepEqual(resolveDatasetPublicDisplayMasks(sensitivity, { confirmed: false, sensitivityVersion: 3, grants: [{ columnName: "NAME", permitted: true }] }, ["NAME"]), {});
});
test("confirmed explicit grants inherit Dataset masks but never grant OMIT or unknown columns", () => {
  assert.deepEqual(resolveDatasetPublicDisplayMasks(sensitivity, { confirmed: true, sensitivityVersion: 3, grants: [
    { columnName: "NAME", permitted: true }, { columnName: "ROOM", permitted: true },
    { columnName: "SECRET", permitted: true }, { columnName: "NEW_FIELD", permitted: true },
  ] }, ["NAME", "ROOM", "SECRET", "NEW_FIELD"]), { NAME: "CUSTOM", ROOM: "NONE" });
});
test("duplicate grants and result aliases never authorize disclosure", () => {
  assert.deepEqual(resolveDatasetPublicDisplayMasks(sensitivity, { confirmed: true, sensitivityVersion: 3, grants: [
    { columnName: "NAME", permitted: true }, { columnName: "name", permitted: true },
  ] }, ["NAME"]), {});
  assert.throws(() => resolveDatasetPublicDisplayMasks(sensitivity, { confirmed: true, sensitivityVersion: 3, grants: [] }, ["ROOM", "room"]), /DASHBOARD_COLUMNS_AMBIGUOUS/);
});

test("sensitivity policy revision change revokes earlier public display confirmations", () => {
  const policy = { confirmed: true, sensitivityVersion: 3, grants: [{ columnName: "NAME", permitted: true }] };
  assert.deepEqual(resolveDatasetPublicDisplayMasks({ ...sensitivity, version: 4 }, policy, ["NAME"]), {});
  assert.deepEqual(resolveDatasetPublicDisplayMasks(sensitivity, policy, ["NAME"]), { NAME: "CUSTOM" });
});
test("a malformed public display grant cannot create accidental approval", () => {
  assert.deepEqual(resolveDatasetPublicDisplayMasks(sensitivity, { confirmed: true, sensitivityVersion: 3, grants: [
    { columnName: "NAME", permitted: true }, { columnName: " name ", permitted: true },
  ] }, ["NAME"]), {});
});
