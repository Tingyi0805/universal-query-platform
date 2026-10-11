import { patientIdentityDigest, parsePatientAuditHmacKey } from "./patientIdentityHmac.js";

export type PatientAuditKeyring = {
  activeVersion: number;
  versions: ReadonlyMap<number, Buffer>;
};

/** Load from a protected secret provider or deployment environment; never from SQL. */
export function parsePatientAuditKeyring(
  activeVersionRaw: string | undefined,
  encodedVersionsRaw: string | undefined,
): PatientAuditKeyring {
  const activeVersion = Number(activeVersionRaw);
  if (!activeVersionRaw || !Number.isSafeInteger(activeVersion) || activeVersion < 1) {
    throw new Error("PATIENT_AUDIT_ACTIVE_KEY_VERSION_INVALID");
  }
  if (!encodedVersionsRaw) throw new Error("PATIENT_AUDIT_KEYRING_NOT_CONFIGURED");
  let parsed: unknown;
  try { parsed = JSON.parse(encodedVersionsRaw); }
  catch { throw new Error("PATIENT_AUDIT_KEYRING_INVALID"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("PATIENT_AUDIT_KEYRING_INVALID");
  }
  const entries = Object.entries(parsed as Record<string, unknown>);
  if (!entries.length) throw new Error("PATIENT_AUDIT_KEYRING_INVALID");
  const versions = new Map<number, Buffer>();
  for (const [versionText, encoded] of entries) {
    const version = Number(versionText);
    if (!/^[1-9][0-9]*$/.test(versionText) || !Number.isSafeInteger(version) || typeof encoded !== "string") {
      throw new Error("PATIENT_AUDIT_KEYRING_INVALID");
    }
    versions.set(version, parsePatientAuditHmacKey(encoded));
  }
  if (!versions.has(activeVersion)) throw new Error("PATIENT_AUDIT_ACTIVE_KEY_NOT_FOUND");
  return { activeVersion, versions };
}

export function hashPatientForDisclosure(
  identity: unknown,
  sourceScope: string,
  keyring: PatientAuditKeyring,
): { keyVersion: number; patientKeyHash: Buffer } {
  const key = keyring.versions.get(keyring.activeVersion);
  if (!key) throw new Error("PATIENT_AUDIT_ACTIVE_KEY_NOT_FOUND");
  return { keyVersion: keyring.activeVersion, patientKeyHash: patientIdentityDigest(identity, sourceScope, key) };
}

/** Lookup must check each retained version to match historical disclosure records. */
export function hashPatientForHistoricalLookup(
  identity: unknown,
  sourceScope: string,
  keyring: PatientAuditKeyring,
): Array<{ keyVersion: number; patientKeyHash: Buffer }> {
  return [...keyring.versions.entries()].map(([keyVersion, key]) => ({
    keyVersion,
    patientKeyHash: patientIdentityDigest(identity, sourceScope, key),
  }));
}
