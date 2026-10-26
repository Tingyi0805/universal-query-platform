import { assessCredentialRevocation, assessCredentialRevocationMutation, type CredentialRevocationEvidence } from "./workstationCredentialRevocationFence.js";

/**
 * H0-5C-2F: isolated transaction-owned writer seam.
 * The adapter supplies real SQL steps within one transaction. This seam is not
 * registered in Runtime, and mocks cannot establish SQL Server acceptance.
 */
export interface RevocationOwnedSqlTransaction {
  acquireSecurityGate(): Promise<boolean>;
  lockAndRevalidateScope(): Promise<void>;
  revokeCredentialAndSessions(): Promise<CredentialRevocationEvidence>;
  insertRequestAuditAndDecision(): Promise<{
    requestReservationAffected: number;
    auditAffected: number;
    decisionAffected: number;
    auditLogId: unknown;
  }>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}
export interface RevocationOwnedSqlDriver {
  beginSerializable(): Promise<RevocationOwnedSqlTransaction>;
}
export type RevocationWriterOutcome = Readonly<{
  status: "SYNTHETIC_COMMITTED" | "REJECTED" | "COMMIT_UNKNOWN" | "ROLLBACK_UNKNOWN";
  authority: "NONE";
  runtimeEnabled: false;
}>;
const result = (status: RevocationWriterOutcome["status"]): RevocationWriterOutcome =>
  Object.freeze({ status, authority: "NONE" as const, runtimeEnabled: false as const });

export async function runIsolatedRevocationWriter(driver: RevocationOwnedSqlDriver): Promise<RevocationWriterOutcome> {
  let tx: RevocationOwnedSqlTransaction;
  try { tx = await driver.beginSerializable(); } catch { return result("REJECTED"); }
  let attemptedCommit = false;
  try {
    if (await tx.acquireSecurityGate() !== true) throw Error("GATE_DENIED");
    await tx.lockAndRevalidateScope();
    const mutation = await tx.revokeCredentialAndSessions();
    // Reject invalid mutation evidence BEFORE writing append-only request/audit/decision.
    if (mutation.commitOutcome !== "UNKNOWN") throw Error("PREMATURE_COMMIT_PROOF");
    const preAudit = assessCredentialRevocationMutation(mutation);
    if (!preAudit.admissible) throw Error(preAudit.reason);
    const receipt = await tx.insertRequestAuditAndDecision();
    const verdict = assessCredentialRevocation({ ...mutation, ...receipt, commitOutcome: "COMMITTED" });
    if (!verdict.admissible) throw Error(verdict.reason);
    attemptedCommit = true;
    await tx.commit();
    return result("SYNTHETIC_COMMITTED");
  } catch {
    if (attemptedCommit) return result("COMMIT_UNKNOWN");
    try { await tx.rollback(); return result("REJECTED"); }
    catch { return result("ROLLBACK_UNKNOWN"); }
  }
}
export const ownedRevocationWriterAvailability = Object.freeze({
  routeRegistered: false as const,
  realSqlAdapterImplemented: true as const,
  legacyWritersConverted: false as const,
  sql2019Accepted: false as const,
  productionReady: false as const,
});
