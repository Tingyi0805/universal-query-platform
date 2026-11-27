import assert from "node:assert/strict";
import test from "node:test";
import { resolveDatasetPreviewSafety } from "./datasetManagementApproval.previewSafety.js";
import { DatasetDeliverySnapshotError } from "./datasetDeliveryPolicy.repository.js";

test("preview safety never loads policy when usage is not approved", async () => {
  let called = false;
  const result = await resolveDatasetPreviewSafety(false, async () => {
    called = true;
    throw new Error("should not be read");
  });
  assert.equal(result.code, "USAGE_NOT_APPROVED");
  assert.equal(result.status, "BLOCKED");
  assert.equal(called, false);
});

test("missing sensitivity revision is blocked even when manager approved usage", async () => {
  const result = await resolveDatasetPreviewSafety(true, async () => {
    throw new DatasetDeliverySnapshotError("DATASET_DELIVERY_POLICY_UNCONFIRMED");
  });
  assert.equal(result.code, "POLICY_UNCONFIRMED");
  assert.equal(result.status, "BLOCKED");
});

test("invalid policy and unavailable repository fail closed without returning technical exceptions", async () => {
  const invalid = await resolveDatasetPreviewSafety(true, async () => {
    throw new DatasetDeliverySnapshotError("DATASET_DELIVERY_POLICY_INVALID");
  });
  assert.equal(invalid.code, "POLICY_INVALID");
  const unavailable = await resolveDatasetPreviewSafety(true, async () => {
    throw new Error("SYNTHETIC_SQL_CREDENTIAL_PRIVATE");
  });
  assert.equal(unavailable.code, "POLICY_UNAVAILABLE");
  assert.ok(!JSON.stringify(unavailable).includes("SYNTHETIC_SQL_CREDENTIAL_PRIVATE"));
});

test("confirmed sensitivity revision is only advisory, not a preview or playback grant", async () => {
  const value = await resolveDatasetPreviewSafety(true, async () => ({
    datasetId: 1, definitionVersion: "0000000000000001",
    sensitivityVersion: "1", patientAuditVersion: "0",
    patientAudit: { configured: false, enabled: false, patientKeyColumn: null },
    policy: { state: "CONFIRMED", version: "1", rules: [] },
  }));
  assert.equal(value.code, "POLICY_CONFIRMED");
  assert.equal(value.status, "POLICY_CONFIRMED");
  assert.match(value.message, /執行時重新驗證/);
});

test("enabled but incomplete patient audit stays blocked even with confirmed sensitivity", async () => {
  const value = await resolveDatasetPreviewSafety(true, async () => ({
    datasetId: 1, definitionVersion: "0000000000000001",
    sensitivityVersion: "1", patientAuditVersion: "1",
    patientAudit: { configured: false, enabled: true, patientKeyColumn: null },
    policy: { state: "CONFIRMED", version: "1", rules: [] },
  }));
  assert.equal(value.code, "PATIENT_AUDIT_UNCONFIRMED");
  assert.equal(value.status, "BLOCKED");
});
