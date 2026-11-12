import test from "node:test";
import assert from "node:assert/strict";
import type sql from "mssql";
import {chartWriterSqlConfig,getChartWriterDbPool,closeChartWriterDbPool} from "../../config/chartWriterDatabase.js";
import {CHART_ATOMIC_CREATE_RUNTIME_ENABLED} from "./dashboardChartAtomicCreate.contract.js";
import {
 CHART_WRITER_APPROVED_PROCEDURE_SHA256,CHART_WRITER_DB_ACTOR_BINDING_APPROVED,
} from "./dashboardChartWriterBoundary.js";
import {attestChartWriterSqlPrincipals,attestChartWriterSqlPools,
 chartWriterIdentitySql,ChartWriterBoundaryError} from "./dashboardChartWriterBoundary.js";

const EXPECTED_SHA="f".repeat(64);
const approvedSids={platform:"A1",writer:"B2"};
const base={
 DbName:"UQP_TEST",ServerName:"SQL_TEST",OriginalSid:"A1",EffectiveUser:"platform",
 ProcedureId:101,ProcedureSha256:EXPECTED_SHA,
 Sysadmin:0,ServerControl:0,ServerImpersonateAny:0,ServerAlterLogins:0,
 ServerAlterRoles:0,ServerSelectAllUserData:0,
 DbOwner:0,DbDdlAdmin:0,DbSecurityAdmin:0,DbDataWriter:0,DbDataReader:0,DbAccessAdmin:0,
 DbAlterAnyUser:0,DbAlterAnyRole:0,DbAlterAnySchema:0,
 DbControl:0,SchemaControl:0,SchemaAlter:0,
 ImpersonateWriter:0,CreateExecute:0,CreateAlter:0,
 PermitInsert:0,SealInsert:0,LedgerInsert:0,ReviewUpdate:0,
 WidgetInsert:0,WidgetUpdate:0,WidgetDelete:0,
};
const platform=()=>({...base});
const writer=()=>({...base,OriginalSid:"B2",EffectiveUser:"writer",CreateExecute:1});
const rejects=(code:string,fn:()=>unknown)=>assert.throws(fn,
 (e:unknown)=>e instanceof ChartWriterBoundaryError&&e.code===code);
const attest=(p:Record<string,unknown>,w:Record<string,unknown>)=>
  attestChartWriterSqlPrincipals(p,w,EXPECTED_SHA);

