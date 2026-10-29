import test from "node:test";
import assert from "node:assert/strict";
import {request as httpRequest} from "node:http";
import {request as httpsRequest,Agent} from "node:https";
import {connect as tlsConnect} from "node:tls";
import {randomUUID} from "node:crypto";
import {readFileSync} from "node:fs";
import path from "node:path";
import {managedFixture} from "./managedFixture.js";

test("real CONNECT TLS 1.2/1.3 mTLS protects login, token and rows; closed routes, freshness and live grant revocation",async t=>{
 const f=await managedFixture();t.after(f.close);
 const call=(route:string,options:{method?:string;body?:unknown;cert?:string;tls12?:boolean;weak?:boolean;nonce?:string;headers?:Record<string,string>}={})=>new Promise<{status:number;body:string}>((resolve,reject)=>{
  const agent=new Agent({keepAlive:false});
  agent.createConnection=(_opts,cb)=>{
   const req=httpRequest({host:"127.0.0.1",port:f.port,method:"CONNECT",path:"uqp-kiosk.internal:443"});
   req.once("connect",(_res,socket)=>{
    const name=options.cert??"client";
    const secure=tlsConnect({socket,servername:"uqp-kiosk.internal",ca:readFileSync(path.join(f.directory,"ca.pem")),...(name!=="none"?{cert:readFileSync(path.join(f.directory,name+".pem")),key:readFileSync(path.join(f.directory,name+".key"))}:{}),minVersion:options.tls12?"TLSv1.2":"TLSv1.3",maxVersion:options.tls12?"TLSv1.2":"TLSv1.3",...(options.weak?{ciphers:"AES128-SHA"}:{})});
    secure.once("secureConnect",()=>cb!(null,secure));secure.once("error",error=>cb!(error,secure));
   });req.on("error",error=>cb!(error,undefined as never));req.end();return undefined as never;
  };
  const data=JSON.stringify(options.body??{});
  const req=httpsRequest({host:"uqp-kiosk.internal",port:443,path:route,agent,method:options.method??"GET",headers:{host:"uqp-kiosk.internal:443","x-uqp-agent-time":String(Date.now()),"x-uqp-agent-request-id":options.nonce??randomUUID(),"x-uqp-public-origin":"http://hospital.example","x-dashboard-device-token":f.state.token,"content-type":"application/json",...(options.method==="POST"?{"content-length":String(Buffer.byteLength(data))}:{}),...options.headers}},res=>{
   const parts:Buffer[]=[];res.on("data",b=>parts.push(b));res.on("end",()=>{agent.destroy();resolve({status:res.statusCode!,body:Buffer.concat(parts).toString()});});
  });req.on("error",error=>{agent.destroy();reject(error);});req.end(options.method==="POST"?data:undefined);
 });
 const layout="/api/dashboards/device/1/layout",page="/api/dashboards/device/1/page";
 const login=await call("/api/auth/login",{method:"POST",body:{username:"manager",password:"fixture-secret"}});assert.equal(login.status,200);
 assert.equal((await call(layout)).status,200);f.state.unavailable=true;assert.equal((await call(layout)).status,503);f.state.unavailable=false;
 const nonce=randomUUID();assert.equal((await call(page,{method:"POST",body:{page:1},nonce})).status,200);assert.equal((await call(page,{method:"POST",body:{page:1},nonce})).status,401);
 for(const headers of [{origin:"http://evil.example"},{"x-uqp-public-origin":"http://evil.example"},{"x-uqp-agent-time":"1"},{"x-dashboard-device-token":"B".repeat(43)}] as Record<string,string>[])assert.equal((await call(layout,{headers})).status,401);
 for(const route of ["/api/dashboards/device/2/layout","/api/dashboards/device/1/preview","/api/admin","/api/dashboards/device/1/layout?x=1"])assert.equal((await call(route)).status,401);
 assert.equal((await call(layout,{cert:"other"})).status,401);
 await assert.rejects(call(layout,{cert:"none"}));assert.equal((await call(layout,{tls12:true})).status,200);await assert.rejects(call(layout,{tls12:true,weak:true}));
 f.hold();const pending=call(page,{method:"POST",body:{page:1}});await new Promise(r=>setTimeout(r,50));f.state.revoked=true;f.release();const denied=await pending;assert.equal(denied.status,401);assert(!denied.body.includes("合○Agent"));
 assert.equal((await call(layout)).status,401);f.state.revoked=false;
 const original=[...f.configuration.peers];f.configuration.peers=[];f.save();assert.equal((await call(layout)).status,401);f.configuration.peers=original;f.save();
 assert.equal(f.state.leaked,false);
});
