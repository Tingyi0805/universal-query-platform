// Gate 3 Option A source review contract. STATIC ONLY: NEVER executes SQL.
// Does not approve, install, attest or enable the proposed Writer procedure.
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";
import {chartLocalJwtWriterCreateSql} from "./dashboardChartLocalJwtSqlCreate.js";
import {CHART_CREATE_HTTP_RELEASE_APPROVED} from "./dashboardChartCreate.routes.js";
import {CHART_LOCAL_JWT_WRITER_RELEASE_APPROVED} from "./dashboardChartLocalJwtSqlCreate.js";
import {CHART_928_GENERIC_MIGRATION_APPROVED} from "../../scripts/chart928MigrationGate.js";

const candidateUrl=new URL(
  "../../../../database/review/928_chart_local_jwt_writer.production-review.sql.txt",
  import.meta.url,
);
const load=()=>readFile(candidateUrl,"utf8");

test("Option A reviewed SQL candidate is non-scanned and hard-stopped twice",async()=>{
  const sql=await load();
  assert.equal(
    sql.split("\n").map(l=>l.trim()).find(l=>l&&!l.startsWith("--")),
    "THROW 51928,'CHART_A_WRITER_PRODUCTION_REVIEW_NOT_APPROVED',1;",
  );
  assert.match(sql,/@approvedFrozenTriggerDefinitionSha256 VARBINARY\(32\)=NULL/);
  assert.match(sql,/@approvedWriterOriginalSid VARBINARY\(85\)=NULL/);
  assert.match(sql,/SUSER_SID\(ORIGINAL_LOGIN\(\)\)<>@approvedWriterOriginalSid/);
  assert.match(sql,/IF @@TRANCOUNT<>1/);
  assert.doesNotMatch(sql,/^\s*(?:GRANT\s+EXECUTE|CREATE\s+LOGIN|INSERT\s+(?:INTO\s+)?uqp\.SchemaMigration)\b/im);
  assert.equal(CHART_928_GENERIC_MIGRATION_APPROVED,false);
  assert.equal(CHART_CREATE_HTTP_RELEASE_APPROVED,false);
  assert.equal(CHART_LOCAL_JWT_WRITER_RELEASE_APPROVED,false);
});

test("Option A SQL procedure matches application ABI without Signer/Issuer grant",async()=>{
  const sql=await load();
  assert.match(chartLocalJwtWriterCreateSql,/EXEC uqp\.usp_DashboardChartCreate\s/);
  assert.match(sql,/CREATE PROCEDURE uqp\.usp_DashboardChartCreate\s/);
  for(const arg of [
    "@DashboardId bigint","@ProfileId bigint","@ActorId bigint",
    "@TokenVersion int","@RequestId uniqueidentifier",
    "@SourceKey nvarchar(64)","@ConfigJson nvarchar(max)",
    "@X int","@Y int","@Width int","@Height int",
  ])assert.ok(sql.includes(arg),arg);
  assert.doesNotMatch(sql,/@GrantId|@Secret|@Signature|@SqlMac/);
  assert.doesNotMatch(sql,/\bEXEC\s+uqp\.usp_ChartDelegationIssue/);
  assert.match(sql,/SELECT @WidgetId AS WidgetId,CONVERT\(varchar\(20\),@AuditId\) AS AuditLogId/);
  assert.match(sql,/@digest AS Digest,@SealRevision AS SealRevision/);
});

test("Option A SQL retains same-transaction authorization, replay, one-use permit and audit",async()=>{
  const sql=await load();
  for(const evidence of [
    "SET TRANSACTION ISOLATION LEVEL SERIALIZABLE",
    "WITH(UPDLOCK,HOLDLOCK)",
    "u.TokenVersion=@TokenVersion",
    "COUNT(DISTINCT p.Code)=2",
    "ua.CanView=1","ua.CanExecute=1",
    "bs.QueryBindingRevision>=1",
    "INSERT uqp.DashboardChartTrustRequest(RequestId,Action,ActorId)",
    "INSERT uqp.AuditLog(",
    "INSERT uqp.DashboardWidget(",
    "INSERT uqp.DashboardChartWidgetSeal(",
    "CHART_A_PERMIT_SINGLE_ROW_REQUIRED",
    "CHART_A_WIDGET_PERMIT_REQUIRED",
    "IsConsumed=0","IsConsumed=1",
    "DATALENGTH(p.SourceKey)=DATALENGTH(i.SourceKey)",
    "DATALENGTH(p.ConfigJson)=DATALENGTH(i.ConfigJson)",
    "CREATE TABLE uqp.DashboardChartCreatePermit",
  ])assert.ok(sql.includes(evidence),evidence);
  for(const key of [
    "dataSourceKey","version","valueMode","chartType",
  ])assert.ok(sql.includes("JSON_VALUE(@ConfigJson,N''$."+key+"'') IS NULL"),key);
  assert.match(sql,/IF XACT_STATE\(\)<>0 ROLLBACK TRANSACTION/);
  assert.match(sql,/WITH EXECUTE AS OWNER/);
  assert.match(sql,/ALTER TRIGGER uqp\.TR_DashboardWidget_ChartFreeze/);
});
