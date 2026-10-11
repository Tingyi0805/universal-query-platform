import { randomUUID } from "node:crypto";

export type DashboardPageSnapshot = {
  id: string;
  deviceId: number;
  dashboardId: number;
  queryId: number;
  datasetId: number;
  sourceScope: string;
  createdAt: number;
  columns: { name: string }[];
  rows: Record<string, unknown>[];
};

// Process-local cache: no durable patient data, no cross-node guarantees.
const MAX_SNAPSHOTS = 100;
const TTL_MS = 120_000;
const snapshots = new Map<string, DashboardPageSnapshot>();

export function createDashboardPageSnapshot(input: Omit<DashboardPageSnapshot, "id" | "createdAt">): DashboardPageSnapshot {
  const now = Date.now();
  for (const [key, item] of snapshots) {
    if (now - item.createdAt > TTL_MS) snapshots.delete(key);
  }
  while (snapshots.size >= MAX_SNAPSHOTS) {
    const oldest = snapshots.keys().next().value;
    if (oldest === undefined) break;
    snapshots.delete(oldest);
  }
  const snapshot = { ...input, id: randomUUID(), createdAt: now };
  snapshots.set(snapshot.id, snapshot);
  return snapshot;
}

export function getDashboardPageSnapshot(id: string, deviceId: number, dashboardId: number): DashboardPageSnapshot | null {
  const item = snapshots.get(id);
  if (!item) return null;
  if (Date.now() - item.createdAt > TTL_MS) {
    snapshots.delete(id);
    return null;
  }
  return item.deviceId === deviceId && item.dashboardId === dashboardId ? item : null;
}
