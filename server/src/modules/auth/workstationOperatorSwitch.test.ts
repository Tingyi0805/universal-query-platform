import assert from "node:assert/strict";
import test from "node:test";
import {
  captureSwitchedOperatorRequest,
  createWorkstationOperatorSwitchService,
  mayDeliverSwitchedOperatorData,
  type OperatorAuthorizationCandidate,
  type OperatorPinFailureMutation,
  type OperatorSwitchAudit,
  type OperatorSwitchLookup,
  type OperatorSwitchMutation,
  type OperatorSwitchRequest,
  type OperatorSwitchSnapshot,
} from "./workstationOperatorSwitch.js";
import {
  OperatorSwitchInfrastructureError,
  type OperatorSwitchInfrastructureCode,
  type OperatorSwitchTransaction,
  type WorkstationOperatorSwitchAuditWriter,
  type WorkstationOperatorSwitchRepository,
  type WorkstationPinVerifier,
} from "./workstationOperatorSwitch.ports.js";
import {
  captureOperatorRequest,
  initialWorkstationSession,
  transitionWorkstationSession,
  type WorkstationSession,
} from "./workstationSessionContract.js";
import type { DeviceSessionRenewalSnapshot } from "./workstationSessionLifecycle.js";

const workstationId = "9007199254740993";
const deviceSessionId = "00000000-0000-4000-8000-000000000401";
const credentialId = "00000000-0000-4000-8000-000000000402";
const operatorIncarnation = "00000000-0000-4000-8000-000000000403";
const nextIncarnations = [
  "00000000-0000-4000-8000-000000000501",
  "00000000-0000-4000-8000-000000000502",
];
const policyRevision = "21";
const deviceRevision = "0000000000000041";
const operatorRevision = "0000000000000011";
const correctPin = "804297";

const revisionAfter = (revision: string) =>
  (BigInt(`0x${revision}`) + 1n).toString(16).padStart(16, "0");

const deviceSession = (): DeviceSessionRenewalSnapshot => ({
  format: "WORKSTATION_DEVICE_SESSION_SNAPSHOT_V1",
  sessionId: deviceSessionId,
  workstationId,
  credentialId,
  sessionState: "ACTIVE",
  sessionRevision: deviceRevision,
  renewalCounter: "4",
  boundCredentialVersion: 7,
  issuedAtMs: 1_000,
  lastActivityAtMs: 10_000,
  idleExpiresAtMs: 70_000,
  absoluteExpiresAtMs: 3_601_000,
  workstationActive: true,
  workstationRetired: false,
  workstationCredentialVersion: 7,
  credentialRevoked: false,
  credentialVersion: 7,
});

const operatorA = () => {
  const ready = transitionWorkstationSession(initialWorkstationSession, { type: "DEVICE_VERIFIED" });
  return transitionWorkstationSession(ready, { type: "OPERATOR_VERIFIED", userId: 12 });
};
const lockedAfterA = () => transitionWorkstationSession(operatorA(), { type: "OPERATOR_LOCKED" });

type SyntheticUser = {
  active: boolean;
  tokenVersion: number;
  permissions: string[];
  allowed: boolean;
  pin: string;
  pinEnabled: boolean;
  pinVersion: number;
  boundTokenVersion: number;
  boundPolicyRevision: string;
  pinRevision: string;
  failedAttempts: number;
  attemptWindowStartedAtMs: number | null;
  lockedUntilMs: number | null;
};

type SyntheticState = {
  device: DeviceSessionRenewalSnapshot;
  workstationPinEnabled: boolean;
  operator: {
    revision: string;
    incarnation: string;
    session: WorkstationSession;
    previousOperatorUserId: number | null;
  };
  users: Map<number, SyntheticUser>;
  policyLength: number;
  policyRevision: string;
  requests: Map<string, string>;
  audits: OperatorSwitchAudit[];
};

