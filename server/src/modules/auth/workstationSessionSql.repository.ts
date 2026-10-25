import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { types } from "node:util";
import sql from "mssql";
import { getPlatformDbPool } from "../../config/database.js";
import {
  type DeviceSessionRenewalAudit,
  type DeviceSessionRenewalMutation,
  type DeviceSessionRenewalRequest,
  type DeviceSessionRenewalSnapshot,
} from "./workstationSessionLifecycle.js";
import {
  WorkstationLifecycleInfrastructureError,
  type WorkstationCredentialProofVerifier,
  type WorkstationDeviceSessionRepository,
  type WorkstationLifecycleTransaction,
  type WorkstationSessionAuditWriter,
} from "./workstationSessionLifecycle.ports.js";
import { canonicalSqlBigInt } from "./workstationSessionSchema926.js";
import { assessWorkstationSqlCommit, exactSqlBigintReceipt } from "./workstationSqlCommitGate.js";
import { deviceRenewalCasSql, workstationSessionRepositorySql } from "./workstationSessionSqlStatements.js";

type QueryResult = Readonly<{
  recordset: readonly Record<string, unknown>[];
  rowsAffected: readonly number[];
}>;

export interface WorkstationSqlRequest {
  input(name: string, type: unknown, value: unknown): WorkstationSqlRequest;
  query(text: string): Promise<QueryResult>;
}

export interface WorkstationSqlTransaction {
  begin(isolationLevel: number): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

export type WorkstationSqlRepositoryDependencies = Readonly<{
  getPool: () => Promise<unknown | null>;
  createTransaction: (pool: unknown) => WorkstationSqlTransaction;
  createRequest: (transaction: WorkstationSqlTransaction) => WorkstationSqlRequest;
  newUuid: () => string;
}>;

const defaults: WorkstationSqlRepositoryDependencies = Object.freeze({
  getPool: getPlatformDbPool as () => Promise<unknown | null>,
  createTransaction: pool => new sql.Transaction(pool as sql.ConnectionPool) as unknown as WorkstationSqlTransaction,
  createRequest: transaction => new sql.Request(transaction as unknown as sql.Transaction) as unknown as WorkstationSqlRequest,
  newUuid: randomUUID,
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const REVISION = /^[0-9a-f]{16}$/;
const DIGEST = /^[0-9a-f]{64}$/;

type LockedDevice = Readonly<{
  snapshot: DeviceSessionRenewalSnapshot;
  proofHash: Buffer;
}>;

type MutationEvidence = Readonly<{
  previousRevision: string;
  nextRevision: string;
  affectedRows: 1;
}>;

type RequestEvidence = Readonly<{
  requestId: string;
  digest: string;
  operation: "DEVICE_RENEW" | "DEVICE_REVOKE";
}>;

type SqlAuditEvent = Readonly<{
  eventType: string;
  status: "SUCCESS" | "FAILED";
  reason: string | null;
  sessionId: string;
  workstationId: string;
  credentialId: string;
  renewalCounter: string;
}>;

type TransactionContext = {
  transaction: WorkstationSqlTransaction;
  locked: LockedDevice | null;
  request: RequestEvidence | null;
  mutation: MutationEvidence | null;
  auditLogId: string | null;
  auditAffectedRows: number;
  decisionAffectedRows: number;
};

const contexts = new WeakMap<object, TransactionContext>();

const restrictions = Object.freeze({
  authority: "NONE" as const,
  operatorAuthority: "NONE" as const,
  queryExecutionAllowed: false as const,
  patientDataAllowed: false as const,
  runtimeWired: false as const,
  productionReady: false as const,
});

export type DeviceSessionRevocationCommand = Readonly<{
  format: "WORKSTATION_DEVICE_SESSION_REVOCATION_V1";
  requestId: string;
  sessionId: string;
  workstationId: string;
  credentialId: string;
  expectedRevision: string;
  cause: "ADMIN_REVOKED" | "CREDENTIAL_REVOKED" | "WORKSTATION_REVOKED";
}>;

export type DeviceSessionRevocationResult =
  | Readonly<{ ok: true; status: "REVOKED"; auditLogId: string } & typeof restrictions>
  | Readonly<{ ok: false; status: "REJECTED"; reason: "FORMAT_INVALID" | "NOT_FOUND" | "CAS_CONFLICT" | "REQUEST_REPLAY" | "PERSISTENCE_FAILURE" | "AUDIT_FAILURE" | "COMMIT_UNKNOWN" | "ROLLBACK_FAILED" } & typeof restrictions>;

function infrastructure(code: "DATABASE_UNAVAILABLE" | "PERSISTENCE_FAILURE" | "AUDIT_FAILURE" | "COMMIT_UNKNOWN" | "ROLLBACK_FAILED") {
  return new WorkstationLifecycleInfrastructureError(code);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

function isRevision(value: unknown): value is string {
  return typeof value === "string" && REVISION.test(value) && value !== "0000000000000000";
}

function isCounter(value: unknown): value is string {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,18})$/.test(value)) return false;
  try { return BigInt(value) <= 9_223_372_036_854_775_807n; } catch { return false; }
}

function asDateMs(value: unknown): number | null {
  if (!(value instanceof Date)) return null;
  const result = value.getTime();
  return Number.isSafeInteger(result) && result >= 0 ? result : null;
}

function asInt(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) >= 1 && Number(value) <= 2_147_483_647
    ? Number(value) : null;
}

