import sql from "mssql";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { QuerySourceError } from "./dashboardQuerySources.service.js";
import type { DeviceActor, DeviceManagementStore } from "./dashboardDeviceManagement.service.js";

export const deviceListQuery = z.object({
  search: z.string().trim().max(200).regex(/^[^\u0000-\u001f\u007f]*$/).default(""),
  status: z.enum(["ALL","ACTIVE","SUSPENDED","PENDING_REENROLLMENT","REVOKED","ARCHIVED","EXPIRED","UNVERIFIED"]).default("ALL"),
  page: z.string().regex(/^[1-9]\d{0,5}$/).default("1").transform(Number),
  pageSize: z.enum(["10","20","50","100"]).default("20").transform(Number),
  snapshot: z.string().max(500).optional(),
}).strict().refine(q => (q.page-1)*q.pageSize <= 1_000_000 && (q.page===1 || !!q.snapshot));
export type DeviceListQuery = z.infer<typeof deviceListQuery>;
export type ListRead = { digest: string; nowUtc: string; nextExpiryUtc: string | null; total: number; items: Record<string, unknown>[] };
export const deviceListStateSql = `CASE
 WHEN ArchivedAtUtc IS NOT NULL THEN 'ARCHIVED'
 WHEN RevokedAtUtc IS NOT NULL THEN 'REVOKED'
 WHEN ExpiresAtUtc<=@asOf THEN 'EXPIRED'
 WHEN SuspendedAtUtc IS NOT NULL THEN 'SUSPENDED'
 WHEN ReenrollmentRequired=1 THEN 'PENDING_REENROLLMENT'
 ELSE 'UNVERIFIED' END`;
