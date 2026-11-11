import assert from "node:assert/strict";
import test from "node:test";
import {
  CHART_928_GENERIC_MIGRATION_APPROVED,
  rejectUnapprovedChart928Migration,
} from "./chart928MigrationGate.js";

test("unapproved 928 cannot enter generic apply or adopt before DB connection",()=>{
  assert.equal(CHART_928_GENERIC_MIGRATION_APPROVED,false);
  for(const command of ["apply","adopt","apply-range","resume-916-to-919"]){
    assert.throws(()=>rejectUnapprovedChart928Migration(
      ["926_dashboard_device_lifecycle.sql","928_dashboard_chart_trust_schema.sql"],
      command,
    ),/CHART_928_GENERIC_MIGRATION_BLOCKED_INDEPENDENT_APPROVAL_REQUIRED/);
  }
});
test("status can inventory 928 without installation; ordinary migrations remain intact",()=>{
  assert.doesNotThrow(()=>rejectUnapprovedChart928Migration(
    ["928_dashboard_chart_trust_schema.sql"],"status"));
  assert.doesNotThrow(()=>rejectUnapprovedChart928Migration(
    ["925_dataset_display_schema.sql","926_dashboard_device_lifecycle.sql"],
    "apply"));
  assert.doesNotThrow(()=>rejectUnapprovedChart928Migration(
    ["928_dashboard_chart_trust_schema.sql.draft"],"apply"));
  assert.throws(()=>rejectUnapprovedChart928Migration(
    ["928_UNAPPROVED.SQL"],"apply"),/CHART_928_GENERIC_MIGRATION_BLOCKED/);
});