function contextFor(tx: WorkstationLifecycleTransaction): TransactionContext {
  const context = contexts.get(tx as object);
  if (!context) throw infrastructure("PERSISTENCE_FAILURE");
  return context;
}

function request(deps: WorkstationSqlRepositoryDependencies, context: TransactionContext): WorkstationSqlRequest {
  return deps.createRequest(context.transaction);
}

function bind(
  sqlRequest: WorkstationSqlRequest,
  values: readonly Readonly<[string, unknown, unknown]>[],
): WorkstationSqlRequest {
  for (const [name, type, value] of values) sqlRequest.input(name, type, value);
  return sqlRequest;
}

function rowBoolean(value: unknown): boolean | null {
  return value === true || value === 1 ? true : value === false || value === 0 ? false : null;
}

async function acquireGate(deps: WorkstationSqlRepositoryDependencies, context: TransactionContext): Promise<void> {
  const result = await request(deps, context).query(workstationSessionRepositorySql.acquireGate);
  const gate = result.recordset[0]?.GateResult;
  if (!Number.isSafeInteger(gate) || Number(gate) < 0) throw infrastructure("PERSISTENCE_FAILURE");
}

async function ownedTransaction<T>(
  deps: WorkstationSqlRepositoryDependencies,
  work: (tx: WorkstationLifecycleTransaction) => Promise<T>,
): Promise<T> {
  let pool: unknown | null;
  try { pool = await deps.getPool(); }
  catch { throw infrastructure("DATABASE_UNAVAILABLE"); }
  if (!pool) throw infrastructure("DATABASE_UNAVAILABLE");
  let transaction: WorkstationSqlTransaction;
  try { transaction = deps.createTransaction(pool); }
  catch { throw infrastructure("DATABASE_UNAVAILABLE"); }
  const token = Object.freeze({ repositoryOwned: true }) as unknown as WorkstationLifecycleTransaction;
  const context: TransactionContext = {
    transaction, locked: null, request: null, mutation: null,
    auditLogId: null, auditAffectedRows: 0, decisionAffectedRows: 0,
  };
  let begun = false;
  let committing = false;
  try {
    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    begun = true;
    contexts.set(token as object, context);
    await acquireGate(deps, context);
    const result = await work(token);
    if (context.mutation && (context.auditAffectedRows !== 1 || context.decisionAffectedRows !== 1 ||
      !exactSqlBigintReceipt(context.auditLogId))) throw infrastructure("AUDIT_FAILURE");
    committing = true;
    await transaction.commit();
    if (context.mutation) {
      const assessment = assessWorkstationSqlCommit({
        commitOutcome: "COMMITTED", affectedRows: context.mutation.affectedRows,
        auditAffectedRows: context.auditAffectedRows, decisionAffectedRows: context.decisionAffectedRows,
        auditLogId: context.auditLogId,
      });
      if (!assessment.ok) throw infrastructure("COMMIT_UNKNOWN");
    }
    return result;
  } catch (error) {
    if (committing) throw infrastructure("COMMIT_UNKNOWN");
    if (begun) {
      try { await transaction.rollback(); }
      catch { throw infrastructure("ROLLBACK_FAILED"); }
    }
    if (error instanceof WorkstationLifecycleInfrastructureError) throw error;
    throw infrastructure("PERSISTENCE_FAILURE");
  } finally {
    contexts.delete(token as object);
  }
}

