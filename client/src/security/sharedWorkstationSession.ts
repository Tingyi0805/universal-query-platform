export type WorkstationLockReason =
  | "INITIAL"
  | "IDLE_TIMEOUT"
  | "OPERATOR_SWITCH"
  | "OPERATOR_SIGNOUT"
  | "AUTHORIZATION_REVOKED"
  | "DEVICE_REVOKED"
  | "SESSION_EXPIRED"
  | "NETWORK_UNAVAILABLE"
  | "PAGE_HIDDEN"
  | "SYNC_UNAVAILABLE"
  | "CONTEXT_INVALID";

export type SensitiveDataKind =
  | "QUERY_PARAMETERS"
  | "QUERY_OPTIONS"
  | "QUERY_RESULTS"
  | "PATIENT_LIST"
  | "PATIENT_DETAIL"
  | "CACHE"
  | "SELECTED_ROWS"
  | "HIERARCHY_NAVIGATION"
  | "EXPORT"
  | "PATIENT_WINDOW"
  | "STATUS_MESSAGES"
  | "INTERACTIVE_DASHBOARD";

export type SensitiveRequestKind =
  | "QUERY"
  | "PATIENT_LIST"
  | "PATIENT_DETAIL"
  | "EXPORT"
  | "INTERACTIVE_DASHBOARD";

export type ServerOperatorObservation = Readonly<{
  format: "WORKSTATION_OPERATOR_BROWSER_OBSERVATION_V1";
  workstationId: string;
  deviceSessionId: string;
  operatorUserId: number;
  generation: number;
  incarnation: string;
  expiresAtMs: number;
}>;

export type BrowserOperatorFence = Readonly<{
  format: "WORKSTATION_BROWSER_REQUEST_FENCE_V1";
  workstationId: string;
  deviceSessionId: string;
  operatorUserId: number;
  generation: number;
  incarnation: string;
}>;

export type SensitiveRequestHandle = Readonly<{
  kind: SensitiveRequestKind;
  signal: AbortSignal;
  fence: BrowserOperatorFence;
}>;

export type SensitiveRequestOutcome<T> =
  | Readonly<{ status: "DELIVERABLE"; value: T }>
  | Readonly<{ status: "CURRENT_ERROR"; error: unknown }>
  | Readonly<{ status: "SUPPRESSED" }>;

export type WorkstationBrowserState = Readonly<{
  status: "LOCKED" | "OPERATOR_ACTIVE" | "DEVICE_REVOKED";
  reason: WorkstationLockReason | null;
  workstationId: string;
  deviceSessionId: string | null;
  operatorUserId: number | null;
  generation: number | null;
  incarnation: string | null;
  expiresAtMs: number | null;
  runtimeAuthority: "NONE";
  productionReady: false;
}>;

type RestrictiveSyncEvent = Readonly<{
  format: "WORKSTATION_RESTRICTIVE_SYNC_V1";
  eventId: string;
  workstationId: string;
  action: "LOCK" | "DEVICE_REVOKED";
  reason: WorkstationLockReason;
}>;

export interface RestrictiveSyncTransport {
  readonly available: boolean;
  post(event: RestrictiveSyncEvent): void;
  subscribe(listener: (event: unknown) => void): () => void;
  close(): void;
}

export interface SharedWorkstationSafetyController {
  getState(): WorkstationBrowserState;
  subscribe(listener: () => void): () => void;
  registerPurgeTarget(kind: SensitiveDataKind, purge: () => void): () => void;
  applyServerObservation(observation: unknown, nowMs?: number): boolean;
  lock(reason: Exclude<WorkstationLockReason, "DEVICE_REVOKED">): void;
  revokeDevice(): void;
  noteActivity(nowMs?: number): void;
  tick(nowMs?: number): void;
  networkUnavailable(): void;
  networkRestored(): void;
  beginSensitiveRequest(kind: SensitiveRequestKind): SensitiveRequestHandle | null;
  mayDeliverResponse(handle: SensitiveRequestHandle): boolean;
  finishRequest(handle: SensitiveRequestHandle): void;
  runSensitiveRequest<T>(
    kind: SensitiveRequestKind,
    execute: (signal: AbortSignal) => Promise<T>,
  ): Promise<SensitiveRequestOutcome<T>>;
  dispose(): void;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SQL_BIGINT_MAX = 9_223_372_036_854_775_807n;
const allowedLockReasons = new Set<WorkstationLockReason>([
  "INITIAL", "IDLE_TIMEOUT", "OPERATOR_SWITCH", "OPERATOR_SIGNOUT",
  "AUTHORIZATION_REVOKED", "DEVICE_REVOKED", "SESSION_EXPIRED",
  "NETWORK_UNAVAILABLE", "PAGE_HIDDEN", "SYNC_UNAVAILABLE", "CONTEXT_INVALID",
]);

function exactObject(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Object.getOwnPropertySymbols(value).length !== 0) return false;
    const actual = Object.keys(descriptors).sort();
    const expected = [...keys].sort();
    return actual.length === expected.length &&
      actual.every((key, index) => key === expected[index]) &&
      Object.values(descriptors).every((descriptor) => "value" in descriptor && descriptor.enumerable);
  } catch {
    return false;
  }
}

