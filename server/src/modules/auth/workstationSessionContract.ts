/**
 * H0-1: pure shared-workstation session contract.
 *
 * This module deliberately has no network, database, browser-storage, token
 * issuance, or runtime-route integration. A device being ready never grants an
 * operator authority, and an operator request fence is only a model-level
 * freshness check until later H0 phases enforce it at both delivery boundaries.
 */
export type WorkstationState =
  | "UNREGISTERED"
  | "DEVICE_READY"
  | "OPERATOR_ACTIVE"
  | "OPERATOR_LOCKED"
  | "DEVICE_REVOKED";

export type WorkstationEvent =
  | { type: "DEVICE_VERIFIED" }
  | { type: "DEVICE_REJECTED" }
  | { type: "OPERATOR_VERIFIED"; userId: number }
  | { type: "OPERATOR_LOCKED" }
  | { type: "OPERATOR_AUTHORIZATION_EXPIRED" }
  | { type: "OPERATOR_AUTHORIZATION_REVOKED" }
  | { type: "OPERATOR_SIGNED_OUT" }
  | { type: "DEVICE_REVOKED" };

export type WorkstationSession = Readonly<{
  state: WorkstationState;
  operatorUserId: number | null;
  /** Increments at every accepted authorization boundary change. */
  generation: number;
}>;

export type OperatorRequestFence = Readonly<{
  contract: "WORKSTATION_OPERATOR_REQUEST_V1";
  operatorUserId: number;
  generation: number;
}>;

const freezeSession = (
  state: WorkstationState,
  operatorUserId: number | null,
  generation: number,
): WorkstationSession => Object.freeze({ state, operatorUserId, generation });

export const initialWorkstationSession: WorkstationSession = freezeSession(
  "UNREGISTERED",
  null,
  0,
);

const isOperatorId = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) > 0;

export function isValidWorkstationSession(value: unknown): value is WorkstationSession {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<WorkstationSession>;
  if (!Number.isSafeInteger(candidate.generation) || Number(candidate.generation) < 0) {
    return false;
  }

  if (candidate.state === "OPERATOR_ACTIVE") {
    return isOperatorId(candidate.operatorUserId);
  }
  if (
    candidate.state === "UNREGISTERED" ||
    candidate.state === "DEVICE_READY" ||
    candidate.state === "OPERATOR_LOCKED" ||
    candidate.state === "DEVICE_REVOKED"
  ) {
    return candidate.operatorUserId === null;
  }
  return false;
}

const failClosedSession = (previous: unknown): WorkstationSession => {
  const generation =
    previous && typeof previous === "object" &&
    Number.isSafeInteger((previous as Partial<WorkstationSession>).generation) &&
    Number((previous as Partial<WorkstationSession>).generation) >= 0
      ? Number((previous as Partial<WorkstationSession>).generation)
      : Number.MAX_SAFE_INTEGER;
  return freezeSession("DEVICE_REVOKED", null, generation);
};

const withNextGeneration = (
  previous: WorkstationSession,
  state: WorkstationState,
  operatorUserId: number | null = null,
): WorkstationSession => {
  if (previous.generation >= Number.MAX_SAFE_INTEGER) {
    // Generation reuse or rounding could admit a stale response. Revoke instead.
    return failClosedSession(previous);
  }
  return freezeSession(state, operatorUserId, previous.generation + 1);
};

/**
 * Applies one authenticated observation to the model. Invalid transitions are
 * identity-preserving no-ops; malformed sessions and generation exhaustion are
 * terminal, fail-closed device revocations.
 */
export function transitionWorkstationSession(
  session: WorkstationSession,
  event: WorkstationEvent,
): WorkstationSession {
  if (!isValidWorkstationSession(session)) return failClosedSession(session);

  if (session.state === "DEVICE_REVOKED") return session;
  if (event.type === "DEVICE_REVOKED" || event.type === "DEVICE_REJECTED") {
    return withNextGeneration(session, "DEVICE_REVOKED");
  }
  if (event.type === "DEVICE_VERIFIED" && session.state === "UNREGISTERED") {
    return withNextGeneration(session, "DEVICE_READY");
  }
  if (
    event.type === "OPERATOR_VERIFIED" &&
    (session.state === "DEVICE_READY" ||
      session.state === "OPERATOR_ACTIVE" ||
      session.state === "OPERATOR_LOCKED") &&
    isOperatorId(event.userId)
  ) {
    return withNextGeneration(session, "OPERATOR_ACTIVE", event.userId);
  }
  if (
    (event.type === "OPERATOR_LOCKED" ||
      event.type === "OPERATOR_AUTHORIZATION_EXPIRED") &&
    session.state === "OPERATOR_ACTIVE"
  ) {
    return withNextGeneration(session, "OPERATOR_LOCKED");
  }
  if (
    event.type === "OPERATOR_AUTHORIZATION_REVOKED" &&
    (session.state === "OPERATOR_ACTIVE" || session.state === "OPERATOR_LOCKED")
  ) {
    return withNextGeneration(session, "DEVICE_READY");
  }
  if (
    event.type === "OPERATOR_SIGNED_OUT" &&
    (session.state === "OPERATOR_ACTIVE" || session.state === "OPERATOR_LOCKED")
  ) {
    return withNextGeneration(session, "DEVICE_READY");
  }
  return session;
}

/** Capture this fence when starting an operator-authorized request. */
export function captureOperatorRequest(
  session: WorkstationSession,
): OperatorRequestFence | null {
  if (!isValidWorkstationSession(session) || session.state !== "OPERATOR_ACTIVE") {
    return null;
  }
  const operatorUserId = session.operatorUserId;
  if (!isOperatorId(operatorUserId)) return null;
  return Object.freeze({
    contract: "WORKSTATION_OPERATOR_REQUEST_V1" as const,
    operatorUserId,
    generation: session.generation,
  });
}

/**
 * A response started under an earlier identity or authorization generation must
 * not be rendered. This does not replace server-side authorization or auditing.
 */
export function mayDeliverOperatorData(
  current: WorkstationSession,
  request: OperatorRequestFence,
): boolean {
  return isValidWorkstationSession(current) &&
    current.state === "OPERATOR_ACTIVE" &&
    request?.contract === "WORKSTATION_OPERATOR_REQUEST_V1" &&
    isOperatorId(request.operatorUserId) &&
    Number.isSafeInteger(request.generation) &&
    request.generation >= 0 &&
    current.operatorUserId === request.operatorUserId &&
    current.generation === request.generation;
}

/**
 * Signals that operator-owned query inputs, results, patient data, and caches
 * must be purged. Actual browser and server integration belongs to later H0 work.
 */
export function requiresOperatorDataPurge(
  previous: WorkstationSession,
  current: WorkstationSession,
): boolean {
  if (!isValidWorkstationSession(previous) || !isValidWorkstationSession(current)) {
    return true;
  }
  if (previous === current || previous.generation === current.generation) return false;
  return previous.state === "OPERATOR_ACTIVE" ||
    previous.state === "OPERATOR_LOCKED" ||
    current.state === "OPERATOR_ACTIVE" ||
    current.state === "OPERATOR_LOCKED";
}
