import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {parse926Approval,sha926,verify926Source,resolve926Tls,reconcile926,Reconcile926Error} from "./deviceLifecycle926Reconciliation.js";
const approval=()=>({format:"UQP_926_LEDGER_APPROVAL_V1",approved:true,scope:"PRODUCTION",applicationSourceSha:"a".repeat(40),packageManifestSha256:"b".repeat(64),migrationSha256:sha926,serverName:"approved-server",machineName:"approved-machine",databaseName:"UniversalQueryPlatform",loginName:"reviewed-deployer",databaseUser:"reviewed-user",engineMajor:15,approvedAtUtc:new Date(Date.now()-1000).toISOString(),expiresAtUtc:new Date(Date.now()+60000).toISOString(),approvalReference:"approval-reviewed",maintenanceReference:"maintenance-reviewed",existingBackupReference:"existing-backup-reviewed"});
test("926 approval binds identity, release hashes, expiry and explicit approval",()=>{
 assert.equal(parse926Approval(approval()).engineMajor,15);
 for(const bad of [{approved:false},{migrationSha256:"0".repeat(64)},{applicationSourceSha:"main"},{expiresAtUtc:"2020-01-01T00:00:00Z"},{databaseName:"master"},{engineMajor:16},{approvalReference:""},{extra:true}])assert.throws(()=>parse926Approval({...approval(),...bad}));
});
test("926 disposable approval cannot masquerade as production or accept arbitrary DBs",()=>{
 assert.throws(()=>parse926Approval({...approval(),scope:"DISPOSABLE_ONLY"}));
 assert.equal(parse926Approval({...approval(),scope:"DISPOSABLE_ONLY",machineName:"uqp-d1-0123456789ab",databaseName:"UQP_D1_UPGRADE_0123456789ab",engineMajor:16}).scope,"DISPOSABLE_ONLY");
});
test("926 adoption source is pinned and never executes migration SQL or config",async()=>{
 await verify926Source();const text=await readFile(new URL("./deviceLifecycle926Reconciliation.ts",import.meta.url),"utf8");
 assert.doesNotMatch(text,/^import[^\n]*(?:config\/|dotenv|migrate\.js)/m);
 assert.doesNotMatch(text,/\.batch\(/);assert.equal((text.match(/INSERT uqp\.SchemaMigration/g)??[]).length,1);
 assert.match(text,/UPDLOCK,HOLDLOCK/);assert.match(text,/TABLOCK,HOLDLOCK/);assert.match(text,/UQP:926:DeviceLifecycle/);
 assert.match(text,/COMMIT_OR_ROLLBACK_UNKNOWN_NO_RETRY/);
});

test("926 TLS defaults to strict and trust-cert requires explicit selection plus approval",()=>{
 const a=parse926Approval(approval());assert.deepEqual(resolve926Tls(a),{mode:"STRICT_TLS",options:{encrypt:true,trustServerCertificate:false}});
 assert.throws(()=>parse926Approval({...approval(),connectionMode:"ENCRYPT_TRUST_CERT"}),{code:"926_TLS_TRUST_APPROVAL_REQUIRED"});
 const trusted=parse926Approval({...approval(),connectionMode:"ENCRYPT_TRUST_CERT",tlsTrustApprovalReference:"reviewed-internal-certificate-exception"});
 assert.throws(()=>resolve926Tls(trusted),{code:"926_TLS_MODE_APPROVAL_MISMATCH"});
 assert.throws(()=>resolve926Tls(a,"ENCRYPT_TRUST_CERT"),{code:"926_TLS_MODE_APPROVAL_MISMATCH"});
 assert.deepEqual(resolve926Tls(trusted,"ENCRYPT_TRUST_CERT"),{mode:"ENCRYPT_TRUST_CERT",options:{encrypt:true,trustServerCertificate:true}});
});
test("926 TLS rejects plaintext, unknown modes and unapproved trust records",()=>{
 for(const mode of ["","NONE","DISABLED","false","encrypt=false"]){assert.throws(()=>resolve926Tls(parse926Approval(approval()),mode),{code:"926_TLS_MODE_INVALID"});assert.throws(()=>parse926Approval({...approval(),connectionMode:mode}));}
 for(const ref of ["", "short", false])assert.throws(()=>parse926Approval({...approval(),connectionMode:"ENCRYPT_TRUST_CERT",tlsTrustApprovalReference:ref}));
});
test("926 core refuses unencrypted or mismatched actual pool settings before adoption",async()=>{
 for(const [options,extra] of [[{encrypt:false,trustServerCertificate:false},{}],[{encrypt:true,trustServerCertificate:true},{}],[{encrypt:true,trustServerCertificate:false},{connectionMode:"ENCRYPT_TRUST_CERT",tlsTrustApprovalReference:"reviewed-exception"}]]){
  const pool={config:{options}} as unknown as Parameters<typeof reconcile926>[0];
  await assert.rejects(()=>reconcile926(pool,{...approval(),...extra},"adopt"),(e:unknown)=>e instanceof Reconcile926Error&&e.code==="926_TLS_CONNECTION_MISMATCH");
 }
});
test("926 CLI selects reviewed TLS options and has exactly one connection attempt",async()=>{
 const source=await readFile(new URL("./reconcileDeviceLifecycle926.ts",import.meta.url),"utf8");
 assert.match(source,/resolve926Tls\(a,process.env.UQP_926_ADOPT_TLS_MODE\)/);assert.match(source,/options:tls.options/);
 assert.equal((source.match(/\.connect\(/g)??[]).length,1);
});
