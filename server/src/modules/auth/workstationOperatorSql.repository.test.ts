import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createWorkstationOperatorSwitchService } from "./workstationOperatorSwitch.js";
import { OperatorSwitchInfrastructureError } from "./workstationOperatorSwitch.ports.js";
import { createWorkstationOperatorSqlRepository } from "./workstationOperatorSql.repository.js";
import type {
  WorkstationSqlRepositoryDependencies,
  WorkstationSqlRequest,
  WorkstationSqlTransaction,
} from "./workstationSessionSql.repository.js";
import { workstationOperatorRepositorySql, workstationSessionRepositorySql } from "./workstationSessionSqlStatements.js";

const requestId = "11111111-1111-4111-8111-111111111111";
const secondRequestId = "12121212-1212-4212-8212-121212121212";
const deviceSessionId = "22222222-2222-4222-8222-222222222222";
const credentialId = "33333333-3333-4333-8333-333333333333";
const oldIncarnation = "44444444-4444-4444-8444-444444444444";
const nextIncarnation = "55555555-5555-4555-8555-555555555555";
const correlationId = "66666666-6666-4666-8666-666666666666";
const workstationId = "9007199254740993";
const deviceRevision = "0000000000000041";
const operatorRevision = "0000000000000011";
const pinRevision = "0000000000000021";
const newOperatorRevision = "0000000000000012";
const newPinRevision = "0000000000000022";
const auditLogId = "9007199254740997";
const correctPin = "804297";

type Options = {
  correctPin?: boolean;
  active?: boolean;
  tokenVersion?: number;
  policyRevision?: string;
  switchCasCount?: number;
  pinCas?: boolean;
  existingDigest?: string | null;
  existingOperation?: string;
  failAt?: string;
  commitFails?: boolean;
  rollbackFails?: boolean;
};

function digest(id = requestId) {
  return createHash("sha256").update(JSON.stringify([
    "WORKSTATION_OPERATOR_SWITCH_REQUEST_V1", id, deviceSessionId,
    workstationId, 13, deviceRevision, operatorRevision, oldIncarnation, 4,
  ])).digest("hex");
}

