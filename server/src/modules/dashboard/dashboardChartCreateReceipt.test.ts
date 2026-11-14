import test from "node:test";
import assert from "node:assert/strict";
import {planDormantChartCreate} from "./dashboardChartAtomicCreate.contract.js";
import {parseChartCreateSqlReceipt} from "./dashboardChartCreateReceipt.js";

const plan=planDormantChartCreate({
  dashboardId:7,profileId:22,actorId:8,tokenVersion:3,
  requestId:"00000000-0000-4000-8000-000000000011",
  config:{version:1,chartType:"BAR",dataSourceKey:"PRIMARY",
    categoryColumn:"ROOM",valueColumn:"TOTAL",valueMode:"QUERY_RESULT",
    maxPoints:20,showLegend:true},
  placement:{x:80,y:80,width:600,height:360},
});
assert(plan);
const row={WidgetId:"88",AuditLogId:"9007199254740993",
  Digest:plan.config.sha256,SealRevision:"0011223344556677"};
test("SQL Writer receipt preserves real seal rowversion and full audit BIGINT",()=>{
  const receipt={widgetId:88,sealRevision:"0011223344556677",auditLogId:"9007199254740993"};
  assert.deepEqual(parseChartCreateSqlReceipt(row,plan),receipt);
  assert.deepEqual(parseChartCreateSqlReceipt({...row,WidgetId:88},plan),receipt);
  assert.deepEqual(parseChartCreateSqlReceipt({...row,WidgetId:88n},plan),receipt);
  assert.equal(parseChartCreateSqlReceipt({...row,AuditLogId:"9223372036854775807"},plan)?.auditLogId,"9223372036854775807");
});
test("SQL Writer receipt rejects forged, rounded, mismatched and oversized fields",()=>{
  for(const delta of [
    {WidgetId:"9007199254740993"},{WidgetId:9007199254740993},
    {WidgetId:"0"},{WidgetId:"001"},{WidgetId:-1},
    {AuditLogId:9007199254740993},{AuditLogId:"0"},
    {AuditLogId:"9223372036854775808"},{AuditLogId:"01"},
    {Digest:"0".repeat(64)},{Digest:plan.config.sha256.toUpperCase()},
    {SealRevision:"FF".repeat(8)},{SealRevision:"0".repeat(15)},
    {sql:"PATIENT_ID"},{token:"PRIVATE_TOKEN"},
  ])assert.equal(parseChartCreateSqlReceipt({...row,...delta},plan),null);
  for(const bad of [null,{},[row]])assert.equal(parseChartCreateSqlReceipt(bad,plan),null);
});
test("digest cannot hide modified canonical config or source scope",()=>{
  assert.equal(parseChartCreateSqlReceipt(row,{...plan,config:{...plan.config,json:plan.config.json+" "}}),null);
  assert.equal(parseChartCreateSqlReceipt(row,{...plan,config:{...plan.config,sha256:"a".repeat(64)}}),null);
  assert.equal(parseChartCreateSqlReceipt(row,{...plan,sourceKey:"WARD"}),null);
});