async function loadLockedDevice(
  deps: WorkstationSqlRepositoryDependencies,
  context: TransactionContext,
  sessionId: string,
): Promise<LockedDevice | null> {
  if (!isUuid(sessionId)) throw infrastructure("PERSISTENCE_FAILURE");
  const discovery = await bind(request(deps, context), [
    ["sessionId", sql.UniqueIdentifier, sessionId],
  ]).query(workstationSessionRepositorySql.discoverDevice);
  const hint = discovery.recordset[0];
  if (!hint) return null;
  const workstationId = hint.WorkstationId;
  const credentialId = typeof hint.CredentialId === "string" ? hint.CredentialId.toLowerCase() : null;
  if (!canonicalSqlBigInt(workstationId) || !isUuid(credentialId)) throw infrastructure("PERSISTENCE_FAILURE");

  const workstationResult = await bind(request(deps, context), [
    ["workstationId", sql.VarChar(20), workstationId],
  ]).query(workstationSessionRepositorySql.lockWorkstation);
  const credentialResult = await bind(request(deps, context), [
    ["credentialId", sql.UniqueIdentifier, credentialId],
  ]).query(workstationSessionRepositorySql.lockCredential);
  const deviceResult = await bind(request(deps, context), [
    ["sessionId", sql.UniqueIdentifier, sessionId],
  ]).query(workstationSessionRepositorySql.lockDevice);
  const workstation = workstationResult.recordset[0];
  const credential = credentialResult.recordset[0];
  const device = deviceResult.recordset[0];
  if (!workstation || !credential || !device) return null;

  const lockedWorkstationId = workstation.WorkstationId;
  const lockedCredentialId = typeof credential.CredentialId === "string" ? credential.CredentialId.toLowerCase() : null;
  const credentialWorkstationId = credential.WorkstationId;
  const lockedSessionId = typeof device.SessionId === "string" ? device.SessionId.toLowerCase() : null;
  const deviceWorkstationId = device.WorkstationId;
  const deviceCredentialId = typeof device.CredentialId === "string" ? device.CredentialId.toLowerCase() : null;
  if (lockedWorkstationId !== workstationId || credentialWorkstationId !== workstationId ||
      lockedCredentialId !== credentialId || lockedSessionId !== sessionId ||
      deviceWorkstationId !== workstationId || deviceCredentialId !== credentialId) {
    throw infrastructure("PERSISTENCE_FAILURE");
  }

  const issuedAtMs = asDateMs(device.CreatedAtUtc);
  const lastActivityAtMs = asDateMs(device.LastActivityAtUtc);
  const idleExpiresAtMs = asDateMs(device.IdleExpiresAtUtc);
  const absoluteExpiresAtMs = asDateMs(device.AbsoluteExpiresAtUtc);
  const workstationActive = rowBoolean(workstation.IsActive);
  const workstationCredentialVersion = asInt(workstation.CredentialVersion);
  const credentialRevoked = rowBoolean(credential.IsRevoked);
  const credentialVersion = asInt(credential.CredentialVersion);
  const boundCredentialVersion = asInt(device.BoundCredentialVersion);
  const proofHash = Buffer.isBuffer(device.SessionProofHash) && device.SessionProofHash.length === 32
    ? Buffer.from(device.SessionProofHash) : null;
  const rowVersion = typeof device.RowVersion === "string" ? device.RowVersion.toLowerCase() : null;
  if (issuedAtMs === null || lastActivityAtMs === null || idleExpiresAtMs === null || absoluteExpiresAtMs === null ||
      workstationActive === null || workstationCredentialVersion === null || credentialRevoked === null ||
      credentialVersion === null || boundCredentialVersion === null || !proofHash ||
      !isRevision(rowVersion) || !isCounter(device.RenewalCounter)) {
    throw infrastructure("PERSISTENCE_FAILURE");
  }
  const locked: LockedDevice = Object.freeze({
    snapshot: Object.freeze({
      format: "WORKSTATION_DEVICE_SESSION_SNAPSHOT_V1",
      sessionId, workstationId, credentialId,
      sessionState: device.RevokedAtUtc === null ? "ACTIVE" : "REVOKED",
      sessionRevision: rowVersion,
      renewalCounter: device.RenewalCounter,
      boundCredentialVersion,
      issuedAtMs, lastActivityAtMs, idleExpiresAtMs, absoluteExpiresAtMs,
      workstationActive,
      workstationRetired: workstation.RetiredAtUtc !== null,
      workstationCredentialVersion,
      credentialRevoked,
      credentialVersion,
    }),
    proofHash,
  });
  context.locked = locked;
  return locked;
}