const cloneState = (state: SyntheticState): SyntheticState => ({
  device: { ...state.device },
  workstationPinEnabled: state.workstationPinEnabled,
  operator: { ...state.operator },
  users: new Map([...state.users].map(([id, user]) => [id, { ...user, permissions: [...user.permissions] }])),
  policyLength: state.policyLength,
  policyRevision: state.policyRevision,
  requests: new Map(state.requests),
  audits: [...state.audits],
});

const initialState = (): SyntheticState => ({
  device: deviceSession(),
  workstationPinEnabled: true,
  operator: {
    revision: operatorRevision,
    incarnation: operatorIncarnation,
    session: lockedAfterA(),
    previousOperatorUserId: 12,
  },
  users: new Map([
    [13, {
      active: true, tokenVersion: 5, permissions: ["EXECUTE_QUERY", "VIEW_QUERY"], allowed: true,
      pin: correctPin, pinEnabled: true, pinVersion: 2, boundTokenVersion: 5,
      boundPolicyRevision: policyRevision, pinRevision: "0000000000000031",
      failedAttempts: 0, attemptWindowStartedAtMs: null, lockedUntilMs: null,
    }],
    [14, {
      active: true, tokenVersion: 8, permissions: ["VIEW_QUERY"], allowed: true,
      pin: "935804", pinEnabled: true, pinVersion: 3, boundTokenVersion: 8,
      boundPolicyRevision: policyRevision, pinRevision: "0000000000000032",
      failedAttempts: 0, attemptWindowStartedAtMs: null, lockedUntilMs: null,
    }],
  ]),
  policyLength: 6,
  policyRevision,
  requests: new Map(),
  audits: [],
});

