import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createWorkstationSessionLifecycle } from "./workstationSessionLifecycle.js";
import { WorkstationLifecycleInfrastructureError } from "./workstationSessionLifecycle.ports.js";
import {
  createWorkstationSessionSqlRepository,
  type WorkstationSqlRepositoryDependencies,
  type WorkstationSqlRequest,
  type WorkstationSqlTransaction,
} from "./workstationSessionSql.repository.js";
import { deviceRenewalCasSql, workstationSessionRepositorySql } from "./workstationSessionSqlStatements.js";

const sessionId = "11111111-1111-4111-8111-111111111111";
const credentialId = "22222222-2222-4222-8222-222222222222";
const internalRequestId = "33333333-3333-4333-8333-333333333333";
const correlationId = "44444444-4444-4444-8444-444444444444";
const explicitRequestId = "55555555-5555-4555-8555-555555555555";
const workstationId = "9007199254740993";
const initialRevision = "0000000000000001";
const nextRevision = "0000000000000002";
const proof = "A".repeat(43);
const auditLogId = "9007199254740995";

type FakeOptions = {
  renewCas?: boolean;
  failAt?: string;
  commitFails?: boolean;
  rollbackFails?: boolean;
  replayDigest?: string | null;
};

function fixture(options: FakeOptions = {}) {
  const queries: string[] = [];
  const inputs: Record<string, unknown>[] = [];
  const transaction = {
    begun: [] as number[], committed: 0, rolledBack: 0,
    async begin(level: number) { this.begun.push(level); },
    async commit() { this.committed++; if (options.commitFails) throw new Error("secret commit detail"); },
    async rollback() { this.rolledBack++; if (options.rollbackFails) throw new Error("secret rollback detail"); },
  } satisfies WorkstationSqlTransaction & { begun: number[]; committed: number; rolledBack: number };
  const rows = (recordset: Record<string, unknown>[] = [], rowsAffected: number[] = []) => ({ recordset, rowsAffected });
  function result(text: string, values: Record<string, unknown>) {
    if (options.failAt && text.includes(options.failAt)) {
      const error = new Error("raw SQL, PIN, credential and patient detail");
      Object.assign(error, { number: options.failAt === "renew" ? 1205 : 1222 });
      throw error;
    }
    if (text === workstationSessionRepositorySql.acquireGate) return rows([{ GateResult: 0 }]);
    if (text === workstationSessionRepositorySql.discoverDevice) return rows([{ WorkstationId: workstationId, CredentialId: credentialId }]);
    if (text === workstationSessionRepositorySql.lockWorkstation) return rows([{
      WorkstationId: workstationId, IsActive: true, CredentialVersion: 4, RetiredAtUtc: null,
    }]);
    if (text === workstationSessionRepositorySql.lockCredential) return rows([{
      CredentialId: credentialId, WorkstationId: workstationId, IsRevoked: false,
      CredentialVersion: 4, RevokedAtUtc: null,
    }]);
    if (text === workstationSessionRepositorySql.lockDevice) return rows([{
      SessionId: sessionId, WorkstationId: workstationId, CredentialId: credentialId,
      BoundCredentialVersion: 4, SessionProofHash: createHash("sha256").update(proof).digest(),
      CreatedAtUtc: new Date(1_000), LastActivityAtUtc: new Date(20_000),
      IdleExpiresAtUtc: new Date(80_000), AbsoluteExpiresAtUtc: new Date(200_000),
      RevokedAtUtc: null, RenewalCounter: "7", RowVersion: initialRevision,
    }]);
    if (text === workstationSessionRepositorySql.readRequest) {
      return options.replayDigest === undefined || options.replayDigest === null ? rows([]) : rows([{
        RequestDigest: options.replayDigest, OperationCode: values.operation ?? "DEVICE_REVOKE",
        WorkstationId: workstationId, DeviceSessionId: sessionId,
      }]);
    }
    if (text === workstationSessionRepositorySql.insertRequest) return rows([{ RequestId: values.requestId }]);
    if (text === deviceRenewalCasSql) return options.renewCas === false ? rows([]) : rows([{ NewRevision: nextRevision }]);
    if (text === workstationSessionRepositorySql.insertAudit) return rows([{ AuditLogId: auditLogId }]);
    if (text === workstationSessionRepositorySql.insertDecision) return rows([{ RequestId: values.requestId }]);
    assert.fail(`unexpected SQL statement: ${text.slice(0, 60)}`);
  }
  const deps: WorkstationSqlRepositoryDependencies = {
    getPool: async () => ({}),
    createTransaction: () => transaction,
    createRequest: () => {
      const values: Record<string, unknown> = {};
      inputs.push(values);
      const request: WorkstationSqlRequest = {
        input(name, _type, value) { values[name] = value; return request; },
        async query(text) { queries.push(text); return result(text, values); },
      };
      return request;
    },
    newUuid: (() => {
      const values = [internalRequestId, correlationId, internalRequestId, correlationId];
      return () => values.shift() ?? correlationId;
    })(),
  };
  return { deps, transaction, queries, inputs };
}

