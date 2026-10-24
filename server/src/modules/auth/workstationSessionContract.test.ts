import assert from "node:assert/strict";
import test from "node:test";
import {
  captureOperatorRequest,
  initialWorkstationSession as initial,
  isValidWorkstationSession,
  mayDeliverOperatorData,
  requiresOperatorDataPurge,
  transitionWorkstationSession as next,
  type WorkstationEvent,
  type WorkstationSession,
  type WorkstationState,
} from "./workstationSessionContract.js";

const ready = () => next(initial, { type: "DEVICE_VERIFIED" });
const active = (userId = 12) => next(ready(), { type: "OPERATOR_VERIFIED", userId });
const locked = () => next(active(), { type: "OPERATOR_LOCKED" });
const revoked = () => next(ready(), { type: "DEVICE_REVOKED" });

test("device registration is separate from operator authorization", () => {
  const session = ready();
  assert.equal(session.state, "DEVICE_READY");
  assert.equal(session.operatorUserId, null);
  assert.equal(captureOperatorRequest(session), null);
});

test("accepted transitions increment generation and produce immutable sessions", () => {
  const device = ready();
  const operator = next(device, { type: "OPERATOR_VERIFIED", userId: 12 });
  assert.equal(device.generation, 1);
  assert.equal(operator.generation, 2);
  assert.equal(Object.isFrozen(device), true);
  assert.equal(Object.isFrozen(operator), true);
  assert.throws(() => {
    (operator as { state: string }).state = "DEVICE_READY";
  }, TypeError);
});

test("PIN-authenticated A to B switch invalidates every A response fence", () => {
  const operatorA = active(12);
  const requestA1 = captureOperatorRequest(operatorA)!;
  const requestA2 = captureOperatorRequest(operatorA)!;
  assert.equal(Object.isFrozen(requestA1), true);
  assert.equal(mayDeliverOperatorData(operatorA, requestA1), true);

  const operatorB = next(operatorA, { type: "OPERATOR_VERIFIED", userId: 13 });
  const requestB = captureOperatorRequest(operatorB)!;
  assert.equal(requiresOperatorDataPurge(operatorA, operatorB), true);
  assert.equal(mayDeliverOperatorData(operatorB, requestA1), false);
  assert.equal(mayDeliverOperatorData(operatorB, requestA2), false);
  assert.equal(mayDeliverOperatorData(operatorB, requestB), true);
});

test("idle lock clears operator authority and PIN re-verification creates a new generation", () => {
  const beforeLock = active(4);
  const stale = captureOperatorRequest(beforeLock)!;
  const afterLock = next(beforeLock, { type: "OPERATOR_LOCKED" });
  assert.deepEqual(
    { state: afterLock.state, user: afterLock.operatorUserId },
    { state: "OPERATOR_LOCKED", user: null },
  );
  assert.equal(requiresOperatorDataPurge(beforeLock, afterLock), true);
  assert.equal(mayDeliverOperatorData(afterLock, stale), false);

  const recovered = next(afterLock, { type: "OPERATOR_VERIFIED", userId: 4 });
  assert.equal(recovered.state, "OPERATOR_ACTIVE");
  assert.equal(recovered.generation, afterLock.generation + 1);
  assert.equal(mayDeliverOperatorData(recovered, stale), false);
});

test("JWT expiry locks only the operator while the verified device remains recoverable", () => {
  const operator = active(7);
  const expired = next(operator, { type: "OPERATOR_AUTHORIZATION_EXPIRED" });
  assert.equal(expired.state, "OPERATOR_LOCKED");
  assert.equal(expired.operatorUserId, null);
  assert.equal(next(expired, { type: "DEVICE_VERIFIED" }), expired);
  assert.equal(next(expired, { type: "OPERATOR_VERIFIED", userId: 8 }).state, "OPERATOR_ACTIVE");
});

test("user disable, permission change, or TokenVersion change removes operator but keeps device ready", () => {
  const operator = active(9);
  const stale = captureOperatorRequest(operator)!;
  const invalidated = next(operator, { type: "OPERATOR_AUTHORIZATION_REVOKED" });
  assert.equal(invalidated.state, "DEVICE_READY");
  assert.equal(invalidated.operatorUserId, null);
  assert.equal(mayDeliverOperatorData(invalidated, stale), false);
  assert.equal(requiresOperatorDataPurge(operator, invalidated), true);
});

test("device rejection and revocation are terminal and idempotent", () => {
  const operator = active(2);
  const stale = captureOperatorRequest(operator)!;
  const denied = next(operator, { type: "DEVICE_REJECTED" });
  assert.equal(denied.state, "DEVICE_REVOKED");
  assert.equal(denied.operatorUserId, null);
  assert.equal(mayDeliverOperatorData(denied, stale), false);

  const attempts: WorkstationEvent[] = [
    { type: "DEVICE_VERIFIED" },
    { type: "OPERATOR_VERIFIED", userId: 2 },
    { type: "OPERATOR_LOCKED" },
    { type: "OPERATOR_AUTHORIZATION_EXPIRED" },
    { type: "OPERATOR_AUTHORIZATION_REVOKED" },
    { type: "OPERATOR_SIGNED_OUT" },
    { type: "DEVICE_REVOKED" },
  ];
  for (const event of attempts) assert.equal(next(denied, event), denied);
});

