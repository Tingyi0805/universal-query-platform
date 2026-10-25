import type {
  OperatorPinFailureMutation,
  OperatorSwitchAudit,
  OperatorSwitchLookup,
  OperatorSwitchMutation,
  OperatorSwitchSnapshot,
} from "./workstationOperatorSwitch.js";

declare const operatorSwitchTransactionBrand: unique symbol;

export type OperatorSwitchTransaction = Readonly<{
  [operatorSwitchTransactionBrand]: "WORKSTATION_OPERATOR_SWITCH_TRANSACTION";
}>;

export type OperatorSwitchInfrastructureCode =
  | "DATABASE_UNAVAILABLE"
  | "AUDIT_FAILURE"
  | "COMMIT_UNKNOWN"
  | "ROLLBACK_FAILED"
  | "PERSISTENCE_FAILURE";

export class OperatorSwitchInfrastructureError extends Error {
  constructor(readonly code: OperatorSwitchInfrastructureCode) {
    super("WORKSTATION_OPERATOR_SWITCH_UNAVAILABLE");
  }
}

export interface WorkstationOperatorSwitchRepository {
  /**
   * Future owned SERIALIZABLE/XACT_ABORT transaction. Lock order must cover the
   * device session, workstation, current operator state, target user/PIN, and
   * request-id reservation before mutation. Unknown external transactions fail.
   */
  transaction<T>(work: (tx: OperatorSwitchTransaction) => Promise<T>): Promise<T>;

  /** Read every authorization input from current storage under the transaction. */
  readForSwitch(
    lookup: OperatorSwitchLookup,
    tx: OperatorSwitchTransaction,
  ): Promise<OperatorSwitchSnapshot | null>;

  /** Unique request ID bound to a digest that deliberately excludes the PIN. */
  claimRequest(
    requestId: string,
    requestDigest: string,
    tx: OperatorSwitchTransaction,
  ): Promise<"CLAIMED" | "REPLAY" | "CONFLICT">;

  /** Persist failed-attempt window/lock state with PIN-row CAS. */
  recordPinFailure(
    mutation: OperatorPinFailureMutation,
    tx: OperatorSwitchTransaction,
  ): Promise<Readonly<{ affectedRows: 0 | 1; newPinRevision?: string }>>;

  /** Atomically reset PIN failures and replace the sole operator authorization. */
  compareAndSwapSwitch(
    mutation: OperatorSwitchMutation,
    tx: OperatorSwitchTransaction,
  ): Promise<Readonly<{ affectedRows: 0 | 1; newOperatorRevision?: string }>>;
}

export interface WorkstationPinVerifier {
  /** Compare only against the explicitly selected user's current locked PIN row. */
  verify(
    targetUserId: number,
    pin: string,
    tx: OperatorSwitchTransaction,
  ): Promise<boolean>;
}

export interface WorkstationOperatorSwitchAuditWriter {
  /** Mandatory same-transaction audit. Never accept Number AuditLog IDs. */
  write(
    event: OperatorSwitchAudit,
    tx: OperatorSwitchTransaction,
  ): Promise<Readonly<{ auditLogId: string }>>;
}