function digestFor(
  operation: RequestEvidence["operation"],
  sessionId: string,
  workstationId: string,
  revision: string,
  discriminator: string,
): string {
  return createHash("sha256").update(JSON.stringify([
    "WORKSTATION_SESSION_SQL_REQUEST_V1", operation, sessionId, workstationId, revision, discriminator,
  ])).digest("hex");
}

async function reserveRequest(
  deps: WorkstationSqlRepositoryDependencies,
  context: TransactionContext,
  evidence: RequestEvidence,
): Promise<"CLAIMED" | "REPLAY" | "CONFLICT"> {
  if (!isUuid(evidence.requestId) || !DIGEST.test(evidence.digest)) throw infrastructure("PERSISTENCE_FAILURE");
  const existing = await bind(request(deps, context), [
    ["requestId", sql.UniqueIdentifier, evidence.requestId],
  ]).query(workstationSessionRepositorySql.readRequest);
  const row = existing.recordset[0];
  if (row) {
    return row.RequestDigest === evidence.digest && row.OperationCode === evidence.operation &&
      row.WorkstationId === context.locked?.snapshot.workstationId &&
      String(row.DeviceSessionId).toLowerCase() === context.locked?.snapshot.sessionId
      ? "REPLAY" : "CONFLICT";
  }
  const locked = context.locked;
  if (!locked) throw infrastructure("PERSISTENCE_FAILURE");
  const inserted = await bind(request(deps, context), [
    ["requestId", sql.UniqueIdentifier, evidence.requestId],
    ["workstationId", sql.VarChar(20), locked.snapshot.workstationId],
    ["deviceSessionId", sql.UniqueIdentifier, locked.snapshot.sessionId],
    ["operation", sql.NVarChar(32), evidence.operation],
    ["requestDigest", sql.VarChar(64), evidence.digest],
  ]).query(workstationSessionRepositorySql.insertRequest);
  if (inserted.recordset.length !== 1 ||
      String(inserted.recordset[0]?.RequestId).toLowerCase() !== evidence.requestId) {
    throw infrastructure("PERSISTENCE_FAILURE");
  }
  context.request = evidence;
  return "CLAIMED";
}

async function ensureRenewalRequest(
  deps: WorkstationSqlRepositoryDependencies,
  context: TransactionContext,
  revision: string,
  counter: string,
): Promise<void> {
  if (context.request) return;
  const locked = context.locked;
  if (!locked) throw infrastructure("PERSISTENCE_FAILURE");
  const requestId = deps.newUuid().toLowerCase();
  const evidence: RequestEvidence = Object.freeze({
    requestId,
    operation: "DEVICE_RENEW",
    digest: digestFor("DEVICE_RENEW", locked.snapshot.sessionId, locked.snapshot.workstationId, revision, counter),
  });
  if (await reserveRequest(deps, context, evidence) !== "CLAIMED") throw infrastructure("PERSISTENCE_FAILURE");
}

