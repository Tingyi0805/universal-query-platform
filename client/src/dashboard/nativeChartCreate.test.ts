import test from "node:test";
import assert from "node:assert/strict";
import {newChartDraft} from "./chartDraft.js";
import {
  buildNativeChartCreateBody,parseNativeChartCreateReceipt,
  hasCreatedSealedChartInLayout,confirmsNativeChartSavedReadback,
} from "./nativeChartCreate.js";
const draft=newChartDraft();
const requestId="00000000-0000-4000-8000-000000000111";
const scope={
  dashboardId:7,profileId:22,canvasWidth:1280,canvasHeight:720,
  allowedSources:["PRIMARY"],canCreate:true,
  hasDesignPermission:true,hasExecutePermission:true,
  hasSourceVersion:true,layoutUnmodified:true,profileIdsCurrent:true,
};
test("native Dashboard create POST contains only strict scoped draft fields",()=>{
  const body=buildNativeChartCreateBody(draft,scope,requestId);
  assert.deepEqual(body,{profileId:22,requestId,
    config:draft.config,placement:draft.placement});
  assert.deepEqual(Object.keys(body!).sort(),["config","placement","profileId","requestId"]);
  assert(!JSON.stringify(body).includes("ActorId"));
  assert(!JSON.stringify(body).includes("approved"));
});
test("a disabled gate, unsaved legacy layout or stale profile never sends a chart",()=>{
  for(const changes of [
    {canCreate:false},{hasDesignPermission:false},
    {hasExecutePermission:false},{hasSourceVersion:false},
    {layoutUnmodified:false},{profileIdsCurrent:false},
    {dashboardId:0},{profileId:-1},{canvasWidth:0},
    {allowedSources:[]},
  ])assert.equal(buildNativeChartCreateBody(draft,{...scope,...changes},requestId),null);
  assert.equal(buildNativeChartCreateBody(draft,scope,"browser-generated-fake"),null);
  assert.equal(buildNativeChartCreateBody({...draft,config:{...draft.config,
    dataSourceKey:"UNREVIEWED"}},scope,requestId),null);
  assert.equal(buildNativeChartCreateBody({...draft,placement:{...draft.placement,
    width:5000}},scope,requestId),null);
});
test("only strictly shaped SQL-owned receipt can trigger saved layout readback",()=>{
  const valid={widgetId:88,sealRevision:"0011223344556677",
    auditLogId:"9007199254740993"};
  assert.deepEqual(parseNativeChartCreateReceipt(valid),valid);
  for(const bad of [
    {...valid,sql:"SELECT PATIENT_ID FROM PRIVATE"},
    {...valid,approved:true},{...valid,auditLogId:9007199254740993},
    {...valid,auditLogId:"9223372036854775808"},
    {...valid,sealRevision:"FF".repeat(8)},
    {...valid,widgetId:9007199254740993},
    {...valid,widgetId:0},null,{},[valid],
  ])assert.equal(parseNativeChartCreateReceipt(bad),null);
});
test("readback must contain the chart ID in the same persisted profile and placement",()=>{
  const saved={profiles:[{id:22,widgets:[{
    id:88,profileId:22,widgetType:"CHART",...draft.placement,config:{},
  }]}]};
  assert(hasCreatedSealedChartInLayout(saved,22,88,draft.placement));
  assert.equal(hasCreatedSealedChartInLayout(saved,22,89,draft.placement),false);
  assert.equal(hasCreatedSealedChartInLayout(saved,24,88,draft.placement),false);
  assert.equal(hasCreatedSealedChartInLayout({profiles:[{id:22,widgets:[
    {...saved.profiles[0]!.widgets[0]!,widgetType:"TEXT"},
  ]}]},22,88,draft.placement),false);
  assert.equal(hasCreatedSealedChartInLayout({profiles:[{id:22,widgets:[
    {...saved.profiles[0]!.widgets[0]!,x:90},
  ]}]},22,88,draft.placement),false);
  assert.equal(hasCreatedSealedChartInLayout({profiles:[]},22,88,draft.placement),false);
});

test("persisted CHART seal readback must match the SQL receipt and entire config",()=>{
  const receipt={widgetId:88,sealRevision:"0011223344556677",
    auditLogId:"9007199254740993"};
  const saved={widgetId:88,sealRevision:receipt.sealRevision,config:{...draft.config}};
  assert.equal(confirmsNativeChartSavedReadback(saved,receipt,draft.config),true);
  for(const invalid of [
    {...saved,widgetId:89},
    {...saved,sealRevision:"ffffffffffffffff"},
    {...saved,config:{...draft.config,categoryColumn:"WRONG_COLUMN"}},
    {...saved,config:{...draft.config,rows:[{PATIENT_ID:"PRIVATE"}]}},
    {...saved,config:{...draft.config,approved:true}},
    {...saved,rows:[{PATIENT_ID:"PRIVATE"}]},
    {...saved,sourceKey:"PRIMARY"},
    {...saved,config:{}},null,[],
  ])assert.equal(confirmsNativeChartSavedReadback(
    invalid,receipt,draft.config),false);
});