const renewalRequest = Object.freeze({
  format: "WORKSTATION_DEVICE_SESSION_RENEWAL_V1" as const,
  sessionId, workstationId, credentialId, credentialProof: proof,
  expectedRevision: initialRevision, renewalCounter: "7",
});

function lifecycle(f: ReturnType<typeof fixture>) {
  const adapter = createWorkstationSessionSqlRepository(f.deps);
  return {
    adapter,
    service: createWorkstationSessionLifecycle({
      repository: adapter.repository, audit: adapter.audit, credentialProof: adapter.credentialProof,
      policy: { idleWindowMs: 60_000, absoluteLifetimeMs: 199_000 }, now: () => 50_000,
    }),
  };
}

test("owned SERIALIZABLE renewal commits one CAS, exact audit receipt and immutable decision", async () => {
  const f = fixture();
  const { adapter, service } = lifecycle(f);
  const result = await service.renew(renewalRequest);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.auditLogId, auditLogId);
  assert.equal(result.nextRenewalCounter, "8");
  assert.equal(result.newRevision, nextRevision);
  assert.equal(result.authority, "DEVICE_ENTRY_ONLY");
  assert.equal(result.operatorAuthority, "NONE");
  assert.equal(result.queryExecutionAllowed, false);
  assert.equal(adapter.runtimeEnabled, false);
  assert.equal(f.transaction.begun.length, 1);
  assert.equal(f.transaction.committed, 1);
  assert.equal(f.transaction.rolledBack, 0);
  assert.deepEqual(f.queries.slice(0, 5), [
    workstationSessionRepositorySql.acquireGate,
    workstationSessionRepositorySql.discoverDevice,
    workstationSessionRepositorySql.lockWorkstation,
    workstationSessionRepositorySql.lockCredential,
    workstationSessionRepositorySql.lockDevice,
  ]);
  assert.ok(f.queries.indexOf(workstationSessionRepositorySql.insertRequest) < f.queries.indexOf(deviceRenewalCasSql));
  assert.ok(f.queries.indexOf(deviceRenewalCasSql) < f.queries.indexOf(workstationSessionRepositorySql.insertAudit));
  assert.ok(f.queries.indexOf(workstationSessionRepositorySql.insertAudit) < f.queries.indexOf(workstationSessionRepositorySql.insertDecision));
  assert.ok(f.inputs.some(value => value.auditLogId === auditLogId));
  assert.equal(JSON.stringify(f.inputs).includes(proof), false);
});

test("renewal CAS conflict is rejected and an immutable rejected decision is committed", async () => {
  const f = fixture({ renewCas: false });
  const result = await lifecycle(f).service.renew(renewalRequest);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "SESSION_REVISION_CONFLICT");
  assert.equal(f.transaction.committed, 1);
  assert.equal(f.transaction.rolledBack, 0);
  const decision = f.inputs.find(value => value.decisionStatus === "REJECTED");
  assert.equal(decision?.nextRevision, null);
  assert.equal(decision?.reason, "SESSION_REVISION_CONFLICT");
});

test("audit failure rolls back CAS; rollback failure and commit unknown remain fail-closed", async () => {
  const auditFailure = fixture({ failAt: "AuditLog" });
  const rejectedAudit = await lifecycle(auditFailure).service.renew(renewalRequest);
  assert.equal(rejectedAudit.ok, false);
  if (!rejectedAudit.ok) assert.equal(rejectedAudit.reason, "AUDIT_FAILURE");
  assert.equal(auditFailure.transaction.rolledBack, 1);
  assert.equal(auditFailure.transaction.committed, 0);

  const rollbackFailure = fixture({ failAt: "AuditLog", rollbackFails: true });
  const rejectedRollback = await lifecycle(rollbackFailure).service.renew(renewalRequest);
  assert.equal(rejectedRollback.ok, false);
  if (!rejectedRollback.ok) assert.equal(rejectedRollback.reason, "ROLLBACK_FAILED");

  const commitUnknown = fixture({ commitFails: true });
  const rejectedCommit = await lifecycle(commitUnknown).service.renew(renewalRequest);
  assert.equal(rejectedCommit.ok, false);
  if (!rejectedCommit.ok) assert.equal(rejectedCommit.reason, "COMMIT_UNKNOWN");
  assert.equal(commitUnknown.transaction.rolledBack, 0);
});

test("deadlock and lock timeout are not retried and expose only fixed infrastructure errors", async () => {
  for (const failAt of ["UPDATE ds WITH", "SharedWorkstationDeviceSession WITH"]) {
    const f = fixture({ failAt });
    const result = await lifecycle(f).service.renew(renewalRequest);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, "PERSISTENCE_FAILURE");
      assert.equal(JSON.stringify(result).includes("raw SQL"), false);
    }
    assert.equal(f.transaction.rolledBack, 1);
    assert.equal(f.queries.filter(query => query === deviceRenewalCasSql).length <= 1, true);
  }
});