async function writeAuditAndDecision(
  deps: WorkstationSqlRepositoryDependencies,
  context: TransactionContext,
  event: SqlAuditEvent,
): Promise<string> {
  const locked = context.locked;
  if (context.auditLogId !== null) throw infrastructure("AUDIT_FAILURE");
  if (locked && (event.sessionId !== locked.snapshot.sessionId ||
      event.workstationId !== locked.snapshot.workstationId ||
      event.credentialId !== locked.snapshot.credentialId)) throw infrastructure("AUDIT_FAILURE");
  if (context.mutation) {
    const expectedEvent = context.request?.operation === "DEVICE_REVOKE"
      ? "WORKSTATION_DEVICE_SESSION_REVOKED" : "WORKSTATION_DEVICE_SESSION_RENEWED";
    if (event.status !== "SUCCESS" || event.reason !== null || event.eventType !== expectedEvent) {
      throw infrastructure("AUDIT_FAILURE");
    }
  } else if (event.status !== "FAILED" || event.reason === null) {
    throw infrastructure("AUDIT_FAILURE");
  }
  if (locked && !context.request) {
    await ensureRenewalRequest(deps, context, locked.snapshot.sessionRevision, event.renewalCounter);
  }
  const parameters = JSON.stringify({
    contract: "WORKSTATION_SESSION_AUDIT_V1",
    requestId: context.request?.requestId ?? null,
    deviceSessionId: event.sessionId,
    workstationId: event.workstationId,
    reason: event.reason,
  });
  let auditResult: QueryResult;
  try {
    auditResult = await bind(request(deps, context), [
      ["eventType", sql.NVarChar(50), event.eventType],
      ["status", sql.NVarChar(20), event.status],
      ["parameters", sql.NVarChar(sql.MAX), parameters],
    ]).query(workstationSessionRepositorySql.insertAudit);
  } catch {
    throw infrastructure("AUDIT_FAILURE");
  }
  const auditLogId = auditResult.recordset[0]?.AuditLogId;
  if (!exactSqlBigintReceipt(auditLogId) || auditResult.recordset.length !== 1) throw infrastructure("AUDIT_FAILURE");
  context.auditLogId = auditLogId;
  context.auditAffectedRows = 1;

  if (!locked || !context.request) return auditLogId;
  const success = context.mutation !== null && event.status === "SUCCESS";
  const previousRevision = context.mutation?.previousRevision ?? locked.snapshot.sessionRevision;
  const nextRevision = success ? context.mutation!.nextRevision : null;
  let decisionResult: QueryResult;
  const correlationId = deps.newUuid().toLowerCase();
  if (!isUuid(correlationId) || event.eventType.length < 1 || event.eventType.length > 50 ||
      (event.reason !== null && (event.reason.length < 1 || event.reason.length > 64))) {
    throw infrastructure("AUDIT_FAILURE");
  }
  try {
    decisionResult = await bind(request(deps, context), [
      ["requestId", sql.UniqueIdentifier, context.request.requestId],
      ["workstationId", sql.VarChar(20), locked.snapshot.workstationId],
      ["deviceSessionId", sql.UniqueIdentifier, locked.snapshot.sessionId],
      ["operation", sql.NVarChar(32), context.request.operation],
      ["decisionStatus", sql.NVarChar(12), success ? "SUCCESS" : "REJECTED"],
      ["reason", sql.NVarChar(64), success ? null : event.reason ?? "PERSISTENCE_FAILURE"],
      ["previousRevision", sql.VarChar(16), previousRevision],
      ["nextRevision", sql.VarChar(16), nextRevision],
      ["auditLogId", sql.VarChar(20), auditLogId],
      ["eventType", sql.NVarChar(50), event.eventType],
      ["correlationId", sql.UniqueIdentifier, correlationId],
    ]).query(workstationSessionRepositorySql.insertDecision);
  } catch {
    throw infrastructure("AUDIT_FAILURE");
  }
  if (decisionResult.recordset.length !== 1 ||
      String(decisionResult.recordset[0]?.RequestId).toLowerCase() !== context.request.requestId) {
    throw infrastructure("AUDIT_FAILURE");
  }
  context.decisionAffectedRows = 1;
  return auditLogId;
}

function exactObject(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const actual = Object.keys(descriptors).sort();
  const expected = [...keys].sort();
  return Object.getOwnPropertySymbols(value).length === 0 && actual.length === expected.length &&
    actual.every((key, index) => key === expected[index]) &&
    Object.values(descriptors).every(descriptor => "value" in descriptor && descriptor.enumerable);
}

function isRevocationCommand(value: unknown): value is DeviceSessionRevocationCommand {
  if (!exactObject(value, ["format", "requestId", "sessionId", "workstationId", "credentialId", "expectedRevision", "cause"])) return false;
  return value.format === "WORKSTATION_DEVICE_SESSION_REVOCATION_V1" &&
    isUuid(value.requestId) && isUuid(value.sessionId) && canonicalSqlBigInt(value.workstationId) &&
    isUuid(value.credentialId) && isRevision(value.expectedRevision) &&
    (value.cause === "ADMIN_REVOKED" || value.cause === "CREDENTIAL_REVOKED" || value.cause === "WORKSTATION_REVOKED");
}