// SQL owns selection, count and pagination. No private row set leaves SQL Server.
export const deviceListSql = `
DECLARE @now datetime2(3)=SYSUTCDATETIME();
IF @asOf IS NULL SET @asOf=@now;
SELECT Id,DashboardId,DeviceName,CreatedByUserId,SharedWorkstationId,IsActive,
 ExpiresAtUtc,RevokedAtUtc,ArchivedAtUtc,SuspendedAtUtc,ReenrollmentRequired,
 EnforceIpRestriction,AllowedIp,AllowedCidr,TokenHash,QueryModeGrantVersion,DelegatorTokenVersion
INTO #DeviceList FROM uqp.DashboardDisplayDevice WITH(HOLDLOCK)
WHERE DashboardId=@dashboardId;
IF EXISTS(SELECT 1 FROM #DeviceList WHERE Id<1 OR Id>9007199254740991
 OR CreatedByUserId<1 OR CreatedByUserId>9007199254740991
 OR SharedWorkstationId>9007199254740991 OR SharedWorkstationId<1
 OR TokenHash IS NULL OR LEN(TokenHash)<>64 OR TokenHash COLLATE Latin1_General_100_BIN2 LIKE '%[^a-fA-F0-9]%'
 OR NOT ((QueryModeGrantVersion IS NULL AND DelegatorTokenVersion IS NULL)
 OR (QueryModeGrantVersion>0 AND DelegatorTokenVersion>0 AND QueryModeGrantVersion<=9007199254740991 AND DelegatorTokenVersion<=9007199254740991))
 OR (QueryModeGrantVersion IS NULL AND DelegatorTokenVersion IS NOT NULL)
 OR (QueryModeGrantVersion IS NOT NULL AND DelegatorTokenVersion IS NULL)
 OR ((RevokedAtUtc IS NOT NULL OR ArchivedAtUtc IS NOT NULL) AND IsActive=1)
 OR (SuspendedAtUtc IS NOT NULL AND (IsActive=1 OR RevokedAtUtc IS NOT NULL OR ArchivedAtUtc IS NOT NULL OR ReenrollmentRequired IS NULL OR ReenrollmentRequired<>1 OR QueryModeGrantVersion IS NOT NULL OR DelegatorTokenVersion IS NOT NULL))
 OR (ReenrollmentRequired IS NOT NULL AND (RevokedAtUtc IS NOT NULL OR ArchivedAtUtc IS NOT NULL OR (IsActive=0 AND SuspendedAtUtc IS NULL))))
 THROW 51031,'DASHBOARD_DEVICE_STATE_INVALID',1;
DECLARE @content nvarchar(max)=(SELECT * FROM #DeviceList ORDER BY Id FOR JSON PATH, INCLUDE_NULL_VALUES);
DECLARE @digest varchar(64)=CONVERT(varchar(64),HASHBYTES('SHA2_256',@content),2);
SELECT *, ${deviceListStateSql} AS LifecycleState INTO #FilteredDevices FROM #DeviceList
WHERE (@search=N'' OR DeviceName LIKE @pattern ESCAPE N'\\' OR Id=@exactId);
SELECT @digest AS Digest,@now AS NowUtc,@asOf AS AsOfUtc,
 (SELECT MIN(ExpiresAtUtc) FROM #DeviceList WHERE ExpiresAtUtc>@asOf AND RevokedAtUtc IS NULL AND ArchivedAtUtc IS NULL) AS NextExpiryUtc,
 (SELECT COUNT_BIG(*) FROM #FilteredDevices WHERE @status='ALL' OR LifecycleState=@status) AS Total;
SELECT Id,DashboardId,DeviceName,CreatedByUserId,SharedWorkstationId,IsActive,
 ExpiresAtUtc,RevokedAtUtc,ArchivedAtUtc,SuspendedAtUtc,ReenrollmentRequired,
 EnforceIpRestriction,AllowedIp,AllowedCidr,LifecycleState
FROM #FilteredDevices WHERE @status='ALL' OR LifecycleState=@status
ORDER BY Id ASC OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY;
DROP TABLE #FilteredDevices; DROP TABLE #DeviceList;`;
export async function readDeviceList(request: sql.Request, id: number, q: DeviceListQuery, asOf: string | null): Promise<ListRead & { asOfUtc: string }> {
  const exact = /^[1-9]\d{0,15}$/.test(q.search) && Number.isSafeInteger(Number(q.search)) ? Number(q.search) : null;
  const pattern = `%${q.search.replace(/[\\%_\[\]]/g, c=>`\\${c}`)}%`;
  const result = await request.input("dashboardId",sql.BigInt,id).input("search",sql.NVarChar(200),q.search)
    .input("pattern",sql.NVarChar(402),pattern).input("exactId",sql.BigInt,exact)
    .input("status",sql.VarChar(30),q.status).input("asOf",sql.DateTime2(3),asOf?new Date(asOf):null)
    .input("offset",sql.Int,(q.page-1)*q.pageSize).input("limit",sql.Int,q.pageSize).query(deviceListSql);
  const sets=result.recordsets as sql.IRecordSet<Record<string,unknown>>[];
  const meta=sets[0]?.[0];
  if(!meta || !sets[1])throw new QuerySourceError("QUERY_SOURCE_STORAGE_UNAVAILABLE",503);
  const date=(v:unknown)=>new Date(v as Date).toISOString();
  return {digest:String(meta.Digest),nowUtc:date(meta.NowUtc),asOfUtc:date(meta.AsOfUtc),nextExpiryUtc:meta.NextExpiryUtc?date(meta.NextExpiryUtc):null,total:Number(meta.Total),items:sets[1]};
}
const key=randomBytes(32); // Per-process, fail-closed on restart/another instance. Not a playback credential.
const conflict=()=>new QuerySourceError("DASHBOARD_DEVICE_LIST_CHANGED",409);
export function createDeviceListReader(store: DeviceManagementStore, enabled: ()=>boolean) {
  return async (id:number,actor:DeviceActor,input:unknown) => {
    const parsed=deviceListQuery.safeParse(input);
    if (!parsed.success) throw new QuerySourceError("VALIDATION_ERROR",400);
    if (!enabled()) throw new QuerySourceError("QUERY_SOURCE_MANAGEMENT_DISABLED",404);
    const q=parsed.data;
    let previous: {asOfUtc:string;validUntilUtc:string;signature:string}|null=null;
    if(q.snapshot){try{
      previous=z.object({asOfUtc:z.string().datetime(),validUntilUtc:z.string().datetime(),signature:z.string().regex(/^[a-f0-9]{64}$/)}).strict().parse(JSON.parse(Buffer.from(q.snapshot,"base64url").toString()));
    }catch{throw conflict();}}
    return store.transaction(async tx=>{
      if(!await tx.schemaReady())throw new QuerySourceError("QUERY_SOURCE_SCHEMA_REQUIRED",503);
      await tx.securityReady();await tx.actor(actor,true);await tx.lifecycleReady();
      const state=await tx.readState(id); // Retain Dashboard -> Device lock order and existence check; no patient execution.
      if(!["LEGACY","QUERY_ONLY","QUERY_ONLY_DISABLED"].includes(state.dashboard.mode??""))throw new QuerySourceError("QUERY_MODE_INVALID",503);
      if(!tx.listDevices)throw new QuerySourceError("QUERY_SOURCE_STORAGE_UNAVAILABLE",503);
      const data=await tx.listDevices(id,q,previous?.asOfUtc??null);
      const asOfUtc=previous?.asOfUtc??data.asOfUtc;
      const validUntilUtc=previous?.validUntilUtc??new Date(Math.min(Date.parse(asOfUtc)+300000,data.nextExpiryUtc?Date.parse(data.nextExpiryUtc):Infinity)).toISOString();
      const signature=createHmac("sha256",key).update(JSON.stringify([id,actor.userId,actor.tokenVersion,q.search,q.status,q.pageSize,asOfUtc,validUntilUtc,data.digest])).digest("hex");
      if(previous && (!timingSafeEqual(Buffer.from(signature),Buffer.from(previous.signature)) || Date.parse(data.nowUtc)>=Date.parse(validUntilUtc) || Date.parse(asOfUtc)>Date.parse(data.nowUtc)))throw conflict();
      const date=(v:unknown)=>v==null?null:new Date(v as Date).toISOString();
      const items=data.items.map(d=>({id:Number(d.Id),dashboardId:id,deviceName:String(d.DeviceName),createdByUserId:Number(d.CreatedByUserId),sharedWorkstationId:d.SharedWorkstationId==null?null:Number(d.SharedWorkstationId),isActive:Boolean(d.IsActive),status:String(d.LifecycleState),expiresAtUtc:date(d.ExpiresAtUtc),revokedAtUtc:date(d.RevokedAtUtc),archivedAtUtc:date(d.ArchivedAtUtc),suspendedAtUtc:date(d.SuspendedAtUtc),reenrollmentRequired:d.ReenrollmentRequired??null,enforceIpRestriction:Boolean(d.EnforceIpRestriction),allowedIp:d.AllowedIp??null,allowedCidr:d.AllowedCidr??null}));
      return {items,total:data.total,page:q.page,pageSize:q.pageSize,asOfUtc,validUntilUtc,sort:"ID_ASC" as const,snapshot:Buffer.from(JSON.stringify({asOfUtc,validUntilUtc,signature})).toString("base64url"),consistency:"CONTENT_CHECKED_UNTIL_EXPIRY" as const,writeVersionIncluded:false};
    });
  };
}
