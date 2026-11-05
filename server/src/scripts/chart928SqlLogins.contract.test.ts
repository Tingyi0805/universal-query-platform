// 2B-15D-17: static guard only. Real SQL logins exist ONLY inside D1
// disposable SQL Server containers and are removed before container teardown.
import assert from "node:assert/strict";
import test from "node:test";
import {readFile} from "node:fs/promises";
import {CHART_ATOMIC_CREATE_RUNTIME_ENABLED}
 from "../modules/dashboard/dashboardChartAtomicCreate.contract.js";
import {CHART_WRITER_DB_ACTOR_BINDING_APPROVED,
 CHART_WRITER_APPROVED_PROCEDURE_SHA256}
 from "../modules/dashboard/dashboardChartWriterBoundary.js";
import {CHART_ISSUER_APPROVED_PROCEDURE_SHA256}
 from "../modules/dashboard/dashboardChartIssuerBoundary.js";

test("2B-15D-17 CI real SQL logins are disposable, least-rights and cleaned",async()=>{
 const source=await readFile(new URL(
  "./chart928SqlLoginIsolationAcceptance.ts",import.meta.url),"utf8");
 const main=await readFile(new URL(
  "./chart928DraftSqlAcceptance.ts",import.meta.url),"utf8");
 assert.match(source,/process\.env\.UQP_D1_SCOPE!=="DISPOSABLE_ONLY"/);
 assert.match(source,/config\.server!=="127\.0\.0\.1"\|\|config\.port!==14336/);
 assert.match(source,/master\?\.Db!=="master"/);
 assert.match(source,/\^UQP_CH_\[a-f0-9\]\{12\}\$/);
 assert.match(source,/CREATE LOGIN/);
 assert.match(source,/CREATE USER/);
 assert.match(source,/ORIGINAL_LOGIN\(\)/);
 assert.match(source,/SUSER_SID\(ORIGINAL_LOGIN\(\)\)/);
 assert.match(source,/GRANT EXECUTE ON OBJECT::uqp\.usp_ChartDelegationIssueSigned_IsolatedDraft TO /);
 assert.match(source,/DENY EXECUTE ON OBJECT::uqp\.usp_ChartDelegationIssue_IsolatedDraft TO /);
 assert.match(source,/GRANT EXECUTE ON OBJECT::uqp\.usp_ChartCreateWithDelegation_IsolatedDraft TO /);
 assert.match(source,/DROP USER/);
 assert.match(source,/DROP LOGIN/);
 assert.match(source,/await pools\[role\]\?\.close\(\)/);
 assert.match(source,/Buffer\.compare\(row\.SecretSha256/);
 assert.match(source,/CHART_2B15D17_DISPOSABLE_REAL_SQL_LOGIN_SID_GRANT_ATTESTED_PASS/);
 assert.match(source,/CHART_2B15D17_INDEPENDENT_HTTP_SIGNER_AND_PRODUCTION_LOGIN_RELEASE_BLOCKED/);
 assert.match(main,/verifyChartIssuerMacDisposable\(db!,admin,config,machine\)/);
 assert.equal(CHART_ATOMIC_CREATE_RUNTIME_ENABLED,false);
 assert.equal(CHART_WRITER_DB_ACTOR_BINDING_APPROVED,false);
 assert.equal(CHART_WRITER_APPROVED_PROCEDURE_SHA256,null);
 assert.equal(CHART_ISSUER_APPROVED_PROCEDURE_SHA256,null);
});
