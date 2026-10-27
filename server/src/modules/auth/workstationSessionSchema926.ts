import { types } from "node:util";

export const workstationSessionMigration = "926_shared_workstation_session_security.sql" as const;

export const workstationSessionTables926 = Object.freeze([
  "SharedWorkstationDeviceSession",
  "UserQuickPinSecurityBinding",
  "SharedWorkstationPinAttemptState",
  "SharedWorkstationOperatorState",
  "SharedWorkstationSessionRequest",
  "SharedWorkstationSessionDecision",
] as const);

export const sessionLockOrder = Object.freeze([
  "SESSION_SECURITY_GATE",
  "QUICK_PIN_POLICY",
  "APP_USER",
  "WORKSTATION",
  "CREDENTIAL",
  "DEVICE_SESSION",
  "USER_QUICK_PIN",
  "PIN_BINDING",
  "PIN_ATTEMPT",
  "OPERATOR_SESSION",
  "OPERATOR_STATE",
  "REQUEST_RESERVATION",
  "AUDIT_LOG",
  "DECISION",
] as const);

export type SessionLockResource = typeof sessionLockOrder[number];
export type SessionPersistenceOperation =
  | "DEVICE_RENEW"
  | "OPERATOR_SWITCH"
  | "PIN_FAILURE"
  | "OPERATOR_LOCK"
  | "OPERATOR_SIGNOUT"
  | "DEVICE_REVOKE"
  | "AUTHORIZATION_REVOKE";

export type SessionPersistenceObservation = Readonly<{
  format: "WORKSTATION_SESSION_PERSISTENCE_OBSERVATION_V1";
  operation: SessionPersistenceOperation;
  workstationId: string;
  requestId: string;
  requestDigest: string;
  transactionOwner: "REPOSITORY_OWNED";
  isolation: "SERIALIZABLE";
  xactAbort: true;
  locks: readonly SessionLockResource[];
  requestClaimAffectedRows: number;
  mutationAffectedRows: number;
  expectedRevision: string;
  nextRevision: string | null;
  auditLogId: string | number;
  auditAffectedRows: number;
  decisionAffectedRows: number;
  commitOutcome: "COMMITTED" | "ROLLED_BACK" | "UNKNOWN";
}>;

export type SessionPersistenceReason =
  | "FORMAT_INVALID"
  | "LOCK_ORDER_INVALID"
  | "TRANSACTION_NOT_OWNED"
  | "REQUEST_CONFLICT"
  | "CAS_CONFLICT"
  | "AUDIT_RECEIPT_INVALID"
  | "AUDIT_NOT_ATOMIC"
  | "DECISION_NOT_ATOMIC"
  | "COMMIT_NOT_PROVEN";

const restrictions = Object.freeze({
  authority: "NONE" as const,
  queryExecutionAllowed: false as const,
  patientDataAllowed: false as const,
  productionReady: false as const,
  sqlTransactionVerified: false as const,
});

export type SessionPersistenceAssessment =
  | Readonly<{ ok: true; status: "SYNTHETIC_CONSISTENT"; auditLogId: string } & typeof restrictions>
  | Readonly<{ ok: false; status: "REJECTED"; reason: SessionPersistenceReason } & typeof restrictions>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const REVISION = /^[0-9a-f]{16}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const SQL_BIGINT_MAX = 9_223_372_036_854_775_807n;
const operations = new Set<SessionPersistenceOperation>([
  "DEVICE_RENEW", "OPERATOR_SWITCH", "PIN_FAILURE", "OPERATOR_LOCK",
  "OPERATOR_SIGNOUT", "DEVICE_REVOKE", "AUTHORIZATION_REVOKE",
]);

const exactKeys = [
  "format", "operation", "workstationId", "requestId", "requestDigest", "transactionOwner",
  "isolation", "xactAbort", "locks", "requestClaimAffectedRows", "mutationAffectedRows",
  "expectedRevision", "nextRevision", "auditLogId", "auditAffectedRows", "decisionAffectedRows",
  "commitOutcome",
] as const;

function exactObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const actual = Object.keys(descriptors).sort();
  const expected = [...exactKeys].sort();
  return Object.getOwnPropertySymbols(value).length === 0 && actual.length === expected.length &&
    actual.every((key, index) => key === expected[index]) &&
    Object.values(descriptors).every(descriptor => "value" in descriptor && descriptor.enumerable);
}

export function canonicalSqlBigInt(value: unknown): value is string {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,18}$/.test(value)) return false;
  try { return BigInt(value) <= SQL_BIGINT_MAX; } catch { return false; }
}

function validRevision(value: unknown): value is string {
  return typeof value === "string" && REVISION.test(value) && value !== "0000000000000000";
}

function locksAreOrdered(value: unknown): value is readonly SessionLockResource[] {
  if (!Array.isArray(value) || types.isProxy(value) || value.length !== sessionLockOrder.length) return false;
  return value.every((resource, index) => resource === sessionLockOrder[index]);
}

function validShape(value: unknown): value is SessionPersistenceObservation {
  if (!exactObject(value)) return false;
  return value.format === "WORKSTATION_SESSION_PERSISTENCE_OBSERVATION_V1" &&
    typeof value.operation === "string" && operations.has(value.operation as SessionPersistenceOperation) &&
    canonicalSqlBigInt(value.workstationId) && typeof value.requestId === "string" && UUID.test(value.requestId) &&
    typeof value.requestDigest === "string" && DIGEST.test(value.requestDigest) &&
    typeof value.transactionOwner === "string" && typeof value.isolation === "string" &&
    typeof value.xactAbort === "boolean" && Array.isArray(value.locks) &&
    Number.isSafeInteger(value.requestClaimAffectedRows) &&
    Number.isSafeInteger(value.mutationAffectedRows) && validRevision(value.expectedRevision) &&
    (value.nextRevision === null || validRevision(value.nextRevision)) &&
    (typeof value.auditLogId === "string" || typeof value.auditLogId === "number") &&
    Number.isSafeInteger(value.auditAffectedRows) && Number.isSafeInteger(value.decisionAffectedRows) &&
    (value.commitOutcome === "COMMITTED" || value.commitOutcome === "ROLLED_BACK" || value.commitOutcome === "UNKNOWN");
}

const reject = (reason: SessionPersistenceReason): SessionPersistenceAssessment => Object.freeze({
  ok: false, status: "REJECTED", reason, ...restrictions,
});

/**
 * Synthetic contract only. H0-5B must replace caller observations with exact SQL
 * OUTPUT values obtained inside one owned transaction.
 */
export function assessSessionPersistence(value: unknown): SessionPersistenceAssessment {
  if (!validShape(value)) return reject("FORMAT_INVALID");
  if (!locksAreOrdered(value.locks)) return reject("LOCK_ORDER_INVALID");
  if (value.transactionOwner !== "REPOSITORY_OWNED" || value.isolation !== "SERIALIZABLE" || !value.xactAbort) {
    return reject("TRANSACTION_NOT_OWNED");
  }
  if (value.requestClaimAffectedRows !== 1) return reject("REQUEST_CONFLICT");
  if (value.mutationAffectedRows !== 1 || value.nextRevision === null || value.nextRevision === value.expectedRevision) {
    return reject("CAS_CONFLICT");
  }
  if (!canonicalSqlBigInt(value.auditLogId)) return reject("AUDIT_RECEIPT_INVALID");
  if (value.auditAffectedRows !== 1) return reject("AUDIT_NOT_ATOMIC");
  if (value.decisionAffectedRows !== 1) return reject("DECISION_NOT_ATOMIC");
  if (value.commitOutcome !== "COMMITTED") return reject("COMMIT_NOT_PROVEN");
  return Object.freeze({
    ok: true,
    status: "SYNTHETIC_CONSISTENT",
    auditLogId: value.auditLogId,
    ...restrictions,
  });
}

export const exactAuditOutputContract = Object.freeze({
  insert: "OUTPUT CONVERT(VARCHAR(20),INSERTED.Id) AS AuditLogId",
  prohibited: "String(Number(AuditLogId))",
  archiveForeignKeyAllowed: false,
});
