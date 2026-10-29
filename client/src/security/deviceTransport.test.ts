import test from "node:test";
import assert from "node:assert/strict";
import {assertDevicePlaybackTransport,devicePlaybackTransportAvailable} from "./deviceTransport.js";
import {apiRequest} from "../api/client.js";

test("only HTTPS is currently a supported device data transport; localhost is not an exception",()=>{
  for(const protocol of ["http:","file:","data:",""]){
    assert.equal(devicePlaybackTransportAvailable(protocol),false);
    assert.throws(()=>assertDevicePlaybackTransport(protocol),{code:"DASHBOARD_PROTECTED_TRANSPORT_REQUIRED"});
  }
  assertDevicePlaybackTransport("https:");
});
test("HTTP device requests stop before fetch, including in-memory Token and enrollment bodies",async t=>{
  const old=Object.getOwnPropertyDescriptor(globalThis,"window");
  Object.defineProperty(globalThis,"window",{configurable:true,value:{location:{protocol:"http:"},isSecureContext:true}});
  t.after(()=>{if(old)Object.defineProperty(globalThis,"window",old);else Reflect.deleteProperty(globalThis,"window");});
  let calls=0;t.mock.method(globalThis,"fetch",async()=>{calls++;throw new Error("must not send");});
  for(const suffix of ["layout","page","data-sources/PRIMARY/page","kiosk/enrollment","kiosk/session","preview"])
    await assert.rejects(apiRequest(`/dashboards/device/1/${suffix}`,{headers:{"X-Dashboard-Device-Token":"synthetic"},body:JSON.stringify({token:"synthetic"})}),{code:"DASHBOARD_PROTECTED_TRANSPORT_REQUIRED",status:426});
  assert.equal(calls,0);
});
test("HTTPS device API does not follow redirects that could move credentials to another transport",async t=>{
  const old=Object.getOwnPropertyDescriptor(globalThis,"window");
  Object.defineProperty(globalThis,"window",{configurable:true,value:{location:{protocol:"https:"}}});
  t.after(()=>{if(old)Object.defineProperty(globalThis,"window",old);else Reflect.deleteProperty(globalThis,"window");});
  let calls=0;t.mock.method(globalThis,"fetch",async(_url:unknown,options?:RequestInit)=>{
    calls++;assert.equal(options?.redirect,"error");return Response.json({ok:true});
  });
  assert.deepEqual(await apiRequest("/dashboards/device/1/layout",{redirect:"follow"}),{ok:true});assert.equal(calls,1);
});
