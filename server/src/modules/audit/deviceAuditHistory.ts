import sql from "mssql";
import { z } from "zod";
import { QuerySourceError } from "../dashboard/dashboardQuerySources.service.js";
export const deviceAuditEvents = ["CREATED","METADATA_UPDATED","PLACEMENT_UPDATED","RENEWED","SUSPENDED","RESTORED_PENDING","TOKEN_ISSUED_PENDING","ENROLLED","REVOKED","ARCHIVED"].map(x=>`DASHBOARD_DEVICE_${x}`);
export const deviceHistoryErrorCodes = ["VALIDATION_ERROR","FORBIDDEN","INVALID_TOKEN","TOKEN_REVOKED","DASHBOARD_DEVICE_VERSION_CONFLICT","DASHBOARD_DEVICE_NOT_EDITABLE","DASHBOARD_DEVICE_NOT_FOUND","DASHBOARD_DEVICE_LIFECYCLE_SCHEMA_REQUIRED","DASHBOARD_DEVICE_AUDIT_REQUIRED","QUERY_DEVICE_DELEGATION_INVALID","QUERY_SOURCE_QUERY_FORBIDDEN","QUERY_SOURCE_PUBLIC_POLICY_REQUIRED"];
export function taipeiAuditDay(value:string,end=false):Date {
  if(!/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)||Number(value.slice(0,4))>9998)throw new Error("INVALID_DATE");
  const civil=Date.parse(`${value}T00:00:00.000Z`);
  if(!Number.isFinite(civil)||new Date(civil).toISOString().slice(0,10)!==value)throw new Error("INVALID_DATE");
  const target=civil+(end?86400000:0),wanted=new Date(target).toISOString().slice(0,10);
  const fmt=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit"});
  const localDay=(seconds:number)=>{const p=Object.fromEntries(fmt.formatToParts(new Date(seconds*1000)).map(p=>[p.type,p.value]));return `${p.year!.padStart(4,"0")}-${p.month}-${p.day}`;};
  // First real instant of the civil day, including historical midnight DST jumps.
  let low=target/1000-36*3600,high=target/1000+36*3600;
  while(low<high){const mid=Math.floor((low+high)/2);if(localDay(mid)<wanted)low=mid+1;else high=mid;}
  if(localDay(low)===wanted)return new Date(low*1000);

  throw new Error("INVALID_DATE");
}
const day=z.string().refine(v=>{try{taipeiAuditDay(v);return true;}catch{return false;}});
export const deviceHistoryQuery=z.object({
 source:z.enum(["LIVE","ARCHIVE"]).default("LIVE"),eventType:z.string().refine(v=>deviceAuditEvents.includes(v)).optional(),
 startDate:day.optional(),endDate:day.optional(),username:z.string().trim().max(100).regex(/^[^\u0000-\u001f\u007f]*$/).default(""),
 page:z.string().regex(/^[1-9]\d{0,5}$/).default("1").transform(Number),pageSize:z.enum(["10","20","50","100"]).default("20").transform(Number),
}).strict().refine(q=>(q.page-1)*q.pageSize<=1_000_000&&(!q.startDate||!q.endDate||q.startDate<=q.endDate));
export type DeviceHistoryQuery=z.infer<typeof deviceHistoryQuery>;
export type DeviceHistoryItem={id:string;createdAtUtc:string;eventType:string;username:string|null;displayName:string|null;status:"SUCCESS"|"FAILED"|"STARTED";errorCode:string|null};
export type DeviceHistoryResult={dashboardId:number;deviceId:number;source:"LIVE"|"ARCHIVE";items:DeviceHistoryItem[];total:number;page:number;pageSize:number};
const literals=(values:string[])=>values.map(v=>`N'${v}'`).join(","); // Compile-time allowlists only, never request values.
export function deviceHistorySql(source:"LIVE"|"ARCHIVE") {
 if(!["LIVE","ARCHIVE"].includes(source))throw new QuerySourceError("VALIDATION_ERROR",400);
 const archive=source==="ARCHIVE";
 return `
 IF OBJECT_ID('uqp.AuditLog','U') IS NULL OR OBJECT_ID('uqp.AuditLogArchive','U') IS NULL
 OR COL_LENGTH('uqp.AuditLog','ParametersJson') IS NULL OR COL_LENGTH('uqp.AuditLogArchive','ParametersJson') IS NULL
 OR (SELECT compatibility_level FROM sys.databases WHERE name=DB_NAME())<130
 THROW 51033,'DEVICE_HISTORY_SCHEMA_REQUIRED',1;
 IF NOT EXISTS(SELECT 1 FROM uqp.DashboardDisplayDevice WITH(HOLDLOCK) WHERE DashboardId=@dashboardId AND Id=@deviceId)
 THROW 51032,'DASHBOARD_DEVICE_NOT_FOUND',1;
 SELECT a.Id,a.CreatedAtUtc,a.EventType,a.Status,${archive?"a.Username,a.DisplayName":"u.Username,u.DisplayName"},
 CASE WHEN a.ErrorCode IN (${literals(deviceHistoryErrorCodes)}) THEN a.ErrorCode ELSE NULL END AS ErrorCode
 INTO #DeviceHistory
 FROM uqp.${archive?"AuditLogArchive":"AuditLog"} a WITH(HOLDLOCK)
 ${archive?"":"LEFT JOIN uqp.AppUser u WITH(HOLDLOCK) ON u.Id=a.UserId"}
 CROSS APPLY(SELECT
 COUNT(CASE WHEN j.[key] COLLATE Latin1_General_100_BIN2=N'dashboardId' AND DATALENGTH(j.[key])=22 THEN 1 END) AS DashboardKeys,
 COUNT(CASE WHEN j.[key] COLLATE Latin1_General_100_BIN2=N'deviceId' AND DATALENGTH(j.[key])=16 THEN 1 END) AS DeviceKeys,
 MAX(CASE WHEN j.[key] COLLATE Latin1_General_100_BIN2=N'dashboardId' AND DATALENGTH(j.[key])=22 AND j.type=2 THEN j.value END) AS DashboardValue,
 MAX(CASE WHEN j.[key] COLLATE Latin1_General_100_BIN2=N'deviceId' AND DATALENGTH(j.[key])=16 AND j.type=2 THEN j.value END) AS DeviceValue
 FROM OPENJSON(CASE WHEN ISJSON(a.ParametersJson)=1 THEN a.ParametersJson ELSE N'{}' END) j) scope
 WHERE scope.DashboardKeys=1 AND scope.DeviceKeys=1
 AND scope.DashboardValue COLLATE Latin1_General_100_BIN2=CONVERT(nvarchar(20),@dashboardId)
 AND scope.DeviceValue COLLATE Latin1_General_100_BIN2=CONVERT(nvarchar(20),@deviceId)
 AND a.EventType IN (${literals(deviceAuditEvents)})
 AND (@eventType IS NULL OR a.EventType=@eventType)
 AND (@startUtc IS NULL OR a.CreatedAtUtc>=@startUtc)
 AND (@endUtc IS NULL OR a.CreatedAtUtc<@endUtc)
 AND (@username=N'' OR ${archive?"a":"u"}.Username LIKE @usernamePattern ESCAPE N'\\');
 SELECT COUNT_BIG(*) AS Total FROM #DeviceHistory;
 SELECT CONVERT(varchar(20),Id) AS Id,CreatedAtUtc,EventType,Status,Username,DisplayName,ErrorCode FROM #DeviceHistory
 ORDER BY CreatedAtUtc DESC,Id DESC OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY;
 DROP TABLE #DeviceHistory;`;
}
export async function readDeviceAuditHistory(request:sql.Request,id:number,deviceId:number,q:DeviceHistoryQuery):Promise<DeviceHistoryResult>{
 const pattern=`%${q.username.replace(/[\\%_\[\]]/g,c=>`\\${c}`)}%`;
 const result=await request.input("dashboardId",sql.BigInt,id).input("deviceId",sql.BigInt,deviceId)
 .input("eventType",sql.NVarChar(50),q.eventType??null).input("startUtc",sql.DateTime2(0),q.startDate?taipeiAuditDay(q.startDate):null)
 .input("endUtc",sql.DateTime2(0),q.endDate?taipeiAuditDay(q.endDate,true):null).input("username",sql.NVarChar(100),q.username)
 .input("usernamePattern",sql.NVarChar(202),pattern).input("offset",sql.Int,(q.page-1)*q.pageSize).input("pageSize",sql.Int,q.pageSize).query(deviceHistorySql(q.source));
 const sets=result.recordsets as sql.IRecordSet<Record<string,unknown>>[];
 if(!sets[0]?.[0]||!sets[1])throw new QuerySourceError("DEVICE_HISTORY_UNAVAILABLE",503);
 const items=sets[1].map(row=>{
  if(!deviceAuditEvents.includes(String(row.EventType))||!["SUCCESS","FAILED","STARTED"].includes(String(row.Status))||!/^[1-9]\d{0,18}$/.test(String(row.Id)))throw new QuerySourceError("DEVICE_HISTORY_UNAVAILABLE",503);
  return ({id:String(row.Id),createdAtUtc:new Date(row.CreatedAtUtc as Date).toISOString(),eventType:String(row.EventType),username:row.Username==null?null:String(row.Username),displayName:row.DisplayName==null?null:String(row.DisplayName),status:String(row.Status) as DeviceHistoryItem["status"],errorCode:deviceHistoryErrorCodes.includes(String(row.ErrorCode))?String(row.ErrorCode):null});});
 return {dashboardId:id,deviceId,source:q.source,items,total:Number(sets[0][0].Total),page:q.page,pageSize:q.pageSize};
}
