// 2B-15D-13: FAST, SQL-server-independent release-blocking contract checks.
// Executed by server/npm test even when D1 SQL jobs are unavailable.
// These do NOT replace real SQL 2019/2022 integration acceptance.
import assert from "node:assert/strict";
import test from "node:test";
import {readFile} from "node:fs/promises";
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

const draftPath=new URL(
 "../../../database/drafts/928_chart_atomic_create_with_delegation.sql.draft",
 import.meta.url,
);
const loadDraft=()=>readFile(draftPath,"utf8");

test("2B-15D-13 runtime and both independent procedure approvals stay closed",()=>{
 assert.equal(CHART_ATOMIC_CREATE_RUNTIME_ENABLED,false);
 assert.equal(CHART_WRITER_DB_ACTOR_BINDING_APPROVED,false);
 assert.equal(CHART_WRITER_APPROVED_PROCEDURE_SHA256,null);
 assert.equal(CHART_ISSUER_APPROVED_PROCEDURE_SHA256,null);
});

test("2B-15D-13 SQL delegated prototype remains disposable and unapproved",async()=>{
 const source=await loadDraft();
 assert.match(source,/NON-SCANNED DRAFT/);
 assert.match(source,/p\.Code IN \(N''DESIGN_QUERY'',N''EXECUTE_QUERY''\)\s+GROUP BY u\.Id HAVING COUNT\(DISTINCT p\.Code\)=2/,
   "SQL Writer must recheck both Query privileges");
 assert.match(source,/IF LEFT\(DB_NAME\(\),7\)<>N'UQP_CH_' OR LEN\(DB_NAME\(\)\)<>19/);
 assert.match(source,/CHART_DELEGATED_DISPOSABLE_ONLY/);
 assert.match(source,/CHART_DELEGATED_FIXTURE_REQUIRED/);
 assert.match(source,/IF @@TRANCOUNT<>0/);
 assert.match(source,/WITH EXECUTE AS OWNER/);
 assert.match(source,/DENY EXECUTE ON OBJECT::uqp\.usp_ChartCreate_IsolatedDraft TO \[UQP_Chart_Writer\]/);
 assert.match(source,/GRANT EXECUTE ON OBJECT::uqp\.usp_ChartCreateWithDelegation_IsolatedDraft\s+TO \[UQP_Chart_Writer\]/);
 // Ignore explanatory comments (e.g. "No SchemaMigration changed") while
 // rejecting any executable production-login/migration statement.
 const executable=source.replace(/^--.*$/gm,"");
 assert.doesNotMatch(executable,/\b(?:CREATE LOGIN|ALTER LOGIN|CREATE USER \[UQP_Chart_Real|USE \[UniversalQueryPlatform|SchemaMigration)\b/i);
});

test("signed Writer denies case-insensitive SQL SourceKey aliases before grant consume",async()=>{
 const source=await loadDraft();
 assert(source.includes("JSON_VALUE(@ConfigJson,N''$.dataSourceKey'') COLLATE Latin1_General_100_BIN2"));
 assert(source.includes("d.SourceKey COLLATE Latin1_General_100_BIN2"));
 assert(source.includes("= @SourceKey COLLATE Latin1_General_100_BIN2"));
 assert(source.includes("UPPER(@SourceKey)=N''PRIMARY''"));
});

test("signed Writer rechecks live Query ACL and source in its own transaction before grant use",async()=>{
 const source=await loadDraft();
 const tx=source.indexOf("BEGIN TRANSACTION;");
 const query=source.indexOf("CHART_DRAFT_QUERY_SCOPE_REVOKED");
 const lock=source.indexOf("SELECT 1 FROM uqp.ChartActorDelegationDisposable WITH(UPDLOCK,HOLDLOCK)");
 assert(tx>=0 && query>tx && lock>query,
   "Query policy check must run inside Writer transaction, before consuming grant");
 for(const clause of [
   "d.QueryMode=N''QUERY_ONLY''","d.QueryModeVersion>0",
   "d.QuerySourceMaxRows IS NOT NULL",
   "q.IsPublished=1","q.IsActive=1","q.IsArchived=0",
   "dt.IsActive=1","dt.IsArchived=0","src.IsActive=1",
   "bs.SourceKey COLLATE Latin1_General_100_BIN2",
   "NOT EXISTS(\n       SELECT 1 FROM uqp.DashboardDataSource shadow",
   "uqp.DatasetParameter dp WITH(HOLDLOCK)",
   "uqp.RoleQueryAccess ra WITH(HOLDLOCK)",
   "uqp.UserQueryAccess ua WITH(HOLDLOCK)",
   "ua.CanView=1","ua.CanExecute=1",
   "ra.CanView=1","ra.CanExecute=1",
 ])assert(source.includes(clause),"Missing same-transaction Query authorization: "+clause);
});

test("2B-15D-13 GrantId PK lock precedes DB-time check and complete scope",async()=>{
 const source=await loadDraft();
 const lock="SELECT 1 FROM uqp.ChartActorDelegationDisposable WITH(UPDLOCK,HOLDLOCK)";
 const acquire=source.indexOf(lock);
 const now="DECLARE @consumeAt DATETIME2(3)=SYSUTCDATETIME();";
 const clock=source.indexOf(now);
 const scope="SELECT 1 FROM uqp.ChartActorDelegationDisposable d WITH(UPDLOCK,HOLDLOCK)";
 const verify=source.indexOf(scope);
 const consume="UPDATE uqp.ChartActorDelegationDisposable SET ConsumedAtUtc=@consumeAt";
 const mark=source.indexOf(consume);
 assert(acquire>=0 && clock>acquire && verify>clock && mark>verify,
   "lock PK first, read current DB clock second, verify full scope third, consume last");
 assert.equal(source.split(now).length-1,1);
 for(const condition of [
   "d.GrantId=@GrantId","d.SecretSha256=HASHBYTES(",
   "d.ActorId=@ActorId","d.TokenVersion=@TokenVersion",
   "d.DashboardId=@DashboardId","d.ProfileId=@ProfileId",
   "d.RequestId=@RequestId",
   "d.SourceKey COLLATE Latin1_General_100_BIN2",
   "= @SourceKey COLLATE Latin1_General_100_BIN2",
   "d.ConfigSha256=@digest","d.X=@X","d.Y=@Y",
   "d.Width=@Width","d.Height=@Height","d.IsRevoked=0",
   "d.ConsumedAtUtc IS NULL","d.IssuedAtUtc<=@consumeAt",
   "d.ExpiresAtUtc>@consumeAt",
 ])assert(source.includes(condition),"Missing grant scope: "+condition);
});

test("2B-15D-13 Grant, Ledger, Audit, Widget and Seal share the transaction",async()=>{
 const source=await loadDraft();
 const statements=[
   "BEGIN TRANSACTION;",
   "UPDATE uqp.ChartActorDelegationDisposable SET ConsumedAtUtc=@consumeAt",
   "INSERT uqp.DashboardChartTrustRequest(RequestId,Action,ActorId)",
   "INSERT uqp.AuditLog(EventType,EventCategory,IsImportant,UserId",
   "INSERT uqp.DashboardChartCreatePermit(SessionId,TransactionId,ProfileId",
   "INSERT uqp.DashboardWidget(ProfileId,WidgetType,Title,SourceKey",
   "INSERT uqp.DashboardChartWidgetSeal(WidgetId,ConfigDigest,IsActive,SealedBy,AuditLogId)",
   "OUTPUT INSERTED.SealRowVersion INTO @sealRows(Revision)",
   "DELETE uqp.DashboardChartCreatePermit",
   "COMMIT TRANSACTION;",
 ];
 let pos=-1;
 for(const sql of statements){
   const next=source.indexOf(sql,pos+1);
   assert(next>pos,"Atomic SQL order missing: "+sql);
   pos=next;
 }
 assert.match(source,/BEGIN CATCH\s+IF XACT_STATE\(\)<>0 ROLLBACK TRANSACTION;/);
 assert.match(source,/COMMIT TRANSACTION;\s+SET TRANSACTION ISOLATION LEVEL READ COMMITTED;/);
 assert.match(source,/CONVERT\(varchar\(20\),@AuditId\) AS AuditLogId/);
 assert.match(source,/@SealRevision AS SealRevision/);
 assert.match(source,/CHART_DRAFT_SEAL_RECEIPT_REQUIRED/);
 assert.match(source,/DATALENGTH\(@SealRevision\)<>16/);
 assert.match(source,/ROLLBACK TRANSACTION;\s+SET TRANSACTION ISOLATION LEVEL READ COMMITTED;/);
});


test("2B-15D-11 unsafe Issuer witness requires previously authorized Actor 77",async()=>{
 const acceptance=await readFile(
   new URL("./chart928DraftSqlAcceptance.ts",import.meta.url),"utf8");
 const initialStage=acceptance.indexOf("ATOMIC_CREATE_VALID_OTHER_ACTOR_IMPERSONATION_WITNESS");
 const assignment=acceptance.indexOf(
   'INSERT uqp.UserRole(UserId,RoleId) VALUES(77,1)',initialStage);
 const stage=acceptance.indexOf("DELEGATED_CREATE_ISSUER_ACTOR_SPOOF_WITNESS_BLOCKED");
 const check=acceptance.indexOf("const actor77Authorized=",stage);
 const issuer=acceptance.indexOf("const forgedIssuerGrant=await issue(",check);
 const requireActor=acceptance.indexOf(
   '"00000000-0000-4000-8000-000000008077",77',issuer);
 const label=acceptance.indexOf(
   "CHART_2B15D11_ISSUER_ACTOR_SPOOFING_REPRODUCED_RELEASE_BLOCKED",requireActor);
 assert(initialStage>=0&&assignment>initialStage&&stage>assignment&&
        check>stage&&issuer>check&&requireActor>issuer&&label>requireActor,
   "The separate authorized actor must exist before Issuer spoofing is demonstrated");
 assert.match(acceptance,/u\.Id=77 AND u\.IsActive=1 AND u\.TokenVersion=1/);
 assert.match(acceptance,/p\.Code=N'DESIGN_QUERY'/);
 // No duplicate grant or role teardown may alter this already-established fixture.
 const witness=acceptance.slice(stage,label);
 assert.doesNotMatch(witness,/INSERT uqp\.UserRole\(UserId,RoleId\) VALUES\(77,1\)/);
});

test("2B-15D-13 both disposable grant endpoints require dual live Query privileges",async()=>{
 const sqlText=await readFile(new URL(
   "../../../database/drafts/928_chart_actor_delegation_disposable.sql.draft",
   import.meta.url),"utf8");
 const auth=/p\.Code IN \(N''DESIGN_QUERY'',N''EXECUTE_QUERY''\)\s+GROUP BY u\.Id HAVING COUNT\(DISTINCT p\.Code\)=2/g;
 assert.equal([...sqlText.matchAll(auth)].length,2);
});
