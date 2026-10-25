import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import sql from "mssql";
import { getPlatformDbPool } from "../../config/database.js";
import type {
  OperatorPinFailureMutation,
  OperatorSwitchAudit,
  OperatorSwitchLookup,
  OperatorSwitchMutation,
  OperatorSwitchSnapshot,
} from "./workstationOperatorSwitch.js";
import {
  OperatorSwitchInfrastructureError,
  type OperatorSwitchTransaction,
  type WorkstationOperatorSwitchAuditWriter,
  type WorkstationOperatorSwitchRepository,
  type WorkstationPinVerifier,
} from "./workstationOperatorSwitch.ports.js";
import type {
  WorkstationSqlRepositoryDependencies,
  WorkstationSqlRequest,
  WorkstationSqlTransaction,
} from "./workstationSessionSql.repository.js";
import { exactSqlBigintReceipt } from "./workstationSqlCommitGate.js";
import { workstationOperatorRepositorySql, workstationSessionRepositorySql } from "./workstationSessionSqlStatements.js";
import type { WorkstationSession } from "./workstationSessionContract.js";

type QueryResult = Awaited<ReturnType<WorkstationSqlRequest["query"]>>;
type Dependencies = WorkstationSqlRepositoryDependencies & Readonly<{
  comparePin: (pin: string, hash: string) => Promise<boolean>;
  now: () => number;
}>;