test("device proof mismatch cannot mutate, authorize an operator, or leak proof", async () => {
  const f = fixture();
  const result = await lifecycle(f).service.renew({ ...renewalRequest, credentialProof: "B".repeat(43) });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "CREDENTIAL_PROOF_REJECTED");
    assert.equal(result.operatorAuthority, "NONE");
    assert.equal(result.patientDataAllowed, false);
  }
  assert.equal(f.queries.includes(deviceRenewalCasSql), false);
  assert.equal(JSON.stringify(f.inputs).includes("B".repeat(43)), false);
});

test("old Device revocation cannot bypass credential lineage or operator CAS even with a valid-looking command", async () => {
  for (const cause of ["ADMIN_REVOKED", "CREDENTIAL_REVOKED", "WORKSTATION_REVOKED"] as const) {
    const f = fixture();
    const result = await createWorkstationSessionSqlRepository(f.deps).revokeDevice({
      format: "WORKSTATION_DEVICE_SESSION_REVOCATION_V1", requestId: explicitRequestId,
      sessionId, workstationId, credentialId, expectedRevision: initialRevision, cause,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "REVOCATION_SCOPE_BLOCKED");
    assert.equal(f.queries.length, 0); assert.equal(f.transaction.begun.length, 0);
    assert.equal(result.authority, "NONE"); assert.equal(result.runtimeWired, false);
  }
});

test("RequestId or matching replay digest cannot re-enable the retired Device writer", async () => {
  const f = fixture({ replayDigest: "0".repeat(64) });
  const adapter = createWorkstationSessionSqlRepository(f.deps);
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await adapter.revokeDevice({
      format: "WORKSTATION_DEVICE_SESSION_REVOCATION_V1", requestId: explicitRequestId,
      sessionId, workstationId, credentialId, expectedRevision: initialRevision, cause: "ADMIN_REVOKED",
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "REVOCATION_SCOPE_BLOCKED");
  }
  assert.equal(f.queries.length, 0); assert.equal(adapter.runtimeEnabled, false);
});

test("revocation rejects Number BIGINT, unknown fields and Proxy input before SQL", async () => {
  const f = fixture();
  const adapter = createWorkstationSessionSqlRepository(f.deps);
  const base = {
    format: "WORKSTATION_DEVICE_SESSION_REVOCATION_V1" as const,
    requestId: explicitRequestId, sessionId, workstationId, credentialId,
    expectedRevision: initialRevision, cause: "ADMIN_REVOKED" as const,
  };
  for (const input of [
    { ...base, workstationId: 9007199254740993 },
    { ...base, unexpected: true },
    new Proxy(base, { get: () => assert.fail("Proxy hook must not run") }),
  ]) {
    const result = await adapter.revokeDevice(input);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "FORMAT_INVALID");
  }
  assert.equal(f.queries.length, 0);
});

test("repository refuses unavailable DB and external transaction tokens", async () => {
  const f = fixture();
  const adapter = createWorkstationSessionSqlRepository({ ...f.deps, getPool: async () => null });
  await assert.rejects(
    adapter.repository.transaction(async () => "unreachable"),
    (error: unknown) => error instanceof WorkstationLifecycleInfrastructureError &&
      error.code === "DATABASE_UNAVAILABLE" && error.message === "WORKSTATION_SESSION_LIFECYCLE_UNAVAILABLE",
  );
  await assert.rejects(
    f.deps.getPool().then(async () => lifecycle(f).adapter.repository.readForRenewal(
      sessionId, Object.freeze({}) as never,
    )),
    (error: unknown) => error instanceof WorkstationLifecycleInfrastructureError && error.code === "PERSISTENCE_FAILURE",
  );
});

test("all values are parameter-bound and SQL contract contains owned transaction guards", () => {
  const statements = Object.values(workstationSessionRepositorySql).join("\n") + deviceRenewalCasSql;
  assert.doesNotMatch(statements, /\$\{|credentialProof|SessionSecret|PinHash|JWT|patient/iu);
  assert.match(workstationSessionRepositorySql.acquireGate, /SET XACT_ABORT ON/u);
  assert.match(workstationSessionRepositorySql.acquireGate, /sp_getapplock/u);
  assert.match(workstationSessionRepositorySql.lockWorkstation, /UPDLOCK, HOLDLOCK/u);
  assert.match(workstationSessionRepositorySql.lockCredential, /UPDLOCK, HOLDLOCK/u);
  assert.match(workstationSessionRepositorySql.lockDevice, /UPDLOCK, HOLDLOCK/u);
  assert.match(workstationSessionRepositorySql.readRequest, /UPDLOCK, HOLDLOCK/u);
  assert.match(workstationSessionRepositorySql.insertAudit, /OUTPUT CONVERT\(VARCHAR\(20\), INSERTED\.Id\)/u);
  assert.equal(workstationId, "9007199254740993");
});
