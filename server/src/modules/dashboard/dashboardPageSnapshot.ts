import { randomUUID } from "node:crypto";

export type DashboardPageSnapshot = {
  id: string;
  deviceId: number;
  dashboardId: number;
  queryId: number;
  executionContext?: "designer" | "user" | "device" | "admin-preview";
  sourceKey?: string;
  sourceId?: number;
  bindingRevision?: number;
  accessRevision?: string;
  authorizationRevision?: number;
  modeVersion?: string;
  datasetId: number;
  sensitivityVersion?: number;
  bindingFingerprint?: string;
  sourceScope: string;
  createdAt: number;
  ttlMs: number;
  byteSize: number;
  columns: { name: string }[];
  rows: Record<string, unknown>[];
};

// Process-local cache: no durable patient data, no cross-node guarantees.
const MAX_SNAPSHOTS = 100;
const MAX_TOTAL_BYTES = 32 * 1024 * 1024;
const MAX_TTL_MS = 3_600_000;
const MAX_ROWS = 10_000;
const MAX_BYTES = 8 * 1024 * 1024;

export type DashboardSnapshotKind = "SURGERY" | "OUTPATIENT" | "EXAM" | "STATISTICS" | "OTHER";
const DEFAULT_SECONDS: Record<DashboardSnapshotKind, number> = {
  SURGERY: 20, OUTPATIENT: 60, EXAM: 60, STATISTICS: 180, OTHER: 60,
};
export function resolveDashboardSnapshotSeconds(kind: DashboardSnapshotKind, configuredSeconds?: number | null): number {
  if (configuredSeconds != null && Number.isInteger(configuredSeconds) && configuredSeconds >= 10 && configuredSeconds <= 3600) return configuredSeconds;
  return DEFAULT_SECONDS[kind];
}
const snapshots = new Map<string, DashboardPageSnapshot>();

export function createDashboardPageSnapshot(input: Omit<DashboardPageSnapshot, "id" | "createdAt" | "ttlMs" | "byteSize"> & { ttlSeconds?: number }): DashboardPageSnapshot {
  const byteSize = Buffer.byteLength(JSON.stringify({ rows: input.rows, columns: input.columns }), "utf8");
  if (input.rows.length > MAX_ROWS || byteSize > MAX_BYTES) {
    throw new Error("DASHBOARD_SNAPSHOT_TOO_LARGE");
  }
  const now = Date.now();
  for (const [key, item] of snapshots) {
    if (now - item.createdAt >= item.ttlMs) snapshots.delete(key);
  }
  let totalBytes = Array.from(snapshots.values()).reduce((total, item) => total + item.byteSize, 0);
  while (snapshots.size >= MAX_SNAPSHOTS || totalBytes + byteSize > MAX_TOTAL_BYTES) {
    const oldest = snapshots.keys().next().value;
    if (oldest === undefined) break;
    totalBytes -= snapshots.get(oldest)?.byteSize ?? 0;
    snapshots.delete(oldest);
  }
  const { ttlSeconds, ...data } = input;
  if (ttlSeconds !== undefined && (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0)) throw new Error("DASHBOARD_SNAPSHOT_INVALID_TTL");
  const ttlMs = Math.min(MAX_TTL_MS, Math.max(10_000, (ttlSeconds ?? 60) * 1000));
  const snapshot: DashboardPageSnapshot = { ...data, id: randomUUID(), createdAt: now, ttlMs, byteSize };
  snapshots.set(snapshot.id, snapshot);
  return snapshot;
}

export function getDashboardPageSnapshot(id: string, deviceId: number, dashboardId: number): DashboardPageSnapshot | null {
  const item = snapshots.get(id);
  if (!item) return null;
  if (Date.now() - item.createdAt >= item.ttlMs) {
    snapshots.delete(id);
    return null;
  }
  return item.deviceId === deviceId && item.dashboardId === dashboardId ? item : null;
}

/** Evict only the authenticated device's process-local patient snapshots. */
export function purgeDashboardDeviceSnapshots(dashboardId: number, deviceId: number) {
  for (const [id,snapshot] of snapshots) if (snapshot.dashboardId===dashboardId && snapshot.deviceId===deviceId) snapshots.delete(id);
}