test("2B-15C independent OriginalLogin SID, not EXECUTE AS USER, is required",()=>{
 assert.match(chartWriterIdentitySql,/ORIGINAL_LOGIN\(\)/);
 assert.match(chartWriterIdentitySql,/SUSER_SID/);
 assert.doesNotMatch(chartWriterIdentitySql,/\b(?:GRANT|CREATE LOGIN|ALTER ROLE|INSERT INTO)\b/i);
 assert.doesNotThrow(()=>attest(platform(),writer()));
 rejects("CHART_WRITER_LOGIN_NOT_ISOLATED",()=>attest(
   platform(),{...writer(),OriginalSid:"A1"}));
 rejects("CHART_WRITER_TARGET_MISMATCH",()=>attest(
   platform(),{...writer(),DbName:"OTHER"}));
 rejects("CHART_WRITER_TARGET_MISMATCH",()=>attest(
   platform(),{...writer(),ServerName:"OTHER"}));
 rejects("CHART_WRITER_PROCEDURE_NOT_ATTESTED",()=>attest(
   platform(),{...writer(),ProcedureId:null}));
});
test("2B-15C broad roles, SQL DML sidecars, impersonation fail closed",()=>{
 // Check effective permissions, not just the fixed role list. A login with
 // CONTROL SERVER or IMPERSONATE ANY LOGIN need not be in sysadmin.
 for(const name of ["CONTROL SERVER","IMPERSONATE ANY LOGIN",
   "ALTER ANY LOGIN","ALTER ANY SERVER ROLE","SELECT ALL USER SECURABLES"]){
   assert(chartWriterIdentitySql.includes("N'"+name+"'"));
 }
 assert.match(chartWriterIdentitySql,/IS_MEMBER\(N'db_datareader'\) AS DbDataReader/);
 assert(chartWriterIdentitySql.includes("N'ALTER ANY USER'"));
 assert(chartWriterIdentitySql.includes("N'ALTER ANY ROLE'"));
 assert(chartWriterIdentitySql.includes("N'ALTER ANY SCHEMA'"));
 for(const key of ["Sysadmin","ServerControl","ServerImpersonateAny",
 "ServerAlterLogins","ServerAlterRoles","ServerSelectAllUserData",
 "DbOwner","DbDdlAdmin","DbSecurityAdmin","DbDataWriter","DbDataReader","DbAccessAdmin",
 "DbAlterAnyUser","DbAlterAnyRole","DbAlterAnySchema",
 "DbControl","SchemaControl","SchemaAlter","ImpersonateWriter",
 "CreateAlter","PermitInsert","SealInsert","LedgerInsert","ReviewUpdate"]){
   rejects("CHART_PLATFORM_PRIVILEGE_EXCESS",()=>attest(
     {...platform(),[key]:1},writer()));
   rejects("CHART_WRITER_PRIVILEGE_EXCESS",()=>attest(
     platform(),{...writer(),[key]:1}));
   rejects("CHART_WRITER_PRIVILEGE_EXCESS",()=>attest(
     platform(),{...writer(),[key]:null}));
 }
 // Preserve legacy Platform Dashboard layout DML, but the CHART-only
 // Writer login must never be able to write Widget directly.
 assert.doesNotThrow(()=>attest(
   {...platform(),WidgetInsert:1,WidgetUpdate:1,WidgetDelete:1},
   writer()));
 for(const key of ["WidgetInsert","WidgetUpdate","WidgetDelete"]){
  rejects("CHART_WRITER_DIRECT_WIDGET_DML",()=>attest(
    platform(),{...writer(),[key]:1}));
  rejects("CHART_WRITER_DIRECT_WIDGET_DML",()=>attest(
    platform(),{...writer(),[key]:null}));
 }
 rejects("CHART_PLATFORM_EXECUTE_EXPOSED",()=>attest(
   {...platform(),CreateExecute:1},writer()));
 rejects("CHART_WRITER_EXECUTE_MISSING",()=>attest(
   platform(),{...writer(),CreateExecute:0}));
 rejects("CHART_WRITER_IDENTITY_UNAVAILABLE",()=>attest(
   {...platform(),OriginalSid:null},writer()));
});
test("2B-15C independently supplied SQL pools; no connection creation",async()=>{
 const pool=(row:unknown)=>({request:()=>({query:async(q:string)=>{
   assert.equal(q,chartWriterIdentitySql);
   return {recordset:row===null?[]:[row]};
 }})}) as unknown as sql.ConnectionPool;
 const p=pool(platform()),w=pool(writer());
 // No direct SQL inspection without two independently reviewed login SIDs.
 await assert.rejects(attestChartWriterSqlPools(p,w,EXPECTED_SHA),(e:unknown)=>
   e instanceof ChartWriterBoundaryError&&
   e.code==="CHART_WRITER_LOGIN_SID_APPROVAL_REQUIRED");
 for(const invalid of [
   {...approvedSids,writer:"A1"},
   {...approvedSids,writer:"b2"},
   {...approvedSids,platform:""},
 ])await assert.rejects(attestChartWriterSqlPools(p,w,EXPECTED_SHA,invalid),(e:unknown)=>
   e instanceof ChartWriterBoundaryError&&
   e.code==="CHART_WRITER_LOGIN_SID_APPROVAL_REQUIRED");
 await assert.doesNotReject(attestChartWriterSqlPools(p,w,EXPECTED_SHA,approvedSids));
 await assert.rejects(attestChartWriterSqlPools(p,p,EXPECTED_SHA,approvedSids),(e:unknown)=>
   e instanceof ChartWriterBoundaryError&&e.code==="CHART_WRITER_POOL_NOT_ISOLATED");
 await assert.rejects(attestChartWriterSqlPools(pool(null),w,EXPECTED_SHA,approvedSids),(e:unknown)=>
   e instanceof ChartWriterBoundaryError&&e.code==="CHART_WRITER_IDENTITY_UNAVAILABLE");
 await assert.rejects(attestChartWriterSqlPools(
   {request:()=>{throw Error("DB_FAIL")}} as unknown as sql.ConnectionPool,w,EXPECTED_SHA,approvedSids),
   (e:unknown)=>e instanceof ChartWriterBoundaryError&&e.code==="CHART_WRITER_IDENTITY_UNAVAILABLE");
});