class SyntheticOperatorStore implements
  WorkstationOperatorSwitchRepository,
  WorkstationOperatorSwitchAuditWriter,
  WorkstationPinVerifier {
  state = initialState();
  infrastructureFailure: OperatorSwitchInfrastructureCode | null = null;
  auditFailure = false;
  invalidAuditReceipt = false;
  pinCasConflict = false;
  switchCasConflict = false;
  missingSnapshot = false;
  private queue: Promise<void> = Promise.resolve();
  private transactions = new WeakMap<object, SyntheticState>();

  async transaction<T>(work: (tx: OperatorSwitchTransaction) => Promise<T>): Promise<T> {
    const predecessor = this.queue;
    let release!: () => void;
    this.queue = new Promise(resolve => { release = resolve; });
    await predecessor;
    try {
      if (this.infrastructureFailure === "DATABASE_UNAVAILABLE") {
        throw new OperatorSwitchInfrastructureError("DATABASE_UNAVAILABLE");
      }
      const handle = Object.freeze({ synthetic: true }) as unknown as OperatorSwitchTransaction;
      const staged = cloneState(this.state);
      this.transactions.set(handle as object, staged);
      try {
        const result = await work(handle);
        this.state = staged;
        if (this.infrastructureFailure === "COMMIT_UNKNOWN") {
          throw new OperatorSwitchInfrastructureError("COMMIT_UNKNOWN");
        }
        return result;
      } catch (error) {
        if (this.infrastructureFailure === "ROLLBACK_FAILED") {
          throw new OperatorSwitchInfrastructureError("ROLLBACK_FAILED");
        }
        throw error;
      }
    } finally {
      release();
    }
  }

  async readForSwitch(lookup: OperatorSwitchLookup, tx: OperatorSwitchTransaction): Promise<OperatorSwitchSnapshot | null> {
    if (this.missingSnapshot) return null;
    const state = this.transactions.get(tx as object)!;
    const user = state.users.get(lookup.targetUserId);
    if (!user) return null;
    return Object.freeze({
      format: "WORKSTATION_OPERATOR_SWITCH_SNAPSHOT_V1" as const,
      deviceSession: Object.freeze({ ...state.device }),
      workstationPinEnabled: state.workstationPinEnabled,
      workstationAllowsUser: user.allowed,
      operator: Object.freeze({ ...state.operator }),
      targetUser: Object.freeze({
        id: lookup.targetUserId,
        active: user.active,
        tokenVersion: user.tokenVersion,
        permissions: Object.freeze([...user.permissions]),
      }),
      pin: Object.freeze({
        enabled: user.pinEnabled,
        version: user.pinVersion,
        boundTokenVersion: user.boundTokenVersion,
        boundPolicyRevision: user.boundPolicyRevision,
        revision: user.pinRevision,
        failedAttempts: user.failedAttempts,
        attemptWindowStartedAtMs: user.attemptWindowStartedAtMs,
        lockedUntilMs: user.lockedUntilMs,
      }),
      pinPolicy: Object.freeze({ length: state.policyLength, revision: state.policyRevision }),
    });
  }

  async claimRequest(requestId: string, digest: string, tx: OperatorSwitchTransaction) {
    const requests = this.transactions.get(tx as object)!.requests;
    const existing = requests.get(requestId);
    if (existing === digest) return "REPLAY" as const;
    if (existing !== undefined) return "CONFLICT" as const;
    requests.set(requestId, digest);
    return "CLAIMED" as const;
  }

  async recordPinFailure(mutation: OperatorPinFailureMutation, tx: OperatorSwitchTransaction) {
    const user = this.transactions.get(tx as object)!.users.get(mutation.targetUserId);
    if (this.pinCasConflict || !user || user.pinRevision !== mutation.expectedPinRevision) {
      return { affectedRows: 0 as const };
    }
    user.failedAttempts = mutation.failedAttempts;
    user.attemptWindowStartedAtMs = mutation.attemptWindowStartedAtMs;
    user.lockedUntilMs = mutation.lockedUntilMs;
    user.pinRevision = revisionAfter(user.pinRevision);
    return { affectedRows: 1 as const, newPinRevision: user.pinRevision };
  }

  async compareAndSwapSwitch(mutation: OperatorSwitchMutation, tx: OperatorSwitchTransaction) {
    const state = this.transactions.get(tx as object)!;
    const user = state.users.get(mutation.targetUserId);
    if (
      this.switchCasConflict || !user || state.operator.revision !== mutation.expectedOperatorRevision ||
      state.operator.incarnation !== mutation.expectedOperatorIncarnation ||
      state.operator.session.generation !== mutation.expectedGeneration ||
      user.pinRevision !== mutation.expectedPinRevision
    ) return { affectedRows: 0 as const };
    const revision = revisionAfter(state.operator.revision);
    state.operator = {
      revision,
      incarnation: mutation.nextIncarnation,
      session: mutation.nextSession,
      previousOperatorUserId: mutation.targetUserId,
    };
    user.failedAttempts = 0;
    user.attemptWindowStartedAtMs = null;
    user.lockedUntilMs = null;
    user.pinRevision = revisionAfter(user.pinRevision);
    return { affectedRows: 1 as const, newOperatorRevision: revision };
  }

  async verify(targetUserId: number, pin: string, tx: OperatorSwitchTransaction) {
    return this.transactions.get(tx as object)!.users.get(targetUserId)?.pin === pin;
  }

  async write(event: OperatorSwitchAudit, tx: OperatorSwitchTransaction) {
    if (this.auditFailure) throw new OperatorSwitchInfrastructureError("AUDIT_FAILURE");
    this.transactions.get(tx as object)!.audits.push(Object.freeze({ ...event }));
    return { auditLogId: this.invalidAuditReceipt ? "9007199254740993.0" : "9007199254740993" };
  }
}

let requestSequence = 600;
const makeRequest = (
  targetUserId = 13,
  pin = targetUserId === 13 ? correctPin : "935804",
  overrides: Partial<OperatorSwitchRequest> = {},
): OperatorSwitchRequest => ({
  format: "WORKSTATION_OPERATOR_SWITCH_V1",
  requestId: `00000000-0000-4000-8000-${String(++requestSequence).padStart(12, "0")}`,
  deviceSessionId,
  workstationId,
  targetUserId,
  pin,
  expectedDeviceRevision: deviceRevision,
  expectedOperatorRevision: operatorRevision,
  expectedOperatorIncarnation: operatorIncarnation,
  expectedGeneration: lockedAfterA().generation,
  ...overrides,
});

