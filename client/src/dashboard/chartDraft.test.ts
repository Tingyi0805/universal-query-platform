import test from "node:test";
import assert from "node:assert/strict";
import {newChartDraft,clampChartPlacement,chartDraftErrors,chartDraftPersistenceEnabled,syntheticChartPoints}
 from "./chartDraft.js";
test("2B-14 V1 chart draft is isolated and cannot persist",()=>{
 const draft=newChartDraft();
 assert.equal(chartDraftPersistenceEnabled,false);
 assert.equal(draft.config.valueMode,"QUERY_RESULT");
 assert.deepEqual(chartDraftErrors(draft,1920,1080,["PRIMARY"]),[]);
 assert.equal(syntheticChartPoints.length,3);
 assert(syntheticChartPoints.every(p=>p.value>=0&&Number.isSafeInteger(p.value)));
});
test("2B-14 source, column, maxPoint and shape validation never authorize data",()=>{
 const d=newChartDraft();
 assert(chartDraftErrors({...d,config:{...d.config,dataSourceKey:"DISABLED"}},1920,1080,["PRIMARY"]).length>0);
 assert(chartDraftErrors({...d,config:{...d.config,valueColumn:d.config.categoryColumn}},1920,1080,["PRIMARY"]).length>0);
 assert(chartDraftErrors({...d,config:{...d.config,maxPoints:51}},1920,1080,["PRIMARY"]).length>0);
 assert(chartDraftErrors({...d,config:{...d.config,categoryColumn:"BAD\u0000"}},1920,1080,["PRIMARY"]).length>0);
 assert.deepEqual(chartDraftErrors({...d,config:{...d.config,dataSourceKey:"SECURE_SOURCE",chartType:"PIE"}},1920,1080,["PRIMARY","SECURE_SOURCE"]),[]);
});
test("2B-14 all chart placement values are clamped within active canvas",()=>{
 const place=clampChartPlacement({x:10000,y:-20,width:5000,height:9000},1280,720);
 assert.deepEqual(place,{x:0,y:0,width:1280,height:720});
 const other=clampChartPlacement({x:1100,y:600,width:600,height:360},1280,720);
 assert.deepEqual(other,{x:680,y:360,width:600,height:360});
 const d=newChartDraft();
 assert(chartDraftErrors({...d,placement:{...d.placement,x:1800}},1920,1080,["PRIMARY"]).length>0);
});
