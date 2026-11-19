import assert from "node:assert/strict";
import test from "node:test";
import { managerPlaybackGrants } from "./datasetManagementApproval.policy.js";

const sensitivity = {
  version: 4,
  columns: [
    { columnName: "PATIENT_ID", sensitivityType: "MRN", deviceMaskMode: "OMIT" as const },
    { columnName: "DISPLAY_NAME", sensitivityType: "NAME", deviceMaskMode: "FULL" as const },
    { columnName: "ROOM", sensitivityType: "OTHER", deviceMaskMode: "NONE" as const },
  ],
};

test("manager approval only permits existing policy-safe rules, never patient audit ID", () => {
  assert.deepEqual(managerPlaybackGrants(sensitivity, true), [
    { columnName: "PATIENT_ID", permitted: false },
    { columnName: "DISPLAY_NAME", permitted: true },
    { columnName: "ROOM", permitted: true },
  ]);
});
test("revocation denies every existing field", () => {
  assert.ok(managerPlaybackGrants(sensitivity, false).every(x => !x.permitted));
});
test("missing policy cannot become an all-fields approval", () => {
  assert.throws(() => managerPlaybackGrants({ version: 0, columns: [] }, true));
});
test("public approval rejects empty visible field set", () => {
  assert.throws(() => managerPlaybackGrants({
    version: 2, columns: [{columnName:"PATIENT_ID", sensitivityType:"MRN", deviceMaskMode:"OMIT"}]
  }, true), /MANAGER_APPROVAL_NO_SAFE_VISIBLE_COLUMNS/);
});