const service = (store: SyntheticOperatorStore, nowMs = 20_000) => {
  let incarnation = 0;
  return createWorkstationOperatorSwitchService({
    repository: store,
    pinVerifier: store,
    audit: store,
    policy: {
      deviceSession: { idleWindowMs: 60_000, absoluteLifetimeMs: 3_600_000 },
      maxFailedAttempts: 3,
      attemptWindowMs: 300_000,
      lockoutMs: 900_000,
    },
    now: () => nowMs,
    newIncarnation: () => nextIncarnations[incarnation++]!,
  });
};

test("correct PIN creates only an isolated B authorization candidate with current permissions", async () => {
  const store = new SyntheticOperatorStore();
  const result = await service(store).switchOperator(makeRequest());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.authorization.session.state, "OPERATOR_ACTIVE");
  assert.equal(result.authorization.session.operatorUserId, 13);
  assert.equal(result.authorization.session.generation, lockedAfterA().generation + 1);
  assert.deepEqual(result.authorization.permissions, ["EXECUTE_QUERY", "VIEW_QUERY"]);
  assert.equal(result.authorization.tokenVersion, 5);
  assert.equal(result.purgeRequired, true);
  assert.equal(result.jwtIssued, false);
  assert.equal(result.queryExecutionAllowed, false);
  assert.equal(result.patientDataAllowed, false);
  assert.equal(result.runtimeAuthority, "NONE");
  assert.equal(result.auditLogId, "9007199254740993");
  assert.equal(store.state.audits[0]?.eventType, "WORKSTATION_OPERATOR_SWITCHED");
});

test("wrong PIN increments persistent attempts and never records the PIN", async () => {
  const store = new SyntheticOperatorStore();
  const wrong = "729405";
  const result = await service(store).switchOperator(makeRequest(13, wrong));
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "INVALID_PIN");
    assert.equal(result.mustRemainLocked, true);
  }
  assert.equal(store.state.users.get(13)?.failedAttempts, 1);
  assert.equal(store.state.operator.session.state, "OPERATOR_LOCKED");
  assert.equal(JSON.stringify(store.state.audits).includes(wrong), false);
  assert.equal(JSON.stringify(result).includes(wrong), false);
});

test("revoked PIN, changed policy, disabled user, and TokenVersion mismatch fail before comparison", async () => {
  const cases: [(store: SyntheticOperatorStore) => void, string][] = [
    [store => { store.state.users.get(13)!.pinEnabled = false; }, "PIN_REVOKED"],
    [store => { store.state.policyRevision = "22"; }, "PIN_POLICY_CHANGED"],
    [store => { store.state.policyLength = 8; }, "PIN_POLICY_CHANGED"],
    [store => { store.state.users.get(13)!.active = false; }, "USER_DISABLED"],
    [store => { store.state.users.get(13)!.tokenVersion = 6; }, "TOKEN_VERSION_MISMATCH"],
  ];
  for (const [configure, reason] of cases) {
    const store = new SyntheticOperatorStore();
    configure(store);
    const result = await service(store).switchOperator(makeRequest());
    assert.equal(result.ok, false, reason);
    if (!result.ok) assert.equal(result.reason, reason);
    assert.equal(store.state.operator.session.state, "OPERATOR_LOCKED");
  }
});

