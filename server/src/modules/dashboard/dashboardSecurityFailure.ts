import { SecurityContractError } from "../securityContract/securityContract.js";
import { PatientAuditError } from "../dataset/patientAuditConfig.service.js";
import { DashboardApprovalError } from "./dashboardApproval.service.js";
const codes = new Set(["SECURITY_SCHEMA_REQUIRED", "PATIENT_AUDIT_NOT_CONFIRMED", "PATIENT_AUDIT_NOT_CONFIGURED", "PATIENT_AUDIT_KEY_UNAVAILABLE",
  "PATIENT_KEY_INVALID", "METADATA_UNCONFIRMED", "METADATA_AMBIGUOUS"]);
/** Only owned error types and allowlisted codes, never driver messages/details. */
export function dashboardSecurityFailure(error: unknown): { code: string; status: number } | null {
  return (error instanceof SecurityContractError || error instanceof PatientAuditError || error instanceof DashboardApprovalError) && codes.has(error.code)
    ? { code: error.code, status: error.status } : null;
}