test("2B-15C SQL procedure hash requires independently approved release",async()=>{
 assert.match(chartWriterIdentitySql,/sys\.sql_modules/);
 assert.match(chartWriterIdentitySql,/HASHBYTES\('SHA2_256'/);
 rejects("CHART_WRITER_RELEASE_NOT_APPROVED",()=>attestChartWriterSqlPrincipals(platform(),writer()));
 rejects("CHART_WRITER_RELEASE_NOT_APPROVED",()=>attestChartWriterSqlPrincipals(platform(),writer(),"browser-header"));
 rejects("CHART_WRITER_PROCEDURE_HASH_MISMATCH",()=>attest(platform(),{...writer(),ProcedureSha256:"a".repeat(64)}));
 rejects("CHART_WRITER_PROCEDURE_HASH_MISMATCH",()=>attest({...platform(),ProcedureSha256:null},writer()));
 const p={request:()=>{throw Error("SHOULD_NOT_QUERY");}} as unknown as sql.ConnectionPool;
 const w={request:()=>{throw Error("SHOULD_NOT_QUERY");}} as unknown as sql.ConnectionPool;
 await assert.rejects(attestChartWriterSqlPools(p,w),(e:unknown)=>
  e instanceof ChartWriterBoundaryError&&e.code==="CHART_WRITER_RELEASE_NOT_APPROVED");
});

test("2B-15C chart pool rejects reused login and unsafe TLS without connecting",async()=>{
 const valid={
  enabled:true,platformServer:"sql.local",platformPort:1433,
  platformDatabase:"UQP",platformUser:"platform_user",platformPassword:"platform-secret",
  writerServer:"sql.local",writerPort:1433,writerDatabase:"UQP",
  writerUser:"chart_writer",writerPassword:"writer-secret",
  writerEncrypt:true,writerTrustServerCertificate:false,
 };
 const config=chartWriterSqlConfig(valid);
 assert(config);
 assert.equal(config.user,"chart_writer");
 assert.equal(config.options?.encrypt,true);
 assert.equal(config.options?.trustServerCertificate,false);
 for(const change of [
   {enabled:false},{writerServer:"other"},{writerDatabase:"other"},
   {writerPort:1434},{writerUser:"PLATFORM_USER"},
   {writerPassword:"platform-secret"},{writerUser:""},
   {writerPassword:""},{writerEncrypt:false},
   {writerTrustServerCertificate:true},{platformUser:undefined},
 ]){
   assert.equal(chartWriterSqlConfig({...valid,...change}),null);
 }
 assert.equal(CHART_ATOMIC_CREATE_RUNTIME_ENABLED,false);
 assert.equal(CHART_WRITER_APPROVED_PROCEDURE_SHA256,null);
 assert.equal(CHART_WRITER_DB_ACTOR_BINDING_APPROVED,false);
 assert.equal(await getChartWriterDbPool(),null);
 await closeChartWriterDbPool();
});
