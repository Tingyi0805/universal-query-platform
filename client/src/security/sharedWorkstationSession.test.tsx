import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SharedWorkstationLockBoundary } from "./SharedWorkstationLockBoundary";
import {
  createSharedWorkstationSafetyController,
  createUnavailableRestrictiveSyncTransport,
  type RestrictiveSyncTransport,
  type ServerOperatorObservation,
  type SensitiveDataKind,
} from "./sharedWorkstationSession";

const workstationA = "9007199254740993";
const workstationB = "9007199254740994";
const sessionA = "00000000-0000-4000-8000-000000000701";
const sessionB = "00000000-0000-4000-8000-000000000702";
const incarnationA = "00000000-0000-4000-8000-000000000711";
const incarnationB = "00000000-0000-4000-8000-000000000712";
let eventSequence = 800;

class SyntheticBus {
  private readonly listeners = new Map<number, (event: unknown) => void>();
  private sequence = 0;
  emitted: unknown[] = [];

  transport(available = true): RestrictiveSyncTransport {
    const id = ++this.sequence;
    return {
      available,
      post: (event) => {
        this.emitted.push(event);
        for (const [target, listener] of this.listeners) if (target !== id) listener(event);
      },
      subscribe: (listener) => {
        this.listeners.set(id, listener);
        return () => this.listeners.delete(id);
      },
      close: () => this.listeners.delete(id),
    };
  }

  inject(value: unknown) {
    for (const listener of this.listeners.values()) listener(value);
  }
}

const observation = (
  operatorUserId: number,
  generation: number,
  overrides: Partial<ServerOperatorObservation> = {},
): ServerOperatorObservation => ({
  format: "WORKSTATION_OPERATOR_BROWSER_OBSERVATION_V1",
  workstationId: workstationA,
  deviceSessionId: generation === 1 ? sessionA : sessionB,
  operatorUserId,
  generation,
  incarnation: generation === 1 ? incarnationA : incarnationB,
  expiresAtMs: 100_000,
  ...overrides,
});

function controller(bus = new SyntheticBus(), workstationId = workstationA, now = () => 1_000) {
  return createSharedWorkstationSafetyController({
    workstationId,
    idleTimeoutMs: 30_000,
    transport: bus.transport(),
    now,
    newEventId: () => `00000000-0000-4000-8000-${String(++eventSequence).padStart(12, "0")}`,
  });
}

test("locked boundary removes sensitive children from the rendered tree", () => {
  const guard = controller();
  const locked = renderToStaticMarkup(
    <SharedWorkstationLockBoundary controller={guard}><div>PATIENT_SECRET</div></SharedWorkstationLockBoundary>,
  );
  assert.match(locked, /工作站已鎖定/);
  assert.doesNotMatch(locked, /PATIENT_SECRET/);
  assert.equal(guard.applyServerObservation(observation(12, 1)), true);
  const active = renderToStaticMarkup(
    <SharedWorkstationLockBoundary controller={guard}><div>AUTHORIZED_VIEW</div></SharedWorkstationLockBoundary>,
  );
  assert.match(active, /AUTHORIZED_VIEW/);
  assert.equal(guard.getState().runtimeAuthority, "NONE");
  assert.equal(guard.getState().productionReady, false);
});

test("A to B switch purges all registered state, aborts A, and changes both fence dimensions", () => {
  const guard = controller();
  assert.equal(guard.applyServerObservation(observation(12, 1)), true);
  const purged: SensitiveDataKind[] = [];
  const kinds: SensitiveDataKind[] = [
    "QUERY_PARAMETERS", "QUERY_OPTIONS", "QUERY_RESULTS", "PATIENT_LIST", "PATIENT_DETAIL", "CACHE",
    "SELECTED_ROWS", "HIERARCHY_NAVIGATION", "EXPORT", "PATIENT_WINDOW", "INTERACTIVE_DASHBOARD",
    "STATUS_MESSAGES",
  ];
  kinds.forEach((kind) => guard.registerPurgeTarget(kind, () => purged.push(kind)));
  const oldRequest = guard.beginSensitiveRequest("QUERY")!;
  assert.equal(guard.applyServerObservation(observation(13, 2)), true);
  assert.equal(oldRequest.signal.aborted, true);
  assert.equal(guard.mayDeliverResponse(oldRequest), false);
  assert.deepEqual(new Set(purged), new Set(kinds));
  assert.equal(guard.getState().operatorUserId, 13);
  assert.equal(guard.getState().generation, 2);
  assert.equal(guard.getState().incarnation, incarnationB);
});