function fixture(options: Options = {}) {
  const queries: string[] = [];
  const inputs: Record<string, unknown>[] = [];
  let remainingSwitches = options.switchCasCount ?? 1;
  const tx = {
    begun: 0, committed: 0, rolledBack: 0,
    async begin() { this.begun++; },
    async commit() { this.committed++; if (options.commitFails) throw new Error("secret commit detail"); },
    async rollback() { this.rolledBack++; if (options.rollbackFails) throw new Error("secret rollback detail"); },
  } satisfies WorkstationSqlTransaction & { begun: number; committed: number; rolledBack: number };
  const rows = (recordset: Record<string, unknown>[] = []) => ({ recordset, rowsAffected: [] as number[] });
  function respond(text: string, values: Record<string, unknown>) {
    if (options.failAt && text.includes(options.failAt)) throw new Error("raw PIN SQL credential patient detail");
    if (text === workstationSessionRepositorySql.acquireGate) return rows([{ GateResult: 0 }]);
    if (text === workstationSessionRepositorySql.discoverDevice) return rows([{ WorkstationId: workstationId, CredentialId: credentialId }]);
    if (text === workstationOperatorRepositorySql.lockPolicy) return rows([{ PinLength: 6, PolicyRevision: options.policyRevision ?? "21" }]);
    if (text === workstationOperatorRepositorySql.lockUser) return rows([{
      UserId: "13", IsActive: options.active ?? true, TokenVersion: options.tokenVersion ?? 5,
    }]);
    if (text === workstationOperatorRepositorySql.readPermissions) return rows([{ Code: "EXECUTE_QUERY" }]);
    if (text === workstationOperatorRepositorySql.lockWorkstation) return rows([{
      WorkstationId: workstationId, IsActive: true, PinLoginEnabled: true,
      CredentialVersion: 7, RetiredAtUtc: null,
    }]);
    if (text === workstationOperatorRepositorySql.lockAccess) return rows([{ IsAllowed: true }]);
    if (text === workstationSessionRepositorySql.lockCredential) return rows([{
      CredentialId: credentialId, WorkstationId: workstationId, IsRevoked: false,
      CredentialVersion: 7, RevokedAtUtc: null,
    }]);
    if (text === workstationSessionRepositorySql.lockDevice) return rows([{
      SessionId: deviceSessionId, WorkstationId: workstationId, CredentialId: credentialId,
      BoundCredentialVersion: 7, SessionProofHash: Buffer.alloc(32, 7),
      CreatedAtUtc: new Date(1_000), LastActivityAtUtc: new Date(20_000),
      IdleExpiresAtUtc: new Date(80_000), AbsoluteExpiresAtUtc: new Date(200_000),
      RevokedAtUtc: null, RenewalCounter: "4", RowVersion: deviceRevision,
    }]);
    if (text === workstationOperatorRepositorySql.lockPin) return rows([{
      UserId: "13", PinHash: "synthetic-hash", PinVersion: 2, IsEnabled: true,
    }]);
    if (text === workstationOperatorRepositorySql.lockPinBinding) return rows([{
      UserId: "13", PinVersion: 2, BoundTokenVersion: 5, BoundPolicyRevision: "21",
    }]);
    if (text === workstationOperatorRepositorySql.lockPinAttempt) return rows([{
      UserId: "13", LastWorkstationId: workstationId, BoundPinVersion: 2,
      BoundPolicyRevision: "21", FailedAttempts: 0, AttemptWindowStartedAtUtc: null,
      LastAttemptAtUtc: null, LockedUntilUtc: null, RowVersion: pinRevision,
    }]);
    if (text === workstationOperatorRepositorySql.lockLegacyOperatorRange) return rows([]);
    if (text === workstationOperatorRepositorySql.lockOperatorState) return rows([{
      WorkstationId: workstationId, DeviceSessionId: deviceSessionId, StateCode: "OPERATOR_LOCKED",
      Generation: "4", Incarnation: oldIncarnation, OperatorUserId: null,
      OperatorSessionId: null, TokenVersion: null, PinVersion: null, AuthMethod: null,
      RowVersion: operatorRevision,
    }]);
    if (text === workstationSessionRepositorySql.readRequest) {
      return options.existingDigest == null ? rows([]) : rows([{
        RequestDigest: options.existingDigest, OperationCode: options.existingOperation ?? "OPERATOR_SWITCH",
        WorkstationId: workstationId, DeviceSessionId: deviceSessionId,
      }]);
    }
    if (text === workstationOperatorRepositorySql.insertRequest) return rows([{ RequestId: values.requestId }]);
    if (text === workstationOperatorRepositorySql.pinFailureCas) return options.pinCas === false ? rows([]) : rows([{ NewRevision: newPinRevision }]);
    if (text === workstationOperatorRepositorySql.switchCas) {
      if (remainingSwitches-- <= 0) return rows([]);
      return rows([{ NewRevision: newOperatorRevision }]);
    }
    if (text === workstationOperatorRepositorySql.insertAudit) return rows([{ AuditLogId: auditLogId }]);
    if (text === workstationOperatorRepositorySql.insertDecision) return rows([{ RequestId: values.requestId }]);
    assert.fail(`unexpected SQL: ${text.slice(0, 80)}`);
  }
  const baseDeps: WorkstationSqlRepositoryDependencies = {
    getPool: async () => ({}), createTransaction: () => tx,
    createRequest: () => {
      const values: Record<string, unknown> = {};
      inputs.push(values);
      const req: WorkstationSqlRequest = {
        input(name, _type, value) { values[name] = value; return req; },
        async query(text) { queries.push(text); return respond(text, values); },
      };
      return req;
    },
    newUuid: () => correlationId,
  };
  const adapter = createWorkstationOperatorSqlRepository({
    ...baseDeps, now: () => 50_000,
    comparePin: async value => (options.correctPin ?? true) && value === correctPin,
  });
  const service = createWorkstationOperatorSwitchService({
    repository: adapter.repository, pinVerifier: adapter.pinVerifier, audit: adapter.audit,
    policy: { deviceSession: { idleWindowMs: 60_000, absoluteLifetimeMs: 199_000 }, maxFailedAttempts: 5, attemptWindowMs: 300_000, lockoutMs: 900_000 },
    now: () => 50_000, newIncarnation: () => nextIncarnation,
  });
  return { adapter, service, tx, queries, inputs };
}

