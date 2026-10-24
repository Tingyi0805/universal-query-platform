import { DatasetDisplayError } from "../dataset/datasetDisplaySchema.js";
import { SecurityContractError } from "../securityContract/securityContract.js";
import { PatientAuditError } from "../dataset/patientAuditConfig.service.js";
import { DashboardApprovalError } from "./dashboardApproval.service.js";
const codes = new Set(["DATASET_DISPLAY_SCHEMA_REQUIRED","DATASET_DISPLAY_SENSITIVITY_INVALID","DATASET_DISPLAY_UNAVAILABLE","DATASET_DISPLAY_WRITE_FAILED","SECURITY_SCHEMA_REQUIRED", "PATIENT_AUDIT_NOT_CONFIRMED", "PATIENT_AUDIT_NOT_CONFIGURED", "PATIENT_AUDIT_KEY_UNAVAILABLE",
  "PATIENT_KEY_INVALID", "METADATA_UNCONFIRMED", "METADATA_AMBIGUOUS"]);
/** Only owned error types and allowlisted codes, never driver messages/details. */
export function dashboardSecurityFailure(error: unknown): { code: string; status: number } | null {
  return (error instanceof DatasetDisplayError || error instanceof SecurityContractError || error instanceof PatientAuditError || error instanceof DashboardApprovalError) && codes.has(error.code)
    ? { code: error.code, status: error.status } : null;
}
