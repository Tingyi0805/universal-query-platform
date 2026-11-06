// 2B-15D-8: synthetic three-ORIGINAL_LOGIN-SID identity checks, no SQL connection.
import test from "node:test";
import assert from "node:assert/strict";
import type sql from "mssql";
import {
 chartIssuerIdentitySql,CHART_ISSUER_APPROVED_PROCEDURE_SHA256,
 ChartIssuerBoundaryError,attestChartIssuerSqlPrincipals,
 attestChartIssuerSqlPools,
} from "./dashboardChartIssuerBoundary.js";

const digest="a".repeat(64);
const base={
 DbName:"UQP_TEST",ServerName:"CI_SQL",OriginalSid:"AA",EffectiveUser:"platform",
 IssuerProcedureId:123,IssuerProcedureSha256:digest,
 Sysadmin:0,ServerControl:0,ServerImpersonateAny:0,ServerAlterLogins:0,
 ServerAlterRoles:0,ServerSelectAllUserData:0,
 DbOwner:0,DbDdlAdmin:0,DbSecurityAdmin:0,DbDataWriter:0,
 DbDataReader:0,DbAccessAdmin:0,DbControl:0,DbAlterAnyUser:0,
 DbAlterAnyRole:0,DbAlterAnySchema:0,SchemaControl:0,SchemaAlter:0,
 ImpersonateIssuer:0,IssueAlter:0,
 GrantSelect:0,GrantInsert:0,GrantUpdate:0,GrantDelete:0,
 IssueExecute:0,CreateExecute:0,ConsumeExecute:0,
};
const platform=()=>({...base});
const issuer=()=>({...base,OriginalSid:"BB",EffectiveUser:"issuer",IssueExecute:1});
const writer=()=>({...base,OriginalSid:"CC",EffectiveUser:"writer",CreateExecute:1});
const check=(p:Record<string,unknown>,i:Record<string,unknown>,w:Record<string,unknown>)=>
 attestChartIssuerSqlPrincipals(p,i,w,digest);
const rejects=(code:string,action:()=>unknown)=>
 assert.throws(action,(e:unknown)=>e instanceof ChartIssuerBoundaryError&&e.code===code);