function switchRequest(id = requestId) {
  return Object.freeze({
    format: "WORKSTATION_OPERATOR_SWITCH_V1" as const, requestId: id,
    deviceSessionId, workstationId, targetUserId: 13, pin: correctPin,
    expectedDeviceRevision: deviceRevision, expectedOperatorRevision: operatorRevision,
    expectedOperatorIncarnation: oldIncarnation, expectedGeneration: 4,
  });
}

test("PIN switch locks and revalidates live state, then commits CAS, exact audit and Decision", async () => {
  const f = fixture();
  const result = await f.service.switchOperator(switchRequest());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.auditLogId, auditLogId);
  assert.equal(result.authorization.revision, newOperatorRevision);
  assert.equal(result.authorization.session.generation, 5);
  assert.equal(result.runtimeAuthority, "NONE");
  assert.equal(result.jwtIssued, false);
  assert.equal(f.adapter.runtimeEnabled, false);
  assert.equal(f.tx.committed, 1);
  assert.equal(f.tx.rolledBack, 0);
  const expectedOrder = [
    workstationOperatorRepositorySql.lockPolicy, workstationOperatorRepositorySql.lockUser,
    workstationOperatorRepositorySql.readPermissions, workstationOperatorRepositorySql.lockWorkstation,
    workstationOperatorRepositorySql.lockAccess, workstationSessionRepositorySql.lockCredential,
    workstationSessionRepositorySql.lockDevice, workstationOperatorRepositorySql.lockPin,
    workstationOperatorRepositorySql.lockPinBinding, workstationOperatorRepositorySql.lockPinAttempt,
    workstationOperatorRepositorySql.lockLegacyOperatorRange, workstationOperatorRepositorySql.lockOperatorState,
  ];
  let previous = -1;
  for (const statement of expectedOrder) {
    const current = f.queries.indexOf(statement);
    assert.ok(current > previous);
    previous = current;
  }
  const decision = f.inputs.find(value => value.decisionStatus === "SUCCESS");
  assert.equal(decision?.revisionDomain, "OPERATOR_STATE");
  assert.equal(decision?.auditLogId, auditLogId);
  assert.equal(JSON.stringify(f.inputs).includes(correctPin), false);
});

test("wrong PIN advances persistent attempt CAS and writes a rejected correlated Decision", async () => {
  const f = fixture({ correctPin: false });
  const result = await f.service.switchOperator(switchRequest());
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "INVALID_PIN");
  assert.ok(f.queries.includes(workstationOperatorRepositorySql.pinFailureCas));
  assert.equal(f.queries.includes(workstationOperatorRepositorySql.switchCas), false);
  const decision = f.inputs.find(value => value.revisionDomain === "PIN_ATTEMPT");
  assert.equal(decision?.decisionStatus, "REJECTED");
  assert.equal(decision?.nextRevision, newPinRevision);
  assert.equal(decision?.reason, "INVALID_PIN");
  assert.equal(f.tx.committed, 1);
});

test("account, TokenVersion and policy drift reject before PIN comparison or Request reservation", async () => {
  for (const [options, reason] of [
    [{ active: false }, "USER_DISABLED"],
    [{ tokenVersion: 6 }, "TOKEN_VERSION_MISMATCH"],
    [{ policyRevision: "22" }, "PIN_POLICY_CHANGED"],
  ] as const) {
    const f = fixture(options);
    const result = await f.service.switchOperator(switchRequest());
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, reason);
    assert.equal(f.queries.includes(workstationOperatorRepositorySql.insertRequest), false);
    assert.equal(f.queries.includes(workstationOperatorRepositorySql.switchCas), false);
  }
});