test("an aborted request that later resolves cannot deliver data or an old error", () => {
  const guard = controller();
  guard.applyServerObservation(observation(12, 1));
  const request = guard.beginSensitiveRequest("PATIENT_DETAIL")!;
  guard.lock("OPERATOR_SWITCH");
  assert.equal(request.signal.aborted, true);
  assert.equal(guard.mayDeliverResponse(request), false);
  guard.finishRequest(request);
  assert.equal(guard.mayDeliverResponse(request), false);
});

test("the fenced runner suppresses late values and errors even when the transport ignores abort", async () => {
  const guard = controller();
  guard.applyServerObservation(observation(12, 1));
  let resolveValue!: (value: string) => void;
  const lateValue = guard.runSensitiveRequest("QUERY", () => new Promise<string>((resolve) => {
    resolveValue = resolve;
  }));
  guard.lock("OPERATOR_SWITCH");
  resolveValue("PATIENT_SECRET");
  const valueOutcome = await lateValue;
  assert.deepEqual(valueOutcome, { status: "SUPPRESSED" });
  assert.doesNotMatch(JSON.stringify(valueOutcome), /PATIENT_SECRET/);

  guard.applyServerObservation(observation(13, 2));
  let rejectError!: (error: Error) => void;
  const lateError = guard.runSensitiveRequest("EXPORT", () => new Promise<string>((_resolve, reject) => {
    rejectError = reject;
  }));
  guard.lock("SESSION_EXPIRED");
  rejectError(new Error("OLD_OPERATOR_EXPORT_ERROR"));
  const errorOutcome = await lateError;
  assert.deepEqual(errorOutcome, { status: "SUPPRESSED" });
  assert.doesNotMatch(JSON.stringify(errorOutcome), /OLD_OPERATOR/);
});

test("same user with a new session cannot receive an old session response", () => {
  const guard = controller();
  guard.applyServerObservation(observation(12, 1));
  const request = guard.beginSensitiveRequest("QUERY")!;
  assert.equal(guard.applyServerObservation(observation(12, 2)), true);
  assert.equal(guard.mayDeliverResponse(request), false);
});

test("out-of-order observations cannot resurrect A after B or reuse a locked generation", () => {
  const guard = controller();
  guard.applyServerObservation(observation(12, 1));
  guard.applyServerObservation(observation(13, 2));
  assert.equal(guard.applyServerObservation(observation(12, 1)), false);
  assert.equal(guard.getState().operatorUserId, 13);
  guard.lock("IDLE_TIMEOUT");
  assert.equal(guard.applyServerObservation(observation(13, 2)), false);
  assert.equal(guard.getState().status, "LOCKED");
});

test("a higher generation cannot reuse an earlier incarnation", () => {
  const guard = controller();
  guard.applyServerObservation(observation(12, 1));
  assert.equal(guard.applyServerObservation(observation(13, 2, { incarnation: incarnationA })), false);
  assert.equal(guard.getState().status, "LOCKED");
  assert.equal(guard.getState().reason, "CONTEXT_INVALID");
});

test("same-workstation tabs synchronize restrictive lock without broadcasting authority", () => {
  const bus = new SyntheticBus();
  const first = controller(bus);
  const second = controller(bus);
  first.applyServerObservation(observation(12, 1));
  second.applyServerObservation(observation(12, 1));
  first.lock("OPERATOR_SIGNOUT");
  assert.equal(second.getState().status, "LOCKED");
  assert.equal(second.getState().reason, "OPERATOR_SIGNOUT");
  assert.equal(JSON.stringify(bus.emitted).includes("OPERATOR_ACTIVE"), false);
  assert.equal(JSON.stringify(bus.emitted).includes(incarnationA), false);
});

test("restrictive events are scoped to one workstation and cannot authorize another", () => {
  const bus = new SyntheticBus();
  const first = controller(bus, workstationA);
  const other = controller(bus, workstationB);
  first.applyServerObservation(observation(12, 1));
  other.applyServerObservation(observation(22, 1, { workstationId: workstationB }));
  first.lock("AUTHORIZATION_REVOKED");
  assert.equal(other.getState().status, "OPERATOR_ACTIVE");
  bus.inject({
    format: "WORKSTATION_RESTRICTIVE_SYNC_V1",
    eventId: "00000000-0000-4000-8000-000000000899",
    workstationId: workstationB,
    action: "OPERATOR_ACTIVE",
    reason: "INITIAL",
  });
  assert.equal(other.getState().status, "OPERATOR_ACTIVE");
});

