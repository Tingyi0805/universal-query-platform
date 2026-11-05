import { patientAuditService } from "../dataset/patientAuditContract.repository.js";
import { confirmedAliases, PatientAuditError } from "../dataset/patientAuditConfig.service.js";
import { getDatasetPatientAuditConfig } from "../dataset/patientAuditConfig.repository.js";
import { parsePatientAuditKeyring } from "./patientAuditKeyring.js";
import { persistPatientListDisclosure, type PatientListDisclosureInput } from "./patientDisclosure.repository.js";

export type DisclosureContext = Omit<
  PatientListDisclosureInput,
  "patientKeyColumn" | "keyring"
>;

export async function auditPatientListIfConfigured(input: DisclosureContext): Promise<number | null> {
  const config = await getDatasetPatientAuditConfig(input.datasetId);
  if (!config?.isEnabled) return null;
  const keyring = parsePatientAuditKeyring(
    process.env.PATIENT_AUDIT_ACTIVE_KEY_VERSION,
    process.env.PATIENT_AUDIT_HMAC_KEYRING_JSON,
  );
  return persistPatientListDisclosure({
    ...input,
    patientKeyColumn: config.patientKeyColumn,
    keyring,
  });
}

/** Dashboard-only contract. General query and Excel keep auditPatientListIfConfigured. */
export function createDashboardPatientAudit(requireDisclosure = patientAuditService.requireDisclosure, persist = persistPatientListDisclosure) {
  return async (input: DisclosureContext): Promise<number | null> => {
    if (!input.rows.length) return null;
    const { config, keyring } = await requireDisclosure(input.datasetId);
    for (const row of input.rows) {
      const names = Object.keys(row);
      if (!confirmedAliases(names) || !Object.prototype.hasOwnProperty.call(row, config.patientKeyColumn))
        throw new PatientAuditError("PATIENT_KEY_INVALID", 503);
      const identity = row[config.patientKeyColumn];
      if (typeof identity === "number" && !Number.isFinite(identity))
        throw new PatientAuditError("PATIENT_KEY_INVALID", 503);
    }
    return persist({ ...input, patientKeyColumn: config.patientKeyColumn, keyring });
  };
}
export const auditDashboardPatientList = createDashboardPatientAudit();
