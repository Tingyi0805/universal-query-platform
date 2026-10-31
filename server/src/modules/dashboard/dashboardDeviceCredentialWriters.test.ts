import test from "node:test";
import assert from "node:assert/strict";
import sql from "mssql";
import { devicePendingInvalidationClause, requireUnmanagedDeviceCredential } from "./dashboardDeviceCredentialWriters.js";
function request(row:Record<string,unknown>,failSchema=false) {
 const statements:string[]=[];
 const r={input(){return this;},async query(s:string){statements.push(s);if(s.includes("DEVICE_LIFECYCLE_TRIGGER_CONFLICT")&&failSchema)throw new Error("SCHEMA_INVALID");return {recordset:[row]};}} as unknown as sql.Request;
 return {r,statements};
}
test("credential invalidation keeps legacy SQL column-compatible; managed cycles return to pending; terminal clears",async()=>{
 const legacy=request({Suspended:null,Pending:null});assert.equal(await devicePendingInvalidationClause(legacy.r),"");assert.equal(legacy.statements.length,1);
 const managed=request({Suspended:8,Pending:1});assert.equal(await devicePendingInvalidationClause(managed.r),"ReenrollmentRequired=CASE WHEN ReenrollmentRequired IS NOT NULL THEN 1 ELSE NULL END,");
 assert.match(await devicePendingInvalidationClause(managed.r,true),/SuspendedAtUtc=NULL,ReenrollmentRequired=NULL,QueryModeGrantVersion=NULL,DelegatorTokenVersion=NULL/);
 await assert.rejects(devicePendingInvalidationClause(request({Suspended:8,Pending:null},true).r),/SCHEMA_INVALID/);
});
for(const marker of [{ReenrollmentRequired:true},{ReenrollmentRequired:false},{SuspendedAtUtc:"2026-01-01T00:00:00Z"},{RevokedAtUtc:"2026-01-01T00:00:00Z"},{ArchivedAtUtc:"2026-01-01T00:00:00Z"}])test(`old credential writers reject ${JSON.stringify(marker)}`,async()=>{
 const f=request(marker);await assert.rejects(requireUnmanagedDeviceCredential(f.r,1,7),{code:"DASHBOARD_DEVICE_VERSIONED_API_REQUIRED"});
 assert(f.statements.every(s=>s.trimStart().startsWith("SELECT")));assert.match(f.statements[0]!,/UPDLOCK,HOLDLOCK/);
});
for(const row of [{},{ReenrollmentRequired:null,SuspendedAtUtc:null}])test(`old unmarked credentials remain compatible ${JSON.stringify(row)}`,async()=>{
 await requireUnmanagedDeviceCredential(request(row).r,1,7);
});