const defaults: Dependencies = Object.freeze({
  getPool: getPlatformDbPool as () => Promise<unknown | null>,
  createTransaction: pool => new sql.Transaction(pool as sql.ConnectionPool) as unknown as WorkstationSqlTransaction,
  createRequest: transaction => new sql.Request(transaction as unknown as sql.Transaction) as unknown as WorkstationSqlRequest,
  newUuid: randomUUID,
  comparePin: (pin, hash) => bcrypt.compare(pin, hash),
  now: Date.now,
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const REVISION = /^[0-9a-f]{16}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const PERMISSION = /^[A-Z][A-Z0-9_]{0,99}$/;
const SQL_BIGINT_MAX = 9_223_372_036_854_775_807n;
const JS_SAFE_MAX = BigInt(Number.MAX_SAFE_INTEGER);

type LockedEvidence = Readonly<{
  snapshot: OperatorSwitchSnapshot;
  pinHash: string;
  targetUserIdText: string;
}>;

type MutationEvidence = Readonly<{
  domain: "PIN_ATTEMPT" | "OPERATOR_STATE";
  previousRevision: string;
  nextRevision: string;
  previousGeneration: string;
  nextGeneration: string | null;
  previousIncarnation: string;
  nextIncarnation: string | null;
}>;

type Context = {
  transaction: WorkstationSqlTransaction;
  locked: LockedEvidence | null;
  requestId: string | null;
  requestDigest: string | null;
  requestFresh: boolean;
  mutation: MutationEvidence | null;
  auditLogId: string | null;
  decisionWritten: boolean;
};

const contexts = new WeakMap<object, Context>();

function failure(code: "DATABASE_UNAVAILABLE" | "PERSISTENCE_FAILURE" | "AUDIT_FAILURE" | "COMMIT_UNKNOWN" | "ROLLBACK_FAILED") {
  return new OperatorSwitchInfrastructureError(code);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

function isRevision(value: unknown): value is string {
  return typeof value === "string" && REVISION.test(value) && value !== "0000000000000000";
}

function canonicalBigInt(value: unknown, allowZero = false): value is string {
  if (typeof value !== "string" || !(allowZero ? /^(0|[1-9][0-9]{0,18})$/ : /^[1-9][0-9]{0,18}$/).test(value)) return false;
  try {
    const parsed = BigInt(value);
    return parsed <= SQL_BIGINT_MAX && (allowZero || parsed > 0n);
  } catch { return false; }
}

function safeNumber(value: unknown, allowZero = false): number | null {
  if (!canonicalBigInt(value, allowZero)) return null;
  const parsed = BigInt(value);
  return parsed <= JS_SAFE_MAX ? Number(parsed) : null;
}

function int(value: unknown, minimum = 1): number | null {
  return Number.isSafeInteger(value) && Number(value) >= minimum && Number(value) <= 2_147_483_647
    ? Number(value) : null;
}

function bit(value: unknown): boolean | null {
  return value === true || value === 1 ? true : value === false || value === 0 ? false : null;
}

function dateMs(value: unknown): number | null {
  if (!(value instanceof Date)) return null;
  const ms = value.getTime();
  return Number.isSafeInteger(ms) && ms >= 0 ? ms : null;
}

function contextFor(tx: OperatorSwitchTransaction): Context {
  const context = contexts.get(tx as object);
  if (!context) throw failure("PERSISTENCE_FAILURE");
  return context;
}

function request(deps: Dependencies, context: Context): WorkstationSqlRequest {
  return deps.createRequest(context.transaction);
}

function bind(req: WorkstationSqlRequest, values: readonly Readonly<[string, unknown, unknown]>[]): WorkstationSqlRequest {
  for (const [name, type, value] of values) req.input(name, type, value);
  return req;
}

async function ownedTransaction<T>(deps: Dependencies, work: (tx: OperatorSwitchTransaction) => Promise<T>): Promise<T> {
  let pool: unknown | null;
  try { pool = await deps.getPool(); } catch { throw failure("DATABASE_UNAVAILABLE"); }
  if (!pool) throw failure("DATABASE_UNAVAILABLE");
  let transaction: WorkstationSqlTransaction;
  try { transaction = deps.createTransaction(pool); } catch { throw failure("DATABASE_UNAVAILABLE"); }
  const token = Object.freeze({ operatorSqlOwner: true }) as unknown as OperatorSwitchTransaction;
  const context: Context = {
    transaction, locked: null, requestId: null, requestDigest: null,
    requestFresh: false, mutation: null, auditLogId: null, decisionWritten: false,
  };
  let begun = false;
  let committing = false;
  try {
    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    begun = true;
    contexts.set(token as object, context);
    const gate = await request(deps, context).query(workstationSessionRepositorySql.acquireGate);
    const gateResult = gate.recordset[0]?.GateResult;
    if (!Number.isSafeInteger(gateResult) || Number(gateResult) < 0) throw failure("PERSISTENCE_FAILURE");
    const result = await work(token);
    if (context.mutation && (!exactSqlBigintReceipt(context.auditLogId) || !context.decisionWritten)) {
      throw failure("AUDIT_FAILURE");
    }
    committing = true;
    await transaction.commit();
    return result;
  } catch (error) {
    if (committing) throw failure("COMMIT_UNKNOWN");
    if (begun) {
      try { await transaction.rollback(); } catch { throw failure("ROLLBACK_FAILED"); }
    }
    if (error instanceof OperatorSwitchInfrastructureError) throw error;
    throw failure("PERSISTENCE_FAILURE");
  } finally {
    contexts.delete(token as object);
  }
}

async function queryOne(
  deps: Dependencies,
  context: Context,
  statement: string,
  values: readonly Readonly<[string, unknown, unknown]>[] = [],
): Promise<Record<string, unknown> | null> {
  const result = await bind(request(deps, context), values).query(statement);
  if (result.recordset.length > 1) throw failure("PERSISTENCE_FAILURE");
  return result.recordset[0] ?? null;
}

async function readSnapshot(
  deps: Dependencies,
  context: Context,
  lookup: OperatorSwitchLookup,
): Promise<OperatorSwitchSnapshot | null> {
  if (!isUuid(lookup.deviceSessionId) || !canonicalBigInt(lookup.workstationId) ||
      !Number.isSafeInteger(lookup.targetUserId) || lookup.targetUserId <= 0) return null;
  const userId = String(lookup.targetUserId);
  const discovery = await queryOne(deps, context, workstationSessionRepositorySql.discoverDevice, [
    ["sessionId", sql.UniqueIdentifier, lookup.deviceSessionId],
  ]);
  if (!discovery || discovery.WorkstationId !== lookup.workstationId) return null;
  const credentialId = typeof discovery.CredentialId === "string" ? discovery.CredentialId.toLowerCase() : null;
  if (!isUuid(credentialId)) return null;

  const policy = await queryOne(deps, context, workstationOperatorRepositorySql.lockPolicy);
  const user = await queryOne(deps, context, workstationOperatorRepositorySql.lockUser, [
    ["userId", sql.VarChar(20), userId],
  ]);
  const permissionsResult = await bind(request(deps, context), [
    ["userId", sql.VarChar(20), userId],
  ]).query(workstationOperatorRepositorySql.readPermissions);
  const workstation = await queryOne(deps, context, workstationOperatorRepositorySql.lockWorkstation, [
    ["workstationId", sql.VarChar(20), lookup.workstationId],
  ]);
  const access = await queryOne(deps, context, workstationOperatorRepositorySql.lockAccess, [
    ["workstationId", sql.VarChar(20), lookup.workstationId], ["userId", sql.VarChar(20), userId],
  ]);
  const credential = await queryOne(deps, context, workstationSessionRepositorySql.lockCredential, [
    ["credentialId", sql.UniqueIdentifier, credentialId],
  ]);
  const device = await queryOne(deps, context, workstationSessionRepositorySql.lockDevice, [
    ["sessionId", sql.UniqueIdentifier, lookup.deviceSessionId],
  ]);
  const pin = await queryOne(deps, context, workstationOperatorRepositorySql.lockPin, [
    ["userId", sql.VarChar(20), userId],
  ]);
  const binding = await queryOne(deps, context, workstationOperatorRepositorySql.lockPinBinding, [
    ["userId", sql.VarChar(20), userId],
  ]);
  const attempt = await queryOne(deps, context, workstationOperatorRepositorySql.lockPinAttempt, [
    ["userId", sql.VarChar(20), userId],
  ]);
  await bind(request(deps, context), [
    ["workstationId", sql.VarChar(20), lookup.workstationId],
  ]).query(workstationOperatorRepositorySql.lockLegacyOperatorRange);
  const operator = await queryOne(deps, context, workstationOperatorRepositorySql.lockOperatorState, [
    ["workstationId", sql.VarChar(20), lookup.workstationId],
  ]);
  if (!policy || !user || !workstation || !access || !credential || !device || !pin || !binding || !attempt || !operator) return null;

  const pinLength = int(policy.PinLength, 4);
  const policyRevision = policy.PolicyRevision;
  const userIdFromDb = safeNumber(user.UserId);
  const userActive = bit(user.IsActive);
  const tokenVersion = int(user.TokenVersion);
  const workstationActive = bit(workstation.IsActive);
  const pinLoginEnabled = bit(workstation.PinLoginEnabled);
  const workstationVersion = int(workstation.CredentialVersion);
  const allowed = bit(access.IsAllowed);
  const credentialVersion = int(credential.CredentialVersion);
  const credentialRevoked = bit(credential.IsRevoked);
  const boundCredentialVersion = int(device.BoundCredentialVersion);
  const issuedAtMs = dateMs(device.CreatedAtUtc);
  const lastActivityAtMs = dateMs(device.LastActivityAtUtc);
  const idleExpiresAtMs = dateMs(device.IdleExpiresAtUtc);
  const absoluteExpiresAtMs = dateMs(device.AbsoluteExpiresAtUtc);
  const deviceRevision = typeof device.RowVersion === "string" ? device.RowVersion.toLowerCase() : null;
  const renewalCounter = device.RenewalCounter;
  const pinVersion = int(pin.PinVersion);
  const pinEnabled = bit(pin.IsEnabled);
  const bindingPinVersion = int(binding.PinVersion);
  const boundTokenVersion = int(binding.BoundTokenVersion);
  const boundPolicyRevision = binding.BoundPolicyRevision;
  const attemptPinVersion = int(attempt.BoundPinVersion);
  const attemptPolicyRevision = attempt.BoundPolicyRevision;
  const failedAttempts = int(attempt.FailedAttempts, 0);
  const attemptRevision = typeof attempt.RowVersion === "string" ? attempt.RowVersion.toLowerCase() : null;
  const generation = safeNumber(operator.Generation, true);
  const operatorRevision = typeof operator.RowVersion === "string" ? operator.RowVersion.toLowerCase() : null;
  const incarnation = typeof operator.Incarnation === "string" ? operator.Incarnation.toLowerCase() : null;
  const state = operator.StateCode;
  const operatorSessionId = operator.OperatorSessionId;
  const operatorUserId = operator.OperatorUserId === null ? null : safeNumber(operator.OperatorUserId);
  const permissions = permissionsResult.recordset.map(row => row.Code);
  const pinHash = typeof pin.PinHash === "string" ? pin.PinHash : null;

  if (pinLength === null || pinLength > 12 || !canonicalBigInt(policyRevision) ||
      userIdFromDb !== lookup.targetUserId || userActive === null || tokenVersion === null || workstationActive === null ||
      pinLoginEnabled === null || workstationVersion === null || allowed === null ||
      credential.WorkstationId !== lookup.workstationId || String(credential.CredentialId).toLowerCase() !== credentialId ||
      credentialVersion === null || credentialRevoked === null ||
      String(device.SessionId).toLowerCase() !== lookup.deviceSessionId || device.WorkstationId !== lookup.workstationId ||
      String(device.CredentialId).toLowerCase() !== credentialId || boundCredentialVersion === null ||
      issuedAtMs === null || lastActivityAtMs === null || idleExpiresAtMs === null || absoluteExpiresAtMs === null ||
      !isRevision(deviceRevision) || !canonicalBigInt(renewalCounter, true) ||
      pin.UserId !== userId || binding.UserId !== userId || attempt.UserId !== userId ||
      pinVersion === null || pinEnabled === null || bindingPinVersion !== pinVersion || boundTokenVersion === null ||
      !canonicalBigInt(boundPolicyRevision) || attemptPinVersion !== pinVersion ||
      attemptPolicyRevision !== boundPolicyRevision || !canonicalBigInt(attemptPolicyRevision) ||
      failedAttempts === null || !isRevision(attemptRevision) || generation === null ||
      operator.WorkstationId !== lookup.workstationId || String(operator.DeviceSessionId).toLowerCase() !== lookup.deviceSessionId ||
      !isRevision(operatorRevision) || !isUuid(incarnation) || !pinHash ||
      (state !== "OPERATOR_ACTIVE" && (operatorSessionId !== null || operator.TokenVersion !== null ||
        operator.PinVersion !== null || operator.AuthMethod !== null)) ||
      permissions.length > 256 || permissions.some(code => typeof code !== "string" || !PERMISSION.test(code)) ||
      permissions.some((code, index) => index > 0 && String(permissions[index - 1]) >= String(code))) return null;

  let session: WorkstationSession | null = null;
  if (state === "OPERATOR_ACTIVE" && operatorUserId !== null) {
    session = { state, operatorUserId, generation };
  } else if (state === "DEVICE_READY" || state === "OPERATOR_LOCKED" || state === "DEVICE_REVOKED") {
    session = { state, operatorUserId: null, generation };
  }
  if (!session || (state !== "OPERATOR_ACTIVE" && operatorUserId !== null)) return null;
  const snapshot: OperatorSwitchSnapshot = Object.freeze({
    format: "WORKSTATION_OPERATOR_SWITCH_SNAPSHOT_V1",
    deviceSession: Object.freeze({
      format: "WORKSTATION_DEVICE_SESSION_SNAPSHOT_V1",
      sessionId: lookup.deviceSessionId, workstationId: lookup.workstationId, credentialId,
      sessionState: device.RevokedAtUtc === null ? "ACTIVE" : "REVOKED",
      sessionRevision: deviceRevision, renewalCounter, boundCredentialVersion,
      issuedAtMs, lastActivityAtMs, idleExpiresAtMs, absoluteExpiresAtMs,
      workstationActive, workstationRetired: workstation.RetiredAtUtc !== null,
      workstationCredentialVersion: workstationVersion, credentialRevoked, credentialVersion,
    }),
    workstationPinEnabled: pinLoginEnabled,
    workstationAllowsUser: allowed,
    operator: Object.freeze({ revision: operatorRevision, incarnation, session: Object.freeze(session), previousOperatorUserId: operatorUserId }),
    targetUser: Object.freeze({ id: userIdFromDb, active: userActive, tokenVersion, permissions: Object.freeze(permissions as string[]) }),
    pin: Object.freeze({
      enabled: pinEnabled, version: pinVersion, boundTokenVersion,
      boundPolicyRevision, revision: attemptRevision, failedAttempts,
      attemptWindowStartedAtMs: attempt.AttemptWindowStartedAtUtc === null ? null : dateMs(attempt.AttemptWindowStartedAtUtc),
      lockedUntilMs: attempt.LockedUntilUtc === null ? null : dateMs(attempt.LockedUntilUtc),
    }),
    pinPolicy: Object.freeze({ length: pinLength, revision: policyRevision }),
  });
  context.locked = Object.freeze({ snapshot, pinHash, targetUserIdText: userId });
  return snapshot;
}

async function claimRequest(
  deps: Dependencies,
  context: Context,
  requestId: string,
  requestDigest: string,
): Promise<"CLAIMED" | "REPLAY" | "CONFLICT"> {
  if (!context.locked || !isUuid(requestId) || !DIGEST.test(requestDigest)) throw failure("PERSISTENCE_FAILURE");
  const existing = await queryOne(deps, context, workstationSessionRepositorySql.readRequest, [
    ["requestId", sql.UniqueIdentifier, requestId],
  ]);
  if (existing) {
    return existing.RequestDigest === requestDigest && existing.OperationCode === "OPERATOR_SWITCH" &&
      existing.WorkstationId === context.locked.snapshot.deviceSession.workstationId &&
      String(existing.DeviceSessionId).toLowerCase() === context.locked.snapshot.deviceSession.sessionId
      ? "REPLAY" : "CONFLICT";
  }
  const inserted = await bind(request(deps, context), [
    ["requestId", sql.UniqueIdentifier, requestId],
    ["workstationId", sql.VarChar(20), context.locked.snapshot.deviceSession.workstationId],
    ["deviceSessionId", sql.UniqueIdentifier, context.locked.snapshot.deviceSession.sessionId],
    ["requestDigest", sql.VarChar(64), requestDigest],
    ["targetUserId", sql.VarChar(20), context.locked.targetUserIdText],
  ]).query(workstationOperatorRepositorySql.insertRequest);
  if (inserted.recordset.length !== 1 || String(inserted.recordset[0]?.RequestId).toLowerCase() !== requestId) {
    throw failure("PERSISTENCE_FAILURE");
  }
  context.requestId = requestId;
  context.requestDigest = requestDigest;
  context.requestFresh = true;
  return "CLAIMED";
}

async function writeAudit(deps: Dependencies, context: Context, event: OperatorSwitchAudit): Promise<string> {
  if (context.auditLogId !== null || event.targetUserId !== context.locked?.snapshot.targetUser.id ||
      event.deviceSessionId !== context.locked?.snapshot.deviceSession.sessionId ||
      event.workstationId !== context.locked?.snapshot.deviceSession.workstationId) throw failure("AUDIT_FAILURE");
  if (context.mutation?.domain === "OPERATOR_STATE" && (event.status !== "SUCCESS" || event.reason !== null)) throw failure("AUDIT_FAILURE");
  if (context.mutation?.domain === "PIN_ATTEMPT" && (event.status !== "FAILED" || (event.reason !== "INVALID_PIN" && event.reason !== "PIN_LOCKED"))) {
    throw failure("AUDIT_FAILURE");
  }
  if (!context.mutation && event.status !== "FAILED") throw failure("AUDIT_FAILURE");
  const parameters = JSON.stringify({
    contract: "WORKSTATION_OPERATOR_AUDIT_V1", requestId: event.requestId,
    deviceSessionId: event.deviceSessionId, workstationId: event.workstationId,
    reason: event.reason, previousGeneration: event.previousGeneration, nextGeneration: event.nextGeneration,
  });
  let audit: QueryResult;
  try {
    audit = await bind(request(deps, context), [
      ["eventType", sql.NVarChar(50), event.eventType],
      ["actorUserId", sql.VarChar(20), context.locked.targetUserIdText],
      ["status", sql.NVarChar(20), event.status], ["parameters", sql.NVarChar(sql.MAX), parameters],
    ]).query(workstationOperatorRepositorySql.insertAudit);
  } catch { throw failure("AUDIT_FAILURE"); }
  const auditLogId = audit.recordset[0]?.AuditLogId;
  if (audit.recordset.length !== 1 || !exactSqlBigintReceipt(auditLogId)) throw failure("AUDIT_FAILURE");
  context.auditLogId = auditLogId;
  if (!context.requestFresh || !context.requestId) return auditLogId;

  const mutation = context.mutation;
  const decisionStatus = mutation?.domain === "OPERATOR_STATE" ? "SUCCESS" : "REJECTED";
  const previousRevision = mutation?.previousRevision ?? context.locked.snapshot.operator.revision;
  const correlationId = deps.newUuid().toLowerCase();
  if (!isUuid(correlationId)) throw failure("AUDIT_FAILURE");
  let decision: QueryResult;
  try {
    decision = await bind(request(deps, context), [
      ["requestId", sql.UniqueIdentifier, context.requestId],
      ["workstationId", sql.VarChar(20), context.locked.snapshot.deviceSession.workstationId],
      ["deviceSessionId", sql.UniqueIdentifier, context.locked.snapshot.deviceSession.sessionId],
      ["decisionStatus", sql.NVarChar(12), decisionStatus],
      ["reason", sql.NVarChar(64), decisionStatus === "SUCCESS" ? null : event.reason ?? "PERSISTENCE_FAILURE"],
      ["actorUserId", sql.VarChar(20), context.locked.targetUserIdText],
      ["targetUserId", sql.VarChar(20), context.locked.targetUserIdText],
      ["revisionDomain", sql.NVarChar(24), mutation?.domain ?? "OPERATOR_STATE"],
      ["previousRevision", sql.VarChar(16), previousRevision],
      ["nextRevision", sql.VarChar(16), mutation?.nextRevision ?? null],
      ["previousGeneration", sql.VarChar(20), mutation?.previousGeneration ?? String(context.locked.snapshot.operator.session.generation)],
      ["nextGeneration", sql.VarChar(20), mutation?.nextGeneration ?? null],
      ["previousIncarnation", sql.UniqueIdentifier, mutation?.previousIncarnation ?? context.locked.snapshot.operator.incarnation],
      ["nextIncarnation", sql.UniqueIdentifier, mutation?.nextIncarnation ?? null],
      ["auditLogId", sql.VarChar(20), auditLogId], ["eventType", sql.NVarChar(50), event.eventType],
      ["correlationId", sql.UniqueIdentifier, correlationId],
    ]).query(workstationOperatorRepositorySql.insertDecision);
  } catch { throw failure("AUDIT_FAILURE"); }
  if (decision.recordset.length !== 1 || String(decision.recordset[0]?.RequestId).toLowerCase() !== context.requestId) {
    throw failure("AUDIT_FAILURE");
  }
  context.decisionWritten = true;
  return auditLogId;
}

export function createWorkstationOperatorSqlRepository(input: Partial<Dependencies> = {}) {
  const deps: Dependencies = Object.freeze({ ...defaults, ...input });
  const repository: WorkstationOperatorSwitchRepository = Object.freeze({
    transaction<T>(work: (tx: OperatorSwitchTransaction) => Promise<T>): Promise<T> {
      return ownedTransaction(deps, work);
    },
    readForSwitch(lookup: OperatorSwitchLookup, tx: OperatorSwitchTransaction) {
      return readSnapshot(deps, contextFor(tx), lookup);
    },
    claimRequest(requestId: string, digest: string, tx: OperatorSwitchTransaction) {
      return claimRequest(deps, contextFor(tx), requestId, digest);
    },
    async recordPinFailure(mutation: OperatorPinFailureMutation, tx: OperatorSwitchTransaction) {
      const context = contextFor(tx);
      const locked = context.locked;
      if (!locked || !context.requestFresh || mutation.targetUserId !== locked.snapshot.targetUser.id ||
          mutation.expectedPinRevision !== locked.snapshot.pin.revision || !Number.isSafeInteger(mutation.failedAttempts) ||
          mutation.failedAttempts < 1 || !Number.isSafeInteger(mutation.attemptWindowStartedAtMs) ||
          (mutation.lockedUntilMs !== null && !Number.isSafeInteger(mutation.lockedUntilMs))) throw failure("PERSISTENCE_FAILURE");
      const result = await bind(request(deps, context), [
        ["workstationId", sql.VarChar(20), locked.snapshot.deviceSession.workstationId],
        ["userId", sql.VarChar(20), locked.targetUserIdText], ["failedAttempts", sql.Int, mutation.failedAttempts],
        ["windowStartedUtc", sql.DateTime2(3), new Date(mutation.attemptWindowStartedAtMs)],
        ["nowUtc", sql.DateTime2(3), new Date(deps.now())],
        ["lockedUntilUtc", sql.DateTime2(3), mutation.lockedUntilMs === null ? null : new Date(mutation.lockedUntilMs)],
        ["pinVersion", sql.Int, locked.snapshot.pin.version],
        ["policyRevision", sql.VarChar(20), locked.snapshot.pinPolicy.revision],
        ["expectedRevision", sql.VarChar(16), mutation.expectedPinRevision],
      ]).query(workstationOperatorRepositorySql.pinFailureCas);
      const revision = typeof result.recordset[0]?.NewRevision === "string" ? result.recordset[0]!.NewRevision.toLowerCase() : null;
      if (!revision) return Object.freeze({ affectedRows: 0 as const });
      if (result.recordset.length !== 1 || !isRevision(revision) || revision === mutation.expectedPinRevision) throw failure("PERSISTENCE_FAILURE");
      context.mutation = Object.freeze({
        domain: "PIN_ATTEMPT", previousRevision: mutation.expectedPinRevision, nextRevision: revision,
        previousGeneration: String(locked.snapshot.operator.session.generation), nextGeneration: null,
        previousIncarnation: locked.snapshot.operator.incarnation, nextIncarnation: null,
      });
      return Object.freeze({ affectedRows: 1 as const, newPinRevision: revision });
    },
    async compareAndSwapSwitch(mutation: OperatorSwitchMutation, tx: OperatorSwitchTransaction) {
      const context = contextFor(tx);
      const locked = context.locked;
      if (!locked || !context.requestFresh || mutation.requestId !== context.requestId ||
          mutation.requestDigest !== context.requestDigest || mutation.expectedOperatorRevision !== locked.snapshot.operator.revision ||
          mutation.expectedOperatorIncarnation !== locked.snapshot.operator.incarnation ||
          mutation.expectedGeneration !== locked.snapshot.operator.session.generation ||
          mutation.expectedPinRevision !== locked.snapshot.pin.revision || mutation.targetUserId !== locked.snapshot.targetUser.id ||
          mutation.targetTokenVersion !== locked.snapshot.targetUser.tokenVersion || mutation.targetPinVersion !== locked.snapshot.pin.version ||
          !isUuid(mutation.nextIncarnation) || mutation.nextSession.state !== "OPERATOR_ACTIVE" ||
          mutation.nextSession.operatorUserId !== mutation.targetUserId ||
          mutation.nextSession.generation !== mutation.expectedGeneration + 1) throw failure("PERSISTENCE_FAILURE");
      const result = await bind(request(deps, context), [
        ["nextGeneration", sql.VarChar(20), String(mutation.nextSession.generation)],
        ["nextIncarnation", sql.UniqueIdentifier, mutation.nextIncarnation],
        ["userId", sql.VarChar(20), locked.targetUserIdText], ["tokenVersion", sql.Int, mutation.targetTokenVersion],
        ["pinVersion", sql.Int, mutation.targetPinVersion], ["nowUtc", sql.DateTime2(3), new Date(deps.now())],
        ["workstationId", sql.VarChar(20), locked.snapshot.deviceSession.workstationId],
        ["deviceSessionId", sql.UniqueIdentifier, locked.snapshot.deviceSession.sessionId],
        ["expectedGeneration", sql.VarChar(20), String(mutation.expectedGeneration)],
        ["expectedIncarnation", sql.UniqueIdentifier, mutation.expectedOperatorIncarnation],
        ["expectedOperatorRevision", sql.VarChar(16), mutation.expectedOperatorRevision],
        ["expectedPinRevision", sql.VarChar(16), mutation.expectedPinRevision],
      ]).query(workstationOperatorRepositorySql.switchCas);
      const revision = typeof result.recordset[0]?.NewRevision === "string" ? result.recordset[0]!.NewRevision.toLowerCase() : null;
      if (!revision) return Object.freeze({ affectedRows: 0 as const });
      if (result.recordset.length !== 1 || !isRevision(revision) || revision === mutation.expectedOperatorRevision) throw failure("PERSISTENCE_FAILURE");
      context.mutation = Object.freeze({
        domain: "OPERATOR_STATE", previousRevision: mutation.expectedOperatorRevision, nextRevision: revision,
        previousGeneration: String(mutation.expectedGeneration), nextGeneration: String(mutation.nextSession.generation),
        previousIncarnation: mutation.expectedOperatorIncarnation, nextIncarnation: mutation.nextIncarnation,
      });
      return Object.freeze({ affectedRows: 1 as const, newOperatorRevision: revision });
    },
  });
  const pinVerifier: WorkstationPinVerifier = Object.freeze({
    async verify(targetUserId: number, pin: string, tx: OperatorSwitchTransaction) {
      const context = contextFor(tx);
      if (!context.locked || targetUserId !== context.locked.snapshot.targetUser.id) return false;
      try { return await deps.comparePin(pin, context.locked.pinHash); } catch { throw failure("PERSISTENCE_FAILURE"); }
    },
  });
  const audit: WorkstationOperatorSwitchAuditWriter = Object.freeze({
    async write(event: OperatorSwitchAudit, tx: OperatorSwitchTransaction) {
      return Object.freeze({ auditLogId: await writeAudit(deps, contextFor(tx), event) });
    },
  });
  return Object.freeze({ repository, pinVerifier, audit, runtimeEnabled: false as const });
}
