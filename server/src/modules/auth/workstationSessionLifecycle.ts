import { types } from "node:util";
import type {
  WorkstationCredentialProofVerifier,
  WorkstationDeviceSessionRepository,
  WorkstationSessionAuditWriter,
} from "./workstationSessionLifecycle.ports.js";
import {
  WorkstationLifecycleInfrastructureError,
  type WorkstationLifecycleFailureCode,
} from "./workstationSessionLifecycle.ports.js";

const SQL_BIGINT_MAX = 9_223_372_036_854_775_807n;
const ROWVERSION = /^[0-9a-f]{16}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const IDLE_MIN_MS = 30_000;
const IDLE_MAX_MS = 8 * 60 * 60 * 1_000;
const ABSOLUTE_MAX_MS = 24 * 60 * 60 * 1_000;
const DEVICE_PROOF = /^[A-Za-z0-9_-]{43}$/;

export type DeviceSessionRenewalRequest = Readonly<{
  format: "WORKSTATION_DEVICE_SESSION_RENEWAL_V1";
  sessionId: string;
  workstationId: string;
  credentialId: string;
  /** Raw proof is accepted only by the verifier port and is never audited. */
  credentialProof: string;
  expectedRevision: string;
  renewalCounter: string;
}>;

/**
 * Synthetic repository snapshot for H0-2. It intentionally contains no user,
 * JWT, PIN, patient data, credential secret, or query authority.
 */
export type DeviceSessionRenewalSnapshot = Readonly<{
  format: "WORKSTATION_DEVICE_SESSION_SNAPSHOT_V1";
  sessionId: string;
  workstationId: string;
  credentialId: string;
  sessionState: "ACTIVE" | "REVOKED";
  sessionRevision: string;
  renewalCounter: string;
  boundCredentialVersion: number;
  issuedAtMs: number;
  lastActivityAtMs: number;
  idleExpiresAtMs: number;
  absoluteExpiresAtMs: number;
  workstationActive: boolean;
  workstationRetired: boolean;
  workstationCredentialVersion: number;
  credentialRevoked: boolean;
  credentialVersion: number;
}>;

export type DeviceSessionLifecyclePolicy = Readonly<{
  idleWindowMs: number;
  absoluteLifetimeMs: number;
}>;

export type DeviceSessionRenewalReason =
  | "FORMAT_INVALID"
  | "SESSION_NOT_FOUND"
  | "SESSION_REVOKED"
  | "SESSION_IDLE_EXPIRED"
  | "SESSION_ABSOLUTE_EXPIRED"
  | "WORKSTATION_DISABLED"
  | "WORKSTATION_RETIRED"
  | "CREDENTIAL_REVOKED"
  | "CREDENTIAL_VERSION_MISMATCH"
  | "CREDENTIAL_PROOF_REJECTED"
  | "IDENTITY_MISMATCH"
  | "SESSION_REVISION_CONFLICT"
  | "RENEWAL_REPLAY"
  | "CLOCK_INVALID"
  | "SESSION_LIFETIME_INVALID"
  | "COUNTER_EXHAUSTED"
  | WorkstationLifecycleFailureCode;

export type DeviceSessionRenewalMutation = Readonly<{
  sessionId: string;
  workstationId: string;
  credentialId: string;
  expectedRevision: string;
  expectedRenewalCounter: string;
  nextRenewalCounter: string;
  lastActivityAtMs: number;
  idleExpiresAtMs: number;
}>;

export type DeviceSessionRenewalAudit = Readonly<{
  eventType: "WORKSTATION_DEVICE_SESSION_RENEWED" | "WORKSTATION_DEVICE_SESSION_RENEWAL_REJECTED";
  status: "SUCCESS" | "FAILED";
  reason: DeviceSessionRenewalReason | null;
  sessionId: string;
  workstationId: string;
  credentialId: string;
  renewalCounter: string;
}>;

const restrictions = Object.freeze({
  authority: "DEVICE_ENTRY_ONLY" as const,
  operatorAuthority: "NONE" as const,
  queryExecutionAllowed: false as const,
  patientDataAllowed: false as const,
  productionPersistence: "NOT_PROVEN" as const,
});

type RenewalEvaluation =
  | Readonly<{ ok: true; mutation: DeviceSessionRenewalMutation }>
  | Readonly<{ ok: false; reason: DeviceSessionRenewalReason }>;

export type DeviceSessionEntryEvaluation =
  | Readonly<{ ok: true; status: "DEVICE_ENTRY_VALID" }>
  | Readonly<{ ok: false; reason: DeviceSessionRenewalReason }>;

