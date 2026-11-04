import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
const draft = readFileSync(new URL("../../../../database/drafts/928_dashboard_chart_trust_schema.sql.draft", import.meta.url),"utf8");
const executable=draft.replace(/--[^\n]*/g,"");
test("2B-12 stays outside the automatic migration scanner",()=>{
  assert.match(import.meta.url,/server\/src\/modules\/dashboard\/dashboardChart928Draft.test.ts/);
  assert.match(draft,/NON-SCANNED DRAFT/);
  // .sql.draft files must never enter the generic SQL inventory or migration scanner.
  assert.equal(new URL("../../../../database/drafts/928_dashboard_chart_trust_schema.sql.draft",import.meta.url)
    .pathname.endsWith(".sql"),false);
  assert.match(executable,/SET XACT_ABORT ON/);
  assert.match(executable,/SAVE TRANSACTION Chart928Draft/);
  assert.match(executable,/sp_getapplock/);
  assert.match(executable,/CHART_928_PREREQUISITES_REQUIRED/);
  assert.doesNotMatch(executable,/\bDROP TABLE\b|\bTRUNCATE TABLE\b|\bDELETE FROM\b/i);
  assert.doesNotMatch(executable,/\bUPDATE uqp\.(Dashboard|DashboardWidget|DashboardDisplayProfile)\b/i);
});
test("2B-12 preserves fail-closed CHART runtime and append-only trust records",()=>{
  for(const n of ["DashboardChartWidgetSeal","DashboardChartPrivacyReview","DashboardChartTrustRequest"]){
    assert.match(executable,new RegExp("CREATE TABLE uqp\\."+n));
  }
  for(const n of ["TR_DashboardWidget_ChartFreeze","TR_ChartSeal_DeleteBlock",
    "TR_ChartReview_Transition","TR_ChartTrustRequest_Immutable"]){
    assert.match(executable,new RegExp("TRIGGER uqp\\."+n));
  }
  assert.match(executable,/CHART_928_WIDGET_FROZEN/);
  assert.match(executable,/CHART_928_SEAL_DELETE_BLOCKED/);
  assert.match(executable,/CHART_928_REVIEW_IMMUTABLE/);
  assert.match(executable,/CHART_928_LEDGER_IMMUTABLE/);
  assert.match(executable,/UX_ChartReview_Active/);
  assert.match(executable,/CHART_928_PARTIAL_SCHEMA/);
  assert.match(executable,/CHART_928_FOREIGN_KEY_INVALID/);
  assert.match(executable,/CHART_928_TRIGGERS_REQUIRED/);
});
