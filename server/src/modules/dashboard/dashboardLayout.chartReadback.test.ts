import test from "node:test";
import assert from "node:assert/strict";
import { mapDashboardWidgetForDisplay } from "./dashboardLayout.repository.js";

const base = {
  Id:88, ProfileId:22, WidgetType:"CHART", Title:"候診彙總",
  SourceKey:"PRIMARY", StaticText:"PRIVATE_STATIC_TEXT",
  X:60,Y:80,Width:620,Height:360,FontSize:20,Alignment:"CENTER",
  ConfigJson:JSON.stringify({
    version:1,chartType:"BAR",dataSourceKey:"PRIMARY",
    categoryColumn:"ROOM",valueColumn:"TOTAL",
    // Raw rows and browser-claimed approvals are never part of the
    // legitimate Chart V1 contract; public layout must hide them anyway.
    rows:[{PATIENT_ID:"PRIVATE_PATIENT_ID"}],
    approved:true, internalToken:"PRIVATE_INTERNAL_TOKEN",
  }), SortOrder:10,
};

test("native layout readback returns only CHART positioning, never sealed configuration or text",()=>{
  const actual=mapDashboardWidgetForDisplay(base);
  assert.deepEqual(actual,{
    id:88,profileId:22,widgetType:"CHART",title:"候診彙總",
    sourceKey:"PRIMARY",staticText:null,
    x:60,y:80,width:620,height:360,fontSize:20,alignment:"CENTER",
    config:{},sortOrder:10,
  });
  const serialized=JSON.stringify(actual);
  for(const sensitive of [
    "PRIVATE_STATIC_TEXT","PRIVATE_PATIENT_ID","PRIVATE_INTERNAL_TOKEN",
    "categoryColumn","valueColumn","approved",
  ]) assert.equal(serialized.includes(sensitive),false);
});

test("CHART never parses arbitrary ConfigJson, including non-JSON or oversized strings",()=>{
  for(const raw of [
    "{not-json", "PRIVATE".repeat(30_000), null, undefined,
    "{\"interactiveDrilldown\":{\"token\":\"PRIVATE\"}}",
  ]){
    const actual=mapDashboardWidgetForDisplay({...base,ConfigJson:raw});
    assert.deepEqual(actual.config,{});
    assert.equal(actual.staticText,null);
  }
});

test("legacy TEXT/TABLE layout settings and existing public drilldown masking remain unchanged",()=>{
  const legacy=mapDashboardWidgetForDisplay({
    ...base,Id:19,WidgetType:"TABLE",StaticText:"固定文字",
    ConfigJson:JSON.stringify({
      dataSourceKey:"PRIMARY",tableHeaderTextColor:"#123456",
      retainedTable:true,interactiveDrilldown:{secret:"HIDDEN"},
      interactiveRoot:{private:"HIDDEN"},
    }),
  });
  assert.equal(legacy.widgetType,"TABLE");
  assert.equal(legacy.staticText,"固定文字");
  assert.deepEqual(legacy.config,{
    dataSourceKey:"PRIMARY",tableHeaderTextColor:"#123456",
    retainedTable:true,
  });
  assert.equal(legacy.id,19);
  assert.equal(legacy.width,620);
});