test("matching and conflicting RequestId replays never rerun PIN or operator mutation", async () => {
  for (const [existingDigest, operation, reason] of [
    [digest(), "OPERATOR_SWITCH", "REQUEST_REPLAY"],
    ["f".repeat(64), "OPERATOR_SWITCH", "REQUEST_ID_CONFLICT"],
    [digest(), "DEVICE_RENEW", "REQUEST_ID_CONFLICT"],
  ] as const) {
    const f = fixture({ existingDigest, existingOperation: operation });
    const result = await f.service.switchOperator(switchRequest());
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, reason);
    assert.equal(f.queries.includes(workstationOperatorRepositorySql.switchCas), false);
    assert.equal(f.queries.includes(workstationOperatorRepositorySql.pinFailureCas), false);
  }
});

test("two synthetic nodes consuming one operator ROWVERSION permit one switch only", async () => {
  const f = fixture({ switchCasCount: 1 });
  const [first, second] = await Promise.all([
    f.service.switchOperator(switchRequest()),
    f.service.switchOperator(switchRequest(secondRequestId)),
  ]);
  assert.equal([first, second].filter(result => result.ok).length, 1);
  const rejected = [first, second].find(result => !result.ok);
  if (rejected && !rejected.ok) assert.equal(rejected.reason, "SWITCH_CAS_CONFLICT");
});

test("audit failure rolls back PIN/operator mutation; rollback and commit unknown stay closed", async () => {
  const audit = fixture({ failAt: "INSERT uqp.AuditLog" });
  const auditResult = await audit.service.switchOperator(switchRequest());
  assert.equal(auditResult.ok, false);
  if (!auditResult.ok) assert.equal(auditResult.reason, "AUDIT_FAILURE");
  assert.equal(audit.tx.rolledBack, 1);

  const rollback = fixture({ failAt: "INSERT uqp.AuditLog", rollbackFails: true });
  const rollbackResult = await rollback.service.switchOperator(switchRequest());
  assert.equal(rollbackResult.ok, false);
  if (!rollbackResult.ok) assert.equal(rollbackResult.reason, "ROLLBACK_FAILED");

  const unknown = fixture({ commitFails: true });
  const unknownResult = await unknown.service.switchOperator(switchRequest());
  assert.equal(unknownResult.ok, false);
  if (!unknownResult.ok) assert.equal(unknownResult.reason, "COMMIT_UNKNOWN");
  assert.equal(unknown.tx.rolledBack, 0);
});

test("missing 926 binding/attempt/operator rows and external transaction tokens fail closed", async () => {
  const f = fixture({ failAt: "UserQuickPinSecurityBinding" });
  const result = await f.service.switchOperator(switchRequest());
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "PERSISTENCE_FAILURE");
  await assert.rejects(
    async () => fixture().adapter.repository.readForSwitch(
      { requestId, deviceSessionId, workstationId, targetUserId: 13 }, Object.freeze({}) as never,
    ),
    (error: unknown) => error instanceof OperatorSwitchInfrastructureError && error.code === "PERSISTENCE_FAILURE",
  );
});

test("SQL uses fixed parameterized statements and never persists PIN or grants Query authority", () => {
  const text = Object.values(workstationOperatorRepositorySql).join("\n");
  assert.doesNotMatch(text, /\$\{|@pin\b|JWT|GRANT|QueryExecution|patient/iu);
  assert.match(workstationOperatorRepositorySql.pinFailureCas, /RowVersion = CONVERT\(BINARY\(8\), @expectedRevision, 2\)/u);
  assert.match(workstationOperatorRepositorySql.switchCas, /StateCode = N'OPERATOR_LOCKED'/u);
  assert.match(workstationOperatorRepositorySql.switchCas, /926_PIN_RESET_CAS_CONFLICT/u);
  assert.match(workstationOperatorRepositorySql.insertAudit, /OUTPUT CONVERT\(VARCHAR\(20\), INSERTED\.Id\)/u);
});
