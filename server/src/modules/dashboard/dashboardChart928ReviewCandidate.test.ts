// Static contract for Gate 2 review-only SQL source; no DB execution.
// Passing this test never authorizes a production migration.
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

const sourceUrl=new URL(
  "../../../../database/review/928_dashboard_chart_trust_base.production-review.sql.txt",
  import.meta.url,
);
const load=()=>readFile(sourceUrl,"utf8");

test("928 Gate 2 review source stays outside automatic installs and hard-stopped",async()=>{
  const sql=await load();
  assert.match(sql,/REVIEW ONLY \/ NOT A PRODUCTION INSTALLER/);
  const stop=sql.indexOf("THROW 51928,'CHART_928_PRODUCTION_REVIEW_NOT_APPROVED',1;");
  assert.ok(stop>=0);
  assert.ok(stop<sql.indexOf("SET XACT_ABORT ON;"));
  assert.doesNotMatch(sql,/\bINSERT\s+(?:INTO\s+)?uqp\.SchemaMigration\b/i);
  assert.doesNotMatch(sql,/\bCOMMIT\s+TRANSACTION\s*;/i);
  assert.match(sql,/IF @@TRANCOUNT<>1/);
});

test("928 review source requires independently pinned exact CHECK and filter definitions",async()=>{
  const sql=await load();
  for(const check of [
    "CK_DashboardWidget_Type","CK_ChartSeal_Digest",
    "CK_ChartTrustRequest_Action","CK_ChartReview_State","CK_ChartReview_Scope",
  ])assert.ok(sql.includes("N'"+check+"',NULL)"),check+" missing a fail-closed unapproved witness");
  assert.match(sql,/ApprovedDefinitionSha256 varbinary\(32\) NULL/);
  assert.match(sql,/CHART_928_CHECK_SOURCE_WITNESSES_NOT_APPROVED/);
  assert.match(sql,/HASHBYTES\('SHA2_256',CONVERT\(varbinary\(max\),c\.definition\)\)/);
  assert.match(sql,/@approvedActiveFilterSha256 varbinary\(32\)=NULL/);
  assert.match(sql,/CHART_928_FILTER_SOURCE_WITNESS_NOT_APPROVED/);
  assert.match(sql,/HASHBYTES\('SHA2_256',CONVERT\(varbinary\(max\),i\.filter_definition\)\)/);
});

test("928 review source verifies eight exact FK references and filtered-index keys",async()=>{
  const sql=await load();
  for(const tuple of [
    "N'FK_ChartSeal_Widget',N'DashboardChartWidgetSeal',N'WidgetId',N'DashboardWidget',N'Id'",
    "N'FK_ChartSeal_User',N'DashboardChartWidgetSeal',N'SealedBy',N'AppUser',N'Id'",
    "N'FK_ChartRequest_Actor',N'DashboardChartTrustRequest',N'ActorId',N'AppUser',N'Id'",
    "N'FK_ChartReview_Dashboard',N'DashboardChartPrivacyReview',N'DashboardId',N'Dashboard',N'Id'",
    "N'FK_ChartReview_Query',N'DashboardChartPrivacyReview',N'QueryId',N'QueryDefinition',N'Id'",
    "N'FK_ChartReview_Dataset',N'DashboardChartPrivacyReview',N'DatasetId',N'Dataset',N'Id'",
    "N'FK_ChartReview_Requester',N'DashboardChartPrivacyReview',N'RequestedByUserId',N'AppUser',N'Id'",
    "N'FK_ChartReview_Reviewer',N'DashboardChartPrivacyReview',N'ReviewerUserId',N'AppUser',N'Id'",
  ])assert.ok(sql.includes(tuple),tuple);
  assert.match(sql,/CHART_928_EXACT_FOREIGN_KEY_MISMATCH/);
  assert.match(sql,/fk\.is_disabled=0 AND fk\.is_not_trusted=0/);
  assert.match(sql,/fk\.delete_referential_action=0 AND fk\.update_referential_action=0/);
  assert.match(sql,/SELECT \* FROM @expectedFk EXCEPT SELECT \* FROM @actualFk/);
  assert.match(sql,/SELECT \* FROM @actualFk EXCEPT SELECT \* FROM @expectedFk/);
  for(const tuple of ["(1,N'DashboardId')","(2,N'QueryId')","(3,N'DatasetId')",
    "(4,N'SourceKey')","(5,N'CategoryColumn')","(6,N'ValueColumn')"])
    assert.ok(sql.includes(tuple),tuple);
  assert.match(sql,/ic\.is_descending_key=0/);
  // A seventh descending key is filtered out above: count all keys explicitly.
  assert.match(sql,/AND i\.name=N'UX_ChartReview_Active' AND ic\.key_ordinal>0\)<>6/);
  assert.match(sql,/CHART_928_EXACT_INDEX_KEY_MISMATCH/);
});
