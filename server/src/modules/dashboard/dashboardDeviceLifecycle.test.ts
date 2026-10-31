import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { assertDeviceLifecycleRecord, assertDeviceLifecycleTransition as transition, deviceLifecycleState as state,
  DeviceLifecycleContractError, deviceLifecycleBlocksPlayback, type DeviceLifecycleRecord as Row } from "./dashboardDeviceLifecycle.js";
const now=Date.parse("2030-01-01T00:00:00Z"), time=new Date(now).toISOString();
const digest=(text:string)=>createHash("sha256").update(text).digest("hex");
const oldToken="synthetic-old-token", oldHash=digest(oldToken), tombstone=digest("no-issued-secret"), freshHash=digest("synthetic-new-token");
const legacy=():Row=>({id:1,dashboardId:1,isActive:true,suspendedAtUtc:null,reenrollmentRequired:null,revokedAtUtc:null,
  archivedAtUtc:null,expiresAtUtc:"2031-01-01T00:00:00Z",tokenHash:oldHash,queryModeGrantVersion:1,delegatorTokenVersion:1});
const suspended=():Row=>({...legacy(),isActive:false,suspendedAtUtc:time,reenrollmentRequired:true,tokenHash:tombstone,queryModeGrantVersion:null,delegatorTokenVersion:null});
const pending=():Row=>({...suspended(),isActive:true,suspendedAtUtc:null,tokenHash:digest("restore-tombstone")});
const issued=():Row=>({...pending(),tokenHash:freshHash,queryModeGrantVersion:1,delegatorTokenVersion:1});
const revoked=():Row=>({...legacy(),isActive:false,revokedAtUtc:time,tokenHash:tombstone,queryModeGrantVersion:null,delegatorTokenVersion:null});
test("existing playback denies pending/suspended markers even with a matching old Token; legacy is unchanged",()=>{
 for(const row of [{},{SuspendedAtUtc:null,ReenrollmentRequired:null},{ReenrollmentRequired:false}])assert.equal(deviceLifecycleBlocksPlayback(row),false);
 for(const row of [{SuspendedAtUtc:time},{ReenrollmentRequired:true},{ReenrollmentRequired:1},{ReenrollmentRequired:"false"}])assert.equal(deviceLifecycleBlocksPlayback(row),true);
});

