import assert from "node:assert/strict";
import test from "node:test";
import { canCreateDashboardInMode } from "./dashboardManagedCreation.js";

test("managed source creation refuses active Dashboard before PRIMARY conversion and approval", () => {
  assert.equal(canCreateDashboardInMode(true, true), false);
  assert.equal(canCreateDashboardInMode(true, false), true);
});
test("legacy creation contract remains unchanged when source management is off", () => {
  assert.equal(canCreateDashboardInMode(false, true), true);
  assert.equal(canCreateDashboardInMode(false, false), true);
});
