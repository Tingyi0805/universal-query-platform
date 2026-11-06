import test from "node:test";
import assert from "node:assert/strict";
import {
  createDormantChartTrustWriters, ChartTrustWriteError,
  type ChartTrustWriterDependencies,
} from "./dashboardChartTrust.writer.js";
import type { PublicCountScope } from "./dashboardChartPublicCountPrivacy.js";

const scope: PublicCountScope = {
  dashboardId: 7, queryId: 9, datasetId: 10,
  sourceKey: "PRIMARY", categoryColumn: "ROOM", valueColumn: "TOTAL",
  queryRevision: "a".repeat(16), datasetRevision: "b".repeat(16),
  policyRevision: "c".repeat(64),
};
const config = {
  version: 1, chartType: "BAR", dataSourceKey: "PRIMARY",
  categoryColumn: "ROOM", valueColumn: "TOTAL",
  valueMode: "QUERY_RESULT", maxPoints: 20, showLegend: false,
};
const actor={userId:8,tokenVersion:1};
const id="00000000-0000-4000-8000-000000000001";
function fixture(enabled:boolean){
  let poolCalls=0,authorizations=0,liveReads=0;
  const deps:ChartTrustWriterDependencies={
    enabled:()=>enabled,
    pool:async()=>{poolCalls++;return null;},
    authorize:async()=>{authorizations++;},
    readLiveScope:async()=>{liveReads++;return scope;},
  };
  return {writer:createDormantChartTrustWriters(deps),
    calls:()=>({poolCalls,authorizations,liveReads})};
}
const blocked = (promise:Promise<unknown>,code:string) =>
  assert.rejects(promise,(error:unknown)=>
    error instanceof ChartTrustWriteError && error.code===code);

test("all dormant writer operations stop at feature gate before any SQL or authority",async()=>{
  const f=fixture(false);
  await blocked(f.writer.sealWidget({
    dashboardId:7,widgetId:88,actor,requestId:id,
    expectedRevision:"a".repeat(16),config,
  }),"CHART_WRITE_DISABLED");
  await blocked(f.writer.requestReview({scope,actor,requestId:id}),"CHART_WRITE_DISABLED");
  await blocked(f.writer.approveReview({
    dashboardId:7,id:123,expectedRevision:"a".repeat(16),actor,requestId:id,
    minimumCellCount:5,validDays:30,
    categoryPrivacyReviewed:true,differencingRiskReviewed:true,
  }),"CHART_WRITE_DISABLED");
  await blocked(f.writer.revokeReview({
    dashboardId:7,id:123,expectedRevision:"a".repeat(16),actor,requestId:id,
  }),"CHART_WRITE_DISABLED");
  assert.deepEqual(f.calls(),{poolCalls:0,authorizations:0,liveReads:0});
});
test("invalid request ID, missing CAS and untrusted review scope fail before touching SQL",async()=>{
  const f=fixture(true);
  await blocked(f.writer.sealWidget({
    dashboardId:7,widgetId:88,actor,requestId:"invalid",
    expectedRevision:"a".repeat(16),config,
  }),"CHART_WRITE_INPUT_INVALID");
  await blocked(f.writer.sealWidget({
    dashboardId:7,widgetId:88,actor,requestId:id,
    expectedRevision:"stale",config,
  }),"CHART_SEAL_INPUT_INVALID");
  await blocked(f.writer.requestReview({
    scope:{...scope,sourceKey:"PRIMARY;DROP"},actor,requestId:id,
  }),"CHART_REVIEW_INPUT_INVALID");
  await blocked(f.writer.approveReview({
    dashboardId:7,id:123,expectedRevision:"a".repeat(16),actor,requestId:id,
    minimumCellCount:1,validDays:30,
    categoryPrivacyReviewed:true,differencingRiskReviewed:true,
  }),"CHART_REVIEW_INPUT_INVALID");
  assert.deepEqual(f.calls(),{poolCalls:0,authorizations:0,liveReads:0});
});
test("enabled writers without a configured pool never issue success",async()=>{
  const f=fixture(true);
  await blocked(f.writer.requestReview({scope,actor,requestId:id}),"CHART_WRITE_UNAVAILABLE");
  assert.deepEqual(f.calls(),{poolCalls:1,authorizations:0,liveReads:0});
});

test("2B-11 refuses review decision without a valid parent lock hint",async()=>{
  const f=fixture(true);
  await blocked(f.writer.revokeReview({
    dashboardId:0,id:123,expectedRevision:"a".repeat(16),actor,requestId:id,
  }),"CHART_REVIEW_INPUT_INVALID");
  await blocked(f.writer.approveReview({
    dashboardId:0,id:123,expectedRevision:"a".repeat(16),actor,requestId:id,
    minimumCellCount:5,validDays:30,
    categoryPrivacyReviewed:true,differencingRiskReviewed:true,
  }),"CHART_REVIEW_INPUT_INVALID");
  assert.deepEqual(f.calls(),{poolCalls:0,authorizations:0,liveReads:0});
});
