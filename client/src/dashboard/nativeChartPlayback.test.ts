import test from "node:test";
import assert from "node:assert/strict";
import {
 CHART_DEVICE_PLAYBACK_RELEASE_APPROVED,
 CHART_USER_PLAYBACK_RELEASE_APPROVED,
 mayRequestSealedChartProjection,sealedChartProjectionPath,
 mayRequestSealedDeviceChartProjection,sealedDeviceChartProjectionPath,
 sealedDeviceChartProjectionHeaders,
 type NativeChartPlaybackContext,
} from "./nativeChartPlayback";

const authorized:NativeChartPlaybackContext={
 widgetType:"CHART",dashboardId:7,widgetId:88,
 queryPreview:true,deviceMode:false,userRoute:false,
 previewAuthorized:true,online:true,hasDataWarning:false,
 accessTokenPresent:true,canDesignQuery:true,canExecuteQuery:true,
};

test("native CHART projection is requested only in authenticated designer Query preview",()=>{
 assert.equal(mayRequestSealedChartProjection(authorized),true);
 assert.equal(sealedChartProjectionPath(7,88),
   "/dashboards/7/charts/v1/88/projection");
 assert.equal(CHART_DEVICE_PLAYBACK_RELEASE_APPROVED,false);
 assert.equal(CHART_USER_PLAYBACK_RELEASE_APPROVED,false);
});

test("kiosk/device, user playback, legacy preview and unsigned actor claims never use designer chart route",()=>{
 const blocked:Partial<NativeChartPlaybackContext>[]=[
  {deviceMode:true},{userRoute:true},{queryPreview:false},
  {previewAuthorized:false},{online:false},{hasDataWarning:true},
  {accessTokenPresent:false},{canDesignQuery:false},
  {canExecuteQuery:false},{widgetType:"TEXT"},
  {dashboardId:0},{dashboardId:NaN},{dashboardId:7.3},
  {widgetId:0},{widgetId:-1},{widgetId:Infinity},
 ];
 for(const patch of blocked)
   assert.equal(mayRequestSealedChartProjection({...authorized,...patch}),false,
     JSON.stringify(patch));
 for(const [id,widget] of [[0,88],[7,-1],[2.5,8],[7,NaN],[7,0]])
   assert.equal(sealedChartProjectionPath(id,widget),null);
});

test("request is keyed to saved SQL identity, never untrusted source/config/row data",()=>{
 const path=sealedChartProjectionPath(7,88)!;
 assert.equal(path.includes("ConfigJson"),false);
 assert.equal(path.includes("PATIENT"),false);
 assert.equal(path.includes("rows"),false);
 assert.equal(path.includes("SourceKey"),false);
});


test("device CHART projection transport is separate from designer JWT and cannot use kiosk cookie sentinel",()=>{
  const deviceToken="A".repeat(43);
  const headers=sealedDeviceChartProjectionHeaders(deviceToken,71);
  assert.deepEqual(headers,{
    "X-Dashboard-Device-Token":deviceToken,
    "X-UQP-Expected-Device-Id":"71",
  });
  assert.equal(Object.keys(headers??{}).some(k=>k.toLowerCase()==="authorization"),false);
  assert.equal(sealedDeviceChartProjectionPath(7,88),
    "/dashboards/device/7/charts/v1/88/projection");
  assert.equal(sealedDeviceChartProjectionHeaders("COOKIE_SESSION"),null);
  assert.equal(sealedDeviceChartProjectionHeaders(null),null);
  assert.equal(sealedDeviceChartProjectionHeaders("Bearer "+deviceToken),null);
  assert.equal(sealedDeviceChartProjectionHeaders(deviceToken,0),null);
  assert.equal(sealedDeviceChartProjectionHeaders(deviceToken,1.5),null);
  assert.deepEqual(sealedDeviceChartProjectionHeaders(deviceToken),{
    "X-Dashboard-Device-Token":deviceToken,
  });
  for(const [dash,widget] of [[0,88],[7,0],[NaN,88],[7,Infinity]])
    assert.equal(sealedDeviceChartProjectionPath(dash,widget),null);
});

test("device CHART stays closed in actual client even with fully valid Token/IP/session conditions",()=>{
  const scenario={
    widgetType:"CHART",dashboardId:7,widgetId:88,
    deviceMode:true,userRoute:false,queryPreview:false,
    activationRequired:false,previewAuthorized:true,
    online:true,hasDataWarning:false,
    deviceToken:"A".repeat(43),expectedDeviceId:71,
  };
  assert.equal(CHART_DEVICE_PLAYBACK_RELEASE_APPROVED,false);
  assert.equal(mayRequestSealedDeviceChartProjection(scenario),false);
  for(const patch of [
    {deviceMode:false},{userRoute:true},{queryPreview:true},
    {activationRequired:true},{previewAuthorized:false},
    {online:false},{hasDataWarning:true},{widgetType:"TABLE"},
    {deviceToken:"COOKIE_SESSION"},{deviceToken:null},
    {expectedDeviceId:0},{dashboardId:0},{widgetId:0},
  ]){
    assert.equal(mayRequestSealedDeviceChartProjection({...scenario,...patch}),false);
  }
});