test("legacy evidence is unchanged; IsActive or a tombstone/grant alone never proves ACTIVE or restored",()=>{
 const row=legacy(),before=structuredClone(row);assert.equal(state(row,now),"UNVERIFIED");assert.equal(state(row,now,oldHash),"ACTIVE");assert.deepEqual(row,before);
 assert.equal(state({...row,isActive:false},now),"UNVERIFIED");
 assert.equal(state({...row,tokenHash:tombstone,queryModeGrantVersion:null,delegatorTokenVersion:null},now,tombstone),"UNVERIFIED");
 assert.equal(state(row,now,digest("wrong")),"UNVERIFIED");
});
test("suspension, pending, revocation, archive and expiry remain distinct",()=>{
 assert.equal(state(suspended(),now),"SUSPENDED");assert.equal(state(pending(),now),"PENDING_REENROLLMENT");
 assert.equal(state(issued(),now,freshHash),"PENDING_REENROLLMENT");
 assert.equal(state(revoked(),now),"REVOKED");assert.equal(state({...revoked(),archivedAtUtc:time},now),"ARCHIVED");
 assert.equal(state({...legacy(),expiresAtUtc:time},now,oldHash),"EXPIRED");
 assert.equal(state({...revoked(),expiresAtUtc:time},now),"REVOKED");
 assert.equal(state({...suspended(),expiresAtUtc:time},now),"EXPIRED");
});
test("suspend -> restore pending -> issue -> verified enroll; old Token stays invalid at every stage",()=>{
 const a=legacy(),b=suspended(),c=pending(),d=issued(),e={...d,reenrollmentRequired:false};
 transition(a,b,"SUSPEND",now);transition(b,c,"RESTORE",now);transition(c,d,"ISSUE",now);
 assert.throws(()=>transition(d,e,"ENROLL",now),DeviceLifecycleContractError);
 assert.throws(()=>transition(d,e,"ENROLL",now,oldHash),DeviceLifecycleContractError);
 transition(d,e,"ENROLL",now,freshHash);assert.equal(state(e,now,freshHash),"ACTIVE");
 for(const row of [b,c,d,e])assert.notEqual(state(row,now,digest(oldToken)),"ACTIVE");
});
test("same-hash, case-only hash changes and direct restore to ACTIVE are refused",()=>{
 for(const tokenHash of [oldHash,oldHash.toUpperCase()])assert.throws(()=>transition(legacy(),{...suspended(),tokenHash},"SUSPEND",now),DeviceLifecycleContractError);
 assert.throws(()=>transition(suspended(),{...pending(),tokenHash:tombstone},"RESTORE",now),DeviceLifecycleContractError);
 assert.throws(()=>transition(suspended(),{...issued(),reenrollmentRequired:false},"RESTORE",now),DeviceLifecycleContractError);
 assert.throws(()=>transition(issued(),{...issued(),tokenHash:digest("different"),reenrollmentRequired:false},"ENROLL",now,freshHash),DeviceLifecycleContractError);
});
test("permanent revocation cannot restore; suspended devices must revoke before archive",()=>{
 const r={...revoked(),tokenHash:digest("revocation-tombstone"),reenrollmentRequired:null};transition(suspended(),r,"REVOKE",now);
 assert.throws(()=>transition(r,pending(),"RESTORE",now),DeviceLifecycleContractError);
 assert.throws(()=>transition(r,legacy(),"ENROLL",now,oldHash),DeviceLifecycleContractError);
 assert.throws(()=>transition(suspended(),{...suspended(),archivedAtUtc:time},"ARCHIVE",now),DeviceLifecycleContractError);
 const archived={...r,archivedAtUtc:time};transition(r,archived,"ARCHIVE",now);
 assert.throws(()=>transition(archived,r,"ARCHIVE",now),DeviceLifecycleContractError);
});
test("expiry, identity, grant versions and deadline cannot be repaired by restore",()=>{
 assert.throws(()=>transition({...suspended(),expiresAtUtc:time},{...pending(),expiresAtUtc:time},"RESTORE",now),DeviceLifecycleContractError);
 for(const patch of [{id:2},{dashboardId:2},{expiresAtUtc:"2032-01-01T00:00:00Z"}])assert.throws(()=>transition(suspended(),{...pending(),...patch},"RESTORE",now),DeviceLifecycleContractError);
});
for(const patch of [
 {isActive:true,suspendedAtUtc:time}, {isActive:true,revokedAtUtc:time}, {isActive:true,archivedAtUtc:time},
 {isActive:false,suspendedAtUtc:time,reenrollmentRequired:null}, {isActive:false,suspendedAtUtc:time,reenrollmentRequired:false},
 {isActive:false,suspendedAtUtc:time,reenrollmentRequired:true},
 {isActive:false,reenrollmentRequired:true}, {isActive:false,revokedAtUtc:time,reenrollmentRequired:true},
 {isActive:false,archivedAtUtc:time,reenrollmentRequired:false},
 {queryModeGrantVersion:null}, {delegatorTokenVersion:0}, {queryModeGrantVersion:Number.MAX_SAFE_INTEGER+1},
 {expiresAtUtc:"2030-02-30T00:00:00Z"}, {expiresAtUtc:"2030-01-01T08:00:00+08:00"},
 {tokenHash:"not-a-hash"},
] as Partial<Row>[])test(`invalid lifecycle combination ${JSON.stringify(patch)}`,()=>assert.throws(()=>assertDeviceLifecycleRecord({...legacy(),...patch}),DeviceLifecycleContractError));
