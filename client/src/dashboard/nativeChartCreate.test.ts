import {newNativeChartRequestId} from "./nativeChartCreate";
import test from "node:test";
import assert from "node:assert/strict";
import {newChartDraft} from "./chartDraft.js";
import {
  buildNativeChartCreateBody,parseNativeChartCreateReceipt,
  canCreateChartOnActivatedDashboard,
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
test("native CHART creation requires a valid activated QUERY_ONLY source",()=>{
 const ready={
   version:"a".repeat(64),dashboardMode:"QUERY_ONLY",isActive:true,
   editable:false,overCapacity:false,
   primary:{sourceKey:"PRIMARY",queryDefinitionId:7,maxRows:1000,requiresConversion:false,
     refreshSeconds:60,pageSize:5,pageSeconds:20},sources:[],
 };
 assert.equal(canCreateChartOnActivatedDashboard(ready),true);
 for(const change of [
   {dashboardMode:"QUERY_ONLY_DISABLED"},{dashboardMode:"LEGACY"},
   {isActive:false},{editable:true},{overCapacity:true},
   {version:"stale"},{primary:{...ready.primary,queryDefinitionId:null}},
   {primary:{...ready.primary,maxRows:null}},
   {sources:[{...ready.primary,sourceKey:"SECONDARY",isEnabled:true,queryDefinitionId:null}]},
 ])assert.equal(canCreateChartOnActivatedDashboard({...ready,...change}),false);
 assert.equal(canCreateChartOnActivatedDashboard({...ready,
   sources:[{...ready.primary,sourceKey:"DISABLED",isEnabled:false,queryDefinitionId:null}]}),true);
});
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

test("CHART request UUID uses secure random bytes without requiring HTTPS-only randomUUID",()=>{
 const a=newNativeChartRequestId(),b=newNativeChartRequestId();assert.notEqual(a,b);
 assert.match(a,/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
});
