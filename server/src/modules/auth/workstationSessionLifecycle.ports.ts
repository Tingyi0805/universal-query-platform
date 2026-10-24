import type {
  DeviceSessionRenewalRequest,
  DeviceSessionRenewalAudit,
  DeviceSessionRenewalMutation,
  DeviceSessionRenewalSnapshot,
} from "./workstationSessionLifecycle.js";

declare const lifecycleTransactionBrand: unique symbol;

/** Opaque future repository-owned transaction. Test mocks may model this only. */
export type WorkstationLifecycleTransaction = Readonly<{
  [lifecycleTransactionBrand]: "WORKSTATION_LIFECYCLE_TRANSACTION";
}>;

export type WorkstationLifecycleFailureCode =
  | "DATABASE_UNAVAILABLE"
  | "AUDIT_FAILURE"
  | "COMMIT_UNKNOWN"
  | "ROLLBACK_FAILED"
  | "PERSISTENCE_FAILURE";

export class WorkstationLifecycleInfrastructureError extends Error {
  constructor(readonly code: WorkstationLifecycleFailureCode) {
    super("WORKSTATION_SESSION_LIFECYCLE_UNAVAILABLE");
  }
}

export interface WorkstationDeviceSessionRepository {
  /**
   * Future owned SERIALIZABLE/XACT_ABORT transaction. The repository must lock
   * the session, workstation, and credential in one documented order. It must
   * reject external transactions whose isolation and ownership are unknown.
   */
  transaction<T>(
    work: (tx: WorkstationLifecycleTransaction) => Promise<T>,
  ): Promise<T>;

  /** Read current DB state under the owned transaction; never trust caller state. */
  readForRenewal(
    sessionId: string,
    tx: WorkstationLifecycleTransaction,
  ): Promise<DeviceSessionRenewalSnapshot | null>;

  /** Exactly one ROWVERSION/revision and one renewal counter may be consumed. */
  compareAndSwapRenewal(
    mutation: DeviceSessionRenewalMutation,
    tx: WorkstationLifecycleTransaction,
  ): Promise<Readonly<{ affectedRows: 0 | 1; newRevision?: string }>>;
}

export interface WorkstationSessionAuditWriter {
  /** Must participate in the same transaction and throw on any write failure. */
  write(
    event: DeviceSessionRenewalAudit,
    tx: WorkstationLifecycleTransaction,
  ): Promise<Readonly<{ auditLogId: string }>>;
}

export interface WorkstationCredentialProofVerifier {
  /**
   * Compare the presented device credential proof against the current locked
   * credential with constant-time semantics. Never log or persist the proof.
   */
  verify(
    request: DeviceSessionRenewalRequest,
    snapshot: DeviceSessionRenewalSnapshot,
    tx: WorkstationLifecycleTransaction,
  ): Promise<boolean>;
}
