// 2B-15C: read-only preflight for an independently provisioned CHART SQL login.
// Does NOT create pools, read env secrets, register a route, enable CHART or DML.
import sql from "mssql";
export const chartWriterIdentitySql = [
  "SELECT DB_NAME() AS DbName,CONVERT(nvarchar(256),@@SERVERNAME) AS ServerName,",
  "CONVERT(varchar(256),SUSER_SID(ORIGINAL_LOGIN()),2) AS OriginalSid,",
  "USER_NAME() AS EffectiveUser,",
  "OBJECT_ID(N'uqp.usp_DashboardChartCreate',N'P') AS ProcedureId,",
  "LOWER(CONVERT(varchar(64),HASHBYTES('SHA2_256',CONVERT(varbinary(max),",
  "(SELECT m.definition FROM sys.sql_modules m",
  "WHERE m.object_id=OBJECT_ID(N'uqp.usp_DashboardChartCreate',N'P')))),2)) AS ProcedureSha256,",
  "IS_SRVROLEMEMBER(N'sysadmin') AS Sysadmin,",
  "IS_MEMBER(N'db_owner') AS DbOwner,",
  "IS_MEMBER(N'db_ddladmin') AS DbDdlAdmin,",
  "IS_MEMBER(N'db_securityadmin') AS DbSecurityAdmin,",
  "IS_MEMBER(N'db_datawriter') AS DbDataWriter,",
  "HAS_PERMS_BY_NAME(DB_NAME(),N'DATABASE',N'CONTROL') AS DbControl,",
  "HAS_PERMS_BY_NAME(N'uqp',N'SCHEMA',N'CONTROL') AS SchemaControl,",
  "HAS_PERMS_BY_NAME(N'uqp',N'SCHEMA',N'ALTER') AS SchemaAlter,",
  "HAS_PERMS_BY_NAME(N'UQP_Chart_Writer',N'USER',N'IMPERSONATE') AS ImpersonateWriter,",
  "HAS_PERMS_BY_NAME(N'uqp.usp_DashboardChartCreate',N'OBJECT',N'EXECUTE') AS CreateExecute,",
  "HAS_PERMS_BY_NAME(N'uqp.usp_DashboardChartCreate',N'OBJECT',N'ALTER') AS CreateAlter,",
  "HAS_PERMS_BY_NAME(N'uqp.DashboardChartCreatePermit',N'OBJECT',N'INSERT') AS PermitInsert,",
  "HAS_PERMS_BY_NAME(N'uqp.DashboardChartWidgetSeal',N'OBJECT',N'INSERT') AS SealInsert,",
  "HAS_PERMS_BY_NAME(N'uqp.DashboardChartTrustRequest',N'OBJECT',N'INSERT') AS LedgerInsert,",
  "HAS_PERMS_BY_NAME(N'uqp.DashboardChartPrivacyReview',N'OBJECT',N'UPDATE') AS ReviewUpdate",
].join(" ");

// Intentionally unapproved until a reviewed SQL procedure definition is
// pinned in a new release. Never accept this from browser/body/env headers.
export const CHART_WRITER_APPROVED_PROCEDURE_SHA256: string|null=null;
export type ChartIdentityRow = Readonly<Record<string,unknown>>;
export class ChartWriterBoundaryError extends Error {
  constructor(readonly code:string){super(code);this.name="ChartWriterBoundaryError";}
}
const block=(code:string):never=>{throw new ChartWriterBoundaryError(code);};
const str=(v:unknown):v is string=>typeof v==="string"&&v.length>0;
const forbidden=["Sysadmin","DbOwner","DbDdlAdmin","DbSecurityAdmin",
  "DbDataWriter","DbControl","SchemaControl","SchemaAlter","ImpersonateWriter",
  "CreateAlter","PermitInsert","SealInsert","LedgerInsert","ReviewUpdate"] as const;

/** Do NOT deny existing platform Widget DML: the LEGACY layout needs that.
 * The 928 freeze and separate procedure execute permission enforce CHART.
 * Null metadata (including absent principal, missing module) is not 0.
 */
export function attestChartWriterSqlPrincipals(
 platform:ChartIdentityRow,writer:ChartIdentityRow,
 expectedSha256:string|null=CHART_WRITER_APPROVED_PROCEDURE_SHA256,
):void {
 if(typeof expectedSha256!=="string"||!/^[a-f0-9]{64}$/.test(expectedSha256))
   return block("CHART_WRITER_RELEASE_NOT_APPROVED");
 if(!platform||!writer||!str(platform.DbName)||!str(writer.DbName)||
   !str(platform.ServerName)||!str(writer.ServerName)||
   !str(platform.OriginalSid)||!str(writer.OriginalSid)||
   !str(platform.EffectiveUser)||!str(writer.EffectiveUser))
    return block("CHART_WRITER_IDENTITY_UNAVAILABLE");
 if(platform.DbName!==writer.DbName||platform.ServerName!==writer.ServerName)
    return block("CHART_WRITER_TARGET_MISMATCH");
 if(platform.OriginalSid===writer.OriginalSid)
    return block("CHART_WRITER_LOGIN_NOT_ISOLATED");
 if(typeof platform.ProcedureId!=="number"||platform.ProcedureId<=0||
   platform.ProcedureId!==writer.ProcedureId)
    return block("CHART_WRITER_PROCEDURE_NOT_ATTESTED");
 if(platform.ProcedureSha256!==expectedSha256||
    writer.ProcedureSha256!==expectedSha256)
    return block("CHART_WRITER_PROCEDURE_HASH_MISMATCH");
 for(const [role,row] of [["PLATFORM",platform],["WRITER",writer]] as const)
   for(const field of forbidden)
     if(row[field]!==0)return block("CHART_"+role+"_PRIVILEGE_EXCESS");
 if(platform.CreateExecute!==0)return block("CHART_PLATFORM_EXECUTE_EXPOSED");
 if(writer.CreateExecute!==1)return block("CHART_WRITER_EXECUTE_MISSING");
}
/** Explicitly provisioned independent pools only; never accepts credentials. */
export async function attestChartWriterSqlPools(
 platform:sql.ConnectionPool,writer:sql.ConnectionPool,
 expectedSha256:string|null=CHART_WRITER_APPROVED_PROCEDURE_SHA256,
):Promise<void> {
 if(typeof expectedSha256!=="string"||!/^[a-f0-9]{64}$/.test(expectedSha256))
   return block("CHART_WRITER_RELEASE_NOT_APPROVED");
 if(!platform||!writer||platform===writer)
   return block("CHART_WRITER_POOL_NOT_ISOLATED");
 try{
   const [a,b]=await Promise.all([
     platform.request().query(chartWriterIdentitySql),
     writer.request().query(chartWriterIdentitySql),
   ]);
   if(a.recordset?.length!==1||b.recordset?.length!==1)
      return block("CHART_WRITER_IDENTITY_UNAVAILABLE");
   attestChartWriterSqlPrincipals(a.recordset[0],b.recordset[0],expectedSha256);
 }catch(e){
   if(e instanceof ChartWriterBoundaryError)throw e;
   return block("CHART_WRITER_IDENTITY_UNAVAILABLE");
 }
}
