import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {parseChartAuthorizedTest,attestChartAuthorizedTest} from "./dashboardChartAuthorizedTest.js";
import type sql from "mssql";
const now=Date.parse("2026-11-15T00:00:00Z");
const config=()=>({version:1,purpose:"UQP_AUTHORIZED_CHART_TEST_ONLY",target:{server:"TEST-SQL",database:"UQP_TEST",login:"uqp"},
 dashboardIds:[7],expiresAt:"2026-11-16T00:00:00Z",changeReceipt:"approved-test-change",backupReceipt:"verified-test-backup",privacy:"EXISTING_REVIEW_AND_PATIENT_AUDIT_REQUIRED"});
test("authorized test config is unavailable in production/development and requires bounded exact scope",()=>{
 assert.ok(parseChartAuthorizedTest(config(),"test",now));
 for(const env of ["production","development"])assert.equal(parseChartAuthorizedTest(config(),env,now),null);
 for(const change of [{expiresAt:"2026-11-14T00:00:00Z"},{expiresAt:"2027-01-01T00:00:00Z"},{dashboardIds:[]},{dashboardIds:[7,7]},
 {backupReceipt:""},{target:{...config().target,database:"master"}},{approved:true}])assert.equal(parseChartAuthorizedTest({...config(),...change},"test",now),null);
});
test("same platform pool requires target marker, engine and all fixed module hashes; never learns trust from SQL",async()=>{
 const manifest=JSON.parse(readFileSync(new URL("../../../../database/authorized-test/928_source_manifest.json",import.meta.url),"utf8"));
 for(const wrong of ["NONE","TARGET","MARKER","HASH","MISSING","DISABLED"]){
  let calls=0;const pool={request:()=>({query:async()=>({recordset:++calls===1?[{ServerName:wrong==="TARGET"?"PROD":"TEST-SQL",DatabaseName:"UQP_TEST",LoginName:"uqp",Engine:15,
   TestTarget:wrong==="MARKER"?null:"UQP_AUTHORIZED_CHART_TEST_ONLY"}]:Object.entries(manifest.modules).slice(0,wrong==="MISSING"?1:undefined).map(([Name,Digest])=>({Name,Digest:wrong==="HASH"?"0".repeat(64):Digest,Disabled:wrong==="DISABLED"?1:0}))})})} as unknown as Pick<sql.ConnectionPool,"request">;
  const run=()=>attestChartAuthorizedTest(pool,parseChartAuthorizedTest(config(),"test",now)!);
  if(wrong==="NONE")await run();else await assert.rejects(run);
 }
});
test("test installer sources are exact, separately guarded, non-disposable and contain no data fixtures or grants",()=>{
 const base=new URL("../../../../database/authorized-test/",import.meta.url),m=JSON.parse(readFileSync(new URL("928_source_manifest.json",base),"utf8"));
 for(const [name,digest] of Object.entries(m.files)){
  const text=readFileSync(new URL(name,base),"utf8");assert.equal(createHash("sha256").update(text).digest("hex"),digest);
  assert.match(text,/@UqpTestServer/);assert.match(text,/@UqpTestDatabase/);assert.match(text,/@UqpTestLogin/);
  assert.doesNotMatch(text,/UQP_CHART_TEST_DISPOSABLE|CREATE LOGIN|GRANT EXECUTE|UPDATE @approvedChecks/);
 }
 assert.equal(Object.keys(m.modules).length,8);
 const reviewed=readFileSync(new URL("../../../../database/review/928_dashboard_chart_trust_base.production-review.sql.txt",import.meta.url),"utf8");
 assert.match(reviewed,/THROW 51928,'CHART_928_PRODUCTION_REVIEW_NOT_APPROVED'/);
});
test("test installer never connects without an explicit valid server-side test approval",async()=>{
 const {installChart928AuthorizedTest}=await import("../../scripts/installChart928AuthorizedTest.js");let calls=0;
 await assert.rejects(installChart928AuthorizedTest("apply",async()=>{calls++;return null;}),/CHART_EXPLICIT_TEST_APPROVAL_FILE_REQUIRED/);
 assert.equal(calls,0);
});
