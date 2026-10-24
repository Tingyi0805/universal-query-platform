import assert from "node:assert/strict";
import test from "node:test";
import {
  createWorkstationSessionLifecycle,
  deviceSessionCanAuthorizeOperatorQuery,
  evaluateDeviceSessionRenewal,
  type DeviceSessionRenewalAudit,
  type DeviceSessionRenewalMutation,
  type DeviceSessionRenewalRequest,
  type DeviceSessionRenewalSnapshot,
} from "./workstationSessionLifecycle.js";
import {
  WorkstationLifecycleInfrastructureError,
  type WorkstationDeviceSessionRepository,
  type WorkstationLifecycleFailureCode,
  type WorkstationLifecycleTransaction,
  type WorkstationSessionAuditWriter,
} from "./workstationSessionLifecycle.ports.js";
import {
  transitionWorkstationSession,
  initialWorkstationSession,
} from "./workstationSessionContract.js";

const sessionId = "00000000-0000-4000-8000-000000000101";
const credentialId = "00000000-0000-4000-8000-000000000201";
const proof = "A".repeat(43);
const policy = { idleWindowMs: 60_000, absoluteLifetimeMs: 3_600_000 } as const;

const baseSnapshot = (): DeviceSessionRenewalSnapshot => ({
  format: "WORKSTATION_DEVICE_SESSION_SNAPSHOT_V1",
  sessionId,
  workstationId: "9007199254740993",
  credentialId,
  sessionState: "ACTIVE",
  sessionRevision: "0000000000000001",
  renewalCounter: "0",
  boundCredentialVersion: 4,
  issuedAtMs: 1_000,
  lastActivityAtMs: 10_000,
  idleExpiresAtMs: 70_000,
  absoluteExpiresAtMs: 3_601_000,
  workstationActive: true,
  workstationRetired: false,
  workstationCredentialVersion: 4,
  credentialRevoked: false,
  credentialVersion: 4,
});

const request = (
  overrides: Partial<DeviceSessionRenewalRequest> = {},
): DeviceSessionRenewalRequest => ({
  format: "WORKSTATION_DEVICE_SESSION_RENEWAL_V1",
  sessionId,
  workstationId: "9007199254740993",
  credentialId,
  credentialProof: proof,
  expectedRevision: "0000000000000001",
  renewalCounter: "0",
  ...overrides,
});

type SyntheticTx = {
  snapshot: DeviceSessionRenewalSnapshot | null;
  audits: DeviceSessionRenewalAudit[];
};

const nextRevision = (revision: string) =>
  (BigInt(`0x${revision}`) + 1n).toString(16).padStart(16, "0");

class SyntheticLifecycleStore implements WorkstationDeviceSessionRepository, WorkstationSessionAuditWriter {
  snapshot: DeviceSessionRenewalSnapshot | null = baseSnapshot();
  audits: DeviceSessionRenewalAudit[] = [];
  expectedProof = proof;
  failure: WorkstationLifecycleFailureCode | null = null;
  auditFailure = false;
  invalidAuditReceipt = false;
  casConflict = false;
  private queue: Promise<void> = Promise.resolve();
  private transactions = new WeakMap<object, SyntheticTx>();

  async transaction<T>(work: (tx: WorkstationLifecycleTransaction) => Promise<T>): Promise<T> {
    const predecessor = this.queue;
    let release!: () => void;
    this.queue = new Promise(resolve => { release = resolve; });
    await predecessor;
    try {
      if (this.failure === "DATABASE_UNAVAILABLE") {
        throw new WorkstationLifecycleInfrastructureError("DATABASE_UNAVAILABLE");
      }
      const handle = Object.freeze({ synthetic: true }) as unknown as WorkstationLifecycleTransaction;
      const staged: SyntheticTx = {
        snapshot: this.snapshot ? { ...this.snapshot } : null,
        audits: [...this.audits],
      };
      this.transactions.set(handle as object, staged);
      try {
        const result = await work(handle);
        this.snapshot = staged.snapshot;
        this.audits = staged.audits;
        if (this.failure === "COMMIT_UNKNOWN") {
          throw new WorkstationLifecycleInfrastructureError("COMMIT_UNKNOWN");
        }
        if (this.failure === "PERSISTENCE_FAILURE") {
          throw new WorkstationLifecycleInfrastructureError("PERSISTENCE_FAILURE");
        }
        return result;
      } catch (error) {
        if (this.failure === "ROLLBACK_FAILED") {
          throw new WorkstationLifecycleInfrastructureError("ROLLBACK_FAILED");
        }
        throw error;
      }
    } finally {
      release();
    }
  }

  async readForRenewal(
    _sessionId: string,
    tx: WorkstationLifecycleTransaction,
  ): Promise<DeviceSessionRenewalSnapshot | null> {
    const staged = this.transactions.get(tx as object)!;
    return staged.snapshot ? Object.freeze({ ...staged.snapshot }) : null;
  }