test("revoked or expired device session and disabled workstation block PIN switching", async () => {
  const cases: [Partial<DeviceSessionRenewalSnapshot>, string, number][] = [
    [{ sessionState: "REVOKED" }, "DEVICE_SESSION_REVOKED", 20_000],
    [{ idleExpiresAtMs: 20_000 }, "DEVICE_SESSION_EXPIRED", 20_000],
    [{ credentialRevoked: true }, "DEVICE_CREDENTIAL_INVALID", 20_000],
    [{ workstationActive: false }, "WORKSTATION_INVALID", 20_000],
  ];
  for (const [change, reason, nowMs] of cases) {
    const store = new SyntheticOperatorStore();
    store.state.device = { ...store.state.device, ...change };
    const result = await service(store, nowMs).switchOperator(makeRequest());
    assert.equal(result.ok, false, reason);
    if (!result.ok) assert.equal(result.reason, reason);
  }
});

test("A to B switch changes generation/incarnation and rejects every A response", async () => {
  const activeA = operatorA();
  const authorizationA: OperatorAuthorizationCandidate = {
    incarnation: operatorIncarnation,
    revision: "0000000000000010",
    deviceSessionId,
    workstationId,
    tokenVersion: 4,
    pinVersion: 1,
    permissions: ["VIEW_QUERY"],
    session: activeA,
  };
  const fenceA = captureSwitchedOperatorRequest(authorizationA)!;
  assert.equal(mayDeliverSwitchedOperatorData(authorizationA, fenceA), true);

  const result = await service(new SyntheticOperatorStore()).switchOperator(makeRequest());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.notEqual(result.authorization.incarnation, authorizationA.incarnation);
  assert.equal(mayDeliverSwitchedOperatorData(result.authorization, fenceA), false);
  const fenceB = captureSwitchedOperatorRequest(result.authorization)!;
  assert.equal(mayDeliverSwitchedOperatorData(result.authorization, fenceB), true);
  assert.equal(captureOperatorRequest(lockedAfterA()), null);
});

test("simultaneous B and C switches across nodes allow only one operator", async () => {
  const store = new SyntheticOperatorStore();
  const nodeOne = service(store);
  const nodeTwo = service(store);
  const [b, c] = await Promise.all([
    nodeOne.switchOperator(makeRequest(13, correctPin)),
    nodeTwo.switchOperator(makeRequest(14, "935804")),
  ]);
  assert.equal([b, c].filter(result => result.ok).length, 1);
  const denial = [b, c].find(result => !result.ok);
  assert.equal(denial?.ok, false);
  if (denial && !denial.ok) assert.equal(denial.reason, "OPERATOR_NOT_LOCKED");
  assert.ok([13, 14].includes(store.state.operator.session.operatorUserId ?? 0));
});

test("persistent brute-force window locks the user on the threshold", async () => {
  const store = new SyntheticOperatorStore();
  const lifecycle = service(store);
  const reasons: string[] = [];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = await lifecycle.switchOperator(makeRequest(13, "729405"));
    if (!result.ok) reasons.push(result.reason);
  }
  assert.deepEqual(reasons, ["INVALID_PIN", "INVALID_PIN", "PIN_LOCKED"]);
  assert.equal(store.state.users.get(13)?.failedAttempts, 3);
  assert.ok((store.state.users.get(13)?.lockedUntilMs ?? 0) > 20_000);
  const correctButLocked = await lifecycle.switchOperator(makeRequest());
  assert.equal(correctButLocked.ok, false);
  if (!correctButLocked.ok) assert.equal(correctButLocked.reason, "PIN_LOCKED");
});

test("unique RequestId rejects replay and conflicting reuse without rechecking PIN", async () => {
  const store = new SyntheticOperatorStore();
  const lifecycle = service(store);
  const first = makeRequest(13, "729405");
  assert.equal((await lifecycle.switchOperator(first)).ok, false);
  const before = store.state.users.get(13)?.failedAttempts;
  const replay = await lifecycle.switchOperator(first);
  assert.equal(replay.ok, false);
  if (!replay.ok) assert.equal(replay.reason, "REQUEST_REPLAY");
  assert.equal(store.state.users.get(13)?.failedAttempts, before);

  const conflict = await lifecycle.switchOperator({ ...first, targetUserId: 14, pin: "935804" });
  assert.equal(conflict.ok, false);
  if (!conflict.ok) assert.equal(conflict.reason, "REQUEST_ID_CONFLICT");
});

