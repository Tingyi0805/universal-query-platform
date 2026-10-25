import { createHash } from "node:crypto";
import { types } from "node:util";
import {
  captureOperatorRequest,
  isValidWorkstationSession,
  mayDeliverOperatorData,
  requiresOperatorDataPurge,
  transitionWorkstationSession,
  type OperatorRequestFence,
  type WorkstationSession,
} from "./workstationSessionContract.js";
import {
  evaluateDeviceSessionEntry,
  type DeviceSessionLifecyclePolicy,
  type DeviceSessionRenewalReason,
  type DeviceSessionRenewalSnapshot,
} from "./workstationSessionLifecycle.js";
import type {
  OperatorSwitchTransaction,
  WorkstationOperatorSwitchAuditWriter,
  WorkstationOperatorSwitchRepository,
  WorkstationPinVerifier,
} from "./workstationOperatorSwitch.ports.js";
import {
  OperatorSwitchInfrastructureError,
  type OperatorSwitchInfrastructureCode,
} from "./workstationOperatorSwitch.ports.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ROWVERSION = /^[0-9a-f]{16}$/;
const SQL_BIGINT_MAX = 9_223_372_036_854_775_807n;
const PIN = /^\d{4,12}$/;
const PERMISSION = /^[A-Z][A-Z0-9_]{0,99}$/;

export type OperatorSwitchRequest = Readonly<{
  format: "WORKSTATION_OPERATOR_SWITCH_V1";
  requestId: string;
  deviceSessionId: string;
  workstationId: string;
  targetUserId: number;
  pin: string;
  expectedDeviceRevision: string;
  expectedOperatorRevision: string;
  expectedOperatorIncarnation: string;
  expectedGeneration: number;
}>;

export type OperatorSwitchLookup = Readonly<{
  requestId: string;
  deviceSessionId: string;
  workstationId: string;
  targetUserId: number;
}>;

export type OperatorSwitchSnapshot = Readonly<{
  format: "WORKSTATION_OPERATOR_SWITCH_SNAPSHOT_V1";
  deviceSession: DeviceSessionRenewalSnapshot;
  workstationPinEnabled: boolean;
  workstationAllowsUser: boolean;
  operator: Readonly<{
    revision: string;
    incarnation: string;
    session: WorkstationSession;
    previousOperatorUserId: number | null;
  }>;
  targetUser: Readonly<{
    id: number;
    active: boolean;
    tokenVersion: number;
    permissions: readonly string[];
  }>;
  pin: Readonly<{
    enabled: boolean;
    version: number;
    boundTokenVersion: number;
    boundPolicyRevision: string;
    revision: string;
    failedAttempts: number;
    attemptWindowStartedAtMs: number | null;
    lockedUntilMs: number | null;
  }>;
  pinPolicy: Readonly<{
    length: number;
    revision: string;
  }>;
}>;

export type OperatorSwitchPolicy = Readonly<{
  deviceSession: DeviceSessionLifecyclePolicy;
  maxFailedAttempts: number;
  attemptWindowMs: number;
  lockoutMs: number;
}>;

export type OperatorSwitchReason =
  | "FORMAT_INVALID"
  | "SNAPSHOT_NOT_FOUND"
  | "DEVICE_SESSION_INVALID"
  | "DEVICE_SESSION_REVOKED"
  | "DEVICE_SESSION_EXPIRED"
  | "DEVICE_CREDENTIAL_INVALID"
  | "WORKSTATION_INVALID"
  | "WORKSTATION_PIN_DISABLED"
  | "WORKSTATION_USER_NOT_ALLOWED"
  | "OPERATOR_NOT_LOCKED"
  | "OPERATOR_CONTEXT_STALE"
  | "USER_DISABLED"
  | "PIN_REVOKED"
  | "PIN_POLICY_CHANGED"
  | "TOKEN_VERSION_MISMATCH"
  | "PIN_LOCKED"
  | "INVALID_PIN"
  | "PIN_STATE_CONFLICT"
  | "SWITCH_CAS_CONFLICT"
  | "REQUEST_REPLAY"
  | "REQUEST_ID_CONFLICT"
  | "GENERATION_EXHAUSTED"
  | OperatorSwitchInfrastructureCode;

