import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { assertDeviceLifecycleTransition, type DeviceLifecycleRecord } from "./dashboardDeviceLifecycle.js";
import { deviceMetadataSchema } from "./dashboardDeviceManagement.schema.js";
import { dashboardQueryParameters } from "./dashboardDeviceMasking.js";
import { matchesIpRestriction, normalizeClientIp } from "./dashboardDeviceIp.js";
import { QuerySourceError, type SourceState } from "./dashboardQuerySources.service.js";
import { deviceManagementVersion, type DeviceActor, type DeviceManagementStore, type DeviceManagementTransaction, type DeviceRecord } from "./dashboardDeviceManagement.service.js";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const record = (d: DeviceRecord): DeviceLifecycleRecord => ({ id:d.id,dashboardId:d.dashboardId,isActive:d.isActive,
  suspendedAtUtc:d.suspendedAtUtc,reenrollmentRequired:d.reenrollmentRequired,revokedAtUtc:d.revokedAtUtc,archivedAtUtc:d.archivedAtUtc,
  expiresAtUtc:d.expiresAtUtc,tokenHash:d.credentialFingerprint,queryModeGrantVersion:d.queryModeGrantVersion,delegatorTokenVersion:d.delegatorTokenVersion });
export function createDeviceEnrollmentService(store: DeviceManagementStore, enabled: () => boolean) {
  const run = <T>(work:(tx:DeviceManagementTransaction)=>Promise<T>) => {
    if (!enabled()) throw new QuerySourceError("QUERY_DEVICE_PLAYBACK_DISABLED",404);
    return store.transaction(async tx => {
      if (!await tx.schemaReady()) throw new QuerySourceError("QUERY_SOURCE_SCHEMA_REQUIRED",503);
      await tx.securityReady(); await tx.lifecycleReady();
      return work(tx);
    });
  };
  const snapshot = async (tx:DeviceManagementTransaction,id:number) => {
    const state=await tx.readState(id),evidence=await tx.evidence(id),devices=await tx.records(id);
    if (!/^[a-f0-9]{64}$/.test(evidence)) throw new QuerySourceError("SECURITY_SCHEMA_REQUIRED",503);
    return {state,devices,version:deviceManagementVersion(state,evidence,devices)};
  };
  const target = (devices:DeviceRecord[],deviceId:number) => {
    const d=devices.find(d=>d.id===deviceId);
    if (!d || !d.isActive || d.revokedAtUtc!==null || d.archivedAtUtc!==null || d.suspendedAtUtc!==null || d.reenrollmentRequired!==true)
      throw new QuerySourceError("DASHBOARD_DEVICE_UNAUTHORIZED",401);
    const {deviceName,enforceIpRestriction,allowedIp,allowedCidr,expiresAtUtc}=d;
    if (!deviceMetadataSchema.safeParse({deviceName,enforceIpRestriction,allowedIp,allowedCidr,expiresAtUtc}).success)
      throw new QuerySourceError("DASHBOARD_DEVICE_UNAUTHORIZED",401);
    return d;
  };
  const authority = async (tx:DeviceManagementTransaction,state:SourceState,d:DeviceRecord,actor?:DeviceActor) => {
    const dashboard=state.dashboard, keys=["PRIMARY",...state.sources.map(s=>s.sourceKey)];
    if (dashboard.mode!=="QUERY_ONLY" || !dashboard.isActive || !Number.isSafeInteger(dashboard.modeVersion) || dashboard.modeVersion!<1 ||
      dashboard.maxRows===null || dashboard.maxRows<1 || dashboard.maxRows>10000 || state.sources.length>7 ||
      new Set(keys.map(k=>k.toUpperCase())).size!==keys.length || keys.some(k=>!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(k)) ||
      state.sources.some(s=>s.queryDefinitionId===null || s.maxRows===null || s.maxRows<1 || s.maxRows>10000 || !Number.isSafeInteger(s.queryBindingRevision) || s.queryBindingRevision<1) ||
      state.references.some(k=>k!=="PRIMARY" && !state.sources.some(s=>s.sourceKey===k && s.isEnabled)))
      throw new QuerySourceError("QUERY_SOURCE_MODE_NOT_ACTIVATED");
    if (actor) await tx.actor(actor);
    const revision=await tx.credentialOwner(d);
    for (const s of [{queryDefinitionId:dashboard.queryDefinitionId,parameters:dashboardQueryParameters(dashboard.parameters)},...state.sources]) {
      if (s.queryDefinitionId===null) throw new QuerySourceError("QUERY_SOURCE_PENDING_CONVERSION");
      const dataset=await tx.validateQuery(d.createdByUserId,s.queryDefinitionId,s.parameters);
      if (actor) await tx.validateQuery(actor.userId,s.queryDefinitionId,s.parameters);
      await tx.credentialPolicy(dataset);
    }
    return revision;
  };
  const transition = (before:DeviceRecord,after:DeviceRecord,action:"ISSUE"|"ENROLL",time:string,proof?:string) => {
    try { assertDeviceLifecycleTransition(record(before),record(after),action,Date.parse(time),proof); }
    catch { throw new QuerySourceError("DASHBOARD_DEVICE_UNAUTHORIZED",401); }
  };
  return {
    issue: (id:number,deviceId:number,actor:DeviceActor,input:{expectedVersion:string;confirmed:true}) => run(async tx=>{
      await tx.actor(actor);
      const current=await snapshot(tx,id);
      if (input.confirmed!==true) throw new QuerySourceError("VALIDATION_ERROR",400);
      if (input.expectedVersion!==current.version) throw new QuerySourceError("DASHBOARD_DEVICE_VERSION_CONFLICT");
      const device=target(current.devices,deviceId),revision=await authority(tx,current.state,device,actor);
      const token=randomBytes(32).toString("base64url"),hash=digest(token);
      const time=await tx.writeCredential(id,deviceId,"ISSUE",hash,current.state.dashboard.modeVersion!,revision);
      const after=await snapshot(tx,id),updated=after.devices.find(d=>d.id===deviceId)!;
      transition(device,updated,"ISSUE",time);
      if (updated.credentialFingerprint!==digest(hash) || updated.queryModeGrantVersion!==current.state.dashboard.modeVersion || updated.delegatorTokenVersion!==revision) throw new QuerySourceError("DASHBOARD_DEVICE_UNAUTHORIZED",401);
      if (await authority(tx,after.state,updated,actor)!==revision) throw new QuerySourceError("DASHBOARD_DEVICE_UNAUTHORIZED",401);
      await tx.touch(id); await tx.deviceAudit(id,actor,"TOKEN_ISSUED_PENDING",deviceId,true);
      // The transaction wrapper commits before this one-time plaintext can reach HTTP.
      return {dashboardId:id,deviceId,version:(await snapshot(tx,id)).version,token,credentialIssued:true,reenrollmentRequired:true};
    }),
    enroll: (id:number,deviceId:number,token:string,context:{ipAddress?:string|null;userAgent?:string|null}) => run(async tx=>{
      if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new QuerySourceError("DASHBOARD_DEVICE_UNAUTHORIZED",401);
      const current=await snapshot(tx,id),device=target(current.devices,deviceId),hash=digest(token),proof=digest(hash);
      if (!/^[a-f0-9]{64}$/.test(device.credentialFingerprint) || !timingSafeEqual(Buffer.from(proof,"hex"),Buffer.from(device.credentialFingerprint,"hex")))
        throw new QuerySourceError("DASHBOARD_DEVICE_UNAUTHORIZED",401);
      const ip=normalizeClientIp(context.ipAddress??"");
      if (!ip || device.enforceIpRestriction && !matchesIpRestriction(ip,device.allowedIp,device.allowedCidr))
        throw new QuerySourceError("DASHBOARD_DEVICE_UNAUTHORIZED",401);
      const revision=await authority(tx,current.state,device);
      if (device.queryModeGrantVersion!==current.state.dashboard.modeVersion || device.delegatorTokenVersion!==revision)
        throw new QuerySourceError("DASHBOARD_DEVICE_UNAUTHORIZED",401);
      const time=await tx.writeCredential(id,deviceId,"ENROLL",hash,current.state.dashboard.modeVersion!,revision);
      const after=await snapshot(tx,id),updated=after.devices.find(d=>d.id===deviceId)!;
      transition(device,updated,"ENROLL",time,proof);
      if (await authority(tx,after.state,updated)!==revision) throw new QuerySourceError("DASHBOARD_DEVICE_UNAUTHORIZED",401);
      await tx.touch(id);
      await tx.deviceAudit(id,{userId:device.createdByUserId,tokenVersion:revision,...context},"ENROLLED",deviceId,false);
      // No Dashboard, Query, layout, result rows or execution service is returned/called.
      return {dashboardId:id,deviceId,modeVersion:current.state.dashboard.modeVersion!,expiresAtUtc:updated.expiresAtUtc};
    }),
  };
}