test("missing BroadcastChannel support stays locked and refuses server observations", () => {
  const guard = createSharedWorkstationSafetyController({
    workstationId: workstationA,
    idleTimeoutMs: 30_000,
    transport: createUnavailableRestrictiveSyncTransport(),
  });
  assert.equal(guard.getState().reason, "SYNC_UNAVAILABLE");
  assert.equal(guard.applyServerObservation(observation(12, 1)), false);
  assert.equal(guard.beginSensitiveRequest("QUERY"), null);
});

test("unknown observation fields and accessors fail closed without reading sensitive hooks", () => {
  const guard = controller();
  let invoked = false;
  const accessor = {
    ...observation(12, 1),
    get pin() { invoked = true; return "123456"; },
  };
  assert.equal(guard.applyServerObservation(accessor), false);
  assert.equal(invoked, false);
  assert.equal(guard.getState().reason, "CONTEXT_INVALID");
});

test("a refreshed page starts locked because no operator state is persisted", () => {
  const bus = new SyntheticBus();
  const beforeRefresh = controller(bus);
  beforeRefresh.applyServerObservation(observation(12, 1));
  const afterRefresh = controller(bus);
  assert.equal(afterRefresh.getState().status, "LOCKED");
  assert.equal(afterRefresh.getState().operatorUserId, null);
});

test("idle and absolute expiry purge data and abort requests", () => {
  let now = 1_000;
  const idle = controller(new SyntheticBus(), workstationA, () => now);
  idle.applyServerObservation(observation(12, 1, { expiresAtMs: 100_000 }), now);
  const idleRequest = idle.beginSensitiveRequest("PATIENT_LIST")!;
  now = 31_000;
  idle.tick(now);
  assert.equal(idle.getState().reason, "IDLE_TIMEOUT");
  assert.equal(idleRequest.signal.aborted, true);

  const expiry = controller(new SyntheticBus(), workstationA, () => now);
  expiry.applyServerObservation(observation(12, 1, { expiresAtMs: 40_000 }), now);
  now = 40_000;
  expiry.tick(now);
  assert.equal(expiry.getState().reason, "SESSION_EXPIRED");
});

test("device revocation is terminal for the current browser controller", () => {
  const guard = controller();
  guard.applyServerObservation(observation(12, 1));
  guard.revokeDevice();
  assert.equal(guard.getState().status, "DEVICE_REVOKED");
  assert.equal(guard.applyServerObservation(observation(13, 2)), false);
});

test("network recovery never restores an operator without a newer server generation", () => {
  const guard = controller();
  guard.applyServerObservation(observation(12, 1));
  guard.networkUnavailable();
  guard.networkRestored();
  assert.equal(guard.getState().status, "LOCKED");
  assert.equal(guard.applyServerObservation(observation(12, 1)), false);
  assert.equal(guard.applyServerObservation(observation(12, 2)), true);
});

test("export handles are aborted and fenced before a Blob can be delivered", () => {
  const guard = controller();
  guard.applyServerObservation(observation(12, 1));
  const exportRequest = guard.beginSensitiveRequest("EXPORT")!;
  guard.lock("SESSION_EXPIRED");
  assert.equal(exportRequest.signal.aborted, true);
  assert.equal(guard.mayDeliverResponse(exportRequest), false);
});

test("one failing purge callback cannot prevent remaining sensitive stores from clearing", () => {
  const guard = controller();
  guard.applyServerObservation(observation(12, 1));
  let cleared = false;
  guard.registerPurgeTarget("CACHE", () => { throw new Error("private callback error"); });
  guard.registerPurgeTarget("QUERY_RESULTS", () => { cleared = true; });
  assert.doesNotThrow(() => guard.lock("OPERATOR_SWITCH"));
  assert.equal(cleared, true);
});

test("the guard is opt-in and does not patch fetch, storage, or public dashboard playback", () => {
  const originalFetch = globalThis.fetch;
  const publicDashboardState = { playing: true, deviceToken: "page-memory-only" };
  const guard = controller();
  guard.lock("IDLE_TIMEOUT");
  assert.equal(globalThis.fetch, originalFetch);
  assert.deepEqual(publicDashboardState, { playing: true, deviceToken: "page-memory-only" });
});
