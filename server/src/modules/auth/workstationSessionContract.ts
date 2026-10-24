/**
 * H0-1: pure shared workstation session contract.
 * No network, database, browser storage, token issuance, or runtime route changes.
 * Device availability is independent of individual operator authorization.
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
  | { type: "OPERATOR_SIGNED_OUT" }
  | { type: "DEVICE_REVOKED" }
  | { type: "DEVICE_RECOVERED" };

export type WorkstationSession = Readonly<{
  state: WorkstationState;
  operatorUserId: number | null;
  /** Increments when operator authorization changes, invalidating pending deliveries. */
  generation: number;
}>;

export const initialWorkstationSession: WorkstationSession = Object.freeze({
  state: "UNREGISTERED",
  operatorUserId: null,
  generation: 0,
});

const withState = (
  previous: WorkstationSession,
  state: WorkstationState,
  operatorUserId: number | null = null,
): WorkstationSession => ({
  state,
  operatorUserId,
  generation: previous.generation + 1,
});

/** Fail closed: invalid events never grant access or change state. */
export function transitionWorkstationSession(
  session: WorkstationSession,
  event: WorkstationEvent,
): WorkstationSession {
  if (event.type === "DEVICE_REVOKED" || event.type === "DEVICE_REJECTED") {
    return withState(session, "DEVICE_REVOKED");
  }
  if (session.state === "DEVICE_REVOKED") {
    // Re-registration must use an independent, authenticated device enrollment flow.
    return session;
  }
  if (event.type === "DEVICE_VERIFIED" && session.state === "UNREGISTERED") {
    return withState(session, "DEVICE_READY");
  }
  if (event.type === "DEVICE_RECOVERED" && session.state === "OPERATOR_LOCKED") {
    return withState(session, "DEVICE_READY");
  }
  if (event.type === "OPERATOR_VERIFIED" &&
      ["DEVICE_READY", "OPERATOR_ACTIVE", "OPERATOR_LOCKED"].includes(session.state) &&
      Number.isSafeInteger(event.userId) && event.userId > 0) {
    return withState(session, "OPERATOR_ACTIVE", event.userId);
  }
  if (event.type === "OPERATOR_LOCKED" && session.state === "OPERATOR_ACTIVE") {
    return withState(session, "OPERATOR_LOCKED");
  }
  if (event.type === "OPERATOR_SIGNED_OUT" &&
      ["OPERATOR_ACTIVE", "OPERATOR_LOCKED"].includes(session.state)) {
    return withState(session, "DEVICE_READY");
  }
  return session;
}

/** A response started by an earlier identity must not be rendered after switching or locking. */
export function mayDeliverOperatorData(
  current: WorkstationSession,
  requestedByUserId: number,
  requestGeneration: number,
): boolean {
  return current.state === "OPERATOR_ACTIVE" &&
    current.operatorUserId === requestedByUserId &&
    current.generation === requestGeneration;
}