  async compareAndSwapRenewal(
    mutation: DeviceSessionRenewalMutation,
    tx: WorkstationLifecycleTransaction,
  ) {
    const staged = this.transactions.get(tx as object)!;
    const current = staged.snapshot;
    if (
      this.casConflict || !current ||
      current.sessionRevision !== mutation.expectedRevision ||
      current.renewalCounter !== mutation.expectedRenewalCounter
    ) return { affectedRows: 0 as const };
    const revision = nextRevision(current.sessionRevision);
    staged.snapshot = Object.freeze({
      ...current,
      sessionRevision: revision,
      renewalCounter: mutation.nextRenewalCounter,
      lastActivityAtMs: mutation.lastActivityAtMs,
      idleExpiresAtMs: mutation.idleExpiresAtMs,
    });
    return { affectedRows: 1 as const, newRevision: revision };
  }

  async write(event: DeviceSessionRenewalAudit, tx: WorkstationLifecycleTransaction) {
    if (this.auditFailure) throw new WorkstationLifecycleInfrastructureError("AUDIT_FAILURE");
    this.transactions.get(tx as object)!.audits.push(Object.freeze({ ...event }));
    return { auditLogId: this.invalidAuditReceipt ? "9007199254740993.0" : "9007199254740993" };
  }
}

const service = (store: SyntheticLifecycleStore, nowMs = 20_000) =>
  createWorkstationSessionLifecycle({
    repository: store,
    audit: store,
    credentialProof: {
      verify: async presented => presented.credentialProof === store.expectedProof,
    },
    policy,
    now: () => nowMs,
  });

test("valid renewal extends only idle expiry, consumes one counter, and grants no query authority", async () => {
  const store = new SyntheticLifecycleStore();
  const result = await service(store).renew(request());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.nextRenewalCounter, "1");
  assert.equal(result.idleExpiresAtMs, 80_000);
  assert.equal(result.auditLogId, "9007199254740993");
  assert.equal(result.queryExecutionAllowed, false);
  assert.equal(result.patientDataAllowed, false);
  assert.equal(result.operatorAuthority, "NONE");
  assert.equal(result.productionPersistence, "NOT_PROVEN");
  assert.equal(store.snapshot?.absoluteExpiresAtMs, 3_601_000);
  assert.equal(store.audits[0]?.eventType, "WORKSTATION_DEVICE_SESSION_RENEWED");
  assert.equal("credentialProof" in (store.audits[0] ?? {}), false);
  assert.equal(deviceSessionCanAuthorizeOperatorQuery(result), false);
});

test("idle and absolute expiry are distinct and both fail closed", async () => {
  for (const [field, nowMs, reason] of [
    ["idleExpiresAtMs", 70_000, "SESSION_IDLE_EXPIRED"],
    ["absoluteExpiresAtMs", 3_601_000, "SESSION_ABSOLUTE_EXPIRED"],
  ] as const) {
    const store = new SyntheticLifecycleStore();
    store.snapshot = { ...baseSnapshot(), [field]: nowMs };
    const result = await service(store, nowMs).renew(request());
    assert.deepEqual({ ok: result.ok, reason: result.ok ? null : result.reason }, { ok: false, reason });
    assert.equal(store.audits.at(-1)?.reason, reason);
  }
});

test("absolute and idle lifetimes cannot exceed the fixed server policy", () => {
  const snapshot = baseSnapshot();
  assert.deepEqual(
    evaluateDeviceSessionRenewal({ ...snapshot, absoluteExpiresAtMs: 3_601_001 }, request(), policy, 20_000),
    { ok: false, reason: "SESSION_LIFETIME_INVALID" },
  );
  assert.deepEqual(
    evaluateDeviceSessionRenewal({ ...snapshot, idleExpiresAtMs: 70_001 }, request(), policy, 20_000),
    { ok: false, reason: "SESSION_LIFETIME_INVALID" },
  );
});

test("revocation, rotation, disablement, and retirement are independently rejected", async () => {
  const cases: [Partial<DeviceSessionRenewalSnapshot>, string][] = [
    [{ sessionState: "REVOKED" }, "SESSION_REVOKED"],
    [{ credentialRevoked: true }, "CREDENTIAL_REVOKED"],
    [{ credentialVersion: 3 }, "CREDENTIAL_VERSION_MISMATCH"],
    [{ workstationCredentialVersion: 5 }, "CREDENTIAL_VERSION_MISMATCH"],
    [{ workstationActive: false }, "WORKSTATION_DISABLED"],
    [{ workstationRetired: true }, "WORKSTATION_RETIRED"],
  ];
  for (const [change, reason] of cases) {
    const store = new SyntheticLifecycleStore();
    store.snapshot = { ...baseSnapshot(), ...change };
    const result = await service(store).renew(request());
    assert.equal(result.ok, false, reason);
    if (!result.ok) assert.equal(result.reason, reason);
    assert.equal(store.snapshot?.renewalCounter, "0");
  }
});

