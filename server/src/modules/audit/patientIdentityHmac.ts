import { createHmac } from "node:crypto";

export function normalizePatientIdentity(value: unknown): string {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "bigint") {
    throw new Error("PATIENT_IDENTITY_INVALID");
  }
  const normalized = String(value).normalize("NFKC").trim();
  if (!normalized || normalized.length > 256) throw new Error("PATIENT_IDENTITY_INVALID");
  return normalized;
}

/**
 * Domain separation and tenant/source scoping prevent cross-source accidental collisions.
 * The key must be managed outside source control and database, >= 32 random bytes.
 */
export function patientIdentityDigest(
  identity: unknown,
  sourceScope: string,
  key: Buffer,
): Buffer {
  if (key.length < 32) throw new Error("PATIENT_AUDIT_HMAC_KEY_INVALID");
  const scope = sourceScope.trim();
  if (!scope || scope.length > 200) throw new Error("PATIENT_AUDIT_SOURCE_SCOPE_INVALID");
  const value = normalizePatientIdentity(identity);
  return createHmac("sha256", key)
    .update("uqp-patient-audit-v1\0", "utf8")
    .update(String(Buffer.byteLength(scope, "utf8")))
    .update(":")
    .update(scope, "utf8")
    .update("\0")
    .update(value, "utf8")
    .digest();
}

/** Requires an explicitly provisioned base64-encoded 32+ byte key. */
export function parsePatientAuditHmacKey(encoded: string | undefined): Buffer {
  if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new Error("PATIENT_AUDIT_HMAC_KEY_NOT_CONFIGURED");
  }
  const key = Buffer.from(encoded, "base64");
  if (key.length < 32 || key.toString("base64") !== encoded) {
    throw new Error("PATIENT_AUDIT_HMAC_KEY_INVALID");
  }
  return key;
}