export type OperatorPinFailureMutation = Readonly<{
  targetUserId: number;
  expectedPinRevision: string;
  failedAttempts: number;
  attemptWindowStartedAtMs: number;
  lockedUntilMs: number | null;
}>;

export type OperatorAuthorizationCandidate = Readonly<{
  incarnation: string;
  revision: string;
  deviceSessionId: string;
  workstationId: string;
  tokenVersion: number;
  pinVersion: number;
  permissions: readonly string[];
  session: WorkstationSession;
}>;

export type OperatorSwitchMutation = Readonly<{
  requestId: string;
  requestDigest: string;
  expectedOperatorRevision: string;
  expectedOperatorIncarnation: string;
  expectedGeneration: number;
  expectedPinRevision: string;
  targetUserId: number;
  targetTokenVersion: number;
  targetPinVersion: number;
  nextIncarnation: string;
  nextSession: WorkstationSession;
}>;

export type OperatorSwitchAudit = Readonly<{
  eventType:
    | "WORKSTATION_PIN_VERIFICATION_FAILED"
    | "WORKSTATION_PIN_LOCKED"
    | "WORKSTATION_OPERATOR_SWITCH_REJECTED"
    | "WORKSTATION_OPERATOR_SWITCHED";
  status: "SUCCESS" | "FAILED";
  reason: OperatorSwitchReason | null;
  requestId: string;
  deviceSessionId: string;
  workstationId: string;
  previousOperatorUserId: number | null;
  targetUserId: number;
  previousGeneration: number | null;
  nextGeneration: number | null;
}>;

export type SwitchedOperatorRequestFence = Readonly<{
  contract: "WORKSTATION_SWITCHED_OPERATOR_REQUEST_V1";
  incarnation: string;
  operator: OperatorRequestFence;
}>;

const restrictions = Object.freeze({
  runtimeAuthority: "NONE" as const,
  jwtIssued: false as const,
  queryExecutionAllowed: false as const,
  patientDataAllowed: false as const,
  productionPersistence: "NOT_PROVEN" as const,
  productionReady: false as const,
});

export type OperatorSwitchResult =
  | Readonly<{
    ok: true;
    status: "SWITCHED";
    authorization: OperatorAuthorizationCandidate;
    auditLogId: string;
    purgeRequired: true;
  } & typeof restrictions>
  | Readonly<{
    ok: false;
    status: "REJECTED";
    reason: OperatorSwitchReason;
    mustRemainLocked: true;
  } & typeof restrictions>;

function hasExactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.getOwnPropertySymbols(value).length > 0) return false;
  const expected = [...keys].sort();
  const actual = Object.keys(descriptors).sort();
  return actual.length === expected.length &&
    actual.every((key, index) => key === expected[index]) &&
    Object.values(descriptors).every(descriptor => "value" in descriptor && descriptor.enumerable);
}

const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);
const isRevision = (value: unknown): value is string =>
  typeof value === "string" && ROWVERSION.test(value) && value !== "0000000000000000";
const isSafePositive = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) > 0;
const isSafeNonnegative = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0;
const isTimestamp = (value: unknown): value is number => isSafeNonnegative(value);
const isCanonicalBigInt = (value: unknown): value is string => {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,18}$/.test(value)) return false;
  try { return BigInt(value) <= SQL_BIGINT_MAX; } catch { return false; }
};

const requestKeys = [
  "format", "requestId", "deviceSessionId", "workstationId", "targetUserId", "pin",
  "expectedDeviceRevision", "expectedOperatorRevision", "expectedOperatorIncarnation",
  "expectedGeneration",
] as const;

