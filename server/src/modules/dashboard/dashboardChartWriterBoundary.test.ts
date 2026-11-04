import test from "node:test";
import assert from "node:assert/strict";
import type sql from "mssql";
import {attestChartWriterSqlPrincipals,attestChartWriterSqlPools,
 chartWriterIdentitySql,ChartWriterBoundaryError} from "./dashboardChartWriterBoundary.js";

const base={
 DbName:"UQP_TEST",ServerName:"SQL_TEST",OriginalSid:"A1",EffectiveUser:"platform",
 ProcedureId:101,Sysadmin:0,DbOwner:0,DbDdlAdmin:0,DbSecurityAdmin:0,
 DbDataWriter:0,DbControl:0,SchemaControl:0,SchemaAlter:0,
 ImpersonateWriter:0,CreateExecute:0,CreateAlter:0,
 PermitInsert:0,SealInsert:0,LedgerInsert:0,ReviewUpdate:0,
};
const platform=()=>({...base});
const writer=()=>({...base,OriginalSid:"B2",EffectiveUser:"writer",CreateExecute:1});
const rejects=(code:string,fn:()=>unknown)=>assert.throws(fn,
 (e:unknown)=>e instanceof ChartWriterBoundaryError&&e.code===code);

test("2B-15C independent OriginalLogin SID, not EXECUTE AS USER, is required",()=>{
 assert.match(chartWriterIdentitySql,/ORIGINAL_LOGIN\(\)/);
 assert.match(chartWriterIdentitySql,/SUSER_SID/);
 assert.doesNotMatch(chartWriterIdentitySql,/\b(?:GRANT|CREATE LOGIN|ALTER ROLE|INSERT INTO)\b/i);
 assert.doesNotThrow(()=>attestChartWriterSqlPrincipals(platform(),writer()));
 rejects("CHART_WRITER_LOGIN_NOT_ISOLATED",()=>attestChartWriterSqlPrincipals(
   platform(),{...writer(),OriginalSid:"A1"}));
 rejects("CHART_WRITER_TARGET_MISMATCH",()=>attestChartWriterSqlPrincipals(
   platform(),{...writer(),DbName:"OTHER"}));
 rejects("CHART_WRITER_TARGET_MISMATCH",()=>attestChartWriterSqlPrincipals(
   platform(),{...writer(),ServerName:"OTHER"}));
 rejects("CHART_WRITER_PROCEDURE_NOT_ATTESTED",()=>attestChartWriterSqlPrincipals(
   platform(),{...writer(),ProcedureId:null}));
});
test("2B-15C broad roles, SQL DML sidecars, impersonation fail closed",()=>{
 for(const key of ["Sysadmin","DbOwner","DbDdlAdmin","DbSecurityAdmin",
 "DbDataWriter","DbControl","SchemaControl","SchemaAlter","ImpersonateWriter",
 "CreateAlter","PermitInsert","SealInsert","LedgerInsert","ReviewUpdate"]){
   rejects("CHART_PLATFORM_PRIVILEGE_EXCESS",()=>attestChartWriterSqlPrincipals(
     {...platform(),[key]:1},writer()));
   rejects("CHART_WRITER_PRIVILEGE_EXCESS",()=>attestChartWriterSqlPrincipals(
     platform(),{...writer(),[key]:1}));
   rejects("CHART_WRITER_PRIVILEGE_EXCESS",()=>attestChartWriterSqlPrincipals(
     platform(),{...writer(),[key]:null}));
 }
 rejects("CHART_PLATFORM_EXECUTE_EXPOSED",()=>attestChartWriterSqlPrincipals(
   {...platform(),CreateExecute:1},writer()));
 rejects("CHART_WRITER_EXECUTE_MISSING",()=>attestChartWriterSqlPrincipals(
   platform(),{...writer(),CreateExecute:0}));
 rejects("CHART_WRITER_IDENTITY_UNAVAILABLE",()=>attestChartWriterSqlPrincipals(
   {...platform(),OriginalSid:null},writer()));
});
test("2B-15C independently supplied SQL pools; no connection creation",async()=>{
 const pool=(row:unknown)=>({request:()=>({query:async(q:string)=>{
   assert.equal(q,chartWriterIdentitySql);
   return {recordset:row===null?[]:[row]};
 }})}) as unknown as sql.ConnectionPool;
 const p=pool(platform()),w=pool(writer());
 await assert.doesNotReject(attestChartWriterSqlPools(p,w));
 await assert.rejects(attestChartWriterSqlPools(p,p),(e:unknown)=>
   e instanceof ChartWriterBoundaryError&&e.code==="CHART_WRITER_POOL_NOT_ISOLATED");
 await assert.rejects(attestChartWriterSqlPools(pool(null),w),(e:unknown)=>
   e instanceof ChartWriterBoundaryError&&e.code==="CHART_WRITER_IDENTITY_UNAVAILABLE");
 await assert.rejects(attestChartWriterSqlPools(
   {request:()=>{throw Error("DB_FAIL")}} as unknown as sql.ConnectionPool,w),
   (e:unknown)=>e instanceof ChartWriterBoundaryError&&e.code==="CHART_WRITER_IDENTITY_UNAVAILABLE");
});