export type DeviceSessionRenewalResult =
  | Readonly<{
    ok: true;
    status: "RENEWED";
    sessionId: string;
    workstationId: string;
    newRevision: string;
    nextRenewalCounter: string;
    idleExpiresAtMs: number;
    auditLogId: string;
    productionReady: false;
  } & typeof restrictions>
  | Readonly<{
    ok: false;
    status: "REJECTED";
    reason: DeviceSessionRenewalReason;
    productionReady: false;
  } & typeof restrictions>;

function isCanonicalBigInt(value: unknown, allowZero: boolean): value is string {
  if (typeof value !== "string") return false;
  const format = allowZero ? /^(0|[1-9][0-9]{0,18})$/ : /^[1-9][0-9]{0,18}$/;
  if (!format.test(value)) return false;
  try {
    const parsed = BigInt(value);
    return parsed <= SQL_BIGINT_MAX && (allowZero || parsed > 0n);
  } catch {
    return false;
  }
}

const isRevision = (value: unknown): value is string =>
  typeof value === "string" && ROWVERSION.test(value) && value !== "0000000000000000";

const isUuid = (value: unknown): value is string =>
  typeof value === "string" && UUID.test(value);

const isTimestamp = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0;

const isCredentialVersion = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 1 && Number(value) <= 2_147_483_647;

function hasExactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.getOwnPropertySymbols(value).length > 0) return false;
  const actual = Object.keys(descriptors).sort();
  if (actual.length !== keys.length || actual.some((key, index) => key !== [...keys].sort()[index])) {
    return false;
  }
  return Object.values(descriptors).every(
    descriptor => "value" in descriptor && descriptor.enumerable,
  );
}

const requestKeys = [
  "format", "sessionId", "workstationId", "credentialId", "credentialProof", "expectedRevision",
  "renewalCounter",
] as const;

export function isDeviceSessionRenewalRequest(
  value: unknown,
): value is DeviceSessionRenewalRequest {
  if (!hasExactKeys(value, requestKeys)) return false;
  return value.format === "WORKSTATION_DEVICE_SESSION_RENEWAL_V1" &&
    isUuid(value.sessionId) &&
    isCanonicalBigInt(value.workstationId, false) &&
    isUuid(value.credentialId) &&
    typeof value.credentialProof === "string" && DEVICE_PROOF.test(value.credentialProof) &&
    isRevision(value.expectedRevision) &&
    isCanonicalBigInt(value.renewalCounter, true);
}

const snapshotKeys = [
  "format", "sessionId", "workstationId", "credentialId", "sessionState", "sessionRevision",
  "renewalCounter", "boundCredentialVersion", "issuedAtMs", "lastActivityAtMs", "idleExpiresAtMs",
  "absoluteExpiresAtMs", "workstationActive", "workstationRetired", "workstationCredentialVersion",
  "credentialRevoked", "credentialVersion",
] as const;

export function isDeviceSessionRenewalSnapshot(
  value: unknown,
): value is DeviceSessionRenewalSnapshot {
  if (!hasExactKeys(value, snapshotKeys)) return false;
  return value.format === "WORKSTATION_DEVICE_SESSION_SNAPSHOT_V1" &&
    isUuid(value.sessionId) &&
    isCanonicalBigInt(value.workstationId, false) &&
    isUuid(value.credentialId) &&
    (value.sessionState === "ACTIVE" || value.sessionState === "REVOKED") &&
    isRevision(value.sessionRevision) &&
    isCanonicalBigInt(value.renewalCounter, true) &&
    isCredentialVersion(value.boundCredentialVersion) &&
    isTimestamp(value.issuedAtMs) &&
    isTimestamp(value.lastActivityAtMs) &&
    isTimestamp(value.idleExpiresAtMs) &&
    isTimestamp(value.absoluteExpiresAtMs) &&
    typeof value.workstationActive === "boolean" &&
    typeof value.workstationRetired === "boolean" &&
    isCredentialVersion(value.workstationCredentialVersion) &&
    typeof value.credentialRevoked === "boolean" &&
    isCredentialVersion(value.credentialVersion);
}

function isPolicy(value: DeviceSessionLifecyclePolicy): boolean {
  return Number.isSafeInteger(value.idleWindowMs) &&
    value.idleWindowMs >= IDLE_MIN_MS &&
    value.idleWindowMs <= IDLE_MAX_MS &&
    Number.isSafeInteger(value.absoluteLifetimeMs) &&
    value.absoluteLifetimeMs >= value.idleWindowMs &&
    value.absoluteLifetimeMs <= ABSOLUTE_MAX_MS;
}

