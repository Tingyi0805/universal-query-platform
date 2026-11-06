import test from "node:test";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {parse926Approval,sha926,verify926Source,resolve926Tls,reconcile926,Reconcile926Error,failure926,diagnostic926,type Reconcile926Stage} from "./deviceLifecycle926Reconciliation.js";
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

test("926 diagnostic emits only fixed codes and bounded numeric SQL facts",()=>{
 const secret="PASSWORD_TOKEN_PATIENT_CONNECTION_STRING_SENTINEL";
 const error:any={code:secret,message:secret,stack:secret,config:{password:secret},originalError:{info:{number:229,message:secret}},precedingErrors:[{number:3621,code:"EREQUEST",message:secret}]};error.cause=error;
 const d=diagnostic926(failure926(error,"SCHEMA","ROLLED_BACK"));
 assert.equal(d.category,"PERMISSION");assert.equal(d.stage,"SCHEMA");assert.deepEqual(d.sqlNumbers,[229,3621]);assert.deepEqual(d.driverCodes,["EREQUEST"]);assert.equal(d.noRetry,true);
 assert(!JSON.stringify(d).includes(secret));assert(!JSON.stringify(d).includes("stack"));
 assert(!JSON.stringify(diagnostic926(new Reconcile926Error(secret))).includes(secret));
});
test("926 diagnostics distinguish connection, approval, permission, schema, ledger, transaction and timeouts",()=>{
 const cases:[Reconcile926Stage,unknown,string][]=[
  ["CONNECTION",{code:"ELOGIN",number:18456},"CONNECTION"],["APPROVAL",new SyntaxError("untrusted-json-secret"),"APPROVAL"],
  ["IDENTITY",new Reconcile926Error("926_DEPLOYMENT_PERMISSION_REQUIRED"),"PERMISSION"],["SCHEMA",{code:"EREQUEST",originalError:{info:{number:51926}}},"SCHEMA"],
  ["LEDGER_WRITE",{code:"EREQUEST",number:2627},"LEDGER"],["TRANSACTION_BEGIN",{code:"ENOTBEGUN"},"TRANSACTION"],
  ["DATA",{code:"ETIMEOUT"},"TIMEOUT"],["DATA",{number:1222},"TIMEOUT"],["LEDGER_WRITE",{number:1205},"TRANSACTION"],
  ["LOCK",new Reconcile926Error("926_LOCK_TIMEOUT_NO_RETRY"),"TIMEOUT"]];
 for(const [stage,error,category] of cases){const d=diagnostic926(failure926(error,stage));assert.equal(d.stage,stage);assert.equal(d.category,category);assert.equal(d.noRetry,true);}
});
test("926 outer CLI context cannot overwrite the original stage or transaction outcome",()=>{
 const e=failure926(new Reconcile926Error("926_APPROVAL_INVALID"),"APPROVAL");
 assert.equal(failure926(e,"RECONCILIATION"),e);assert.equal(diagnostic926(e).code,"926_APPROVAL_INVALID");
 assert.equal(diagnostic926(failure926({code:"ECONNRESET"},"CONNECTION_CLOSE","COMMITTED")).transactionOutcome,"COMMITTED");
});
test("926 commit/rollback uncertainty preserves safe primary and rollback facts and forbids retry",()=>{
 const e=failure926({number:547,message:"private SQL"},"LEDGER_WRITE","UNKNOWN","926_COMMIT_OR_ROLLBACK_UNKNOWN_NO_RETRY",{code:"ENOTBEGUN",message:"private connection"});
 const d=diagnostic926(e);assert.equal(e.code,"926_COMMIT_OR_ROLLBACK_UNKNOWN_NO_RETRY");assert.equal(d.stage,"LEDGER_WRITE");assert.equal(d.transactionOutcome,"UNKNOWN");assert.deepEqual(d.sqlNumbers,[547]);assert.deepEqual(d.rollbackError,{sqlNumbers:[],driverCodes:["ENOTBEGUN"]});assert.equal(d.noRetry,true);assert(!JSON.stringify(d).includes("private"));
});
test("926 CLI prints one safe JSON diagnostic with exit 1 before any connection on invalid arguments",()=>{
 const result=spawnSync(process.execPath,["--import","tsx",fileURLToPath(new URL("./reconcileDeviceLifecycle926.ts",import.meta.url))],{encoding:"utf8",timeout:15000});
 assert.equal(result.status,1);assert.equal(result.stdout,"");const d=JSON.parse(result.stderr.trim());assert.equal(d.format,"UQP_926_ERROR_V1");assert.equal(d.code,"926_EXPLICIT_INVOCATION_REQUIRED");assert.equal(d.stage,"INPUT");assert.equal(d.transactionOutcome,"NOT_STARTED");assert.equal(d.noRetry,true);
});
