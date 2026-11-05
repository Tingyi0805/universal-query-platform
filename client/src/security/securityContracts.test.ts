import test from "node:test";
import assert from "node:assert/strict";
import { patientAuditView, columnApprovals, basicDashboardParameters, securityGuidance } from "./securityContracts";

test("audit view accepts only verified shape and canonical BIGINT version strings", () => {
  const value = { config: null, version: "0", status: "NOT_CONFIGURED", metadataStatus: "CONFIRMED", columns: ["MRN", "NAME"] };
  assert.equal(patientAuditView(value).version, "0");
  for (const patch of [{ version: 0 }, { version: "01" }, { version: "9223372036854775808" }, { version: "1" }, { columns: ["MRN", "mrn"] }, { status: "private SQL Bind" }])
    assert.throws(() => patientAuditView({ ...value, ...patch }));
  assert.equal(patientAuditView({ ...value, version: "9223372036854775807", config: { isEnabled: true, patientKeyColumn: "MRN", version: "9223372036854775807" } }).version, "9223372036854775807");
});
test("approval view projects only management fields and requires backend digest", () => {
  const value = { version: "a".repeat(64), dashboardId: 1, isActive: false, sources: [{ id: 1, sourceKey: "PRIMARY", datasetId: 3 }], deviceColumnMasks: { MRN: "CUSTOM" }, deviceColumnTypes: { MRN: "MRN" }, deviceSourceColumnMasks: {}, sql: "SELECT private" };
  assert.ok(!JSON.stringify(columnApprovals(value)).includes("SELECT"));
  for (const patch of [{ version: "guess" }, { deviceColumnMasks: { MRN: "unmasked private" } }, { sources: null }]) assert.throws(() => columnApprovals({ ...value, ...patch }));
});
test("ordinary settings cannot smuggle approvals through editable parameter JSON", () => {
  assert.deepEqual(basicDashboardParameters({ WARD: "TEST", LEGACY: { keep: true }, snapshotSeconds: 60 }), { WARD: "TEST", LEGACY: { keep: true }, snapshotSeconds: 60 });
  for (const key of ["deviceColumnMasks", "deviceColumnTypes", "deviceSourceColumnMasks"]) assert.throws(() => basicDashboardParameters({ [key]: {} }), { code: "DASHBOARD_APPROVAL_WRITE_REQUIRED" });
});
test("security hints never use private server messages or details", () => {
  for (const code of ["SECURITY_SCHEMA_REQUIRED", "PATIENT_AUDIT_FAILED", "PATIENT_AUDIT_NOT_CONFIGURED", "PATIENT_AUDIT_VERSION_CONFLICT", "DASHBOARD_APPROVAL_BINDING_CHANGED", "DASHBOARD_PREVIEW_STATE_CHANGED", "DASHBOARD_DEVICE_UNAUTHORIZED", "FORBIDDEN"]) {
    const result = securityGuidance({ code, message: "SELECT private Bind Token", detail: "patient secret" });
    assert.equal(result.code, code); assert.ok(!result.message.includes("SELECT")); assert.ok(!result.message.includes("patient secret"));
  }
  assert.equal(securityGuidance({ code: "PRIVATE_PATIENT_123" }).code, "REQUEST_FAILED");
});
