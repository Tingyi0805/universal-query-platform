import assert from "node:assert/strict";
import test from "node:test";
import { deviceManagementFixture as fixture } from "./dashboardDeviceManagement.testFixture.js";
const actor={userId:1,tokenVersion:1};
const input=async(f:ReturnType<typeof fixture>)=>({expectedVersion:(await f.service.safetyRead(1,actor)).version,confirmed:true as const});
for(const state of ["ACTIVE","SUSPENDED","PENDING_REENROLLMENT","EXPIRED"]){
 test(`D3 revoke ${state} irreversibly then archive with retained history`,async()=>{
  const f=fixture(),d=f.db().devices[0]!;
  if(state==="SUSPENDED")Object.assign(d,{IsActive:false,SuspendedAtUtc:"2026-01-01T00:00:00Z",ReenrollmentRequired:true,QueryModeGrantVersion:null,DelegatorTokenVersion:null});
  if(state==="PENDING_REENROLLMENT")d.ReenrollmentRequired=true;
  if(state==="EXPIRED")d.ExpiresAtUtc="2020-01-01T00:00:00Z";
  const old=d.TokenHash,first=await input(f);
  const revoked=await f.service.revoke(1,7,actor,first);
  const r=f.db().devices[0]!;
  assert.equal(r.IsActive,false);assert.equal(r.SuspendedAtUtc,null);assert.equal(r.ReenrollmentRequired,null);
  assert.equal(r.QueryModeGrantVersion,null);assert.equal(r.DelegatorTokenVersion,null);assert.notEqual(r.TokenHash,old);
  assert.equal(f.db().audits[0]!.eventType,"DASHBOARD_DEVICE_REVOKED");
  await assert.rejects(f.service.revoke(1,7,actor,first),/VERSION_CONFLICT/);
  await assert.rejects(f.service.restore(1,7,actor,await input(f)));
  const archived=await f.service.archive(1,7,actor,{expectedVersion:revoked.version,confirmed:true});
  assert.notEqual(archived.version,revoked.version);assert.equal(f.db().devices.length,1);
  assert.equal(f.db().history.length,1);assert.equal(f.db().audits.at(-1)!.eventType,"DASHBOARD_DEVICE_ARCHIVED");
  await assert.rejects(f.service.archive(1,7,actor,await input(f)));assert.equal(f.db().history.length,1);
 });
}
for(const op of ["revoke","archive"] as const)for(const fail of ["audit","audit-evidence","commit","touch",...(op==="archive"?["history"]:[])])test(`D3 ${op} ${fail} rolls back`,async()=>{
 const f=fixture();if(op==="archive")await f.service.revoke(1,7,actor,await input(f));
 const i=await input(f),before=f.snapshot();f.control.failAt=fail;
 await assert.rejects(f.service[op](1,7,actor,i));assert.deepEqual(f.snapshot(),before);
});
test("D3 suspended cannot archive; safety operations survive loss of query execution ACL",async()=>{
 const f=fixture();await f.service.suspend(1,7,actor,await input(f));
 const before=f.snapshot();await assert.rejects(f.service.archive(1,7,actor,await input(f)));assert.deepEqual(f.snapshot(),before);
 f.control.permissions=["DESIGN_QUERY"];f.control.query=false;f.control.workstation=false;
 await f.service.revoke(1,7,actor,await input(f));await f.service.archive(1,7,actor,await input(f));
});
for(const op of ["revoke","archive"] as const)test(`D3 concurrent ${op} single commit and stale version conflict`,async()=>{
 const f=fixture();if(op==="archive")await f.service.revoke(1,7,actor,await input(f));const i=await input(f);
 const results=await Promise.allSettled([f.service[op](1,7,actor,i),f.service[op](1,7,actor,i)]);
 assert.equal(results.filter(r=>r.status==="fulfilled").length,1);
 assert.match(String((results.find(r=>r.status==="rejected") as PromiseRejectedResult).reason),/VERSION_CONFLICT/);
});