export function isOperatorSwitchRequest(value: unknown): value is OperatorSwitchRequest {
  if (!hasExactKeys(value, requestKeys)) return false;
  return value.format === "WORKSTATION_OPERATOR_SWITCH_V1" &&
    isUuid(value.requestId) && isUuid(value.deviceSessionId) &&
    isCanonicalBigInt(value.workstationId) && isSafePositive(value.targetUserId) &&
    typeof value.pin === "string" && PIN.test(value.pin) &&
    isRevision(value.expectedDeviceRevision) && isRevision(value.expectedOperatorRevision) &&
    isUuid(value.expectedOperatorIncarnation) && isSafeNonnegative(value.expectedGeneration);
}

function validPermissions(value: unknown): value is readonly string[] {
  if (!Array.isArray(value) || value.length > 256 || types.isProxy(value)) return false;
  if (!value.every(item => typeof item === "string" && PERMISSION.test(item))) return false;
  return value.every((item, index) => index === 0 || value[index - 1]! < item);
}

function isOperatorSwitchSnapshot(value: unknown): value is OperatorSwitchSnapshot {
  if (!hasExactKeys(value, [
    "format", "deviceSession", "workstationPinEnabled", "workstationAllowsUser",
    "operator", "targetUser", "pin", "pinPolicy",
  ])) return false;
  if (!hasExactKeys(value.operator, ["revision", "incarnation", "session", "previousOperatorUserId"]) ||
    !hasExactKeys(value.targetUser, ["id", "active", "tokenVersion", "permissions"]) ||
    !hasExactKeys(value.pin, [
      "enabled", "version", "boundTokenVersion", "boundPolicyRevision", "revision",
      "failedAttempts", "attemptWindowStartedAtMs", "lockedUntilMs",
    ]) || !hasExactKeys(value.pinPolicy, ["length", "revision"])) return false;
  const operator = value.operator;
  const user = value.targetUser;
  const pin = value.pin;
  const pinPolicy = value.pinPolicy;
  return value.format === "WORKSTATION_OPERATOR_SWITCH_SNAPSHOT_V1" &&
    typeof value.workstationPinEnabled === "boolean" && typeof value.workstationAllowsUser === "boolean" &&
    isRevision(operator.revision) && isUuid(operator.incarnation) &&
    hasExactKeys(operator.session, ["state", "operatorUserId", "generation"]) &&
    isValidWorkstationSession(operator.session) &&
    (operator.previousOperatorUserId === null || isSafePositive(operator.previousOperatorUserId)) &&
    isSafePositive(user.id) && typeof user.active === "boolean" && isSafePositive(user.tokenVersion) &&
    validPermissions(user.permissions) && typeof pin.enabled === "boolean" &&
    isSafePositive(pin.version) && isSafePositive(pin.boundTokenVersion) &&
    isCanonicalBigInt(pin.boundPolicyRevision) && isRevision(pin.revision) &&
    isSafeNonnegative(pin.failedAttempts) &&
    (pin.attemptWindowStartedAtMs === null || isTimestamp(pin.attemptWindowStartedAtMs)) &&
    (pin.lockedUntilMs === null || isTimestamp(pin.lockedUntilMs)) &&
    isSafePositive(pinPolicy.length) && pinPolicy.length >= 4 && pinPolicy.length <= 12 &&
    isCanonicalBigInt(pinPolicy.revision) &&
    ((pin.failedAttempts === 0 && pin.attemptWindowStartedAtMs === null) ||
      (pin.failedAttempts > 0 && pin.attemptWindowStartedAtMs !== null));
}

function isPolicy(value: OperatorSwitchPolicy): boolean {
  return Number.isSafeInteger(value.maxFailedAttempts) && value.maxFailedAttempts >= 3 && value.maxFailedAttempts <= 10 &&
    Number.isSafeInteger(value.attemptWindowMs) && value.attemptWindowMs >= 60_000 && value.attemptWindowMs <= 3_600_000 &&
    Number.isSafeInteger(value.lockoutMs) && value.lockoutMs >= 60_000 && value.lockoutMs <= 3_600_000;
}