test("2B-15D-8 three distinct SQL ORIGINAL_LOGIN identities are required",()=>{
 assert.match(chartIssuerIdentitySql,/ORIGINAL_LOGIN\(\)/);
 assert.match(chartIssuerIdentitySql,/SUSER_SID/);
 assert.match(chartIssuerIdentitySql,/sys\.sql_modules/);
 assert.match(chartIssuerIdentitySql,/HASHBYTES\('SHA2_256'/);
 assert.match(chartIssuerIdentitySql,/HAS_PERMS_BY_NAME/);
 assert.match(chartIssuerIdentitySql,/^SELECT\s/);
 assert.doesNotMatch(chartIssuerIdentitySql,/\b(?:INSERT INTO|UPDATE uqp\.|DELETE FROM|GRANT EXECUTE)\b/i);
 assert.equal(CHART_ISSUER_APPROVED_PROCEDURE_SHA256,null);
 assert.doesNotThrow(()=>check(platform(),issuer(),writer()));
 for(const oldSid of ["AA","CC"])
  rejects("CHART_ISSUER_LOGINS_NOT_ISOLATED",()=>
    check(platform(),{...issuer(),OriginalSid:oldSid},writer()));
 rejects("CHART_ISSUER_LOGINS_NOT_ISOLATED",()=>
   check(platform(),issuer(),{...writer(),OriginalSid:"AA"}));
 // EXECUTE AS USER can change EffectiveUser, not ORIGINAL_LOGIN SID.
 rejects("CHART_ISSUER_LOGINS_NOT_ISOLATED",()=>
   check(platform(),{...issuer(),OriginalSid:"AA",EffectiveUser:"issuer"},writer()));
 rejects("CHART_ISSUER_TARGET_MISMATCH",()=>
   check(platform(),{...issuer(),DbName:"OTHER"},writer()));
 rejects("CHART_ISSUER_TARGET_MISMATCH",()=>
   check(platform(),issuer(),{...writer(),ServerName:"OTHER"}));
 rejects("CHART_ISSUER_IDENTITY_UNAVAILABLE",()=>
   check(platform(),{...issuer(),OriginalSid:null},writer()));
});

test("2B-15D-8 explicit independently approved issuer-procedure hash is mandatory",()=>{
 rejects("CHART_ISSUER_RELEASE_NOT_APPROVED",()=>
   attestChartIssuerSqlPrincipals(platform(),issuer(),writer()));
 rejects("CHART_ISSUER_RELEASE_NOT_APPROVED",()=>
   attestChartIssuerSqlPrincipals(platform(),issuer(),writer(),"not-reviewed"));
 rejects("CHART_ISSUER_PROCEDURE_UNAVAILABLE",()=>
   check(platform(),{...issuer(),IssuerProcedureId:null},writer()));
 rejects("CHART_ISSUER_PROCEDURE_HASH_MISMATCH",()=>
   check(platform(),{...issuer(),IssuerProcedureSha256:"b".repeat(64)},writer()));
});

test("2B-15D-8 broad SQL grants, DML, impersonation and cross-execute fail closed",()=>{
 const forbidden=[
  "Sysadmin","ServerControl","ServerImpersonateAny","ServerAlterLogins",
  "ServerAlterRoles","ServerSelectAllUserData",
  "DbOwner","DbDdlAdmin","DbSecurityAdmin","DbDataWriter",
  "DbDataReader","DbAccessAdmin","DbControl","DbAlterAnyUser",
  "DbAlterAnyRole","DbAlterAnySchema","SchemaControl","SchemaAlter",
  "ImpersonateIssuer","IssueAlter","GrantSelect","GrantInsert",
  "GrantUpdate","GrantDelete",
 ];
 for(const key of forbidden){
  rejects("CHART_PLATFORM_ISSUER_PRIVILEGE_EXCESS",()=>
    check({...platform(),[key]:1},issuer(),writer()));
  rejects("CHART_ISSUER_ISSUER_PRIVILEGE_EXCESS",()=>
    check(platform(),{...issuer(),[key]:1},writer()));
  rejects("CHART_WRITER_ISSUER_PRIVILEGE_EXCESS",()=>
    check(platform(),issuer(),{...writer(),[key]:null}));
 }
 rejects("CHART_ISSUER_EXECUTE_EXPOSED",()=>
   check({...platform(),IssueExecute:1},issuer(),writer()));
 rejects("CHART_ISSUER_EXECUTE_EXPOSED",()=>
   check(platform(),issuer(),{...writer(),IssueExecute:1}));
 rejects("CHART_ISSUER_EXECUTE_MISSING",()=>
   check(platform(),{...issuer(),IssueExecute:0},writer()));
 rejects("CHART_ISSUER_CROSS_EXECUTE_EXPOSED",()=>
   check(platform(),{...issuer(),CreateExecute:1},writer()));
 rejects("CHART_ISSUER_CROSS_EXECUTE_EXPOSED",()=>
   check(platform(),{...issuer(),ConsumeExecute:1},writer()));
 rejects("CHART_ISSUER_CONSUME_EXPOSED",()=>
   check({...platform(),ConsumeExecute:1},issuer(),writer()));
 rejects("CHART_ISSUER_CONSUME_EXPOSED",()=>
   check(platform(),issuer(),{...writer(),ConsumeExecute:1}));
 // Platform's legacy Widget CRUD is outside this Issuer grant contract.
 assert.doesNotThrow(()=>check(platform(),issuer(),writer()));
});

test("2B-15D-8 pools are independent; unapproved release never executes SQL",async()=>{
 let queries=0;
 const pool=(row:unknown)=>({
  request:()=>({query:async(q:string)=>{
   assert.equal(q,chartIssuerIdentitySql);queries++;
   return {recordset:row===null?[]:[row]};
  }}),
 }) as unknown as sql.ConnectionPool;
 const p=pool(platform()),i=pool(issuer()),w=pool(writer());
 await assert.rejects(attestChartIssuerSqlPools(p,i,w),(e:unknown)=>
   e instanceof ChartIssuerBoundaryError&&e.code==="CHART_ISSUER_RELEASE_NOT_APPROVED");
 assert.equal(queries,0);
 await assert.doesNotReject(attestChartIssuerSqlPools(p,i,w,digest));
 assert.equal(queries,3);
 await assert.rejects(attestChartIssuerSqlPools(p,p,w,digest),(e:unknown)=>
   e instanceof ChartIssuerBoundaryError&&e.code==="CHART_ISSUER_POOL_NOT_ISOLATED");
 await assert.rejects(attestChartIssuerSqlPools(p,i,i,digest),(e:unknown)=>
   e instanceof ChartIssuerBoundaryError&&e.code==="CHART_ISSUER_POOL_NOT_ISOLATED");
 assert.equal(queries,3);
 await assert.rejects(attestChartIssuerSqlPools(p,pool(null),w,digest),(e:unknown)=>
   e instanceof ChartIssuerBoundaryError&&e.code==="CHART_ISSUER_IDENTITY_UNAVAILABLE");
 await assert.rejects(attestChartIssuerSqlPools(
  {request:()=>{throw Error("DATABASE_UNAVAILABLE");}} as unknown as sql.ConnectionPool,i,w,digest),
  (e:unknown)=>e instanceof ChartIssuerBoundaryError&&
    e.code==="CHART_ISSUER_IDENTITY_UNAVAILABLE");
});
