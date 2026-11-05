import assert from "node:assert/strict";
import test from "node:test";
import { createDashboardPageSnapshot, getDashboardPageSnapshot, resolveDashboardSnapshotSeconds } from "./dashboardPageSnapshot.js";

test("uses recommended defaults and honors valid custom durations", () => {
  assert.equal(resolveDashboardSnapshotSeconds("SURGERY"), 20);
  assert.equal(resolveDashboardSnapshotSeconds("OUTPATIENT"), 60);
  assert.equal(resolveDashboardSnapshotSeconds("EXAM"), 60);
  assert.equal(resolveDashboardSnapshotSeconds("STATISTICS"), 180);
  assert.equal(resolveDashboardSnapshotSeconds("OTHER"), 60);
  assert.equal(resolveDashboardSnapshotSeconds("SURGERY", 35), 35);
  assert.equal(resolveDashboardSnapshotSeconds("SURGERY", 3601), 20);
  assert.equal(resolveDashboardSnapshotSeconds("OTHER", 9), 60);
});

test("snapshot is scoped to verified device and dashboard", () => {
  const snapshot = createDashboardPageSnapshot({ deviceId: 901, dashboardId: 21, queryId: 3,
    datasetId: 7, sourceScope: "datasource:4", columns: [{ name: "name" }], rows: [{ name: "masked" }], ttlSeconds: 60 });
  assert.equal(getDashboardPageSnapshot(snapshot.id, 901, 21)?.id, snapshot.id);
  assert.equal(getDashboardPageSnapshot(snapshot.id, 902, 21), null);
  assert.equal(getDashboardPageSnapshot(snapshot.id, 901, 22), null);
  assert.equal(getDashboardPageSnapshot("missing", 901, 21), null);
});

test("rejects overlarge snapshots without retaining them", () => {
  assert.throws(() => createDashboardPageSnapshot({ deviceId: 901, dashboardId: 21, queryId: 3,
    datasetId: 7, sourceScope: "datasource:4", columns: [{ name: "x" }],
    rows: [{ x: "x".repeat(9 * 1024 * 1024) }] }), /DASHBOARD_SNAPSHOT_TOO_LARGE/);
});

test("expires at the exact TTL boundary and rejects invalid durations", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1000 });
  const input = { deviceId: 901, dashboardId: 21, queryId: 3, datasetId: 7,
    sourceScope: "datasource:4", columns: [], rows: [], ttlSeconds: 10 };
  const snapshot = createDashboardPageSnapshot(input);
  t.mock.timers.setTime(10_999);
  assert.equal(getDashboardPageSnapshot(snapshot.id, 901, 21)?.id, snapshot.id);
  t.mock.timers.setTime(11_000);
  assert.equal(getDashboardPageSnapshot(snapshot.id, 901, 21), null);
  for (const ttlSeconds of [NaN, Infinity, 0, -1]) {
    assert.throws(() => createDashboardPageSnapshot({ ...input, ttlSeconds }), /INVALID_TTL/);
  }
});
