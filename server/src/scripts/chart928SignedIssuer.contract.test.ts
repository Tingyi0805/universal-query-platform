// 2B-15D-15: static tripwire against reverting the disposable SQL atomic Issuer.
// No live SQL, JWT, environment secrets, production routes or migrations.
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";
import {
 CHART_ATOMIC_CREATE_RUNTIME_ENABLED,
} from "../modules/dashboard/dashboardChartAtomicCreate.contract.js";
import {
 CHART_WRITER_APPROVED_PROCEDURE_SHA256,
 CHART_WRITER_DB_ACTOR_BINDING_APPROVED,
} from "../modules/dashboard/dashboardChartWriterBoundary.js";
import {
 CHART_ISSUER_APPROVED_PROCEDURE_SHA256,
} from "../modules/dashboard/dashboardChartIssuerBoundary.js";

const read=()=>readFile(new URL(
 "../../../database/drafts/928_chart_signed_issuer_atomic_disposable.sql.draft",
 import.meta.url),"utf8");

test("2B-15D-15 signed issuer cannot fall back to unrestricted ActorId issuance",async()=>{
 const source=await read();
 assert.match(source,/DISPOSABLE.*NOT a production migration/i);
 assert.match(source,/IF LEFT\(DB_NAME\(\),7\)<>N'UQP_CH_' OR LEN\(DB_NAME\(\)\)<>19/);
 assert.match(source,/DENY EXECUTE ON OBJECT::uqp\.usp_ChartDelegationIssue_IsolatedDraft\s+TO \[UQP_Chart_IssuerSynthetic\]/);
 assert.match(source,/GRANT EXECUTE ON OBJECT::uqp\.usp_ChartDelegationIssueSigned_IsolatedDraft\s+TO \[UQP_Chart_IssuerSynthetic\]/);
 assert.match(source,/DENY EXECUTE ON OBJECT::uqp\.usp_ChartDelegationIssueSigned_IsolatedDraft\s+TO \[UQP_Chart_Writer\]/);
 const logic=source.replace(/^--.*$/gm,"");
 assert.doesNotMatch(logic,/\b(?:CREATE LOGIN|ALTER LOGIN|SchemaMigration|USE \[UniversalQueryPlatform)\b/i);
 assert.equal(CHART_ATOMIC_CREATE_RUNTIME_ENABLED,false);
 assert.equal(CHART_WRITER_DB_ACTOR_BINDING_APPROVED,false);
 assert.equal(CHART_WRITER_APPROVED_PROCEDURE_SHA256,null);
 assert.equal(CHART_ISSUER_APPROVED_PROCEDURE_SHA256,null);
});

test("2B-15D-15 signature, nonce, actor and grant share one transaction",async()=>{
 const s=await read();
 const order=[
  "BEGIN TRANSACTION;",
  "FROM uqp.ChartIssuerMacPadsDisposable WITH(UPDLOCK,HOLDLOCK)",
  "IF @verified IS NULL OR @verified<>@Signature",
  "FROM uqp.ChartIssuerProofNonceDisposable WITH(UPDLOCK,HOLDLOCK)",
  "FROM uqp.DashboardDisplayProfile WITH(UPDLOCK,HOLDLOCK)",
  "FROM uqp.AppUser u WITH(UPDLOCK,HOLDLOCK)",
  "INSERT uqp.ChartIssuerProofNonceDisposable(Nonce,ActorId,ConsumedAtUtc)",
  "INSERT uqp.ChartActorDelegationDisposable(",
  "COMMIT TRANSACTION;",
 ];
 let last=-1;
 for(const part of order){
  const next=s.indexOf(part,last+1);
  assert(next>last,"Missing or misordered signed issuance step: "+part);
  last=next;
 }
 assert.match(s,/SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;/);
 assert.match(s,/p\.Code IN \(N''DESIGN_QUERY'',N''EXECUTE_QUERY''\)\s+GROUP BY u\.Id HAVING COUNT\(DISTINCT p\.Code\)=2/,
   "SQL Issuer must recheck both effective Query permissions in its transaction");
 assert.match(s,/BEGIN CATCH\s+IF XACT_STATE\(\)<>0 ROLLBACK TRANSACTION;/);
 assert.match(s,/SET @GrantId=NULL;SET @Secret=NULL;\s+THROW;/);
});
