import { dashboardQueryParameters, dashboardReservedParameters, validDashboardColumnMasks, validSourceColumnMasks } from "./dashboardDeviceMasking.js";
import { hasPrimaryApprovals, sourceApprovals, DashboardApprovalError } from "./dashboardApproval.service.js";
import type { DashboardProfileInput } from "./dashboardLayout.repository.js";
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
export type DashboardPresentation = { name: string; description: string | null; displayMode: "TABLE" | "BIG_SCREEN"; displayTitle: string | null; showClock: boolean; showPageNumber: boolean; showCountdown: boolean };
export type SourceState = {
  dashboard: { id: number; queryDefinitionId: number; isActive: boolean; parameters: Record<string, unknown>;
    mode?: string; modeVersion?: number;
    updatedAtUtc: string; maxRows: number | null; refreshSeconds: number; pageSize: number; pageSeconds: number };
  sources: QuerySource[];
  presentation?: DashboardPresentation;
  references: string[];
  layoutFingerprint?: string;
};
export interface SourceTransaction {
  schemaReady(): Promise<boolean>;
  readState(id: number): Promise<SourceState>;
  validateQuery(userId: number, queryId: number, parameters: Record<string, unknown>): Promise<number>;
  upsert(dashboardId: number, source: Omit<QuerySource, "id"> & { id: number | null }): Promise<void>;
  remove(dashboardId: number, id: number): Promise<void>;
  markManaged(dashboardId: number): Promise<void>;
  writeLayout?(id: number, profiles: DashboardProfileInput[]): Promise<void>;
  updatePrimary?(id: number, input: PrimarySettings): Promise<void>;
  updatePresentation?(id: number, input: DashboardPresentation): Promise<void>;
  audit(userId: number, dashboardId: number, changes: { sourceKey: string; queryDefinitionId?: number; action: string }[]): Promise<void>;
}
export type PrimarySettings = { queryDefinitionId: number; parameters: Record<string, unknown>; refreshSeconds: number; pageSize: number; pageSeconds: number; maxRows: number };
export interface SourceStore {
  transaction<T>(work: (tx: SourceTransaction) => Promise<T>): Promise<T>;
}
export const sourceVersion = (state: SourceState) => createHash("sha256").update(JSON.stringify(state)).digest("hex");
function projection(state: SourceState) {
  const { dashboard, sources } = state;
  return { version: sourceVersion(state), mode: "MANAGEMENT_ONLY", playbackEnabled: false,
    overCapacity: sources.length + 1 > 8,
    primary: { sourceKey: "PRIMARY", queryDefinitionId: dashboard.queryDefinitionId,
      maxRows: dashboard.maxRows ?? 1000, requiresConversion: dashboard.maxRows === null, refreshSeconds: dashboard.refreshSeconds,
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
    const parameters = dashboardQueryParameters(state.dashboard.parameters);
    await tx.validateQuery(userId, state.dashboard.queryDefinitionId, parameters);
  };
  return {
    presentation: (id: number, userId: number, input: DashboardPresentation & { expectedVersion: string }) => run(id, async (tx, state) => {
      if (state.dashboard.isActive || state.dashboard.mode === "QUERY_ONLY") throw new QuerySourceError("QUERY_SOURCE_DASHBOARD_MUST_BE_INACTIVE");
      if (sourceVersion(state) !== input.expectedVersion) throw new QuerySourceError("QUERY_SOURCE_VERSION_CONFLICT");
      if (!tx.updatePresentation || !state.presentation) throw new QuerySourceError("QUERY_SOURCE_STORAGE_UNAVAILABLE", 503);
      const { expectedVersion: _expectedVersion, ...presentation } = input;
      await validatePrimary(tx, state, userId);
      await tx.updatePresentation(id, presentation);
      await tx.audit(userId, id, [{ sourceKey: "PRIMARY", action: "PRESENTATION_UPDATE" }]);
      return projection(await tx.readState(id));
    }),
    configuration: (id: number, userId: number) => run(id, async (tx, state) => {
      // A failed validation is local to its source. Never return unauthorized parameter values.
      const inspect = async (queryId: number | null, values: Record<string, unknown>) => {
        if (queryId === null) return { parameters: undefined, errorCode: "PENDING_CONVERSION" };
        try { await tx.validateQuery(userId, queryId, values); return { parameters: values, errorCode: null }; }
        catch (error) {
          if (!(error instanceof QuerySourceError)) throw error;
          const parameterError = error.code.startsWith("PARAMETER_") || error.code === "QUERY_SOURCE_PARAMETER_VALIDATION_FAILED";
          return { parameters: parameterError ? values : undefined, errorCode: error.code };
        }
      };
      const primaryParameters = dashboardQueryParameters(state.dashboard.parameters);
      const view = projection(state);
      const sources = [];
      for (const source of view.sources) sources.push({ ...source,
        ...await inspect(source.queryDefinitionId, state.sources.find(s => s.id === source.id)!.parameters) });
      return { ...view, presentation: state.presentation, dashboardMode: state.dashboard.mode ?? "LEGACY", isActive: state.dashboard.isActive, editable: !state.dashboard.isActive && state.dashboard.mode !== "QUERY_ONLY",
        primary: { ...view.primary, readOnly: false, ...await inspect(state.dashboard.queryDefinitionId, primaryParameters) },
        sources };
    }),
    layout: (id: number, userId: number, input: { expectedVersion: string; profiles: DashboardProfileInput[] }) => run(id, async (tx, state) => {
      if (state.dashboard.isActive || state.dashboard.mode === "QUERY_ONLY") throw new QuerySourceError("QUERY_SOURCE_DASHBOARD_MUST_BE_INACTIVE");
      if (sourceVersion(state) !== input.expectedVersion) throw new QuerySourceError("QUERY_SOURCE_VERSION_CONFLICT");
      if (!tx.writeLayout) throw new QuerySourceError("QUERY_SOURCE_STORAGE_UNAVAILABLE", 503);
      await validatePrimary(tx, state, userId);
      if (state.sources.length + 1 > 8) throw new QuerySourceError("QUERY_SOURCE_LIMIT", 400);
      for (const source of state.sources) {
        if (source.queryDefinitionId === null) throw new QuerySourceError("QUERY_SOURCE_PENDING_CONVERSION");
        await tx.validateQuery(userId, source.queryDefinitionId, source.parameters);
      }
      if (input.profiles.filter(p => p.isDefault).length > 1) throw new QuerySourceError("DASHBOARD_MULTIPLE_DEFAULT_PROFILES", 400);
      for (const profile of input.profiles) for (const widget of profile.widgets) {
        if (widget.x + widget.width > profile.canvasWidth || widget.y + widget.height > profile.canvasHeight)
          throw new QuerySourceError("DASHBOARD_WIDGET_OUT_OF_BOUNDS", 400);
        if (widget.widgetType === "FIELD" || widget.widgetType === "TABLE") {
          const key = widget.config.dataSourceKey ?? "PRIMARY";
          if (typeof key !== "string" || (key !== "PRIMARY" && !state.sources.some(s => s.sourceKey === key && s.isEnabled)))
            throw new QuerySourceError("DASHBOARD_WIDGET_SOURCE_NOT_AVAILABLE", 400);
        }
      }
      await tx.writeLayout(id, input.profiles);
      await tx.markManaged(id);
      await tx.audit(userId, id, [{ sourceKey: "PRIMARY", action: "LAYOUT_UPDATE" }]);
      return projection(await tx.readState(id));
    }),
    disclosure: (id: number, userId: number, input: { expectedVersion: string; sourceKey: string; masks: Record<string, unknown> }) => run(id, async (tx, state) => {
      if (state.dashboard.isActive || state.dashboard.mode === "QUERY_ONLY") throw new QuerySourceError("QUERY_SOURCE_DASHBOARD_MUST_BE_INACTIVE");
      if (sourceVersion(state) !== input.expectedVersion) throw new QuerySourceError("QUERY_SOURCE_VERSION_CONFLICT");
      if (!tx.updatePrimary || state.dashboard.maxRows === null) throw new QuerySourceError("QUERY_SOURCE_CONVERSION_REQUIRED", 409);
      if (state.sources.length + 1 > 8) throw new QuerySourceError("QUERY_SOURCE_LIMIT", 400);
      if (!validDashboardColumnMasks(input.masks)) throw new QuerySourceError("VALIDATION_ERROR", 400);
      const source = input.sourceKey === "PRIMARY" ? undefined : state.sources.find(source => source.sourceKey === input.sourceKey);
      if (input.sourceKey !== "PRIMARY" && !source) throw new QuerySourceError("DASHBOARD_SOURCE_NOT_FOUND", 404);
      if (source?.queryDefinitionId === null) throw new QuerySourceError("PENDING_CONVERSION", 409);
      const queryId = source?.queryDefinitionId ?? state.dashboard.queryDefinitionId;
      await tx.validateQuery(userId, queryId, source?.parameters ?? dashboardQueryParameters(state.dashboard.parameters));
      const parameters = { ...state.dashboard.parameters };
      if (input.sourceKey === "PRIMARY") parameters.deviceColumnMasks = input.masks;
      else {
        if (!validSourceColumnMasks(parameters.deviceSourceColumnMasks)) throw new QuerySourceError("QUERY_SOURCE_SAVED_CONFIG_INVALID", 409);
        parameters.deviceSourceColumnMasks = { ...(parameters.deviceSourceColumnMasks as Record<string, unknown> | undefined), [input.sourceKey]: input.masks };
        if (!validSourceColumnMasks(parameters.deviceSourceColumnMasks)) throw new QuerySourceError("VALIDATION_ERROR", 400);
      }
      // The same locked/versioned primary writer updates ParametersJson only for this
      // explicit policy action; source IDs, bindings and all unrelated policies stay intact.
      await tx.updatePrimary(id, { queryDefinitionId: state.dashboard.queryDefinitionId, parameters,
        refreshSeconds: state.dashboard.refreshSeconds, pageSize: state.dashboard.pageSize,
        pageSeconds: state.dashboard.pageSeconds, maxRows: state.dashboard.maxRows });
      await tx.audit(userId, id, [{ sourceKey: input.sourceKey, queryDefinitionId: queryId, action: "DISCLOSURE_APPROVAL_UPDATE" }]);
      return projection(await tx.readState(id));
    }),
    primary: (id: number, userId: number, input: PrimarySettings & { expectedVersion: string }) => run(id, async (tx, state) => {
      if (state.dashboard.isActive || state.dashboard.mode === "QUERY_ONLY") throw new QuerySourceError("QUERY_SOURCE_DASHBOARD_MUST_BE_INACTIVE");
      if (sourceVersion(state) !== input.expectedVersion) throw new QuerySourceError("QUERY_SOURCE_VERSION_CONFLICT");
      if (!tx.updatePrimary) throw new QuerySourceError("QUERY_SOURCE_STORAGE_UNAVAILABLE", 503);
      if (input.queryDefinitionId !== state.dashboard.queryDefinitionId && hasPrimaryApprovals(state.dashboard.parameters))
        throw new DashboardApprovalError("DASHBOARD_APPROVAL_BINDING_CHANGED");
      if (state.sources.length + 1 > 8) throw new QuerySourceError("QUERY_SOURCE_LIMIT", 400);
      if (dashboardReservedParameters.some(key => key in input.parameters))
        throw new QuerySourceError("VALIDATION_ERROR", 400);
      await tx.validateQuery(userId, input.queryDefinitionId, input.parameters);
      const reserved = Object.fromEntries(Object.entries(state.dashboard.parameters).filter(([key]) =>
        dashboardReservedParameters.includes(key)));
      await tx.updatePrimary(id, { ...input, parameters: { ...input.parameters, ...reserved } });
      await tx.audit(userId, id, [{ sourceKey: "PRIMARY", queryDefinitionId: input.queryDefinitionId, action: "UPDATE" }]);
      return projection(await tx.readState(id));
    }),
    read: (id: number, userId: number) => run(id, async (tx, state) => {
      await validatePrimary(tx, state, userId);
      for (const source of state.sources) if (source.queryDefinitionId !== null)
        await tx.validateQuery(userId, source.queryDefinitionId, source.parameters);
      return projection(state);
    }),
    patch: (id: number, userId: number, input: QuerySourcePatch) => run(id, async (tx, state) => {
      if (state.dashboard.isActive || state.dashboard.mode === "QUERY_ONLY") throw new QuerySourceError("QUERY_SOURCE_DASHBOARD_MUST_BE_INACTIVE");
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
        if (Object.keys(sourceApprovals(state.dashboard.parameters, item.sourceKey)).length)
          throw new DashboardApprovalError("DASHBOARD_APPROVAL_BINDING_CHANGED");
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
        if ((!saved || saved.queryDefinitionId !== item.queryDefinitionId || saved.datasetId !== datasetId) &&
          Object.keys(sourceApprovals(state.dashboard.parameters, item.sourceKey)).length)
          throw new DashboardApprovalError("DASHBOARD_APPROVAL_BINDING_CHANGED");
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
