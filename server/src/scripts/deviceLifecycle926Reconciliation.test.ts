import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {parse926Approval,sha926,verify926Source} from "./deviceLifecycle926Reconciliation.js";
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
