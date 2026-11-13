import assert from "node:assert/strict";
import test from "node:test";
import { isChartPlaybackApproved } from "./dashboardChartPlaybackApproval.policy.js";

const approved = {
  widgetId: 17, widgetRevision: "0123456789abcdef",
  configDigest: "a".repeat(64), reviewerUserId: 3,
  auditLogId: "42", status: "APPROVED" as const,
};

test("approved exact widget revision and digest is accepted", () => {
  assert.equal(isChartPlaybackApproved(approved, 17, approved.widgetRevision, approved.configDigest), true);
});

test("missing, revoked, edited, unaudited or unreviewed versions fail closed", () => {
  const check = (a: typeof approved | null, id = 17,
    revision = approved.widgetRevision, digest = approved.configDigest) =>
    isChartPlaybackApproved(a, id, revision, digest);
  assert.equal(check(null), false);
  assert.equal(check({...approved, status: "REVOKED"} as typeof approved), false);
  assert.equal(check(approved, 18), false);
  assert.equal(check(approved, 17, "fedcba9876543210"), false);
  assert.equal(check(approved, 17, approved.widgetRevision, "b".repeat(64)), false);
  assert.equal(check({...approved, reviewerUserId: 0}), false);
  assert.equal(check({...approved, auditLogId: "0"}), false);
});
