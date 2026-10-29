import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {createServer} from "node:http";
import {once} from "node:events";
import type {Request} from "express";
import {hasProtectedPlaybackTransport} from "./dashboardPlaybackTransport.js";
import {createKioskRouter} from "./dashboardKiosk.routes.js";

test("transport trusts actual TLS or the existing exact TLS terminator; no client assertions",()=>{
  const request=(address:string,proto?:string,tls=false)=>({socket:{remoteAddress:address,encrypted:tls},header:(name:string)=>name==="x-forwarded-proto"?proto:undefined}) as unknown as Request;
  assert(hasProtectedPlaybackTransport(request("203.0.113.9",undefined,true),[]));
  assert(hasProtectedPlaybackTransport(request("::ffff:127.0.0.1","https"),["127.0.0.1"]));
  for(const proto of [undefined,"http","https,http","HTTPS","https, https"])
    assert(!hasProtectedPlaybackTransport(request("127.0.0.1",proto),["127.0.0.1"]));
  assert(!hasProtectedPlaybackTransport(request("203.0.113.9","https"),["127.0.0.1"]));
  assert(!hasProtectedPlaybackTransport(request("","https"),[""]));
});

test("production device router blocks HTTP layout, Legacy, page, source and enrollment before any authority/data call",async t=>{
  let calls=0;
  const forbidden=async()=>{calls++;throw new Error("must not query, authorize or renew");};
  const app=express();app.use(express.json());
  app.use("/api/dashboards",createKioskRouter(()=>({origin:"http://hospital.example",enabled:true,trustedProxies:[]}),{check:forbidden,mode:forbidden,inspect:forbidden}));
  app.use((_req,res)=>{calls++;res.json({row:"must not deliver"});});
  const server=createServer(app);server.listen(0,"127.0.0.1");await once(server,"listening");
  t.after(()=>{server.closeAllConnections();server.close();});
  const port=(server.address() as import("node:net").AddressInfo).port;
  for(const suffix of ["1/layout","1/preview","1/page","1/data-sources/PRIMARY/page","1/kiosk/enrollment","1/kiosk/session","1/kiosk/forget","bad-id/page"]){
    for(const proofs of [{},{"x-forwarded-proto":"https","origin":"https://hospital.example","x-uqp-kiosk":"1"},{"x-uqp-agent":"1","x-uqp-dpapi":"protected","x-uqp-channel":"encrypted","host":"localhost"}] as Record<string,string>[]){
      const response=await fetch(`http://127.0.0.1:${port}/api/dashboards/device/${suffix}`,{method:suffix.endsWith("layout")?"GET":"POST",headers:{...proofs,"x-dashboard-device-token":"A".repeat(43)}});
      assert.equal(response.status,426);assert.equal(response.headers.get("cache-control"),"no-store");assert.equal(response.headers.get("set-cookie"),null);
      const body=await response.text();assert(body.includes("DASHBOARD_PROTECTED_TRANSPORT_REQUIRED"));assert(!body.includes("A".repeat(43)));assert(!body.includes("must not deliver"));
    }
  }
  assert.equal(calls,0);
});
