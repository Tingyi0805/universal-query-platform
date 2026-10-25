import { assessCredentialRevocation, type CredentialRevocationEvidence } from "./workstationCredentialRevocationFence.js";

/**
 * H0-5C-2C isolated transaction orchestration for contract tests.
 * Not a SQL implementation and never wired into Runtime. The future adapter
 * must enforce all locks and return receipts from the same SQL transaction.
 */
export interface IsolatedRevocationTransaction {
  revokeCredentialAndDependents(): Promise<CredentialRevocationEvidence>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}
export interface IsolatedRevocationTransactionFactory {
  openSerializableWithSecurityGate(): Promise<IsolatedRevocationTransaction>;
}

export type IsolatedRevocationOutcome = Readonly<{
  status: "COMMITTED_SYNTHETIC" | "REJECTED" | "COMMIT_UNKNOWN" | "ROLLBACK_UNKNOWN";
  authority: "NONE";
  runtimeEnabled: false;
}>;

function outcome(status: IsolatedRevocationOutcome["status"]): IsolatedRevocationOutcome {
  return Object.freeze({ status, authority: "NONE" as const, runtimeEnabled: false as const });
}

/**
 * The supplied transaction is exclusively for offline mocks. Evidence supplied
 * from outside an owned SQL adapter MUST NOT be interpreted as production proof.
 */
export async function executeIsolatedCredentialRevocation(
  factory: IsolatedRevocationTransactionFactory,
): Promise<IsolatedRevocationOutcome> {
  let transaction: IsolatedRevocationTransaction;
  try {
    transaction = await factory.openSerializableWithSecurityGate();
  } catch {
    return outcome("REJECTED");
  }
  let committing = false;
  try {
    const evidence = await transaction.revokeCredentialAndDependents();
    // Check transactional receipts before commit, without relying on a caller's
    // declared commit outcome as proof that the commit already happened.
    if (evidence.commitOutcome !== "UNKNOWN") throw new Error("PREMATURE_COMMIT_ATTESTATION");
    const ready = assessCredentialRevocation({ ...evidence, commitOutcome: "COMMITTED" });
    if (!ready.admissible) throw new Error(ready.reason);
    committing = true;
    await transaction.commit();
    return outcome("COMMITTED_SYNTHETIC");
  } catch {
    if (committing) return outcome("COMMIT_UNKNOWN");
    try {
      await transaction.rollback();
      return outcome("REJECTED");
    } catch {
      return outcome("ROLLBACK_UNKNOWN");
    }
  }
}

export const isolatedRevocationTransactionAvailability = Object.freeze({
  isProductionSqlAdapter: false as const,
  routesConnected: false as const,
  migration926Executed: false as const,
  sqlServer2019Acceptance: "NOT_RUN" as const,
});