test("signout clears active or locked operator without disabling workstation", () => {
  const operator = active(1);
  const signedOut = next(operator, { type: "OPERATOR_SIGNED_OUT" });
  assert.equal(signedOut.state, "DEVICE_READY");
  assert.equal(requiresOperatorDataPurge(operator, signedOut), true);

  const lockedOperator = locked();
  assert.equal(next(lockedOperator, { type: "OPERATOR_SIGNED_OUT" }).state, "DEVICE_READY");
});

test("invalid operator identity and forged request fences never grant authority", () => {
  const device = ready();
  assert.equal(next(device, { type: "OPERATOR_VERIFIED", userId: 0 }), device);
  assert.equal(next(device, { type: "OPERATOR_VERIFIED", userId: Number.NaN }), device);
  assert.equal(next(initial, { type: "OPERATOR_VERIFIED", userId: 1 }), initial);

  const operator = active(3);
  assert.equal(mayDeliverOperatorData(operator, {
    contract: "WORKSTATION_OPERATOR_REQUEST_V1",
    operatorUserId: 3,
    generation: Number.NaN,
  }), false);
  assert.equal(mayDeliverOperatorData(operator, {
    contract: "WORKSTATION_OPERATOR_REQUEST_V1",
    operatorUserId: 4,
    generation: operator.generation,
  }), false);
});

test("illegal transition matrix is identity-preserving", () => {
  const sessions: Record<WorkstationState, WorkstationSession> = {
    UNREGISTERED: initial,
    DEVICE_READY: ready(),
    OPERATOR_ACTIVE: active(),
    OPERATOR_LOCKED: locked(),
    DEVICE_REVOKED: revoked(),
  };
  const illegal: Record<WorkstationState, WorkstationEvent[]> = {
    UNREGISTERED: [
      { type: "OPERATOR_VERIFIED", userId: 1 },
      { type: "OPERATOR_LOCKED" },
      { type: "OPERATOR_AUTHORIZATION_EXPIRED" },
      { type: "OPERATOR_AUTHORIZATION_REVOKED" },
      { type: "OPERATOR_SIGNED_OUT" },
    ],
    DEVICE_READY: [
      { type: "DEVICE_VERIFIED" },
      { type: "OPERATOR_LOCKED" },
      { type: "OPERATOR_AUTHORIZATION_EXPIRED" },
      { type: "OPERATOR_AUTHORIZATION_REVOKED" },
      { type: "OPERATOR_SIGNED_OUT" },
    ],
    OPERATOR_ACTIVE: [{ type: "DEVICE_VERIFIED" }],
    OPERATOR_LOCKED: [
      { type: "DEVICE_VERIFIED" },
      { type: "OPERATOR_LOCKED" },
      { type: "OPERATOR_AUTHORIZATION_EXPIRED" },
    ],
    DEVICE_REVOKED: [
      { type: "DEVICE_VERIFIED" },
      { type: "OPERATOR_VERIFIED", userId: 1 },
      { type: "OPERATOR_SIGNED_OUT" },
      { type: "DEVICE_REVOKED" },
    ],
  };
  for (const [state, events] of Object.entries(illegal) as [WorkstationState, WorkstationEvent[]][]) {
    for (const event of events) assert.equal(next(sessions[state], event), sessions[state]);
  }
});

test("malformed sessions and exhausted generations fail closed", () => {
  const malformed = { state: "OPERATOR_ACTIVE", operatorUserId: null, generation: 2 } as WorkstationSession;
  assert.equal(isValidWorkstationSession(malformed), false);
  const denied = next(malformed, { type: "OPERATOR_VERIFIED", userId: 1 });
  assert.equal(denied.state, "DEVICE_REVOKED");
  assert.equal(captureOperatorRequest(denied), null);

  const exhausted = Object.freeze({
    state: "OPERATOR_ACTIVE" as const,
    operatorUserId: 1,
    generation: Number.MAX_SAFE_INTEGER,
  });
  const overflowDenied = next(exhausted, { type: "OPERATOR_LOCKED" });
  assert.equal(overflowDenied.state, "DEVICE_REVOKED");
  assert.equal(overflowDenied.generation, Number.MAX_SAFE_INTEGER);
  assert.equal(mayDeliverOperatorData(overflowDenied, captureOperatorRequest(exhausted)!), false);
});

test("purge signal is conservative for malformed input and ignores true no-ops", () => {
  const device = ready();
  assert.equal(requiresOperatorDataPurge(device, device), false);
  assert.equal(requiresOperatorDataPurge(device, next(device, { type: "DEVICE_VERIFIED" })), false);
  assert.equal(requiresOperatorDataPurge(
    { state: "OPERATOR_ACTIVE", operatorUserId: null, generation: 1 } as WorkstationSession,
    device,
  ), true);
});
