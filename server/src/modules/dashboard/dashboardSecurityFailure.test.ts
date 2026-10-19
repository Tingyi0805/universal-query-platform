import test from "node:test";
import assert from "node:assert/strict";
import { dashboardSecurityFailure } from "./dashboardSecurityFailure.js";
import { SecurityContractError } from "../securityContract/securityContract.js";
import { PatientAuditError } from "../dataset/patientAuditConfig.service.js";
test("known Dashboard security errors expose code/status only", () => {
  const error = new SecurityContractError("SECURITY_SCHEMA_REQUIRED"); error.message = "SELECT private Bind patient Token";
  assert.deepEqual(dashboardSecurityFailure(error), { code: "SECURITY_SCHEMA_REQUIRED", status: 503 });
  assert.deepEqual(dashboardSecurityFailure(new PatientAuditError("PATIENT_AUDIT_NOT_CONFIRMED", 503)), { code: "PATIENT_AUDIT_NOT_CONFIRMED", status: 503 });
});
test("driver errors cannot impersonate a safe error or inject arbitrary code text", () => {
  assert.equal(dashboardSecurityFailure(Object.assign(new Error("private"), { code: "SECURITY_SCHEMA_REQUIRED", status: 503 })), null);
  assert.equal(dashboardSecurityFailure(new PatientAuditError("SELECT_PATIENT_PRIVATE")), null);
});
