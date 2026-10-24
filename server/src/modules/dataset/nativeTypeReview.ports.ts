import type { AuthorizationObservation, ReviewEvidenceEnvelope, ReviewSnapshot, SourceObservation } from "./nativeTypeReview.js";

// Ports only. No implementation, database import, transaction opener or issuer.
declare const transactionBrand: unique symbol;
export type ReviewTransaction = Readonly<{ [transactionBrand]: "REVIEW_TRANSACTION_PORT" }>;
export interface ReviewSnapshotReader {
  read(reviewId: string, tx: ReviewTransaction): Promise<ReviewSnapshot>;
}
export interface AuthorizationEpochProvider {
  /** Re-read session, permission and review scope, not the existing ACL hash. */
  observe(userId: string, tx: ReviewTransaction): Promise<AuthorizationObservation>;
}
export interface SourceEvidenceProvider {
  /** External observation is NOT part of the platform DB transaction. */
  observe(dataSourceId: string, leaseId: string): Promise<SourceObservation>;
}
export type ReviewDecisionCommand = Readonly<{
  requestId: string;
  actorId: string;
  envelope: ReviewEvidenceEnvelope;
  action: "CONFIRM" | "REJECT" | "REVOKE" | "INVALIDATE";
}>;
export type ReviewCasReceipt = Readonly<{ affectedRows: 1; stateRowVersion: string }>;
export type ReviewDecisionRecord = Readonly<{
  requestId: string; reviewId: string; actorId: string; action: ReviewDecisionCommand["action"];
  previousRowVersion: string; stateRowVersion: string;
}>;
export interface MandatoryAuditWriter {
  /** Must throw on failure. Validate exact receipt; never truncate proof or swallow errors. */
  write(decision: ReviewDecisionRecord, tx: ReviewTransaction): Promise<unknown>;
}
export interface ReviewDecisionRepository {
  /**
   * Future owned SERIALIZABLE/XACT_ABORT unit of work: read + authorize + CAS +
   * appendDecision + mandatoryAudit + final revalidation must commit together.
   * Throw => rollback; an outer transaction is unsupported until isolation and
   * ownership are proven. B2 supplies only a synthetic, test-local model.
   */
  transaction<T>(work: (tx: ReviewTransaction) => Promise<T>): Promise<T>;
  /** Exactly one expected review/state/version. No terminal-state resurrection. */
  compareAndSwap(command: ReviewDecisionCommand, tx: ReviewTransaction): Promise<ReviewCasReceipt>;
  /** Unique requestId binds actor/action/exact snapshot; collisions fail, never overwrite. */
  appendDecision(decision: ReviewDecisionRecord, tx: ReviewTransaction): Promise<void>;
}
