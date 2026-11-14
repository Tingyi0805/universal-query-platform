import assert from "node:assert/strict";
import test from "node:test";
import { validatePlaybackApprovalRow } from "./dashboardChartPlaybackApproval.repository.js";

const valid = {
  DashboardId: 7, WidgetId: 88, WidgetRevision: Buffer.from("aaaaaaaaaaaaaaaa", "hex"),
  ConfigDigest: "b".repeat(64), ReviewerUserId: 3, AuditLogId: "42",
  Status: "APPROVED", ReviewerIsActiveAdmin: true, AuditReceiptVerified: true,
};
test("trusted SQL approval row maps exact widget version and audit evidence", () => {
  assert.deepEqual(validatePlaybackApprovalRow(valid), {
    widgetId: 88, widgetRevision: "a".repeat(16), configDigest: "b".repeat(64),
    reviewerUserId: 3, auditLogId: "42", status: "APPROVED",
    reviewerIsActiveAdmin: true, auditReceiptVerified: true,
  });
});
test("missing, ambiguous or invalid trust evidence cannot create approval", () => {
  for (const row of [
    null, {...valid, Status:"REVOKED"}, {...valid, ReviewerIsActiveAdmin:false},
    {...valid, AuditReceiptVerified:false}, {...valid, WidgetRevision:Buffer.alloc(7)},
    {...valid, ConfigDigest:"invalid"}, {...valid, AuditLogId:"0"},
    {...valid, ReviewerUserId:0}, {...valid, WidgetId:0},
  ]) assert.equal(validatePlaybackApprovalRow(row), null);
});

test("approval from another dashboard or widget cannot authorize requested playback", () => {
  assert.equal(validatePlaybackApprovalRow(valid, 8, 88), null);
  assert.equal(validatePlaybackApprovalRow(valid, 7, 89), null);
  assert.ok(validatePlaybackApprovalRow(valid, 7, 88));
});