type RevocationReason = Extract<DeviceSessionRevocationResult, { ok: false }>["reason"];

function rejected(reason: RevocationReason): DeviceSessionRevocationResult {
  return Object.freeze({ ok: false, status: "REJECTED", reason, ...restrictions });
}

export function createWorkstationSessionSqlRepository(
  deps: WorkstationSqlRepositoryDependencies = defaults,
) {
  const repository: WorkstationDeviceSessionRepository = Object.freeze({
    transaction<T>(work: (tx: WorkstationLifecycleTransaction) => Promise<T>): Promise<T> {
      return ownedTransaction(deps, work);
    },
    async readForRenewal(sessionId: string, tx: WorkstationLifecycleTransaction) {
      return (await loadLockedDevice(deps, contextFor(tx), sessionId))?.snapshot ?? null;
    },
    async compareAndSwapRenewal(mutation: DeviceSessionRenewalMutation, tx: WorkstationLifecycleTransaction) {
      const context = contextFor(tx);
      const locked = context.locked;
      if (!locked || mutation.sessionId !== locked.snapshot.sessionId ||
          mutation.workstationId !== locked.snapshot.workstationId ||
          mutation.credentialId !== locked.snapshot.credentialId ||
          mutation.expectedRevision !== locked.snapshot.sessionRevision ||
          mutation.expectedRenewalCounter !== locked.snapshot.renewalCounter ||
          !isCounter(mutation.nextRenewalCounter) ||
          BigInt(mutation.nextRenewalCounter) !== BigInt(mutation.expectedRenewalCounter) + 1n) {
        throw infrastructure("PERSISTENCE_FAILURE");
      }
      await ensureRenewalRequest(deps, context, mutation.expectedRevision, mutation.expectedRenewalCounter);
      const result = await bind(request(deps, context), [
        ["sessionId", sql.UniqueIdentifier, mutation.sessionId],
        ["workstationId", sql.VarChar(20), mutation.workstationId],
        ["credentialId", sql.UniqueIdentifier, mutation.credentialId],
        ["expectedRevision", sql.VarChar(16), mutation.expectedRevision],
        ["expectedCounter", sql.VarChar(20), mutation.expectedRenewalCounter],
        ["nextCounter", sql.VarChar(20), mutation.nextRenewalCounter],
        ["lastActivityUtc", sql.DateTime2(3), new Date(mutation.lastActivityAtMs)],
        ["idleExpiresUtc", sql.DateTime2(3), new Date(mutation.idleExpiresAtMs)],
      ]).query(deviceRenewalCasSql);
      const nextRevision = typeof result.recordset[0]?.NewRevision === "string"
        ? String(result.recordset[0]!.NewRevision).toLowerCase() : null;
      if (!nextRevision) return Object.freeze({ affectedRows: 0 as const });
      if (!isRevision(nextRevision) || nextRevision === mutation.expectedRevision || result.recordset.length !== 1) {
        throw infrastructure("PERSISTENCE_FAILURE");
      }
      context.mutation = Object.freeze({
        previousRevision: mutation.expectedRevision,
        nextRevision,
        affectedRows: 1,
      });
      return Object.freeze({ affectedRows: 1 as const, newRevision: nextRevision });
    },
  });

  const audit: WorkstationSessionAuditWriter = Object.freeze({
    async write(event: DeviceSessionRenewalAudit, tx: WorkstationLifecycleTransaction) {
      const context = contextFor(tx);
      return Object.freeze({ auditLogId: await writeAuditAndDecision(deps, context, event) });
    },
  });

  const credentialProof: WorkstationCredentialProofVerifier = Object.freeze({
    async verify(
      requestValue: DeviceSessionRenewalRequest,
      snapshot: DeviceSessionRenewalSnapshot,
      tx: WorkstationLifecycleTransaction,
    ) {
      const context = contextFor(tx);
      if (!context.locked || context.locked.snapshot !== snapshot || requestValue.sessionId !== snapshot.sessionId) return false;
      const digest = createHash("sha256").update(requestValue.credentialProof, "utf8").digest();
      return digest.length === context.locked.proofHash.length && timingSafeEqual(digest, context.locked.proofHash);
    },
  });

  async function revokeDevice(input: unknown): Promise<DeviceSessionRevocationResult> {
    if (!isRevocationCommand(input)) return rejected("FORMAT_INVALID");
    try {
      return await ownedTransaction(deps, async tx => {
        const context = contextFor(tx);
        const locked = await loadLockedDevice(deps, context, input.sessionId);
        if (!locked) return rejected("NOT_FOUND");
        if (locked.snapshot.workstationId !== input.workstationId || locked.snapshot.credentialId !== input.credentialId ||
            locked.snapshot.sessionRevision !== input.expectedRevision) return rejected("CAS_CONFLICT");
        const claim: RequestEvidence = Object.freeze({
          requestId: input.requestId,
          operation: "DEVICE_REVOKE",
          digest: digestFor("DEVICE_REVOKE", input.sessionId, input.workstationId, input.expectedRevision, input.cause),
        });
        if (await reserveRequest(deps, context, claim) !== "CLAIMED") return rejected("REQUEST_REPLAY");
        const mutation = await bind(request(deps, context), [
          ["reason", sql.NVarChar(64), input.cause],
          ["sessionId", sql.UniqueIdentifier, input.sessionId],
          ["workstationId", sql.VarChar(20), input.workstationId],
          ["credentialId", sql.UniqueIdentifier, input.credentialId],
          ["expectedRevision", sql.VarChar(16), input.expectedRevision],
        ]).query(workstationSessionRepositorySql.revokeDevice);
        const nextRevision = typeof mutation.recordset[0]?.NewRevision === "string"
          ? String(mutation.recordset[0]!.NewRevision).toLowerCase() : null;
        if (!nextRevision) {
          await writeAuditAndDecision(deps, context, Object.freeze({
            eventType: "WORKSTATION_DEVICE_SESSION_REVOCATION_REJECTED", status: "FAILED",
            reason: "SESSION_REVISION_CONFLICT", sessionId: input.sessionId,
            workstationId: input.workstationId, credentialId: input.credentialId,
            renewalCounter: locked.snapshot.renewalCounter,
          }));
          return rejected("CAS_CONFLICT");
        }
        if (!isRevision(nextRevision) || nextRevision === input.expectedRevision || mutation.recordset.length !== 1) {
          throw infrastructure("PERSISTENCE_FAILURE");
        }
        if (input.cause === "CREDENTIAL_REVOKED") {
          await bind(request(deps, context), [
            ["workstationId", sql.VarChar(20), input.workstationId],
            ["credentialId", sql.UniqueIdentifier, input.credentialId],
          ]).query(workstationSessionRepositorySql.revokeCredentialSessions);
        } else if (input.cause === "WORKSTATION_REVOKED") {
          await bind(request(deps, context), [
            ["workstationId", sql.VarChar(20), input.workstationId],
          ]).query(workstationSessionRepositorySql.revokeWorkstationSessions);
        }
        await bind(request(deps, context), [
          ["workstationId", sql.VarChar(20), input.workstationId],
          ["sessionId", sql.UniqueIdentifier, input.sessionId],
        ]).query(workstationSessionRepositorySql.revokeDependents);
        context.mutation = Object.freeze({ previousRevision: input.expectedRevision, nextRevision, affectedRows: 1 });
        const auditLogId = await writeAuditAndDecision(deps, context, Object.freeze({
          eventType: "WORKSTATION_DEVICE_SESSION_REVOKED",
          status: "SUCCESS",
          reason: null,
          sessionId: input.sessionId,
          workstationId: input.workstationId,
          credentialId: input.credentialId,
          renewalCounter: locked.snapshot.renewalCounter,
        }));
        return Object.freeze({ ok: true, status: "REVOKED", auditLogId, ...restrictions });
      });
    } catch (error) {
      const code = error instanceof WorkstationLifecycleInfrastructureError ? error.code : "PERSISTENCE_FAILURE";
      return rejected(code === "DATABASE_UNAVAILABLE" ? "PERSISTENCE_FAILURE" : code);
    }
  }

  return Object.freeze({
    repository,
    audit,
    credentialProof,
    revokeDevice,
    runtimeEnabled: false as const,
  });
}
