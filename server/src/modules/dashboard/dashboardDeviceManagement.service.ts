import { createHash } from "node:crypto";
import { dashboardQueryParameters } from "./dashboardDeviceMasking.js";
import { QuerySourceError, sourceVersion, type SourceState, type SourceTransaction } from "./dashboardQuerySources.service.js";
import { deviceMetadataSchema, devicePlacementSchema, deviceRenewalSchema, type DeviceMetadata, type DevicePlacement } from "./dashboardDeviceManagement.schema.js";

export type DeviceActor = { userId: number; tokenVersion: number; ipAddress?: string | null; userAgent?: string | null };
export type DeviceRecord = DeviceMetadata & { id: number; dashboardId: number; createdByUserId: number; sharedWorkstationId: number | null;
  isActive: boolean; revokedAtUtc: string | null; archivedAtUtc: string | null; queryModeGrantVersion: number | null;
  delegatorTokenVersion: number | null; credentialFingerprint: string; placement: DevicePlacement | null };
export interface DeviceManagementTransaction extends SourceTransaction {
  securityReady(): Promise<void>;
  actor(actor: DeviceActor): Promise<void>;
  evidence(id: number): Promise<string>;
  records(id: number): Promise<DeviceRecord[]>;
  delegation(device: DeviceRecord, modeVersion?: number): Promise<void>;
  createDevice(id: number, ownerId: number, metadata: DeviceMetadata): Promise<number>;
  updateMetadata(id: number, deviceId: number, metadata: DeviceMetadata): Promise<void>;
  updatePlacement(id: number, deviceId: number, placement: DevicePlacement): Promise<void>;
  renewDevice(id: number, deviceId: number, days: number): Promise<string>;
  touch(id: number): Promise<void>;
  deviceAudit(id: number, actor: DeviceActor, action: "CREATED" | "METADATA_UPDATED" | "PLACEMENT_UPDATED" | "RENEWED", deviceId: number, invalidated: boolean, renewal?: { extendDays: number; previousExpiresAtUtc: string; expiresAtUtc: string }): Promise<void>;
}
export interface DeviceManagementStore { transaction<T>(work: (tx: DeviceManagementTransaction) => Promise<T>): Promise<T> }
export function createDeviceManagementService(store: DeviceManagementStore, enabled: () => boolean) {
  const snapshot = async (tx: DeviceManagementTransaction, id: number) => {
    const state = await tx.readState(id), evidence = await tx.evidence(id), devices = await tx.records(id);
    if (!/^[a-f0-9]{64}$/.test(evidence)) throw new QuerySourceError("SECURITY_SCHEMA_REQUIRED", 503);
    const version = createHash("sha256").update(JSON.stringify([sourceVersion(state), evidence, devices])).digest("hex");
    return { state, devices, version };
  };
  const run = async <T>(id: number, actor: DeviceActor, work: (tx: DeviceManagementTransaction, current: Awaited<ReturnType<typeof snapshot>>) => Promise<T>) => {
    if (!enabled()) throw new QuerySourceError("QUERY_SOURCE_MANAGEMENT_DISABLED", 404);
    return store.transaction(async tx => {
      if (!await tx.schemaReady()) throw new QuerySourceError("QUERY_SOURCE_SCHEMA_REQUIRED", 503);
      await tx.securityReady(); await tx.actor(actor);
      const current = await snapshot(tx, id);
      if (!["LEGACY", "QUERY_ONLY", "QUERY_ONLY_DISABLED"].includes(current.state.dashboard.mode ?? "")) throw new QuerySourceError("QUERY_MODE_INVALID", 503);
      return work(tx, current);
    });
  };
  const queries = async (tx: DeviceManagementTransaction, state: SourceState, userId: number) => {
    if (state.dashboard.maxRows === null) throw new QuerySourceError("QUERY_SOURCE_CONVERSION_REQUIRED");
    for (const source of [{ queryDefinitionId: state.dashboard.queryDefinitionId, parameters: dashboardQueryParameters(state.dashboard.parameters) }, ...state.sources]) {
      if (source.queryDefinitionId === null) throw new QuerySourceError("QUERY_SOURCE_PENDING_CONVERSION");
      await tx.validateQuery(userId, source.queryDefinitionId, source.parameters);
    }
  };
  const project = (value: Awaited<ReturnType<typeof snapshot>>) => ({ dashboardId: value.state.dashboard.id, version: value.version, canCreate: !value.state.dashboard.isActive && value.state.dashboard.mode !== "QUERY_ONLY",
    devices: value.devices.map(({ credentialFingerprint: _private, ...device }) => device) });
  const validate = (current: Awaited<ReturnType<typeof snapshot>>, input: { expectedVersion: string; confirmed: true }) => {
    if (input.confirmed !== true) throw new QuerySourceError("VALIDATION_ERROR", 400);
    if (input.expectedVersion !== current.version) throw new QuerySourceError("DASHBOARD_DEVICE_VERSION_CONFLICT");
  };
  const target = (devices: DeviceRecord[], deviceId: number) => {
    const device = devices.find(d => d.id === deviceId);
    if (!device) throw new QuerySourceError("DASHBOARD_DEVICE_NOT_FOUND", 404);
    if (!device.isActive || device.revokedAtUtc !== null || device.archivedAtUtc !== null ||
      (device.expiresAtUtc !== null && (!Number.isFinite(Date.parse(device.expiresAtUtc)) || Date.parse(device.expiresAtUtc) <= Date.now())))
      throw new QuerySourceError("DASHBOARD_DEVICE_NOT_EDITABLE");
    return device;
  };
  return {
    read: (id: number, actor: DeviceActor) => run(id, actor, async (tx, current) => {
      await queries(tx, current.state, actor.userId); return project(current);
    }),
    create: (id: number, actor: DeviceActor, input: { expectedVersion: string; confirmed: true; metadata: DeviceMetadata }) => run(id, actor, async (tx, current) => {
      validate(current, input);
      const parsed = deviceMetadataSchema.safeParse(input.metadata);
      if (!parsed.success) throw new QuerySourceError("VALIDATION_ERROR", 400);
      if (current.state.dashboard.isActive || current.state.dashboard.mode === "QUERY_ONLY") throw new QuerySourceError("QUERY_SOURCE_DASHBOARD_MUST_BE_INACTIVE");
      await queries(tx, current.state, actor.userId);
      const deviceId = await tx.createDevice(id, actor.userId, parsed.data);
      await tx.touch(id); await tx.deviceAudit(id, actor, "CREATED", deviceId, false);
      return { ...project(await snapshot(tx, id)), deviceId, credentialIssued: false };
    }),
    metadata: (id: number, deviceId: number, actor: DeviceActor, input: { expectedVersion: string; confirmed: true; metadata: DeviceMetadata }) => run(id, actor, async (tx, current) => {
      validate(current, input);
      const parsed = deviceMetadataSchema.safeParse(input.metadata);
      if (!parsed.success) throw new QuerySourceError("VALIDATION_ERROR", 400);
      const device = target(current.devices, deviceId);
      await queries(tx, current.state, actor.userId); await tx.delegation(device); await queries(tx, current.state, device.createdByUserId);
      await tx.updateMetadata(id, deviceId, parsed.data);
      await tx.touch(id); await tx.deviceAudit(id, actor, "METADATA_UPDATED", deviceId, true);
      return { ...project(await snapshot(tx, id)), deviceId, deviceCredentialsInvalidated: true };
    }),
    renew: (id: number, deviceId: number, actor: DeviceActor, input: { expectedVersion: string; confirmed: true; days: number }) => run(id, actor, async (tx,current) => {
      validate(current,input);
      const parsed=deviceRenewalSchema.safeParse({days:input.days});
      if(!parsed.success)throw new QuerySourceError("VALIDATION_ERROR",400);
      const device=target(current.devices,deviceId), previousExpiresAtUtc=device.expiresAtUtc;
      if(previousExpiresAtUtc===null || Date.parse(previousExpiresAtUtc)+parsed.data.days*86400000>Date.now()+365*86400000)throw new QuerySourceError("DASHBOARD_DEVICE_RENEWAL_LIMIT");
      if(current.state.dashboard.mode==="QUERY_ONLY_DISABLED")throw new QuerySourceError("QUERY_SOURCE_MODE_NOT_ACTIVATED");
      await queries(tx,current.state,actor.userId);
      if(current.state.dashboard.mode==="QUERY_ONLY" && (!current.state.dashboard.isActive || !Number.isSafeInteger(current.state.dashboard.modeVersion) || current.state.dashboard.modeVersion!<1))throw new QuerySourceError("QUERY_SOURCE_MODE_NOT_ACTIVATED");
      await tx.delegation(device,current.state.dashboard.mode==="QUERY_ONLY"?current.state.dashboard.modeVersion:undefined);
      await queries(tx,current.state,device.createdByUserId);
      const expiresAtUtc=await tx.renewDevice(id,deviceId,parsed.data.days);
      await tx.touch(id);await tx.deviceAudit(id,actor,"RENEWED",deviceId,false,{extendDays:parsed.data.days,previousExpiresAtUtc,expiresAtUtc});
      return {...project(await snapshot(tx,id)),deviceId,credentialIssued:false,deviceCredentialsInvalidated:false};
    }),
    placement: (id: number, deviceId: number, actor: DeviceActor, input: { expectedVersion: string; confirmed: true; placement: DevicePlacement }) => run(id, actor, async (tx, current) => {
      validate(current, input);
      const parsed = devicePlacementSchema.safeParse(input.placement);
      if (!parsed.success) throw new QuerySourceError("VALIDATION_ERROR", 400);
      const device = target(current.devices, deviceId);
      await queries(tx, current.state, actor.userId); await tx.delegation(device); await queries(tx, current.state, device.createdByUserId);
      await tx.updatePlacement(id, deviceId, parsed.data);
      await tx.touch(id); await tx.deviceAudit(id, actor, "PLACEMENT_UPDATED", deviceId, false);
      return { ...project(await snapshot(tx, id)), deviceId, deviceCredentialsInvalidated: false };
    }),
  };
}