const reject = (reason: OperatorSwitchReason): OperatorSwitchResult => Object.freeze({
  ok: false, status: "REJECTED", reason, mustRemainLocked: true, ...restrictions,
});

function deviceReason(reason: DeviceSessionRenewalReason): OperatorSwitchReason {
  if (reason === "SESSION_REVOKED") return "DEVICE_SESSION_REVOKED";
  if (reason === "SESSION_IDLE_EXPIRED" || reason === "SESSION_ABSOLUTE_EXPIRED") {
    return "DEVICE_SESSION_EXPIRED";
  }
  if (reason === "CREDENTIAL_REVOKED" || reason === "CREDENTIAL_VERSION_MISMATCH") {
    return "DEVICE_CREDENTIAL_INVALID";
  }
  if (reason === "WORKSTATION_DISABLED" || reason === "WORKSTATION_RETIRED") {
    return "WORKSTATION_INVALID";
  }
  return "DEVICE_SESSION_INVALID";
}

function requestDigest(request: OperatorSwitchRequest): string {
  return createHash("sha256").update(JSON.stringify([
    "WORKSTATION_OPERATOR_SWITCH_REQUEST_V1", request.requestId, request.deviceSessionId,
    request.workstationId, request.targetUserId, request.expectedDeviceRevision,
    request.expectedOperatorRevision, request.expectedOperatorIncarnation, request.expectedGeneration,
  ])).digest("hex");
}

function failureMutation(
  snapshot: OperatorSwitchSnapshot,
  policy: OperatorSwitchPolicy,
  nowMs: number,
): OperatorPinFailureMutation {
  const inWindow = snapshot.pin.attemptWindowStartedAtMs !== null &&
    nowMs - snapshot.pin.attemptWindowStartedAtMs < policy.attemptWindowMs;
  const failedAttempts = inWindow ? snapshot.pin.failedAttempts + 1 : 1;
  return Object.freeze({
    targetUserId: snapshot.targetUser.id,
    expectedPinRevision: snapshot.pin.revision,
    failedAttempts,
    attemptWindowStartedAtMs: inWindow ? snapshot.pin.attemptWindowStartedAtMs! : nowMs,
    lockedUntilMs: failedAttempts >= policy.maxFailedAttempts ? nowMs + policy.lockoutMs : null,
  });
}

function auditEvent(
  request: OperatorSwitchRequest,
  snapshot: OperatorSwitchSnapshot | null,
  reason: OperatorSwitchReason | null,
  nextGeneration: number | null = null,
): OperatorSwitchAudit {
  const eventType = reason === null
    ? "WORKSTATION_OPERATOR_SWITCHED"
    : reason === "INVALID_PIN"
      ? "WORKSTATION_PIN_VERIFICATION_FAILED"
      : reason === "PIN_LOCKED"
        ? "WORKSTATION_PIN_LOCKED"
        : "WORKSTATION_OPERATOR_SWITCH_REJECTED";
  return Object.freeze({
    eventType,
    status: reason === null ? "SUCCESS" : "FAILED",
    reason,
    requestId: request.requestId,
    deviceSessionId: request.deviceSessionId,
    workstationId: request.workstationId,
    previousOperatorUserId: snapshot?.operator.previousOperatorUserId ?? null,
    targetUserId: request.targetUserId,
    previousGeneration: snapshot?.operator.session.generation ?? null,
    nextGeneration,
  });
}

async function writeAudit(
  writer: WorkstationOperatorSwitchAuditWriter,
  event: OperatorSwitchAudit,
  tx: OperatorSwitchTransaction,
): Promise<string> {
  const receipt = await writer.write(event, tx);
  if (!isCanonicalBigInt(receipt.auditLogId)) {
    throw new OperatorSwitchInfrastructureError("AUDIT_FAILURE");
  }
  return receipt.auditLogId;
}

