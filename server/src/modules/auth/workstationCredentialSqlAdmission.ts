import { isolatedCredentialAtomicSql } from "./workstationCredentialAtomicSql.js";

/**
 * H0-5C-2H admission gate. SQL string checks cannot prove server semantics;
 * this static gate prevents accidental promotion of the known unsafe draft.
 */
export const credentialRevocationSqlAdmission = Object.freeze({
  legacyScopeReviewed: false as const,
  credentialRowVersionCas: false as const,
  generationOverflowGuard: false as const,
  stableRequestAuditDecision: false as const,
  mixedVersionWritersCoordinated: false as const,
  sqlServer2019Acceptance: "NOT_RUN" as const,
  productionReady: false as const,
});

export type CredentialRevocationSqlGap =
  | "LEGACY_WORKSTATION_WIDE_REVOKE"
  | "CREDENTIAL_VERSION_NOT_ROWVERSION"
  | "OPERATOR_GENERATION_OVERFLOW"
  | "AUDIT_DECISION_NOT_ATOMIC";

export function inspectIsolatedCredentialSql(): Readonly<{ safeToEnable: false; gaps: readonly CredentialRevocationSqlGap[] }> {
  const gaps: CredentialRevocationSqlGap[] = [];
  const normalizedLegacy = isolatedCredentialAtomicSql.revokeLegacy.replace(/\s+/gu, " ");
  if (/WHERE WorkstationId=CONVERT\(BIGINT,@workstationId\) AND RevokedAtUtc IS NULL/iu.test(normalizedLegacy) &&
      !/CredentialId|DeviceSessionId/iu.test(normalizedLegacy)) {
    gaps.push("LEGACY_WORKSTATION_WIDE_REVOKE");
  }
  if (/CredentialVersion=@expectedCredentialVersion/u.test(isolatedCredentialAtomicSql.credentialCas) &&
      !/RowVersion\s*=/iu.test(isolatedCredentialAtomicSql.credentialCas)) {
    gaps.push("CREDENTIAL_VERSION_NOT_ROWVERSION");
  }
  if (/Generation=Generation\+CONVERT\(BIGINT,1\)/u.test(isolatedCredentialAtomicSql.revokeOperatorCas) &&
      !/9223372036854775807/u.test(isolatedCredentialAtomicSql.revokeOperatorCas)) {
    gaps.push("OPERATOR_GENERATION_OVERFLOW");
  }
  if (!isolatedCredentialAtomicSql.auditDecisionIntegrated) gaps.push("AUDIT_DECISION_NOT_ATOMIC");
  return Object.freeze({ safeToEnable: false as const, gaps: Object.freeze(gaps) });
}
