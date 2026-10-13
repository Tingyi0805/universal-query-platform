import { QuerySourceError, sourceVersion, type SourceStore, type SourceTransaction } from "./dashboardQuerySources.service.js";
import { randomBytes, createHash } from "node:crypto";

export type ModeDevice = { id: number; ownerId: number; workstationId: number | null; expiresAt: string | null;
  enforceIpRestriction?: boolean; allowedIp?: string | null; allowedCidr?: string | null };
export interface ModeTransaction extends SourceTransaction {
  modeReady(): Promise<boolean>;
  actor(userId: number, tokenVersion: number): Promise<void>;
  devices(id: number): Promise<ModeDevice[]>;
  delegation(device: ModeDevice): Promise<void>;
  policy(datasetId: number): Promise<void>;
  switchMode(id: number, enabled: boolean): Promise<void>;
  modeAudit(userId: number, id: number, enabled: boolean): Promise<void>;
  issueDevice(id: number, device: ModeDevice, hash: string): Promise<void>;
  issueAudit(userId: number, id: number, deviceId: number): Promise<void>;
}
export function createQueryModeService(store: SourceStore, enabled: () => boolean) {
  const run = async <T>(id: number, user: number, version: number, work: (tx: ModeTransaction) => Promise<T>) => {
    if (!enabled()) throw new QuerySourceError("QUERY_DEVICE_PLAYBACK_DISABLED", 404);
    return store.transaction(async base => {
      const tx = base as ModeTransaction;
      if (!await tx.schemaReady() || !await tx.modeReady()) throw new QuerySourceError("QUERY_MODE_SCHEMA_REQUIRED", 503);
      await tx.actor(user, version);
      return work(tx);
    });
  };
  return {
    issue: (id: number, deviceId: number, user: number, tokenVersion: number, expectedVersion: string) => run(id, user, tokenVersion, async tx => {
      const state = await tx.readState(id);
      if (sourceVersion(state) !== expectedVersion) throw new QuerySourceError("QUERY_SOURCE_VERSION_CONFLICT");
      if (state.dashboard.mode !== "QUERY_ONLY" || !state.dashboard.isActive) throw new QuerySourceError("QUERY_SOURCE_MODE_NOT_ACTIVATED");
      const device = (await tx.devices(id)).find(d => d.id === deviceId);
      if (!device) throw new QuerySourceError("DASHBOARD_DEVICE_NOT_FOUND", 404);
      await tx.delegation(device);
      const { snapshotKind: _kind, snapshotSeconds: _sec, deviceColumnMasks: _masks, deviceColumnTypes: _types, ...parameters } = state.dashboard.parameters;
      for (const source of [{ queryDefinitionId: state.dashboard.queryDefinitionId, parameters }, ...state.sources]) {
        if (source.queryDefinitionId === null) throw new QuerySourceError("QUERY_SOURCE_PENDING_CONVERSION");
        const datasetId = await tx.validateQuery(user, source.queryDefinitionId, source.parameters);
        await tx.policy(datasetId);
        await tx.validateQuery(device.ownerId, source.queryDefinitionId, source.parameters);
      }
      const token = randomBytes(32).toString("base64url");
      await tx.issueDevice(id, device, createHash("sha256").update(token).digest("hex"));
      await tx.issueAudit(user, id, deviceId);
      return { device: { id: deviceId, dashboardId: id }, token };
    }),
    read: (id: number, user: number, tokenVersion: number) => run(id, user, tokenVersion, async tx => {
      const state = await tx.readState(id);
      return { mode: state.dashboard.mode, modeVersion: state.dashboard.modeVersion, version: sourceVersion(state) };
    }),
    change: (id: number, user: number, tokenVersion: number, expectedVersion: string, activate: boolean) => run(id, user, tokenVersion, async tx => {
      const state = await tx.readState(id);
      if (sourceVersion(state) !== expectedVersion) throw new QuerySourceError("QUERY_SOURCE_VERSION_CONFLICT");
      if (activate) {
        if (state.dashboard.isActive || state.dashboard.mode === "QUERY_ONLY") throw new QuerySourceError("QUERY_MODE_TRANSITION_CONFLICT");
        if (state.sources.length + 1 > 8) throw new QuerySourceError("QUERY_SOURCE_LIMIT", 400);
        const keys = state.sources.map(s => s.sourceKey.toUpperCase());
        if (new Set(keys).size !== keys.length || keys.includes("PRIMARY") || state.sources.some(s => !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(s.sourceKey)))
          throw new QuerySourceError("QUERY_SOURCE_LEGACY_KEY_CONFLICT");
        if (state.references.some(key => key !== "PRIMARY" && !state.sources.some(s => s.sourceKey === key)))
          throw new QuerySourceError("QUERY_SOURCE_REFERENCE_INVALID");
        const { snapshotKind: _kind, snapshotSeconds: _seconds, deviceColumnMasks: _masks, deviceColumnTypes: _types, ...primaryParameters } = state.dashboard.parameters;
        const sources = [{ queryDefinitionId: state.dashboard.queryDefinitionId, parameters: primaryParameters }, ...state.sources];
        for (const source of state.sources) if (source.queryDefinitionId === null || source.maxRows === null || source.queryBindingRevision < 1)
          throw new QuerySourceError("QUERY_SOURCE_PENDING_CONVERSION");
        const devices = await tx.devices(id);
        if (!devices.length) throw new QuerySourceError("QUERY_MODE_DEVICE_REQUIRED");
        for (const device of devices) await tx.delegation(device);
        for (const source of sources) {
          const datasetId = await tx.validateQuery(user, source.queryDefinitionId!, source.parameters);
          await tx.policy(datasetId);
          // Every device's stored delegator must independently possess every Query ACL.
          for (const device of devices) await tx.validateQuery(device.ownerId, source.queryDefinitionId!, source.parameters);
        }
      } else if (state.dashboard.mode !== "QUERY_ONLY") throw new QuerySourceError("QUERY_MODE_TRANSITION_CONFLICT");
      await tx.switchMode(id, activate); // Also rotates all device token hashes; never returns a new credential.
      await tx.modeAudit(user, id, activate);
      const updated = await tx.readState(id);
      return { mode: updated.dashboard.mode, modeVersion: updated.dashboard.modeVersion,
        version: sourceVersion(updated), deviceCredentialsInvalidated: true };
    }),
  };
}
