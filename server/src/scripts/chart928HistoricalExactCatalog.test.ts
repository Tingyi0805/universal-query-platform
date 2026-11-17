import {test} from "node:test";
import assert from "node:assert/strict";
import type sql from "mssql";
import {deviceLifecycleSchemaSql} from "../modules/dashboard/dashboardDeviceLifecycleSchema.js";
import {workstationPinSchemaSql} from "../modules/auth/workstationPinSchema.js";
import {verifyChartHistoricalExactCatalog} from "./chart928HistoricalExactCatalog.js";
import type {ChartHistoricalFootprint} from "./chart928HistoricalFootprint.js";

const present=(schema:926|927):ChartHistoricalFootprint=>({
  schema,status:"PRESENT_REQUIRES_EXACT_ATTESTATION",
  ledger:"RECORDED_NOT_ATTESTED",consistency:"COHERENT_NOT_ATTESTED",
  exactAttested:false,
});
const absent=(schema:926|927):ChartHistoricalFootprint=>({
  schema,status:"ABSENT",ledger:"NOT_RECORDED",
  consistency:"COHERENT_NOT_ATTESTED",exactAttested:false,
});
function fixture(
  fail:string[]=[],
){
  const statements:string[]=[];
  const pool={request:()=>({query:async(text:string)=>{
    statements.push(text);
    if(fail.includes(text))throw Error("SYNTHETIC_METADATA_MISMATCH");
    return {recordset:[]};
  }})} as unknown as sql.ConnectionPool;
  return {pool,statements};
}
test("926/927 exact catalog validators reuse reviewed SQL, no 928 authorization",async()=>{
  const f=fixture();
  const r=await verifyChartHistoricalExactCatalog(f.pool,{
    schema926:present(926),schema927:present(927),
  });
  assert.deepEqual(f.statements,[deviceLifecycleSchemaSql,workstationPinSchemaSql]);
  assert.deepEqual(r,{
    schema926:"EXACT_REVIEWED_CATALOG_MATCH",
    schema927:"EXACT_REVIEWED_CATALOG_MATCH",approves928:false,
  });
  assert.equal(Object.isFrozen(r),true);
});
test("absent/partial catalog is skipped with no SQL queries",async()=>{
  const f=fixture();
  const partial:ChartHistoricalFootprint={
    ...absent(927),status:"PARTIAL_OR_CONFLICT",
    consistency:"BLOCKED_PARTIAL_OR_INVISIBLE",
  };
  const r=await verifyChartHistoricalExactCatalog(f.pool,{
    schema926:absent(926),schema927:partial,
  });
  assert.deepEqual(f.statements,[]);
  assert.deepEqual(r,{
    schema926:"NOT_RUN_FOOTPRINT_INCOMPLETE",
    schema927:"NOT_RUN_FOOTPRINT_INCOMPLETE",approves928:false,
  });
});
test("each exact validator fails closed independently and never auto-repairs",async()=>{
  for(const fail of [
    [deviceLifecycleSchemaSql],
    [workstationPinSchemaSql],
    [deviceLifecycleSchemaSql,workstationPinSchemaSql],
  ]){
    const f=fixture(fail);
    const r=await verifyChartHistoricalExactCatalog(f.pool,{
      schema926:present(926),schema927:present(927),
    });
    assert.equal(r.schema926,fail.includes(deviceLifecycleSchemaSql)?
      "BLOCKED_CATALOG_MISMATCH_OR_INVISIBLE":"EXACT_REVIEWED_CATALOG_MATCH");
    assert.equal(r.schema927,fail.includes(workstationPinSchemaSql)?
      "BLOCKED_CATALOG_MISMATCH_OR_INVISIBLE":"EXACT_REVIEWED_CATALOG_MATCH");
    assert.equal(r.approves928,false);
  }
});
test("927 verifier modifies only transient table variables; 926 verifier is metadata-only",()=>{
  const withoutLiteral=(s:string)=>s.replace(/N?'(?:''|[^'])*'/g,"''")
    .replace(/--[^\n]*/g,"");
  assert.doesNotMatch(withoutLiteral(deviceLifecycleSchemaSql),
    /\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|MERGE|EXEC|GRANT|DENY|TRUNCATE)\b/i);
  assert.doesNotMatch(withoutLiteral(workstationPinSchemaSql),
    /\b(?:UPDATE|DELETE|ALTER|CREATE|DROP|MERGE|EXEC|GRANT|DENY|TRUNCATE)\b/i);
  assert.match(workstationPinSchemaSql,/INSERT INTO @columns VALUES/);
  assert.doesNotMatch(withoutLiteral(workstationPinSchemaSql),
    /\bINSERT\s+INTO\s+(?!@)[a-z\[\]\.]+/i);
});
