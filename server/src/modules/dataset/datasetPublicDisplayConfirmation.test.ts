import assert from "node:assert/strict";
import test from "node:test";
import { confirmDatasetPublicDisplay, publicDisplayDigest } from "./datasetPublicDisplayConfirmation.js";
const sensitivity = { version: 4, columns: [
  { columnName: "NAME", sensitivityType: "NAME", deviceMaskMode: "CUSTOM" as const, customMask: { prefix: 1, suffix: 1, symbol: "○" } },
  { columnName: "ROOM", sensitivityType: "OTHER", deviceMaskMode: "NONE" as const },
  { columnName: "SECRET", sensitivityType: "HEALTH", deviceMaskMode: "OMIT" as const },
] };
test("administrator confirmation preserves only explicit Dataset grants and negative decisions", () => {
  const policy = confirmDatasetPublicDisplay(sensitivity, null, { expectedSensitivityVersion: 4, expectedPolicyDigest: null,
    grants: [{ columnName: "NAME", permitted: true }, { columnName: "ROOM", permitted: false }] });
  assert.deepEqual(policy, { confirmed: true, sensitivityVersion: 4, grants: [
    { columnName: "NAME", permitted: true }, { columnName: "ROOM", permitted: false }] });
  assert.match(publicDisplayDigest(policy)!, /^[a-f0-9]{64}$/);
});
test("sensitivity and concurrent policy revisions cannot be silently overwritten", () => {
  assert.throws(() => confirmDatasetPublicDisplay(sensitivity, null, { expectedSensitivityVersion: 3, expectedPolicyDigest: null, grants: [] }),
    /PUBLIC_DISPLAY_SENSITIVITY_VERSION_CONFLICT/);
  const previous = { confirmed: true, sensitivityVersion: 4, grants: [{ columnName: "NAME", permitted: true }] };
  assert.throws(() => confirmDatasetPublicDisplay(sensitivity, previous, { expectedSensitivityVersion: 4, expectedPolicyDigest: null, grants: [] }),
    /PUBLIC_DISPLAY_VERSION_CONFLICT/);
});
test("unknown, duplicate, OMIT and invalid grants are refused", () => {
  for (const grants of [
    [{ columnName: "UNKNOWN", permitted: true }],
    [{ columnName: "NAME", permitted: true }, { columnName: "name", permitted: false }],
    [{ columnName: "SECRET", permitted: true }],
    [{ columnName: " ROOM ", permitted: true }],
  ]) assert.throws(() => confirmDatasetPublicDisplay(sensitivity, null, { expectedSensitivityVersion: 4, expectedPolicyDigest: null, grants }),
    /PUBLIC_DISPLAY_/);
});
