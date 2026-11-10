// 2B-15D-8: DORMANT read-only attestation for an independently provisioned
// Chart Actor-delegation SIGNED ISSUER SQL login. No connection config, secrets,
// route, GRANT, issuer procedure, runtime activation or production DML.
import type sql from "mssql";

// The executable production Issuer does not exist and has not been reviewed.
// A test-supplied digest can exercise the pure attestation predicate, but
// NEVER constitutes production release approval.
export const CHART_ISSUER_APPROVED_PROCEDURE_SHA256:string|null=null;

export const chartIssuerIdentitySql=[
 "SELECT DB_NAME() AS DbName,CONVERT(nvarchar(256),@@SERVERNAME) AS ServerName,",
 "CONVERT(varchar(256),SUSER_SID(ORIGINAL_LOGIN()),2) AS OriginalSid,",
 "USER_NAME() AS EffectiveUser,",
 "OBJECT_ID(N'uqp.usp_ChartDelegationIssueSigned',N'P') AS IssuerProcedureId,",
 "LOWER(CONVERT(varchar(64),HASHBYTES('SHA2_256',CONVERT(varbinary(max),",
 "(SELECT m.definition FROM sys.sql_modules m",
 "WHERE m.object_id=OBJECT_ID(N'uqp.usp_ChartDelegationIssueSigned',N'P')))),2)) AS IssuerProcedureSha256,",
 "IS_SRVROLEMEMBER(N'sysadmin') AS Sysadmin,",
 "HAS_PERMS_BY_NAME(NULL,NULL,N'CONTROL SERVER') AS ServerControl,",
 "HAS_PERMS_BY_NAME(NULL,NULL,N'IMPERSONATE ANY LOGIN') AS ServerImpersonateAny,",
 "HAS_PERMS_BY_NAME(NULL,NULL,N'ALTER ANY LOGIN') AS ServerAlterLogins,",
 "HAS_PERMS_BY_NAME(NULL,NULL,N'ALTER ANY SERVER ROLE') AS ServerAlterRoles,",
 "HAS_PERMS_BY_NAME(NULL,NULL,N'SELECT ALL USER SECURABLES') AS ServerSelectAllUserData,",
 "IS_MEMBER(N'db_owner') AS DbOwner,",
 "IS_MEMBER(N'db_ddladmin') AS DbDdlAdmin,",
 "IS_MEMBER(N'db_securityadmin') AS DbSecurityAdmin,",
 "IS_MEMBER(N'db_datawriter') AS DbDataWriter,",
 "IS_MEMBER(N'db_datareader') AS DbDataReader,",
 "IS_MEMBER(N'db_accessadmin') AS DbAccessAdmin,",
 "HAS_PERMS_BY_NAME(DB_NAME(),N'DATABASE',N'CONTROL') AS DbControl,",
 "HAS_PERMS_BY_NAME(DB_NAME(),N'DATABASE',N'ALTER ANY USER') AS DbAlterAnyUser,",
 "HAS_PERMS_BY_NAME(DB_NAME(),N'DATABASE',N'ALTER ANY ROLE') AS DbAlterAnyRole,",
 "HAS_PERMS_BY_NAME(DB_NAME(),N'DATABASE',N'ALTER ANY SCHEMA') AS DbAlterAnySchema,",
 "HAS_PERMS_BY_NAME(N'uqp',N'SCHEMA',N'CONTROL') AS SchemaControl,",
 "HAS_PERMS_BY_NAME(N'uqp',N'SCHEMA',N'ALTER') AS SchemaAlter,",
 "HAS_PERMS_BY_NAME(N'UQP_Chart_Issuer',N'USER',N'IMPERSONATE') AS ImpersonateIssuer,",
 "HAS_PERMS_BY_NAME(N'uqp.usp_ChartDelegationIssueSigned',N'OBJECT',N'EXECUTE') AS IssueExecute,",
 "HAS_PERMS_BY_NAME(N'uqp.usp_ChartDelegationIssueSigned',N'OBJECT',N'ALTER') AS IssueAlter,",
 "HAS_PERMS_BY_NAME(N'uqp.usp_DashboardChartCreate',N'OBJECT',N'EXECUTE') AS CreateExecute,",
 "HAS_PERMS_BY_NAME(N'uqp.usp_ChartDelegationConsume',N'OBJECT',N'EXECUTE') AS ConsumeExecute,",
 "HAS_PERMS_BY_NAME(N'uqp.ChartActorDelegation',N'OBJECT',N'SELECT') AS GrantSelect,",
 "HAS_PERMS_BY_NAME(N'uqp.ChartActorDelegation',N'OBJECT',N'INSERT') AS GrantInsert,",
 "HAS_PERMS_BY_NAME(N'uqp.ChartActorDelegation',N'OBJECT',N'UPDATE') AS GrantUpdate,",
 "HAS_PERMS_BY_NAME(N'uqp.ChartActorDelegation',N'OBJECT',N'DELETE') AS GrantDelete",
].join(" ");

