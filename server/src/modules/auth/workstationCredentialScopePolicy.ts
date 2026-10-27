/**
 * H0-5C-2I — isolated release-blocking scope policy.
 * The 926 draft has DeviceSession -> Credential linkage, but legacy
 * SharedWorkstationSession is keyed by workstation/operator identity rather
 * than CredentialId. Never infer the legacy revocation scope from workstation
 * equality alone.
 */
export const credentialLegacyScopePolicy = Object.freeze({
  credentialScopedDevices: true as const,
  legacySessionCredentialMappingProven: false as const,
  legacyWorkstationWideRevokeAllowed: false as const,
  releaseEnabled: false as const,
  sqlAcceptance: "NOT_RUN" as const,
});

export type CredentialRevocationScopeAssessment = Readonly<{
  eligible: false;
  reason: "UNMAPPED_LEGACY_SESSIONS" | "UNVERIFIED_GENERATION" | "UNKNOWN_SCOPE";
  authority: "NONE";
}>;

/**
 * No caller assertion is sufficient proof that a legacy session belongs to a
 * credential. Until the DB schema and mixed-version writers establish a stable
 * credential-session relationship, all proposed scopes remain blocked.
 */
export function assessCredentialRevocationScope(
  scope: Readonly<{ workstationId: string; credentialId: string; expectedGeneration: string }>,
): CredentialRevocationScopeAssessment {
  const positiveBigint = (v: string) =>
    typeof v === "string" && /^[1-9][0-9]{0,18}$/.test(v) &&
    BigInt(v) <= 9223372036854775807n;
  const uuid = typeof scope.credentialId === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(scope.credentialId);
  const validGeneration = typeof scope.expectedGeneration === "string" &&
    /^(0|[1-9][0-9]{0,18})$/.test(scope.expectedGeneration) &&
    BigInt(scope.expectedGeneration) < 9223372036854775807n;
  const reason = !positiveBigint(scope.workstationId) || !uuid ? "UNKNOWN_SCOPE" :
    !validGeneration ? "UNVERIFIED_GENERATION" : "UNMAPPED_LEGACY_SESSIONS";
  return Object.freeze({ eligible: false as const, reason, authority: "NONE" as const });
}

/** SQL predicate to be used ONLY after the authoritative scope proof exists. */
export const isolatedOperatorGenerationOverflowPredicate =
  "Generation < CONVERT(BIGINT, '9223372036854775807')" as const;