function infrastructureReason(error: unknown): OperatorSwitchReason {
  return error instanceof OperatorSwitchInfrastructureError ? error.code : "PERSISTENCE_FAILURE";
}

export function createWorkstationOperatorSwitchService(dependencies: Readonly<{
  repository: WorkstationOperatorSwitchRepository;
  pinVerifier: WorkstationPinVerifier;
  audit: WorkstationOperatorSwitchAuditWriter;
  policy: OperatorSwitchPolicy;
  now: () => number;
  newIncarnation: () => string;
}>) {
  return Object.freeze({
    async switchOperator(input: unknown): Promise<OperatorSwitchResult> {
      if (!isOperatorSwitchRequest(input) || !isPolicy(dependencies.policy)) return reject("FORMAT_INVALID");
      const request = input;
      try {
        return await dependencies.repository.transaction(async tx => {
          const lookup: OperatorSwitchLookup = Object.freeze({
            requestId: request.requestId,
            deviceSessionId: request.deviceSessionId,
            workstationId: request.workstationId,
            targetUserId: request.targetUserId,
          });
          const snapshot = await dependencies.repository.readForSwitch(lookup, tx);
          if (snapshot === null) {
            await writeAudit(dependencies.audit, auditEvent(request, null, "SNAPSHOT_NOT_FOUND"), tx);
            return reject("SNAPSHOT_NOT_FOUND");
          }
          if (!isOperatorSwitchSnapshot(snapshot)) {
            throw new OperatorSwitchInfrastructureError("PERSISTENCE_FAILURE");
          }
          const deny = async (reason: OperatorSwitchReason) => {
            await writeAudit(dependencies.audit, auditEvent(request, snapshot, reason), tx);
            return reject(reason);
          };
          if (
            snapshot.deviceSession.sessionId !== request.deviceSessionId ||
            snapshot.deviceSession.workstationId !== request.workstationId ||
            snapshot.deviceSession.sessionRevision !== request.expectedDeviceRevision
          ) return deny("DEVICE_SESSION_INVALID");
          const nowMs = dependencies.now();
          const device = evaluateDeviceSessionEntry(
            snapshot.deviceSession,
            dependencies.policy.deviceSession,
            nowMs,
          );
          if (!device.ok) return deny(deviceReason(device.reason));
          if (!snapshot.workstationPinEnabled) return deny("WORKSTATION_PIN_DISABLED");
          if (!snapshot.workstationAllowsUser) return deny("WORKSTATION_USER_NOT_ALLOWED");
          if (snapshot.operator.session.state !== "OPERATOR_LOCKED") return deny("OPERATOR_NOT_LOCKED");
          if (
            snapshot.operator.revision !== request.expectedOperatorRevision ||
            snapshot.operator.incarnation !== request.expectedOperatorIncarnation ||
            snapshot.operator.session.generation !== request.expectedGeneration
          ) return deny("OPERATOR_CONTEXT_STALE");
          if (snapshot.targetUser.id !== request.targetUserId) return deny("OPERATOR_CONTEXT_STALE");
          if (!snapshot.targetUser.active) return deny("USER_DISABLED");
          if (!snapshot.pin.enabled) return deny("PIN_REVOKED");
          if (
            snapshot.pin.boundPolicyRevision !== snapshot.pinPolicy.revision ||
            request.pin.length !== snapshot.pinPolicy.length
          ) return deny("PIN_POLICY_CHANGED");
          if (snapshot.pin.boundTokenVersion !== snapshot.targetUser.tokenVersion) {
            return deny("TOKEN_VERSION_MISMATCH");
          }
          if (snapshot.pin.lockedUntilMs !== null && snapshot.pin.lockedUntilMs > nowMs) {
            return deny("PIN_LOCKED");
          }
          const digest = requestDigest(request);
          const claim = await dependencies.repository.claimRequest(request.requestId, digest, tx);
          if (claim === "REPLAY") return deny("REQUEST_REPLAY");
          if (claim === "CONFLICT") return deny("REQUEST_ID_CONFLICT");

          if (!await dependencies.pinVerifier.verify(request.targetUserId, request.pin, tx)) {
            const mutation = failureMutation(snapshot, dependencies.policy, nowMs);
            const receipt = await dependencies.repository.recordPinFailure(mutation, tx);
            if (receipt.affectedRows !== 1 || !isRevision(receipt.newPinRevision)) {
              return deny("PIN_STATE_CONFLICT");
            }
            const reason: OperatorSwitchReason = mutation.lockedUntilMs === null ? "INVALID_PIN" : "PIN_LOCKED";
            return deny(reason);
          }

          const nextIncarnation = dependencies.newIncarnation();
          if (!isUuid(nextIncarnation)) throw new OperatorSwitchInfrastructureError("PERSISTENCE_FAILURE");
          const nextSession = transitionWorkstationSession(snapshot.operator.session, {
            type: "OPERATOR_VERIFIED",
            userId: snapshot.targetUser.id,
          });
          if (nextSession.state !== "OPERATOR_ACTIVE") return deny("GENERATION_EXHAUSTED");
          const mutation: OperatorSwitchMutation = Object.freeze({
            requestId: request.requestId,
            requestDigest: digest,
            expectedOperatorRevision: snapshot.operator.revision,
            expectedOperatorIncarnation: snapshot.operator.incarnation,
            expectedGeneration: snapshot.operator.session.generation,
            expectedPinRevision: snapshot.pin.revision,
            targetUserId: snapshot.targetUser.id,
            targetTokenVersion: snapshot.targetUser.tokenVersion,
            targetPinVersion: snapshot.pin.version,
            nextIncarnation,
            nextSession,
          });
          const receipt = await dependencies.repository.compareAndSwapSwitch(mutation, tx);
          if (receipt.affectedRows !== 1 || !isRevision(receipt.newOperatorRevision)) {
            return deny("SWITCH_CAS_CONFLICT");
          }
          const auditLogId = await writeAudit(
            dependencies.audit,
            auditEvent(request, snapshot, null, nextSession.generation),
            tx,
          );
          const authorization: OperatorAuthorizationCandidate = Object.freeze({
            incarnation: nextIncarnation,
            revision: receipt.newOperatorRevision,
            deviceSessionId: request.deviceSessionId,
            workstationId: request.workstationId,
            tokenVersion: snapshot.targetUser.tokenVersion,
            pinVersion: snapshot.pin.version,
            permissions: Object.freeze([...snapshot.targetUser.permissions]),
            session: nextSession,
          });
          if (!requiresOperatorDataPurge(snapshot.operator.session, nextSession)) {
            throw new OperatorSwitchInfrastructureError("PERSISTENCE_FAILURE");
          }
          return Object.freeze({
            ok: true, status: "SWITCHED", authorization, auditLogId,
            purgeRequired: true, ...restrictions,
          });
        });
      } catch (error) {
        return reject(infrastructureReason(error));
      }
    },
  });
}

export function captureSwitchedOperatorRequest(
  authorization: OperatorAuthorizationCandidate,
): SwitchedOperatorRequestFence | null {
  if (!isUuid(authorization.incarnation)) return null;
  const operator = captureOperatorRequest(authorization.session);
  return operator ? Object.freeze({
    contract: "WORKSTATION_SWITCHED_OPERATOR_REQUEST_V1" as const,
    incarnation: authorization.incarnation,
    operator,
  }) : null;
}

export function mayDeliverSwitchedOperatorData(
  authorization: OperatorAuthorizationCandidate,
  fence: SwitchedOperatorRequestFence,
): boolean {
  return fence?.contract === "WORKSTATION_SWITCHED_OPERATOR_REQUEST_V1" &&
    authorization.incarnation === fence.incarnation &&
    mayDeliverOperatorData(authorization.session, fence.operator);
}
