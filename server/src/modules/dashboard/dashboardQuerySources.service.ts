import { createHash } from "node:crypto";
import type { QuerySourcePatch } from "./dashboardQuerySources.schema.js";

export class QuerySourceError extends Error {
  constructor(public code: string, public status = 409) { super(code); }
}
export type QuerySource = {
  id: number; sourceKey: string; datasetId: number; queryDefinitionId: number | null;
  queryBindingRevision: number; maxRows: number | null; parameters: Record<string, unknown>;
  refreshSeconds: number; pageSize: number; pageSeconds: number; isEnabled: boolean;
};
export type SourceState = {
  dashboard: { id: number; queryDefinitionId: number; isActive: boolean; parameters: Record<string, unknown>;
    updatedAtUtc: string; maxRows: number | null; refreshSeconds: number; pageSize: number; pageSeconds: number };
  sources: QuerySource[];
  references: string[];
};
export interface SourceTransaction {
  schemaReady(): Promise<boolean>;
  readState(id: number): Promise<SourceState>;
  validateQuery(userId: number, queryId: number, parameters: Record<string, unknown>): Promise<number>;
  upsert(dashboardId: number, source: Omit<QuerySource, "id"> & { id: number | null }): Promise<void>;
  remove(dashboardId: number, id: number): Promise<void>;
  markManaged(dashboardId: number): Promise<void>;
  audit(userId: number, dashboardId: number, changes: { sourceKey: string; queryDefinitionId?: number; action: string }[]): Promise<void>;
}
export interface SourceStore {
  transaction<T>(work: (tx: SourceTransaction) => Promise<T>): Promise<T>;
}
export const sourceVersion = (state: SourceState) => createHash("sha256").update(JSON.stringify(state)).digest("hex");
function projection(state: SourceState) {
  const { dashboard, sources } = state;
  return { version: sourceVersion(state), mode: "MANAGEMENT_ONLY", playbackEnabled: false,
    overCapacity: sources.length + 1 > 8,
    primary: { sourceKey: "PRIMARY", queryDefinitionId: dashboard.queryDefinitionId,
      maxRows: dashboard.maxRows ?? 1000, refreshSeconds: dashboard.refreshSeconds,
      pageSize: dashboard.pageSize, pageSeconds: dashboard.pageSeconds, readOnly: true },
    sources: sources.map(({ parameters: _parameters, datasetId: _history, ...source }) => ({
      ...source, bindingState: source.queryDefinitionId === null ? "PENDING_CONVERSION" : "QUERY_BOUND",
    })),
  };
}
export function createQuerySourceManagement(store: SourceStore, enabled: () => boolean) {
  const run = async <T>(id: number, work: (tx: SourceTransaction, state: SourceState) => Promise<T>) => {
    if (!enabled()) throw new QuerySourceError("QUERY_SOURCE_MANAGEMENT_DISABLED", 404);
    return store.transaction(async tx => {
      if (!await tx.schemaReady()) throw new QuerySourceError("QUERY_SOURCE_SCHEMA_REQUIRED", 503);
      const state = await tx.readState(id);
      return work(tx, state);
    });
  };
  const validatePrimary = async (tx: SourceTransaction, state: SourceState, userId: number) => {
    const { snapshotKind: _kind, snapshotSeconds: _seconds, deviceColumnMasks: _masks,
      deviceColumnTypes: _types, ...parameters } = state.dashboard.parameters;
    await tx.validateQuery(userId, state.dashboard.queryDefinitionId, parameters);
  };
  return {
    read: (id: number, userId: number) => run(id, async (tx, state) => {
      await validatePrimary(tx, state, userId);
      for (const source of state.sources) if (source.queryDefinitionId !== null)
        await tx.validateQuery(userId, source.queryDefinitionId, source.parameters);
      return projection(state);
    }),
    patch: (id: number, userId: number, input: QuerySourcePatch) => run(id, async (tx, state) => {
      if (state.dashboard.isActive) throw new QuerySourceError("QUERY_SOURCE_DASHBOARD_MUST_BE_INACTIVE");
      if (sourceVersion(state) !== input.expectedVersion) throw new QuerySourceError("QUERY_SOURCE_VERSION_CONFLICT");
      await validatePrimary(tx, state, userId);
      const canonical = (key: string) => key.toUpperCase();
      const savedKeys = state.sources.map(s => canonical(s.sourceKey));
      if (new Set(savedKeys).size !== savedKeys.length || state.sources.some(s =>
        canonical(s.sourceKey) === "PRIMARY" || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(s.sourceKey)))
        throw new QuerySourceError("QUERY_SOURCE_LEGACY_KEY_CONFLICT");
      const removed = new Set<number>();
      for (const item of input.removals) {
        const saved = state.sources.find(s => s.sourceKey === item.sourceKey && s.id === item.id);
        if (!saved) throw new QuerySourceError("QUERY_SOURCE_IDENTITY_CONFLICT");
        if (state.references.some(ref => canonical(ref) === canonical(item.sourceKey)))
          throw new QuerySourceError("QUERY_SOURCE_IN_USE");
        removed.add(saved.id);
      }
      const next = state.sources.filter(s => !removed.has(s.id));
      const changes: Parameters<SourceTransaction["audit"]>[2] = input.removals.map(s => ({ sourceKey: s.sourceKey, action: "REMOVE" }));
      const writes: Parameters<SourceTransaction["upsert"]>[1][] = [];
      for (const item of input.upserts) {
        const saved = state.sources.find(s => canonical(s.sourceKey) === canonical(item.sourceKey));
        if ((saved && (saved.id !== item.id || saved.sourceKey !== item.sourceKey)) || (!saved && item.id !== null))
          throw new QuerySourceError("QUERY_SOURCE_IDENTITY_CONFLICT");
        const datasetId = await tx.validateQuery(userId, item.queryDefinitionId, item.parameters);
        if (saved?.queryDefinitionId === null && saved.datasetId !== datasetId)
          throw new QuerySourceError("QUERY_SOURCE_CONVERSION_DATASET_MISMATCH");
        const write = { ...item, datasetId: saved?.datasetId ?? datasetId, queryBindingRevision: (saved?.queryBindingRevision ?? 0) + 1 };
        const { id: _id, queryBindingRevision: _revision, ...settings } = write;
        const same = saved && Object.entries(settings).every(([k, v]) => JSON.stringify(saved[k as keyof QuerySource]) === JSON.stringify(v));
        if (same) continue;
        writes.push(write);
        if (saved) next.splice(next.findIndex(s => s.id === saved.id), 1);
        next.push({ ...write, id: saved?.id ?? -writes.length });
        changes.push({ sourceKey: item.sourceKey, queryDefinitionId: item.queryDefinitionId, action: saved ? "UPDATE" : "ADD" });
      }
      if (next.length + 1 > 8) throw new QuerySourceError("QUERY_SOURCE_LIMIT", 400);
      for (const source of next) if (source.queryDefinitionId !== null)
        await tx.validateQuery(userId, source.queryDefinitionId, source.parameters);
      // Validate all changes before the first write. No omitted sources are removed.
      for (const sourceId of removed) await tx.remove(id, sourceId);
      for (const write of writes) await tx.upsert(id, write);
      if (changes.length) {
        await tx.markManaged(id);
        await tx.audit(userId, id, changes); // Mandatory, in the same transaction.
      }
      return projection(await tx.readState(id));
    }),
  };
}