function canonicalBigInt(value: unknown): value is string {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,18}$/.test(value)) return false;
  try {
    return BigInt(value) <= SQL_BIGINT_MAX;
  } catch {
    return false;
  }
}

const safePositive = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
const safeNonnegative = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const validUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

function validObservation(value: unknown): value is ServerOperatorObservation {
  if (!exactObject(value, [
    "format", "workstationId", "deviceSessionId", "operatorUserId", "generation",
    "incarnation", "expiresAtMs",
  ])) return false;
  return value.format === "WORKSTATION_OPERATOR_BROWSER_OBSERVATION_V1" &&
    canonicalBigInt(value.workstationId) && validUuid(value.deviceSessionId) &&
    safePositive(value.operatorUserId) && safeNonnegative(value.generation) &&
    validUuid(value.incarnation) && safeNonnegative(value.expiresAtMs);
}

function validSyncEvent(value: unknown): value is RestrictiveSyncEvent {
  if (!exactObject(value, ["format", "eventId", "workstationId", "action", "reason"])) return false;
  return value.format === "WORKSTATION_RESTRICTIVE_SYNC_V1" && validUuid(value.eventId) &&
    canonicalBigInt(value.workstationId) && (value.action === "LOCK" || value.action === "DEVICE_REVOKED") &&
    typeof value.reason === "string" && allowedLockReasons.has(value.reason as WorkstationLockReason) &&
    (value.action !== "DEVICE_REVOKED" || value.reason === "DEVICE_REVOKED");
}

const lockedState = (workstationId: string, reason: WorkstationLockReason): WorkstationBrowserState => Object.freeze({
  status: reason === "DEVICE_REVOKED" ? "DEVICE_REVOKED" as const : "LOCKED" as const,
  reason,
  workstationId,
  deviceSessionId: null,
  operatorUserId: null,
  generation: null,
  incarnation: null,
  expiresAtMs: null,
  runtimeAuthority: "NONE" as const,
  productionReady: false as const,
});

export function createUnavailableRestrictiveSyncTransport(): RestrictiveSyncTransport {
  return Object.freeze({
    available: false,
    post() {},
    subscribe() { return () => {}; },
    close() {},
  });
}

export function createBrowserRestrictiveSyncTransport(
  channelName = "uqp.shared-workstation.restrictive.v1",
): RestrictiveSyncTransport {
  if (typeof BroadcastChannel !== "function") return createUnavailableRestrictiveSyncTransport();
  try {
    const channel = new BroadcastChannel(channelName);
    return Object.freeze({
      available: true,
      post(event: RestrictiveSyncEvent) { channel.postMessage(event); },
      subscribe(listener: (event: unknown) => void) {
        const receive = (event: MessageEvent<unknown>) => listener(event.data);
        channel.addEventListener("message", receive);
        return () => channel.removeEventListener("message", receive);
      },
      close() { channel.close(); },
    });
  } catch {
    return createUnavailableRestrictiveSyncTransport();
  }
}

