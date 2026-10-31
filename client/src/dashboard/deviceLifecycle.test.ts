import { test } from "node:test";
import assert from "node:assert/strict";
import { lifecycleActions, lifecycleStatus, lifecycleConfirmation, type LifecycleDevice } from "./deviceLifecycle";
const now = Date.parse("2026-10-31T00:00:00Z");
const device: LifecycleDevice = { id: 7, deviceName: "Test", isActive: true, expiresAtUtc: null, revokedAtUtc: null, archivedAtUtc: null, suspendedAtUtc: null, reenrollmentRequired: null };
test("management snapshot never claims active playback, including enrolled and granted rows", () => {
  for (const marker of [null, false]) assert.match(lifecycleStatus({ ...device, reenrollmentRequired: marker, queryModeGrantVersion: 2, delegatorTokenVersion: 3 }, now), /啟用設定.*無法驗證/);
  assert.equal(lifecycleStatus({ ...device, isActive: false }, now), "無法驗證");
});
test("terminal, expiry, suspension and pending status priority", () => {
  const pending = { ...device, reenrollmentRequired: true };
  assert.equal(lifecycleStatus(pending, now), "待重新授權");
  const suspended = { ...pending, isActive: false, suspendedAtUtc: "2026-10-30T00:00:00Z" };
  assert.equal(lifecycleStatus(suspended, now), "已暫停");
  assert.equal(lifecycleStatus({ ...suspended, expiresAtUtc: "2026-10-30T00:00:00Z" }, now), "已到期");
  assert.equal(lifecycleStatus({ ...device, revokedAtUtc: "2026-10-30T00:00:00Z" }, now), "已撤銷（永久）");
  assert.equal(lifecycleStatus({ ...device, archivedAtUtc: "2026-10-30T00:00:00Z" }, now), "已封存");
  assert.match(lifecycleStatus({ ...device, expiresAtUtc: "invalid" }, now), /無法驗證/);
});
test("safety actions remain available without EXECUTE_QUERY; restore and issue require it", () => {
  assert.deepEqual(lifecycleActions(device, false, true, now), []);
  assert.deepEqual(lifecycleActions(device, true, false, now), ["suspend", "revoke"]);
  const suspended = { ...device, isActive: false, suspendedAtUtc: "2026-10-30T00:00:00Z", reenrollmentRequired: true };
  assert.deepEqual(lifecycleActions(suspended, true, false, now), ["revoke"]);
  assert.deepEqual(lifecycleActions(suspended, true, true, now), ["restore", "revoke"]);
  assert.deepEqual(lifecycleActions({ ...device, reenrollmentRequired: true }, true, true, now), ["credential", "suspend", "revoke"]);
  assert.deepEqual(lifecycleActions({ ...device, expiresAtUtc: "2026-10-30T00:00:00Z" }, true, true, now), ["revoke"]);
  assert.deepEqual(lifecycleActions({ ...device, isActive: false, revokedAtUtc: "2026-10-30T00:00:00Z" }, true, false, now), ["archive"]);
  assert.deepEqual(lifecycleActions({ ...device, archivedAtUtc: "2026-10-30T00:00:00Z" }, true, true, now), []);
});
test("confirmations describe destructive and reenrollment consequences", () => {
  assert.match(lifecycleConfirmation("suspend", "X"), /舊 Token.*失效/);
  assert.match(lifecycleConfirmation("revoke", "X"), /原 Token 不可恢復/);
  assert.match(lifecycleConfirmation("restore", "X"), /待重新授權/);
  assert.match(lifecycleConfirmation("credential", "X"), /只顯示一次/);
});