function rejected(reason: DeviceSessionRenewalReason): DeviceSessionRenewalResult {
  return Object.freeze({ ok: false, status: "REJECTED", reason, productionReady: false, ...restrictions });
}

/** Validate current device-entry state without renewing or granting operator authority. */
export function evaluateDeviceSessionEntry(
  snapshot: unknown,
  policy: DeviceSessionLifecyclePolicy,
  nowMs: number,
): DeviceSessionEntryEvaluation {
  if (!isDeviceSessionRenewalSnapshot(snapshot) || !isPolicy(policy) || !isTimestamp(nowMs)) {
    return Object.freeze({ ok: false, reason: "FORMAT_INVALID" });
  }
  if (snapshot.sessionState !== "ACTIVE") return Object.freeze({ ok: false, reason: "SESSION_REVOKED" });
  if (!snapshot.workstationActive) return Object.freeze({ ok: false, reason: "WORKSTATION_DISABLED" });
  if (snapshot.workstationRetired) return Object.freeze({ ok: false, reason: "WORKSTATION_RETIRED" });
  if (snapshot.credentialRevoked) return Object.freeze({ ok: false, reason: "CREDENTIAL_REVOKED" });
  if (
    snapshot.boundCredentialVersion !== snapshot.credentialVersion ||
    snapshot.credentialVersion !== snapshot.workstationCredentialVersion
  ) return Object.freeze({ ok: false, reason: "CREDENTIAL_VERSION_MISMATCH" });
  if (
    snapshot.issuedAtMs > snapshot.lastActivityAtMs ||
    snapshot.lastActivityAtMs > nowMs ||
    snapshot.idleExpiresAtMs > snapshot.absoluteExpiresAtMs
  ) return Object.freeze({ ok: false, reason: "CLOCK_INVALID" });
  const policyAbsoluteLimit = snapshot.issuedAtMs + policy.absoluteLifetimeMs;
  const policyIdleLimit = snapshot.lastActivityAtMs + policy.idleWindowMs;
  if (
    !Number.isSafeInteger(policyAbsoluteLimit) ||
    !Number.isSafeInteger(policyIdleLimit) ||
    snapshot.absoluteExpiresAtMs > policyAbsoluteLimit ||
    snapshot.idleExpiresAtMs > Math.min(policyIdleLimit, snapshot.absoluteExpiresAtMs)
  ) return Object.freeze({ ok: false, reason: "SESSION_LIFETIME_INVALID" });
  if (nowMs >= snapshot.absoluteExpiresAtMs) {
    return Object.freeze({ ok: false, reason: "SESSION_ABSOLUTE_EXPIRED" });
  }
  if (nowMs >= snapshot.idleExpiresAtMs) {
    return Object.freeze({ ok: false, reason: "SESSION_IDLE_EXPIRED" });
  }
  return Object.freeze({ ok: true, status: "DEVICE_ENTRY_VALID" });
}

export function evaluateDeviceSessionRenewal(
  snapshot: unknown,
  request: unknown,
  policy: DeviceSessionLifecyclePolicy,
  nowMs: number,
): RenewalEvaluation {
  if (
    !isDeviceSessionRenewalSnapshot(snapshot) ||
    !isDeviceSessionRenewalRequest(request) ||
    !isPolicy(policy) ||
    !isTimestamp(nowMs)
  ) {
    return Object.freeze({ ok: false, reason: "FORMAT_INVALID" });
  }
  if (
    snapshot.sessionId !== request.sessionId ||
    snapshot.workstationId !== request.workstationId ||
    snapshot.credentialId !== request.credentialId
  ) return Object.freeze({ ok: false, reason: "IDENTITY_MISMATCH" });
  const entry = evaluateDeviceSessionEntry(snapshot, policy, nowMs);
  if (!entry.ok) return entry;
  if (snapshot.renewalCounter !== request.renewalCounter) {
    return Object.freeze({ ok: false, reason: "RENEWAL_REPLAY" });
  }
  if (snapshot.sessionRevision !== request.expectedRevision) {
    return Object.freeze({ ok: false, reason: "SESSION_REVISION_CONFLICT" });
  }
  const counter = BigInt(snapshot.renewalCounter);
  if (counter >= SQL_BIGINT_MAX) return Object.freeze({ ok: false, reason: "COUNTER_EXHAUSTED" });
  const idleExpiresAtMs = Math.min(nowMs + policy.idleWindowMs, snapshot.absoluteExpiresAtMs);
  if (!Number.isSafeInteger(idleExpiresAtMs) || idleExpiresAtMs <= nowMs) {
    return Object.freeze({ ok: false, reason: "CLOCK_INVALID" });
  }
  return Object.freeze({
    ok: true,
    mutation: Object.freeze({
      sessionId: snapshot.sessionId,
      workstationId: snapshot.workstationId,
      credentialId: snapshot.credentialId,
      expectedRevision: snapshot.sessionRevision,
      expectedRenewalCounter: snapshot.renewalCounter,
      nextRenewalCounter: String(counter + 1n),
      lastActivityAtMs: nowMs,
      idleExpiresAtMs,
    }),
  });
}