test("missing sessions and mismatched identities are rejected with safe audit fields", async () => {
  const missing = new SyntheticLifecycleStore();
  missing.snapshot = null;
  const missingResult = await service(missing).renew(request());
  assert.equal(missingResult.ok, false);
  if (!missingResult.ok) assert.equal(missingResult.reason, "SESSION_NOT_FOUND");
  assert.equal(missing.audits[0]?.reason, "SESSION_NOT_FOUND");

  const mismatch = new SyntheticLifecycleStore();
  mismatch.snapshot = { ...baseSnapshot(), workstationId: "9007199254740994" };
  const mismatchResult = await service(mismatch).renew(request());
  assert.equal(mismatchResult.ok, false);
  if (!mismatchResult.ok) assert.equal(mismatchResult.reason, "IDENTITY_MISMATCH");
  assert.equal(mismatch.audits[0]?.reason, "IDENTITY_MISMATCH");
  assert.equal(JSON.stringify(mismatch.audits).includes(proof), false);
});

test("wrong credential proof is audited without recording the proof", async () => {
  const store = new SyntheticLifecycleStore();
  const secret = "B".repeat(43);
  const result = await service(store).renew(request({ credentialProof: secret }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "CREDENTIAL_PROOF_REJECTED");
  assert.equal(JSON.stringify(store.audits).includes(secret), false);
  assert.equal(JSON.stringify(result).includes(secret), false);
});

test("two tabs racing the same renewal allow exactly one and audit the replay", async () => {
  const store = new SyntheticLifecycleStore();
  const lifecycle = service(store);
  const [first, second] = await Promise.all([lifecycle.renew(request()), lifecycle.renew(request())]);
  assert.equal([first, second].filter(result => result.ok).length, 1);
  const denial = [first, second].find(result => !result.ok);
  assert.equal(denial?.ok, false);
  if (denial && !denial.ok) assert.equal(denial.reason, "RENEWAL_REPLAY");
  assert.equal(store.snapshot?.renewalCounter, "1");
  assert.deepEqual(store.audits.map(event => event.status), ["SUCCESS", "FAILED"]);
});

test("persisted counter rejects replay after service restart or another node", async () => {
  const store = new SyntheticLifecycleStore();
  assert.equal((await service(store).renew(request())).ok, true);
  const anotherNode = service(store);
  const replay = await anotherNode.renew(request());
  assert.equal(replay.ok, false);
  if (!replay.ok) assert.equal(replay.reason, "RENEWAL_REPLAY");
});

test("CAS conflict rejects renewal without leaving a partial session update", async () => {
  const store = new SyntheticLifecycleStore();
  store.casConflict = true;
  const result = await service(store).renew(request());
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "SESSION_REVISION_CONFLICT");
  assert.equal(store.snapshot?.renewalCounter, "0");
  assert.equal(store.audits[0]?.reason, "SESSION_REVISION_CONFLICT");
});

test("audit failure or invalid exact receipt rolls back the staged renewal", async () => {
  for (const configure of [
    (store: SyntheticLifecycleStore) => { store.auditFailure = true; },
    (store: SyntheticLifecycleStore) => { store.invalidAuditReceipt = true; },
  ]) {
    const store = new SyntheticLifecycleStore();
    configure(store);
    const result = await service(store).renew(request());
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "AUDIT_FAILURE");
    assert.equal(store.snapshot?.renewalCounter, "0");
    assert.equal(store.audits.length, 0);
  }
});

test("database failure, rollback failure, and commit unknown never report renewal success", async () => {
  for (const failure of ["DATABASE_UNAVAILABLE", "ROLLBACK_FAILED", "COMMIT_UNKNOWN"] as const) {
    const store = new SyntheticLifecycleStore();
    store.failure = failure;
    if (failure === "ROLLBACK_FAILED") store.auditFailure = true;
    const result = await service(store).renew(request());
    assert.equal(result.ok, false, failure);
    if (!result.ok) assert.equal(result.reason, failure);
  }
});

test("operator JWT expiry does not destroy device entry and device renewal never restores operator authority", async () => {
  const ready = transitionWorkstationSession(initialWorkstationSession, { type: "DEVICE_VERIFIED" });
  const operator = transitionWorkstationSession(ready, { type: "OPERATOR_VERIFIED", userId: 12 });
  const expired = transitionWorkstationSession(operator, { type: "OPERATOR_AUTHORIZATION_EXPIRED" });
  assert.equal(expired.state, "OPERATOR_LOCKED");

  const result = await service(new SyntheticLifecycleStore()).renew(request());
  assert.equal(result.ok, true);
  assert.equal(result.operatorAuthority, "NONE");
  assert.equal(result.queryExecutionAllowed, false);
  assert.equal(expired.operatorUserId, null);
});

test("unknown fields, unsafe IDs, getters, and proxies are rejected without invoking caller hooks", async () => {
  const store = new SyntheticLifecycleStore();
  let invoked = false;
  const getter = {
    ...request(),
    get unexpected() { invoked = true; return proof; },
  };
  assert.equal((await service(store).renew(getter)).ok, false);
  assert.equal(invoked, false);
  assert.equal((await service(store).renew({ ...request(), workstationId: 9_007_199_254_740_993 })).ok, false);
  const proxied = new Proxy(request(), { get() { invoked = true; return undefined; } });
  assert.equal((await service(store).renew(proxied)).ok, false);
  assert.equal(invoked, false);
  assert.equal(store.audits.length, 0);
});
