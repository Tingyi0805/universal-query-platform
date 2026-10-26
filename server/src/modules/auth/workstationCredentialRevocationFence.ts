import { exactSqlBigintReceipt } from "./workstationSqlCommitGate.js";

/**
 * H0-5C-2B: isolated credential-revocation result fence.
 * This is NOT a SQL executor. Evidence must eventually come from ONE owned
 * transaction, never from a caller's assertion or separately committed queries.
 */
export type CredentialRevocationEvidence = Readonly<{
  credentialMutationAffected: number;
  expectedCredentialVersionMatched: boolean;
  deviceSessionsLocked: number;
  deviceSessionsRevoked: number;
  deviceSessionsRemaining: number;
  legacySessionsLocked: number;
  legacySessionsRevoked: number;
  legacySessionsRemaining: number;
  operatorStatePresent: boolean;
  operatorCasAffected: number;
  operatorGenerationAdvanced: boolean;
  operatorIncarnationRotated: boolean;
  requestReservationAffected: number;
  auditAffected: number;
  decisionAffected: number;
  auditLogId: unknown;
  commitOutcome: "COMMITTED" | "ROLLED_BACK" | "UNKNOWN";
}>;

export type CredentialRevocationAssessment = Readonly<{
  admissible: boolean;
  reason: "SYNTHETIC_CONSISTENT" | "MUTATION_UNPROVEN" | "SESSION_SCOPE_UNPROVEN" |
    "OPERATOR_FENCE_UNPROVEN" | "RECEIPT_UNPROVEN" | "COMMIT_UNCONFIRMED";
  authority: "NONE";
  productionReady: false;
}>;

const count = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
const result = (reason: CredentialRevocationAssessment["reason"]): CredentialRevocationAssessment =>
  Object.freeze({ admissible: reason === "SYNTHETIC_CONSISTENT", reason, authority: "NONE" as const, productionReady: false as const });

export function assessCredentialRevocation(e: CredentialRevocationEvidence): CredentialRevocationAssessment {
  if (e.commitOutcome !== "COMMITTED") return result("COMMIT_UNCONFIRMED");
  if (e.credentialMutationAffected !== 1 || e.expectedCredentialVersionMatched !== true) return result("MUTATION_UNPROVEN");
  if (![e.deviceSessionsLocked, e.deviceSessionsRevoked, e.deviceSessionsRemaining,
        e.legacySessionsLocked, e.legacySessionsRevoked, e.legacySessionsRemaining].every(count) ||
      e.deviceSessionsLocked !== e.deviceSessionsRevoked || e.deviceSessionsRemaining !== 0 ||
      e.legacySessionsLocked !== e.legacySessionsRevoked || e.legacySessionsRemaining !== 0)
    return result("SESSION_SCOPE_UNPROVEN");
  if (e.operatorStatePresent !== true || e.operatorCasAffected !== 1 ||
      e.operatorGenerationAdvanced !== true || e.operatorIncarnationRotated !== true)
    return result("OPERATOR_FENCE_UNPROVEN");
  if (e.requestReservationAffected !== 1 || e.auditAffected !== 1 ||
      e.decisionAffected !== 1 || !exactSqlBigintReceipt(e.auditLogId))
    return result("RECEIPT_UNPROVEN");
  return result("SYNTHETIC_CONSISTENT");
}

/**
 * Mutation-only preflight. No synthetic audit receipt or invented commit
 * outcome is needed before append-only request/audit/decision inserts.
 */
export function assessCredentialRevocationMutation(
  e: CredentialRevocationEvidence,
): Readonly<{ admissible: boolean; reason: CredentialRevocationAssessment["reason"] }> {
  if (e.commitOutcome !== "UNKNOWN") return { admissible: false, reason: "COMMIT_UNCONFIRMED" };
  if (e.credentialMutationAffected !== 1 || e.expectedCredentialVersionMatched !== true)
    return { admissible: false, reason: "MUTATION_UNPROVEN" };
  if (![e.deviceSessionsLocked, e.deviceSessionsRevoked, e.deviceSessionsRemaining,
        e.legacySessionsLocked, e.legacySessionsRevoked, e.legacySessionsRemaining].every(count) ||
      e.deviceSessionsLocked !== e.deviceSessionsRevoked || e.deviceSessionsRemaining !== 0 ||
      e.legacySessionsLocked !== e.legacySessionsRevoked || e.legacySessionsRemaining !== 0)
    return { admissible: false, reason: "SESSION_SCOPE_UNPROVEN" };
  if (e.operatorStatePresent !== true || e.operatorCasAffected !== 1 ||
      e.operatorGenerationAdvanced !== true || e.operatorIncarnationRotated !== true)
    return { admissible: false, reason: "OPERATOR_FENCE_UNPROVEN" };
  return { admissible: true, reason: "SYNTHETIC_CONSISTENT" };
}

export const credentialRevocationRuntimeGate = Object.freeze({
  registered: false as const,
  writerIntegrated: false as const,
  sqlServer2019Accepted: false as const,
  legacyWriterCoverageProven: false as const,
  authority: "NONE" as const,
});
