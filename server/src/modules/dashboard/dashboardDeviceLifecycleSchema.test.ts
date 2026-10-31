import test from "node:test";
import assert from "node:assert/strict";
import { readFile,readdir } from "node:fs/promises";
import {createHash} from "node:crypto";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {fileURLToPath} from "node:url";
import { deviceLifecycleSchemaSql,requireDeviceLifecycleSchema } from "./dashboardDeviceLifecycleSchema.js";
import {inventory,selectProfile} from "../../scripts/securityAcceptancePlan.js";
const directory=new URL("../../../../database/migrations/",import.meta.url),file="926_dashboard_device_lifecycle.sql";
test("926 is unique, pinned and leaves 922-925 reservations and old acceptance profiles unchanged",async()=>{
 const files=await readdir(directory);assert.equal(files.filter(f=>f.startsWith("926_")).length,1);
 assert.equal(files.filter(f=>/92[2-5]_/.test(f)).length,0);
 const rows=await inventory();assert.equal(rows.length,49);assert.equal(rows.at(-1)?.file,file);
 for(const profile of ["legacy","coexistence"])assert.deepEqual(selectProfile(rows,profile),selectProfile(rows.filter(r=>r.id<926),profile));
});
test("926 repeats strict catalog checks instead of repairing conflicting/partial installations",async()=>{
 const sql=await readFile(new URL(file,directory),"utf8"),shared=sql.split("-- BEGIN SHARED CATALOG VALIDATION\n")[1]?.split("-- END SHARED CATALOG VALIDATION")[0];
 assert.equal(shared,deviceLifecycleSchemaSql);
 for(const part of ["SET XACT_ABORT ON","BEGIN TRANSACTION","sp_getapplock","DEVICE_LIFECYCLE_PARTIAL_INSTALLATION","WITH CHECK ADD CONSTRAINT","is_not_trusted=0","is_disabled=0","is_not_for_replication=0","user_type_id=42","scale=0","default_object_id=0","XACT_STATE()<>0 ROLLBACK"])assert(sql.includes(part),part);
 assert.match(sql,/ADD SuspendedAtUtc DATETIME2\(0\) NULL, ReenrollmentRequired BIT NULL/);
 assert.doesNotMatch(sql,/(?:UPDATE|DELETE FROM|INSERT INTO|MERGE|TRUNCATE TABLE) uqp\./i);
 const quoted=sql.match(/EXEC\(N'(CREATE TRIGGER[\s\S]*?)'\);/)![1]!.replaceAll("''","'");
 const normalized=quoted.toLowerCase().replace(/[\[\]\s]/g,"");
 const digest=createHash("sha256").update(Buffer.from(normalized,"utf16le")).digest("hex");
 assert(sql.includes(`=0x${digest}`));
 const runner=await readFile(new URL("../../scripts/migrate.ts",import.meta.url),"utf8");assert(runner.includes(`"${file}"`));assert(runner.includes("deviceLifecycleSchemaSql"));
});
test("lifecycle readiness stays read-only and is not forced on existing playback",async()=>{
 let called="";await requireDeviceLifecycleSchema({query:async text=>{called=text;return{};}});assert.equal(called,deviceLifecycleSchemaSql);
 await assert.rejects(requireDeviceLifecycleSchema({query:async()=>{throw new Error("SCHEMA_NOT_READY");}}),/SCHEMA_NOT_READY/);
 for(const name of ["dashboardKiosk.routes.ts"]){const text=await readFile(new URL(name,import.meta.url),"utf8");assert(!text.includes("requireDeviceLifecycleSchema"));}
});
test("SQL acceptance refuses an unbound target before connecting and never imports platform configuration",async()=>{
 const url=new URL("../../scripts/deviceLifecycle926Acceptance.ts",import.meta.url),source=await readFile(url,"utf8");
 assert.doesNotMatch(source,/from ["'][^"']*(?:config\/database|config\/env|migrate\.js)|import ["']dotenv/);
 const run=promisify(execFile);
 await assert.rejects(run(process.execPath,["--import","tsx",fileURLToPath(url)],{env:{PATH:process.env.PATH,UQP_D1_SCOPE:"INVALID",PLATFORM_DB_SERVER:"must-not-connect"}}),error=>{
  const result=error as Error&{stderr?:string;code?:number};assert.equal(result.code,1);assert.match(result.stderr??"",/D1_SQL_ACCEPTANCE_FAILED:target-guard:0/);return true;
 });
});