function auditEvent(
  request: DeviceSessionRenewalRequest,
  reason: DeviceSessionRenewalReason | null,
): DeviceSessionRenewalAudit {
  return Object.freeze({
    eventType: reason === null
      ? "WORKSTATION_DEVICE_SESSION_RENEWED"
      : "WORKSTATION_DEVICE_SESSION_RENEWAL_REJECTED",
    status: reason === null ? "SUCCESS" : "FAILED",
    reason,
    sessionId: request.sessionId,
    workstationId: request.workstationId,
    credentialId: request.credentialId,
    renewalCounter: request.renewalCounter,
  });
}

async function writeValidatedAudit(
  writer: WorkstationSessionAuditWriter,
  event: DeviceSessionRenewalAudit,
  tx: Parameters<WorkstationSessionAuditWriter["write"]>[1],
): Promise<string> {
  const receipt = await writer.write(event, tx);
  if (!isCanonicalBigInt(receipt.auditLogId, false)) {
    throw new WorkstationLifecycleInfrastructureError("AUDIT_FAILURE");
  }
  return receipt.auditLogId;
}

function infrastructureReason(error: unknown): DeviceSessionRenewalReason {
  return error instanceof WorkstationLifecycleInfrastructureError
    ? error.code
    : "PERSISTENCE_FAILURE";
}

export function createWorkstationSessionLifecycle(dependencies: Readonly<{
  repository: WorkstationDeviceSessionRepository;
  audit: WorkstationSessionAuditWriter;
  credentialProof: WorkstationCredentialProofVerifier;
  policy: DeviceSessionLifecyclePolicy;
  now: () => number;
}>) {
  return Object.freeze({
    async renew(input: unknown): Promise<DeviceSessionRenewalResult> {
      if (!isDeviceSessionRenewalRequest(input) || !isPolicy(dependencies.policy)) {
        return rejected("FORMAT_INVALID");
      }
      const request = input;
      try {
        return await dependencies.repository.transaction(async tx => {
          const snapshot = await dependencies.repository.readForRenewal(request.sessionId, tx);
          if (snapshot === null) {
            await writeValidatedAudit(dependencies.audit, auditEvent(request, "SESSION_NOT_FOUND"), tx);
            return rejected("SESSION_NOT_FOUND");
          }
          const evaluated = evaluateDeviceSessionRenewal(
            snapshot,
            request,
            dependencies.policy,
            dependencies.now(),
          );
          if (!evaluated.ok) {
            await writeValidatedAudit(dependencies.audit, auditEvent(request, evaluated.reason), tx);
            return rejected(evaluated.reason);
          }
          if (!await dependencies.credentialProof.verify(request, snapshot, tx)) {
            await writeValidatedAudit(
              dependencies.audit,
              auditEvent(request, "CREDENTIAL_PROOF_REJECTED"),
              tx,
            );
            return rejected("CREDENTIAL_PROOF_REJECTED");
          }
          const receipt = await dependencies.repository.compareAndSwapRenewal(evaluated.mutation, tx);
          if (receipt.affectedRows !== 1 || !isRevision(receipt.newRevision)) {
            await writeValidatedAudit(
              dependencies.audit,
              auditEvent(request, "SESSION_REVISION_CONFLICT"),
              tx,
            );
            return rejected("SESSION_REVISION_CONFLICT");
          }
          const auditLogId = await writeValidatedAudit(dependencies.audit, auditEvent(request, null), tx);
          return Object.freeze({
            ok: true,
            status: "RENEWED",
            sessionId: evaluated.mutation.sessionId,
            workstationId: evaluated.mutation.workstationId,
            newRevision: receipt.newRevision,
            nextRenewalCounter: evaluated.mutation.nextRenewalCounter,
            idleExpiresAtMs: evaluated.mutation.idleExpiresAtMs,
            auditLogId,
            productionReady: false,
            ...restrictions,
          });
        });
      } catch (error) {
        return rejected(infrastructureReason(error));
      }
    },
  });
}

/** Device presence can open an entry screen; it can never authorize a user query. */
export function deviceSessionCanAuthorizeOperatorQuery(_session: unknown): false {
  return false;
}