export function createSharedWorkstationSafetyController(config: Readonly<{
  workstationId: string;
  idleTimeoutMs: number;
  transport: RestrictiveSyncTransport;
  now?: () => number;
  newEventId?: () => string;
}>): SharedWorkstationSafetyController {
  if (!canonicalBigInt(config.workstationId)) throw new Error("WORKSTATION_CONTEXT_INVALID");
  if (!Number.isSafeInteger(config.idleTimeoutMs) || config.idleTimeoutMs < 30_000 || config.idleTimeoutMs > 8 * 60 * 60_000) {
    throw new Error("WORKSTATION_IDLE_POLICY_INVALID");
  }
  const clock = config.now ?? (() => Date.now());
  const newEventId = config.newEventId ?? (() => crypto.randomUUID());
  let state = lockedState(config.workstationId, config.transport.available ? "INITIAL" : "SYNC_UNAVAILABLE");
  let lastActivityMs: number | null = null;
  let lastAcceptedFence: BrowserOperatorFence | null = null;
  let disposed = false;
  const subscribers = new Set<() => void>();
  const purgeTargets = new Map<SensitiveDataKind, Set<() => void>>();
  const requests = new Map<SensitiveRequestHandle, AbortController>();

  const publish = () => subscribers.forEach((listener) => {
    try { listener(); } catch { /* a UI subscriber cannot prevent safety state changes */ }
  });
  const abortAndPurge = () => {
    for (const controller of requests.values()) controller.abort();
    requests.clear();
    for (const callbacks of purgeTargets.values()) {
      for (const callback of callbacks) {
        try { callback(); } catch { /* continue purging independent sensitive stores */ }
      }
    }
  };
  const transitionToLock = (reason: WorkstationLockReason, broadcast: boolean) => {
    abortAndPurge();
    lastActivityMs = null;
    const terminal = state.status === "DEVICE_REVOKED" || reason === "DEVICE_REVOKED";
    state = lockedState(config.workstationId, terminal ? "DEVICE_REVOKED" : reason);
    publish();
    if (!broadcast || !config.transport.available) return;
    let eventId: string;
    try { eventId = newEventId(); } catch { return; }
    if (!validUuid(eventId)) return;
    config.transport.post(Object.freeze({
      format: "WORKSTATION_RESTRICTIVE_SYNC_V1" as const,
      eventId,
      workstationId: config.workstationId,
      action: terminal ? "DEVICE_REVOKED" as const : "LOCK" as const,
      reason: terminal ? "DEVICE_REVOKED" as const : reason,
    }));
  };

  const unsubscribeTransport = config.transport.subscribe((candidate) => {
    if (!validSyncEvent(candidate) || candidate.workstationId !== config.workstationId) return;
    transitionToLock(candidate.reason, false);
  });

  const controller: SharedWorkstationSafetyController = {
    getState: () => state,
    subscribe(listener) {
      subscribers.add(listener);
      return () => subscribers.delete(listener);
    },
    registerPurgeTarget(kind, purge) {
      if (typeof purge !== "function") throw new Error("PURGE_TARGET_INVALID");
      const callbacks = purgeTargets.get(kind) ?? new Set<() => void>();
      callbacks.add(purge);
      purgeTargets.set(kind, callbacks);
      return () => callbacks.delete(purge);
    },
    applyServerObservation(observation, nowMs = clock()) {
      if (disposed || state.status === "DEVICE_REVOKED") return false;
      if (!config.transport.available) {
        transitionToLock("SYNC_UNAVAILABLE", false);
        return false;
      }
      if (!validObservation(observation) || observation.workstationId !== config.workstationId ||
        !safeNonnegative(nowMs) || observation.expiresAtMs <= nowMs) {
        transitionToLock(
          validObservation(observation) && observation.expiresAtMs <= nowMs ? "SESSION_EXPIRED" : "CONTEXT_INVALID",
          true,
        );
        return false;
      }
      if (lastAcceptedFence !== null && observation.generation <= lastAcceptedFence.generation) {
        const identicalCurrent = state.status === "OPERATOR_ACTIVE" &&
          observation.generation === lastAcceptedFence.generation &&
          observation.deviceSessionId === lastAcceptedFence.deviceSessionId &&
          observation.operatorUserId === lastAcceptedFence.operatorUserId &&
          observation.incarnation === lastAcceptedFence.incarnation &&
          observation.expiresAtMs === state.expiresAtMs;
        if (identicalCurrent) return true;
        if (observation.generation === lastAcceptedFence.generation) {
          transitionToLock("CONTEXT_INVALID", true);
        }
        return false;
      }
      if (lastAcceptedFence !== null && observation.incarnation === lastAcceptedFence.incarnation) {
        transitionToLock("CONTEXT_INVALID", true);
        return false;
      }
      abortAndPurge();
      lastAcceptedFence = Object.freeze({
        format: "WORKSTATION_BROWSER_REQUEST_FENCE_V1" as const,
        workstationId: observation.workstationId,
        deviceSessionId: observation.deviceSessionId,
        operatorUserId: observation.operatorUserId,
        generation: observation.generation,
        incarnation: observation.incarnation,
      });
      state = Object.freeze({
        status: "OPERATOR_ACTIVE" as const,
        reason: null,
        workstationId: observation.workstationId,
        deviceSessionId: observation.deviceSessionId,
        operatorUserId: observation.operatorUserId,
        generation: observation.generation,
        incarnation: observation.incarnation,
        expiresAtMs: observation.expiresAtMs,
        runtimeAuthority: "NONE" as const,
        productionReady: false as const,
      });
      lastActivityMs = nowMs;
      publish();
      return true;
    },
    lock(reason) { if (!disposed) transitionToLock(reason, true); },
    revokeDevice() { if (!disposed) transitionToLock("DEVICE_REVOKED", true); },
    noteActivity(nowMs = clock()) {
      if (disposed || state.status !== "OPERATOR_ACTIVE" || !safeNonnegative(nowMs)) return;
      if (state.expiresAtMs === null || nowMs >= state.expiresAtMs) {
        transitionToLock("SESSION_EXPIRED", true);
        return;
      }
      if (lastActivityMs === null || nowMs >= lastActivityMs) lastActivityMs = nowMs;
    },
    tick(nowMs = clock()) {
      if (disposed || state.status !== "OPERATOR_ACTIVE" || !safeNonnegative(nowMs)) return;
      if (state.expiresAtMs === null || nowMs >= state.expiresAtMs) {
        transitionToLock("SESSION_EXPIRED", true);
      } else if (lastActivityMs === null || nowMs - lastActivityMs >= config.idleTimeoutMs) {
        transitionToLock("IDLE_TIMEOUT", true);
      }
    },
    networkUnavailable() { if (!disposed) transitionToLock("NETWORK_UNAVAILABLE", true); },
    networkRestored() {
      // Reconnection is deliberately non-authorizing; a new server observation is required.
      if (!disposed && state.status !== "DEVICE_REVOKED" && state.status !== "LOCKED") {
        transitionToLock("NETWORK_UNAVAILABLE", true);
      }
    },
    beginSensitiveRequest(kind) {
      if (disposed || state.status !== "OPERATOR_ACTIVE" || state.deviceSessionId === null ||
        state.operatorUserId === null || state.generation === null || state.incarnation === null) return null;
      const requestController = new AbortController();
      const handle = Object.freeze({
        kind,
        signal: requestController.signal,
        fence: Object.freeze({
          format: "WORKSTATION_BROWSER_REQUEST_FENCE_V1" as const,
          workstationId: state.workstationId,
          deviceSessionId: state.deviceSessionId,
          operatorUserId: state.operatorUserId,
          generation: state.generation,
          incarnation: state.incarnation,
        }),
      });
      requests.set(handle, requestController);
      return handle;
    },
    mayDeliverResponse(handle) {
      const requestController = requests.get(handle);
      if (!requestController || requestController.signal.aborted || state.status !== "OPERATOR_ACTIVE") return false;
      return handle.fence.workstationId === state.workstationId &&
        handle.fence.deviceSessionId === state.deviceSessionId &&
        handle.fence.operatorUserId === state.operatorUserId &&
        handle.fence.generation === state.generation &&
        handle.fence.incarnation === state.incarnation;
    },
    finishRequest(handle) { requests.delete(handle); },
    async runSensitiveRequest<T>(kind: SensitiveRequestKind, execute: (signal: AbortSignal) => Promise<T>) {
      const handle = controller.beginSensitiveRequest(kind);
      if (handle === null) return Object.freeze({ status: "SUPPRESSED" as const });
      try {
        const value = await execute(handle.signal);
        return controller.mayDeliverResponse(handle)
          ? Object.freeze({ status: "DELIVERABLE" as const, value })
          : Object.freeze({ status: "SUPPRESSED" as const });
      } catch (error) {
        return controller.mayDeliverResponse(handle)
          ? Object.freeze({ status: "CURRENT_ERROR" as const, error })
          : Object.freeze({ status: "SUPPRESSED" as const });
      } finally {
        controller.finishRequest(handle);
      }
    },
    dispose() {
      if (disposed) return;
      transitionToLock("PAGE_HIDDEN", true);
      disposed = true;
      unsubscribeTransport();
      config.transport.close();
      subscribers.clear();
      purgeTargets.clear();
    },
  };
  return Object.freeze(controller);
}

