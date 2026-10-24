import { dashboardQueryParameters } from "./dashboardDeviceMasking.js";
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
  revokeDevice?(id: number, deviceId: number): Promise<void>;
  revokeAudit?(userId: number, id: number, deviceId: number): Promise<void>;
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
    preflight: (id: number, user: number, tokenVersion: number) => run(id,user,tokenVersion,async tx => {
      const state = await tx.readState(id), devices = await tx.devices(id);
      const keys = state.sources.map(s => s.sourceKey.toUpperCase());
      const checks = [
        { name: "inactive", ok: !state.dashboard.isActive && state.dashboard.mode !== "QUERY_ONLY", code: "QUERY_MODE_TRANSITION_CONFLICT" },
        { name: "capacity", ok: state.sources.length + 1 <= 8, code: "QUERY_SOURCE_LIMIT" },
        { name: "primaryConversion", ok: state.dashboard.maxRows !== null, code: "QUERY_SOURCE_CONVERSION_REQUIRED" },
        { name: "bindings", ok: new Set(keys).size === keys.length && !keys.includes("PRIMARY") && state.sources.every(s =>
          /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(s.sourceKey) && s.queryDefinitionId !== null && s.maxRows !== null && s.queryBindingRevision >= 1), code: "QUERY_SOURCE_PENDING_CONVERSION" },
        { name: "references", ok: state.references.every(key => key === "PRIMARY" || state.sources.some(s => s.sourceKey === key && s.isEnabled)), code: "QUERY_SOURCE_REFERENCE_INVALID" },
        { name: "devices", ok: devices.length > 0, code: "QUERY_MODE_DEVICE_REQUIRED" },
      ];
      const inspect = async (work: () => Promise<unknown>) => {
        try { await work(); return {ok:true,code:null}; }
        catch (error) { if (!(error instanceof QuerySourceError)) throw error; return {ok:false,code:error.code}; }
      };
      const parameters = dashboardQueryParameters(state.dashboard.parameters);
      const sources = [{sourceKey:"PRIMARY",queryDefinitionId:state.dashboard.queryDefinitionId,parameters},...state.sources];
      const queryChecks = [];
      for (const source of sources) queryChecks.push({sourceKey:source.sourceKey,...await inspect(async () => {
        if (source.queryDefinitionId === null) throw new QuerySourceError("QUERY_SOURCE_PENDING_CONVERSION");
        const datasetId = await tx.validateQuery(user,source.queryDefinitionId,source.parameters); await tx.policy(datasetId);
      })});
      const delegators = [];
      for (const device of devices) delegators.push({deviceId:device.id,...await inspect(async () => {
        await tx.delegation(device);
        for (const source of sources) {
          if (source.queryDefinitionId === null) throw new QuerySourceError("QUERY_SOURCE_PENDING_CONVERSION");
          await tx.validateQuery(device.ownerId,source.queryDefinitionId,source.parameters);
        }
      })});
      return { version:sourceVersion(state),mode:state.dashboard.mode,modeVersion:state.dashboard.modeVersion,
        sourceCount:sources.length,pendingCount:state.sources.filter(s => s.queryDefinitionId === null).length,
        checks,queries:queryChecks,delegators,ready:[...checks,...queryChecks,...delegators].every(c => c.ok) };
    }),
    revoke: (id: number, deviceId: number, user: number, tokenVersion: number, expectedVersion: string) => run(id,user,tokenVersion,async tx => {
      const state = await tx.readState(id);
      if (sourceVersion(state) !== expectedVersion) throw new QuerySourceError("QUERY_SOURCE_VERSION_CONFLICT");
      if (state.dashboard.mode === "LEGACY") throw new QuerySourceError("QUERY_SOURCE_MODE_NOT_ACTIVATED");
      if (!tx.revokeDevice || !tx.revokeAudit) throw new QuerySourceError("QUERY_SOURCE_STORAGE_UNAVAILABLE",503);
      // Revocation must remain possible after the delegated Query/workstation permission is revoked.
      await tx.revokeDevice(id,deviceId); await tx.revokeAudit(user,id,deviceId);
      return {deviceId,revoked:true};
    }),
    issue: (id: number, deviceId: number, user: number, tokenVersion: number, expectedVersion: string) => run(id, user, tokenVersion, async tx => {
      const state = await tx.readState(id);
      if (sourceVersion(state) !== expectedVersion) throw new QuerySourceError("QUERY_SOURCE_VERSION_CONFLICT");
      if (state.dashboard.mode !== "QUERY_ONLY" || !state.dashboard.isActive) throw new QuerySourceError("QUERY_SOURCE_MODE_NOT_ACTIVATED");
      const device = (await tx.devices(id)).find(d => d.id === deviceId);
      if (!device) throw new QuerySourceError("DASHBOARD_DEVICE_NOT_FOUND", 404);
      await tx.delegation(device);
      const parameters = dashboardQueryParameters(state.dashboard.parameters);
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
        if (state.dashboard.maxRows === null) throw new QuerySourceError("QUERY_SOURCE_CONVERSION_REQUIRED");
        const keys = state.sources.map(s => s.sourceKey.toUpperCase());
        if (new Set(keys).size !== keys.length || keys.includes("PRIMARY") || state.sources.some(s => !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(s.sourceKey)))
          throw new QuerySourceError("QUERY_SOURCE_LEGACY_KEY_CONFLICT");
        if (state.references.some(key => key !== "PRIMARY" && !state.sources.some(s => s.sourceKey === key && s.isEnabled)))
          throw new QuerySourceError("QUERY_SOURCE_REFERENCE_INVALID");
        const primaryParameters = dashboardQueryParameters(state.dashboard.parameters);
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
