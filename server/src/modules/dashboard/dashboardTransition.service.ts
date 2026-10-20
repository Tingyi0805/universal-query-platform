import { createHash } from "node:crypto";
import { approvalObject } from "./dashboardApproval.service.js";
import { dashboardQueryParameters } from "./dashboardDeviceMasking.js";
import { QuerySourceError, sourceVersion, type SourceState, type SourceTransaction } from "./dashboardQuerySources.service.js";

export type TransitionActor = { userId: number; tokenVersion: number };
export interface TransitionTransaction extends SourceTransaction {
  securityReady(): Promise<void>;
  actor(actor: TransitionActor): Promise<void>;
  approvalEvidence(id: number): Promise<string>;
  readDisableState(id: number): Promise<{ id: number; isActive: boolean; mode: string; version: string }>;
  disableLegacy(id: number): Promise<void>;
  revokeCredentials(id: number): Promise<void>;
  updateApprovalParameters(id: number, parameters: Record<string, unknown>): Promise<void>;
  transitionAudit(id: number, actor: TransitionActor, action: "LEGACY_DISABLED" | "PENDING_APPROVALS_REVOKED", source?: { id: number; sourceKey: string }): Promise<void>;
}
export interface TransitionStore { transaction<T>(work: (tx: TransitionTransaction) => Promise<T>): Promise<T> }

export function createDashboardTransitionService(store: TransitionStore, managementEnabled: () => boolean) {
  const trusted = (evidence: string) => {
    if (typeof evidence !== "string" || evidence.length !== 64 || !/^[a-f0-9]{64}$/.test(evidence))
      throw new QuerySourceError("SECURITY_SCHEMA_REQUIRED", 503);
    return evidence;
  };
  const version = async (tx: TransitionTransaction, state: SourceState) => {
    const evidence = trusted(await tx.approvalEvidence(state.dashboard.id));
    return createHash("sha256").update(JSON.stringify([sourceVersion(state), evidence])).digest("hex");
  };
  const run = <T>(actor: TransitionActor, work: (tx: TransitionTransaction) => Promise<T>) =>
    store.transaction(async tx => {
      if (!await tx.schemaReady()) throw new QuerySourceError("QUERY_SOURCE_SCHEMA_REQUIRED", 503);
      await tx.securityReady();
      await tx.actor(actor);
      return work(tx);
    });
  const runPending = <T>(id: number, actor: TransitionActor, work: (tx: TransitionTransaction, state: SourceState, version: string) => Promise<T>) =>
    run(actor, async tx => { const state = await tx.readState(id); return work(tx, state, await version(tx, state)); });
  const checkVersion = (actual: string, expected: string) => {
    if (actual !== expected) throw new QuerySourceError("DASHBOARD_TRANSITION_VERSION_CONFLICT");
  };
  const legacy = (mode: string) => {
    if (mode !== "LEGACY") throw new QuerySourceError("DASHBOARD_LEGACY_MODE_REQUIRED");
  };
  const pending = async (tx: TransitionTransaction, state: SourceState, actor: TransitionActor, key: string) => {
    if (!managementEnabled()) throw new QuerySourceError("QUERY_SOURCE_MANAGEMENT_DISABLED", 404);
    if (state.dashboard.isActive || state.dashboard.mode === "QUERY_ONLY") throw new QuerySourceError("QUERY_SOURCE_DASHBOARD_MUST_BE_INACTIVE");
    if (state.dashboard.mode !== "LEGACY" && state.dashboard.mode !== "QUERY_ONLY_DISABLED") throw new QuerySourceError("QUERY_MODE_INVALID", 503);
    if (key.toUpperCase() === "PRIMARY") throw new QuerySourceError("QUERY_SOURCE_IDENTITY_CONFLICT");
    const matches = state.sources.filter(s => s.sourceKey.toUpperCase() === key.toUpperCase());
    if (matches.length !== 1 || matches[0]!.sourceKey !== key) throw new QuerySourceError("QUERY_SOURCE_IDENTITY_CONFLICT");
    const source = matches[0]!;
    if (source.queryDefinitionId !== null) throw new QuerySourceError("QUERY_SOURCE_PENDING_REQUIRED");
    await tx.validateQuery(actor.userId, state.dashboard.queryDefinitionId, dashboardQueryParameters(state.dashboard.parameters));
    return source;
  };
  return {
    readDisable: (id: number, actor: TransitionActor) => run(actor, async tx => {
      const state = await tx.readDisableState(id); legacy(state.mode);
      return { dashboardId: id, mode: "LEGACY", isActive: state.isActive, version: trusted(state.version) };
    }),
    disable: (id: number, actor: TransitionActor, input: { expectedVersion: string; confirmed: true }) => run(actor, async tx => {
      const state = await tx.readDisableState(id);
      legacy(state.mode); checkVersion(trusted(state.version), input.expectedVersion);
      if (input.confirmed !== true) throw new QuerySourceError("VALIDATION_ERROR", 400);
      if (!state.isActive) throw new QuerySourceError("DASHBOARD_ALREADY_INACTIVE");
      // DESIGN_QUERY is sufficient to stop exposure even if the Query ACL is revoked.
      await tx.disableLegacy(id);
      await tx.revokeCredentials(id);
      await tx.transitionAudit(id, actor, "LEGACY_DISABLED");
      const updated = await tx.readDisableState(id);
      return { dashboardId: id, isActive: false, credentialsInvalidated: true, version: trusted(updated.version) };
    }),
    readPending: (id: number, key: string, actor: TransitionActor) => runPending(id, actor, async (tx, state, current) => {
      const source = await pending(tx, state, actor, key);
      const masks = approvalObject(state.dashboard.parameters.deviceSourceColumnMasks);
      const hasApprovals = Object.entries(masks).some(([name, value]) => name.toUpperCase() === key.toUpperCase() && Object.keys(approvalObject(value)).length > 0);
      return { dashboardId: id, sourceId: source.id, sourceKey: source.sourceKey, hasApprovals, version: current, reapprovalRequired: true };
    }),
    revokePending: (id: number, key: string, actor: TransitionActor, input: { sourceId: number; expectedVersion: string; confirmed: true }) => runPending(id, actor, async (tx, state, current) => {
      checkVersion(current, input.expectedVersion);
      const source = await pending(tx, state, actor, key);
      if (input.confirmed !== true || input.sourceId !== source.id) throw new QuerySourceError("QUERY_SOURCE_IDENTITY_CONFLICT");
      const masks = { ...approvalObject(state.dashboard.parameters.deviceSourceColumnMasks) };
      const names = Object.keys(masks).filter(name => name.toUpperCase() === key.toUpperCase());
      if (!names.some(name => Object.keys(approvalObject(masks[name])).length)) throw new QuerySourceError("DASHBOARD_PENDING_APPROVALS_NOT_FOUND");
      // Explicitly revoke only this identity, including historical case aliases.
      // Preserve PRIMARY, classifications, sibling approvals and every unrelated parameter.
      for (const name of names) delete masks[name];
      await tx.updateApprovalParameters(id, { ...state.dashboard.parameters, deviceSourceColumnMasks: masks });
      await tx.transitionAudit(id, actor, "PENDING_APPROVALS_REVOKED", { id: source.id, sourceKey: key });
      const updated = await tx.readState(id);
      return { dashboardId: id, sourceId: source.id, sourceKey: key, revoked: true, reapprovalRequired: true,
        version: await version(tx, updated), configurationVersion: sourceVersion(updated) };
    }),
  };
}