export type ChartIssuerIdentityRow=Readonly<Record<string,unknown>>;
export class ChartIssuerBoundaryError extends Error {
 constructor(readonly code:string){super(code);this.name="ChartIssuerBoundaryError";}
}
const fail=(code:string):never=>{throw new ChartIssuerBoundaryError(code);};
const nonempty=(x:unknown):x is string=>typeof x==="string"&&x.length>0;
const privileged=[
 "Sysadmin","ServerControl","ServerImpersonateAny","ServerAlterLogins",
 "ServerAlterRoles","ServerSelectAllUserData",
 "DbOwner","DbDdlAdmin","DbSecurityAdmin",
 "DbDataWriter","DbDataReader","DbAccessAdmin","DbControl","DbAlterAnyUser",
 "DbAlterAnyRole","DbAlterAnySchema","SchemaControl","SchemaAlter",
 "ImpersonateIssuer",
 "IssueAlter","GrantSelect","GrantInsert","GrantUpdate","GrantDelete",
] as const;

/** Pure metadata predicate. An authenticated request, valid JWT, or successful
 * predicate does NOT prove who issued @ActorId. True production authorization
 * still needs an independently authenticated issuer and a DB-owned
 * same-transaction grant consumption with Widget/Seal/Audit/RequestLedger.
 */
export function attestChartIssuerSqlPrincipals(
 platform:ChartIssuerIdentityRow,issuer:ChartIssuerIdentityRow,
 writer:ChartIssuerIdentityRow,
 expectedDigest:string|null=CHART_ISSUER_APPROVED_PROCEDURE_SHA256,
):void {
 if(typeof expectedDigest!=="string"||!/^[a-f0-9]{64}$/.test(expectedDigest))
   return fail("CHART_ISSUER_RELEASE_NOT_APPROVED");
 const roles=[platform,issuer,writer];
 for(const row of roles)
   if(!row||!nonempty(row.DbName)||!nonempty(row.ServerName)||
      !nonempty(row.OriginalSid)||!nonempty(row.EffectiveUser))
     return fail("CHART_ISSUER_IDENTITY_UNAVAILABLE");
 if(platform.DbName!==issuer.DbName||platform.DbName!==writer.DbName||
    platform.ServerName!==issuer.ServerName||
    platform.ServerName!==writer.ServerName)
   return fail("CHART_ISSUER_TARGET_MISMATCH");
 if(new Set(roles.map(row=>row.OriginalSid)).size!==3)
   return fail("CHART_ISSUER_LOGINS_NOT_ISOLATED");
 if(typeof issuer.IssuerProcedureId!=="number"||
    !Number.isSafeInteger(issuer.IssuerProcedureId)||
    issuer.IssuerProcedureId<=0)
   return fail("CHART_ISSUER_PROCEDURE_UNAVAILABLE");
 if(issuer.IssuerProcedureSha256!==expectedDigest)
   return fail("CHART_ISSUER_PROCEDURE_HASH_MISMATCH");
 for(const [name,row] of [
   ["PLATFORM",platform],["ISSUER",issuer],["WRITER",writer],
 ] as const)
   for(const field of privileged)
     if(row[field]!==0)
       return fail("CHART_"+name+"_ISSUER_PRIVILEGE_EXCESS");
 if(platform.IssueExecute!==0||writer.IssueExecute!==0)
   return fail("CHART_ISSUER_EXECUTE_EXPOSED");
 if(issuer.IssueExecute!==1)
   return fail("CHART_ISSUER_EXECUTE_MISSING");
 if(issuer.CreateExecute!==0||issuer.ConsumeExecute!==0)
   return fail("CHART_ISSUER_CROSS_EXECUTE_EXPOSED");
 // Writer's ability to invoke a *separate* consumption procedure is not
 // approved here. No normal login may invoke a standalone consume endpoint;
 // the final approved Chart Writer must own its own grant consume transaction.
 if(platform.ConsumeExecute!==0||writer.ConsumeExecute!==0)
   return fail("CHART_ISSUER_CONSUME_EXPOSED");
}

/** Metadata checks only. Three distinct provided pools; no fallback or
 * connection creation. A failure is always fail-closed and never logs secrets.
 */
export async function attestChartIssuerSqlPools(
 platform:sql.ConnectionPool,issuer:sql.ConnectionPool,writer:sql.ConnectionPool,
 expectedDigest:string|null=CHART_ISSUER_APPROVED_PROCEDURE_SHA256,
):Promise<void> {
 if(typeof expectedDigest!=="string"||!/^[a-f0-9]{64}$/.test(expectedDigest))
   return fail("CHART_ISSUER_RELEASE_NOT_APPROVED");
 if(!platform||!issuer||!writer||
    platform===issuer||platform===writer||issuer===writer)
   return fail("CHART_ISSUER_POOL_NOT_ISOLATED");
 try {
   const results=await Promise.all([
     platform.request().query(chartIssuerIdentitySql),
     issuer.request().query(chartIssuerIdentitySql),
     writer.request().query(chartIssuerIdentitySql),
   ]);
   if(results.some(r=>r.recordset?.length!==1))
     return fail("CHART_ISSUER_IDENTITY_UNAVAILABLE");
   attestChartIssuerSqlPrincipals(
     results[0]!.recordset[0]!,results[1]!.recordset[0]!,
     results[2]!.recordset[0]!,expectedDigest);
 }catch(e){
   if(e instanceof ChartIssuerBoundaryError)throw e;
   return fail("CHART_ISSUER_IDENTITY_UNAVAILABLE");
 }
}
