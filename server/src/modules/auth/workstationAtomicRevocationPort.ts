/**
 * H0-5C-2A — transaction ownership boundary for future legacy writer adoption.
 * This adapter intentionally performs NO SQL and is NOT used by existing routes.
 * A caller cannot provide a fake transaction token to claim atomic revocation.
 */
declare const ownerBrand: unique symbol;
export type RevocationOwnerToken = Readonly<{ [ownerBrand]: "REVOCATION_OWNER" }>;

export type RevocationWriterKind =
  | "PIN_ENROLL_REVOKE" | "PIN_POLICY" | "PASSWORD_TOKEN_VERSION"
  | "USER_ROLE_PERMISSION" | "WORKSTATION_CREDENTIAL"
  | "WORKSTATION_STATE" | "WORKSTATION_GRANTS";

export type RevocationStepResult = Readonly<{
  writerAffected: number;
  lockedActiveSessions: number;
  invalidatedSessions: number;
  remainingActiveSessions: number;
  auditAffected: number;
  decisionAffected: number;
  auditLogId: string;
}>;

/**
 * Implementations must own the entire SERIALIZABLE/XACT_ABORT transaction,
 * shared application gate, mutation, invalidation, audit and decision.
 * A legacy writer must never commit its own transaction inside execute().
 */
export interface AtomicRevocationWriterPort {
  execute(kind: RevocationWriterKind, scopeId: string): Promise<Readonly<{
    outcome: "COMMITTED" | "REJECTED" | "UNKNOWN";
    result?: RevocationStepResult;
    authority: "NONE";
  }>>;
}

/**
 * Production has no implementation registered. Do not interpret this as a
 * working revocation service; callers must remain blocked.
 */
export const revocationWriterAdapterAvailability = Object.freeze({
  registered: false as const,
  runtimeEnabled: false as const,
  sqlAcceptance: "NOT_RUN" as const,
  bypassWritersResolved: false as const,
  authority: "NONE" as const,
});
