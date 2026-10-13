import assert from "node:assert/strict";
import test from "node:test";
import {rememberDashboardToken,readDashboardToken,forgetDashboardToken} from "./dashboardToken.js";
test("valid device secrets remain in page memory and never invoke persistent storage writes",()=>{
  rememberDashboardToken(11,"A".repeat(43));assert.equal(readDashboardToken(11),"A".repeat(43));
  forgetDashboardToken(11);assert.equal(readDashboardToken(11),null);
  for(const [id,token] of [[0,"A".repeat(43)],[11,"short"],[-1,"A".repeat(43)]] as const)assert.throws(()=>rememberDashboardToken(id,token));
});
test("legacy credential is read once then removed from both browser stores",t=>{
  const data=new Map([["uqp.dashboard.device.12","A".repeat(43)]]);let writes=0;
  for(const name of ["localStorage","sessionStorage"] as const){const descriptor=Object.getOwnPropertyDescriptor(globalThis,name);
    Object.defineProperty(globalThis,name,{configurable:true,value:{getItem:(key:string)=>data.get(key)??null,removeItem:(key:string)=>data.delete(key),setItem:()=>{writes++;}}});
    t.after(()=>{if(descriptor)Object.defineProperty(globalThis,name,descriptor);else Reflect.deleteProperty(globalThis,name);});
  }
  assert.equal(readDashboardToken(12),"A".repeat(43));assert.equal(data.size,0);assert.equal(writes,0);forgetDashboardToken(12);
});
