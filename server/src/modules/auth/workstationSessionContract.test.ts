import assert from "node:assert/strict";
import test from "node:test";
import {
  initialWorkstationSession as initial,
  mayDeliverOperatorData,
  transitionWorkstationSession as next,
} from "./workstationSessionContract.js";

test("device registration does not authenticate an operator", () => {
  const ready = next(initial, { type: "DEVICE_VERIFIED" });
  assert.equal(ready.state, "DEVICE_READY");
  assert.equal(ready.operatorUserId, null);
  assert.equal(mayDeliverOperatorData(ready, 1, ready.generation), false);
});

test("PIN-authenticated switch invalidates previous user's pending responses", () => {
  const ready = next(initial, { type: "DEVICE_VERIFIED" });
  const a = next(ready, { type: "OPERATOR_VERIFIED", userId: 12 });
  assert.equal(mayDeliverOperatorData(a, 12, a.generation), true);
  const b = next(a, { type: "OPERATOR_VERIFIED", userId: 13 });
  assert.equal(mayDeliverOperatorData(b, 12, a.generation), false);
  assert.equal(mayDeliverOperatorData(b, 13, b.generation), true);
});

test("locking and signout remove access without making workstation unavailable", () => {
  const active = next(next(initial, { type: "DEVICE_VERIFIED" }), { type: "OPERATOR_VERIFIED", userId: 1 });
  const locked = next(active, { type: "OPERATOR_LOCKED" });
  assert.equal(locked.state, "OPERATOR_LOCKED");
  assert.equal(locked.operatorUserId, null);
  assert.equal(mayDeliverOperatorData(locked, 1, active.generation), false);
  const ready = next(locked, { type: "OPERATOR_SIGNED_OUT" });
  assert.equal(ready.state, "DEVICE_READY");
});

test("revocation fails closed and cannot be unlocked by PIN or device verification", () => {
  const ready = next(initial, { type: "DEVICE_VERIFIED" });
  const revoked = next(ready, { type: "DEVICE_REVOKED" });
  assert.equal(revoked.state, "DEVICE_REVOKED");
  assert.equal(next(revoked, { type: "OPERATOR_VERIFIED", userId: 1 }), revoked);
  assert.equal(next(revoked, { type: "DEVICE_VERIFIED" }), revoked);
});

test("invalid operator identity never grants authorization", () => {
  const ready = next(initial, { type: "DEVICE_VERIFIED" });
  assert.equal(next(ready, { type: "OPERATOR_VERIFIED", userId: 0 }), ready);
  assert.equal(next(ready, { type: "OPERATOR_VERIFIED", userId: Number.NaN }), ready);
  assert.equal(next(initial, { type: "OPERATOR_VERIFIED", userId: 1 }), initial);
});

test("recovery requires operator reauthentication", () => {
  const active = next(next(initial, { type: "DEVICE_VERIFIED" }), { type: "OPERATOR_VERIFIED", userId: 4 });
  const recovered = next(next(active, { type: "OPERATOR_LOCKED" }), { type: "DEVICE_RECOVERED" });
  assert.equal(recovered.state, "DEVICE_READY");
  assert.equal(recovered.operatorUserId, null);
});