test("PIN and switch CAS conflicts fail closed without activating an operator", async () => {
  const pinStore = new SyntheticOperatorStore();
  pinStore.pinCasConflict = true;
  const pinResult = await service(pinStore).switchOperator(makeRequest(13, "729405"));
  assert.equal(pinResult.ok, false);
  if (!pinResult.ok) assert.equal(pinResult.reason, "PIN_STATE_CONFLICT");
  assert.equal(pinStore.state.operator.session.state, "OPERATOR_LOCKED");

  const switchStore = new SyntheticOperatorStore();
  switchStore.switchCasConflict = true;
  const switchResult = await service(switchStore).switchOperator(makeRequest());
  assert.equal(switchResult.ok, false);
  if (!switchResult.ok) assert.equal(switchResult.reason, "SWITCH_CAS_CONFLICT");
  assert.equal(switchStore.state.operator.session.state, "OPERATOR_LOCKED");
});

test("audit failure and invalid exact receipt roll back PIN or switch mutation", async () => {
  for (const invalidReceipt of [false, true]) {
    const store = new SyntheticOperatorStore();
    store.auditFailure = !invalidReceipt;
    store.invalidAuditReceipt = invalidReceipt;
    const result = await service(store).switchOperator(makeRequest());
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "AUDIT_FAILURE");
    assert.equal(store.state.operator.session.state, "OPERATOR_LOCKED");
    assert.equal(store.state.requests.size, 0);
    assert.equal(store.state.audits.length, 0);
  }

  const failedPinStore = new SyntheticOperatorStore();
  failedPinStore.auditFailure = true;
  const failedPin = await service(failedPinStore).switchOperator(makeRequest(13, "729405"));
  assert.equal(failedPin.ok, false);
  if (!failedPin.ok) assert.equal(failedPin.reason, "AUDIT_FAILURE");
  assert.equal(failedPinStore.state.users.get(13)?.failedAttempts, 0);
  assert.equal(failedPinStore.state.requests.size, 0);
});

test("database failure, rollback failure, and commit unknown never report success", async () => {
  for (const failure of ["DATABASE_UNAVAILABLE", "ROLLBACK_FAILED", "COMMIT_UNKNOWN"] as const) {
    const store = new SyntheticOperatorStore();
    store.infrastructureFailure = failure;
    if (failure === "ROLLBACK_FAILED") store.auditFailure = true;
    const result = await service(store).switchOperator(makeRequest());
    assert.equal(result.ok, false, failure);
    if (!result.ok) assert.equal(result.reason, failure);
  }
});

test("an active operator must be locked and purged before any switch attempt", async () => {
  const store = new SyntheticOperatorStore();
  store.state.operator.session = operatorA();
  const result = await service(store).switchOperator(makeRequest());
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "OPERATOR_NOT_LOCKED");
  assert.equal(store.state.operator.session.operatorUserId, 12);
});

test("missing snapshot is audited; malformed input and hooks are rejected before storage", async () => {
  const missing = new SyntheticOperatorStore();
  missing.missingSnapshot = true;
  const missingResult = await service(missing).switchOperator(makeRequest());
  assert.equal(missingResult.ok, false);
  if (!missingResult.ok) assert.equal(missingResult.reason, "SNAPSHOT_NOT_FOUND");
  assert.equal(missing.state.audits[0]?.reason, "SNAPSHOT_NOT_FOUND");

  const store = new SyntheticOperatorStore();
  let invoked = false;
  const unsafe = { ...makeRequest(), get unexpected() { invoked = true; return correctPin; } };
  assert.equal((await service(store).switchOperator(unsafe)).ok, false);
  assert.equal(invoked, false);
  const proxy = new Proxy(makeRequest(), { get() { invoked = true; return undefined; } });
  assert.equal((await service(store).switchOperator(proxy)).ok, false);
  assert.equal(invoked, false);
  assert.equal(store.state.audits.length, 0);
});
