import test from "node:test";
import assert from "node:assert/strict";
import { playbackPlacement, dashboardMode, dashboardPreflight, dashboardOperationError, deviceMayIssue, deviceStatus, type Preflight } from "./managementStatus";
const mode = { mode: "LEGACY" as const, modeVersion: 1, version: "a".repeat(64) };
const flight = (): Preflight => ({ ...mode, ready: true, sourceCount: 1, pendingCount: 0, checks: ["inactive", "capacity", "primaryConversion", "bindings", "references", "devices"].map(name => ({ name, ok: true, code: null })), queries: [{ sourceKey: "PRIMARY", ok: true, code: null }], delegators: [{ deviceId: 1, ok: true, code: null }] });
test("mode requires known backend state and trusted version evidence", () => {
  assert.deepEqual(dashboardMode(mode), mode);
  for (const patch of [{ mode: "UNKNOWN" }, { modeVersion: -1 }, { modeVersion: 0.1 }, { version: undefined }, { version: "" }]) assert.throws(() => dashboardMode({ ...mode, ...patch } as any));
});
test("ready preflight requires every backend check plus Query and device evidence", () => {
  assert.equal(dashboardPreflight(flight()).ready, true);
  for (const patch of [{ checks: [] }, { delegators: [] }, { queries: [] }, { pendingCount: 1 }, { sourceCount: 9 }, { ready: "true" }]) assert.throws(() => dashboardPreflight({ ...flight(), ...patch } as any));
  const incomplete = flight(); incomplete.queries[0]!.ok = false; assert.throws(() => dashboardPreflight(incomplete));
  incomplete.ready = false; assert.equal(dashboardPreflight(incomplete).ready, false);
});
test("preflight rejects duplicate identities and unsafe diagnostics", () => {
  const value = flight(); value.queries.push(value.queries[0]!); assert.throws(() => dashboardPreflight(value));
  const bad = flight(); bad.queries[0]!.code = "SQL private text"; assert.throws(() => dashboardPreflight(bad));
});
test("expired, revoked, archived and unknown device expiry cannot authorize issuance", () => {
  const device = { id: 1, deviceName: "Synthetic", isActive: true, expiresAtUtc: null };
  assert.equal(deviceMayIssue(device, 1000), true);
  for (const patch of [{ isActive: false }, { revokedAtUtc: "synthetic" }, { archivedAtUtc: "synthetic" }, { isArchived: true }, { expiresAtUtc: undefined }, { expiresAtUtc: "bad" }, { expiresAtUtc: "1970-01-01T00:00:00Z" }]) assert.equal(deviceMayIssue({ ...device, ...patch }, 1000), false);
  assert.match(deviceStatus({ ...device, isActive: false }), /不能藉重新整理恢復/);
  assert.match(deviceStatus({ ...device, archivedAtUtc: "synthetic" }), /不代表 Dashboard 退役/);
});
test("disabled flags are expected safe states and driver details are never displayed", () => {
  for (const code of ["QUERY_DEVICE_PLAYBACK_DISABLED", "QUERY_SOURCE_MANAGEMENT_DISABLED"]) {
    const text = dashboardOperationError({ code, message: "SQL private synthetic-secret" });
    assert.match(text, /旗標關閉/); assert.doesNotMatch(text, /private|synthetic-secret|系統故障。/);
  }
  assert.doesNotMatch(dashboardOperationError({ code: "FORBIDDEN", message: "private synthetic-secret" }), /private|synthetic-secret/);
});

test("read-only placement retains documented fields and refuses invalid geometry", () => {
  const value = { browser: "edge" as const, screenNumber: 2, fullscreen: true, windowX: -1920, windowY: 0, windowWidth: 1920, windowHeight: 1080 };
  assert.deepEqual(playbackPlacement(value), value);
  assert.equal("unexpected" in playbackPlacement({ ...value, unexpected: "synthetic" } as any), false);
  for (const patch of [{ browser: "unknown" }, { screenNumber: 0 }, { windowWidth: 0 }, { fullscreen: "true" }]) assert.throws(() => playbackPlacement({ ...value, ...patch } as any));
});
