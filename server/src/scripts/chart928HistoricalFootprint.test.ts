import test from "node:test";
import assert from "node:assert/strict";
import {
 chartHistoricalFootprintSql,chartHistoricalLedgerSql,
 parseChartHistoricalFootprints,
} from "./chart928HistoricalFootprint.js";
const cases=[
 {SchemaNumber:"926",Assessment:"PRESENT_REQUIRES_EXACT_ATTESTATION"},
 {SchemaNumber:"927",Assessment:"ABSENT"},
];
test("926/927 probe is static read-only metadata, never health or approval",()=>{
 const sql=chartHistoricalFootprintSql+"\n"+chartHistoricalLedgerSql;
 assert.match(chartHistoricalFootprintSql,/sys\.check_constraints/);
 assert.match(chartHistoricalFootprintSql,/sys\.triggers/);
 assert.match(chartHistoricalLedgerSql,/uqp\.SchemaMigration/);
 assert.match(chartHistoricalFootprintSql,/HAS_PERMS_BY_NAME/);
 assert.match(chartHistoricalFootprintSql,/is_not_trusted=0/);
 assert.match(chartHistoricalFootprintSql,/is_disabled=0/);
 assert.match(chartHistoricalFootprintSql,/is_primary_key=1/);
 assert.doesNotMatch(sql,/\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|MERGE|EXEC|GRANT|DENY|TRUNCATE)\b/i);
 assert.doesNotMatch(sql,/PATIENT|PINHASH|TOKENHASH|CHART_CAN_ENABLE|APPROVED/i);
});
test("provenance is *never* exact attestation even when both objects and ledger exist",()=>{
 const result=parseChartHistoricalFootprints(cases,[
   {FileName:"926_dashboard_device_lifecycle.sql"},
   {FileName:"927_workstation_pin_runtime.sql"},
 ]);
 assert.deepEqual(result.schema926,{
   schema:926,status:"PRESENT_REQUIRES_EXACT_ATTESTATION",
   ledger:"RECORDED_NOT_ATTESTED",
   consistency:"COHERENT_NOT_ATTESTED",exactAttested:false,
 });
 assert.deepEqual(result.schema927,{
   schema:927,status:"ABSENT",ledger:"RECORDED_NOT_ATTESTED",
   consistency:"BLOCKED_LEDGER_CATALOG_CONFLICT",exactAttested:false,
 });
 assert(Object.isFrozen(result));
});
test("independently distinguishes absent/missing ledger, partial and invisible baseline",()=>{
 for(const [status926,status927] of [
   ["ABSENT","ABSENT"],
   ["PARTIAL_OR_CONFLICT","ABSENT"],
   ["BLOCKED_BASELINE_MISSING_OR_INVISIBLE","PARTIAL_OR_CONFLICT"],
 ] as const){
   const r=parseChartHistoricalFootprints([
     {SchemaNumber:"926",Assessment:status926},
     {SchemaNumber:"927",Assessment:status927},
   ],[]);
   assert.equal(r.schema926.status,status926);
   assert.equal(r.schema927.status,status927);
   assert.equal(r.schema926.ledger,"NOT_RECORDED");
   assert.equal(r.schema927.ledger,"NOT_RECORDED");
   assert.equal(r.schema926.consistency,status926==="ABSENT"
     ?"COHERENT_NOT_ATTESTED":"BLOCKED_PARTIAL_OR_INVISIBLE");
   assert.equal(r.schema927.consistency,status927==="ABSENT"
     ?"COHERENT_NOT_ATTESTED":"BLOCKED_PARTIAL_OR_INVISIBLE");
   assert.equal(r.schema926.exactAttested,false);
   assert.equal(r.schema927.exactAttested,false);
 }
});
test("malformed, duplicate, invented or inconsistent responses always block",()=>{
 for(const value of [
   [],[cases[0]],
   [...cases,cases[0]],
   [cases[0],{SchemaNumber:"928",Assessment:"ABSENT"}],
   [cases[0],{SchemaNumber:"927",Assessment:"EXACT_MATCH"}],
   [cases[0],{SchemaNumber:"927",Assessment:true}],
   [cases[0],null],
 ] as unknown[])assert.throws(()=>parseChartHistoricalFootprints(value,[]));
 for(const ledger of [
   [{FileName:"928_unapproved.sql"}],
   [{FileName:"926_dashboard_device_lifecycle.sql"},
    {FileName:"926_dashboard_device_lifecycle.sql"}],
   [{}],null,
 ])assert.throws(()=>parseChartHistoricalFootprints(cases,ledger));
});

test("a present catalog without a ledger entry remains an explicit contradiction",()=>{
  const result=parseChartHistoricalFootprints([
    {SchemaNumber:"926",Assessment:"PRESENT_REQUIRES_EXACT_ATTESTATION"},
    {SchemaNumber:"927",Assessment:"PRESENT_REQUIRES_EXACT_ATTESTATION"},
  ],[]);
  for(const foot of [result.schema926,result.schema927]){
    assert.equal(foot.consistency,"BLOCKED_LEDGER_CATALOG_CONFLICT");
    assert.equal(foot.exactAttested,false);
  }
});
test("both present and recorded is coherent evidence only, never exact attestation",()=>{
  const result=parseChartHistoricalFootprints([
    {SchemaNumber:"926",Assessment:"PRESENT_REQUIRES_EXACT_ATTESTATION"},
    {SchemaNumber:"927",Assessment:"PRESENT_REQUIRES_EXACT_ATTESTATION"},
  ],[
    {FileName:"926_dashboard_device_lifecycle.sql"},
    {FileName:"927_workstation_pin_runtime.sql"},
  ]);
  assert.equal(result.schema926.consistency,"COHERENT_NOT_ATTESTED");
  assert.equal(result.schema927.consistency,"COHERENT_NOT_ATTESTED");
  assert.equal(result.schema926.exactAttested,false);
  assert.equal(result.schema927.exactAttested,false);
});
