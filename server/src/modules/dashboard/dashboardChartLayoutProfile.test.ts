import test from "node:test";
import assert from "node:assert/strict";
import {
 chartLayoutPublicRow,chartLayoutRevision,withChartLayoutChange,
 chartIsSoftRemoved,chartLayoutPublicConfig,chartLayoutGeometryValid,
} from "./dashboardChartLayoutProfile.js";
const base='{"theme":"CUSTOM","fontSize":32}';
const chart={id:34,widgetType:"CHART",x:5,y:30,width:620,height:360,sortOrder:0};
const geometry={x:120,y:140,width:600,height:300,sortOrder:80};
const requestId="c05136ad-9a03-4d2b-ae13-3bdb750f95d0";
test("CHART sidecar changes only Profile config and retains other settings",()=>{
 const next=withChartLayoutChange({raw:base,widgetId:34,action:"MOVE",
  geometry,requestId,canvasWidth:1920,canvasHeight:1080});
 assert.deepEqual(chartLayoutPublicConfig(next),{theme:"CUSTOM",fontSize:32});
 assert.deepEqual(chartLayoutPublicRow(chart,1,next,1920,1080),{
  ...chart,...geometry,chartLayoutRevision:chartLayoutRevision(1,next)});
 assert.notEqual(chartLayoutRevision(1,next),chartLayoutRevision(1,base));
});
test("soft removal hides CHART, never deletes or rewrites its widget/seal",()=>{
 const next=withChartLayoutChange({raw:base,widgetId:34,action:"HIDE",
  geometry,requestId,canvasWidth:1920,canvasHeight:1080});
 assert.equal(chartIsSoftRemoved(next,34),true);
 assert.equal(chartLayoutPublicRow(chart,1,next,1920,1080),null);
 assert.throws(()=>withChartLayoutChange({raw:next,widgetId:34,action:"MOVE",
  geometry,requestId,canvasWidth:1920,canvasHeight:1080}));
});
test("invalid geometry and corrupt stored overlays fail closed",()=>{
 assert.equal(chartLayoutGeometryValid({...geometry,x:1800},1920,1080),false);
 assert.throws(()=>withChartLayoutChange({raw:base,widgetId:34,action:"MOVE",
  geometry:{...geometry,width:9999},requestId,canvasWidth:1920,canvasHeight:1080}));
 assert.equal(chartIsSoftRemoved('not-json',34),true);
 const bad='{"chartLayoutOverridesV1":{"34":{"hidden":false}}}';
 assert.equal(chartIsSoftRemoved(bad,34),true);
 assert.throws(()=>chartLayoutPublicRow(chart,1,bad,1920,1080));
});