export function attachBrowserWorkstationSafetyEvents(
  controller: SharedWorkstationSafetyController,
  targetWindow: Window = window,
  targetDocument: Document = document,
  tickIntervalMs = 1_000,
): () => void {
  const activity = () => controller.noteActivity(Date.now());
  const offline = () => controller.networkUnavailable();
  const online = () => controller.networkRestored();
  const pageHide = () => controller.lock("PAGE_HIDDEN");
  const visibility = () => { if (targetDocument.visibilityState === "hidden") pageHide(); };
  for (const name of ["pointerdown", "keydown", "input", "touchstart"] as const) {
    targetWindow.addEventListener(name, activity, { passive: true });
  }
  targetWindow.addEventListener("offline", offline);
  targetWindow.addEventListener("online", online);
  targetWindow.addEventListener("pagehide", pageHide);
  targetDocument.addEventListener("visibilitychange", visibility);
  const timer = targetWindow.setInterval(() => controller.tick(Date.now()), tickIntervalMs);
  return () => {
    for (const name of ["pointerdown", "keydown", "input", "touchstart"] as const) {
      targetWindow.removeEventListener(name, activity);
    }
    targetWindow.removeEventListener("offline", offline);
    targetWindow.removeEventListener("online", online);
    targetWindow.removeEventListener("pagehide", pageHide);
    targetDocument.removeEventListener("visibilitychange", visibility);
    targetWindow.clearInterval(timer);
  };
}
