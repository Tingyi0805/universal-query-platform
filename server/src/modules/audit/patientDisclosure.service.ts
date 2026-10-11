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
