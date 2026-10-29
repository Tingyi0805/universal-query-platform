import test from "node:test";
import assert from "node:assert/strict";
import {managedDeviceVerifier} from "./managedDevice.js";
const peer={certificateSha256:"A".repeat(64),dashboardId:1,deviceId:7,publicOrigin:"http://hospital.example",enrollmentExpiresAtUtc:new Date(Date.now()+100000).toISOString()};
for(const denied of ["revoked","expired","ip","device","mode","revision","delegation","policy"] as const)test(`native verifier preserves ${denied} denial; no alias/device/permission bypass`,async()=>{
 let inspected=0;const device={id:7,createdByUserId:2,authorizationRevision:3,delegatorTokenVersion:3,queryModeGrantVersion:4,lastUsedAtUtc:null};
 if(denied==="device")device.id=8;if(denied==="revision")device.queryModeGrantVersion=5;if(denied==="delegation")device.delegatorTokenVersion=2;
 const dependencies={check:async(_id:number,_token:string,ip:string)=>{assert.equal(ip,"192.0.2.7");return{status:denied==="revoked"?"DISABLED":denied==="expired"?"EXPIRED":denied==="ip"?"IP_RESTRICTED":"VALID",device};},mode:async()=>({mode:denied==="mode"?"LEGACY":"QUERY_ONLY",version:4}),inspect:async(_id:number,subject:{verifyDevice?:()=>Promise<unknown>})=>{inspected++;await subject.verifyDevice!();throw new Error("PUBLIC_POLICY_DENIED");}};
 const verify=managedDeviceVerifier(dependencies as unknown as Parameters<typeof managedDeviceVerifier>[0]);
 await assert.rejects(verify(peer,"A".repeat(43),"192.0.2.7"));assert.equal(inspected,denied==="policy"?1:0);
});
