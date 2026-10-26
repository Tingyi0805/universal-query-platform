import { createHash } from "node:crypto";
import sql from "mssql";
import { types } from "node:util";
import { getPlatformDbPool } from "../../config/database.js";
import type { WorkstationSqlRequest, WorkstationSqlTransaction } from "./workstationSessionSql.repository.js";
import type { RevocationOwnedSqlDriver, RevocationOwnedSqlTransaction } from "./workstationRevocationOwnedWriter.js";
import { workstationSessionRepositorySql } from "./workstationSessionSqlStatements.js";
import { isolatedCredentialAtomicSql } from "./workstationCredentialAtomicSql.js";
import type { CredentialRevocationEvidence } from "./workstationCredentialRevocationFence.js";
import { exactSqlBigintReceipt } from "./workstationSqlCommitGate.js";

/**
 * H0-5C-2H — isolated credential revocation SQL writer.
 *
 * The adapter owns one SERIALIZABLE transaction and proves the complete active
 * device/legacy/operator scope before mutation. It is deliberately not
 * registered in Runtime. It must only be invoked against an approved isolated
 * database containing the reviewed 926 draft schema.
 */
type Dependencies = Readonly<{
  getPool: () => Promise<unknown | null>;
  transaction: (pool: unknown) => WorkstationSqlTransaction;
  request: (tx: WorkstationSqlTransaction) => WorkstationSqlRequest;
}>;
const defaults: Dependencies = {
  getPool: getPlatformDbPool as () => Promise<unknown | null>,
  transaction: pool => new sql.Transaction(pool as sql.ConnectionPool) as unknown as WorkstationSqlTransaction,
  request: tx => new sql.Request(tx as unknown as sql.Transaction) as unknown as WorkstationSqlRequest,
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REVISION = /^[0-9a-f]{16}$/;
const BIGINT = /^(?:0|[1-9][0-9]{0,18})$/;
const MAX_BIGINT = 9_223_372_036_854_775_807n;
const gateStatement = workstationSessionRepositorySql.acquireGate;

export type IsolatedRevocationScope = Readonly<{
  workstationId: string;
  credentialId: string;
  deviceSessionId?: string;
  expectedCredentialVersion?: number;
  requestId?: string;
  transactionCorrelationId?: string;
  nextIncarnation?: string;
}>;

type OperatorReceipt = Readonly<{
  revision: string;
  generation: string;
  incarnation: string;
  nextRevision?: string;
  nextGeneration?: string;
  nextIncarnation?: string;
}>;

const safeBigint = (value: string): boolean => {
  if (!BIGINT.test(value)) return false;
  try { return BigInt(value) <= MAX_BIGINT; } catch { return false; }
};
const safeScope = (scope: IsolatedRevocationScope | undefined): scope is IsolatedRevocationScope =>
  !!scope && typeof scope.workstationId === "string" && /^[1-9][0-9]{0,18}$/.test(scope.workstationId) && safeBigint(scope.workstationId) &&
  typeof scope.credentialId === "string" && UUID.test(scope.credentialId);
const count = (value: unknown): number | null => {
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0 ? value : null;
  if (typeof value !== "string" && typeof value !== "bigint") return null;
  if (typeof value === "string" && !BIGINT.test(value)) return null;
  try {
    const parsed = BigInt(value);
    return parsed >= 0n && parsed <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(parsed) : null;
  } catch { return null; }
};
const one = (value: unknown): value is 1 => value === 1;
const bind = (request: WorkstationSqlRequest, values: readonly (readonly [string, unknown, unknown])[]) => {
  for (const [name, type, value] of values) request.input(name, type, value);
  return request;
};

export function createIsolatedRevocationSqlDriver(deps: Dependencies = defaults, inputScope?: IsolatedRevocationScope): RevocationOwnedSqlDriver {
  // Copy data descriptors once. A caller cannot change the protected target
  // across awaits, and getters/Proxy hooks are never evaluated.
  let scope: IsolatedRevocationScope | undefined;
  if (inputScope && typeof inputScope === "object" && !types.isProxy(inputScope) &&
      Object.getPrototypeOf(inputScope) === Object.prototype) {
    const descriptors = Object.getOwnPropertyDescriptors(inputScope);
    const allowed = new Set(["workstationId", "credentialId", "deviceSessionId", "expectedCredentialVersion",
      "requestId", "transactionCorrelationId", "nextIncarnation"]);
    if (Reflect.ownKeys(descriptors).every(key => typeof key === "string" && allowed.has(key) &&
        "value" in descriptors[key]!)) {
      scope = Object.freeze(Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]))) as IsolatedRevocationScope;
    }
  }
  return {
    async beginSerializable(): Promise<RevocationOwnedSqlTransaction> {
      const pool = await deps.getPool();
      if (!pool) throw new Error("DATABASE_UNAVAILABLE");
      const tx = deps.transaction(pool);
      try {
        await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
      } catch (beginError) {
        try { await tx.rollback(); } catch { /* begin remains untrusted */ }
        throw beginError;
      }

      let gateAcquired = false;
      let gateAttempted = false;
      let scopeAttempted = false;
      let scopeLocked = false;
      let mutationAttempted = false;
      let appendOnlyAttempted = false;
      let mutationWritten = false;
      let appendOnlyWritten = false;
      let completed = false;
      let deviceSessionIds: string[] = [];
      let legacySessionIds: string[] = [];
      let operator: OperatorReceipt | null = null;
      let mutationEvidence: CredentialRevocationEvidence | null = null;

      const assertActive = () => { if (completed) throw new Error("TRANSACTION_CLOSED"); };
      const request = () => deps.request(tx);
      const common = (req: WorkstationSqlRequest) => bind(req, [
        ["workstationId", sql.NVarChar(20), scope!.workstationId],
        ["credentialId", sql.UniqueIdentifier, scope!.credentialId],
      ]);
      const requireWriteScope = () => {
        if (!safeScope(scope) || typeof scope.deviceSessionId !== "string" || !UUID.test(scope.deviceSessionId) ||
            !Number.isSafeInteger(scope.expectedCredentialVersion) || scope.expectedCredentialVersion! <= 0 ||
            scope.expectedCredentialVersion! > 2_147_483_647 || typeof scope.requestId !== "string" || !UUID.test(scope.requestId) ||
            typeof scope.transactionCorrelationId !== "string" || !UUID.test(scope.transactionCorrelationId) ||
            typeof scope.nextIncarnation !== "string" || !UUID.test(scope.nextIncarnation)) {
          throw new Error("WRITE_SCOPE_INVALID");
        }
      };

      return {
        async acquireSecurityGate() {
          assertActive();
          if (gateAttempted) throw new Error("GATE_ALREADY_ATTEMPTED");
          gateAttempted = true;
          const result = await request().query(gateStatement);
          gateAcquired = result.recordset.length === 1 && Number.isSafeInteger(result.recordset[0]?.GateResult) &&
            Number(result.recordset[0]?.GateResult) >= 0;
          return gateAcquired;
        },

        async lockAndRevalidateScope() {
          assertActive();
          if (!gateAcquired) throw new Error("GATE_NOT_HELD");
          if (scopeAttempted) throw new Error("SCOPE_ALREADY_ATTEMPTED");
          scopeAttempted = true;
          if (!safeScope(scope)) throw new Error("SCOPE_REQUIRED");

          const unmapped = await common(request()).query(isolatedCredentialAtomicSql.countUnmappedLegacy);
          if (unmapped.recordset.length !== 1 || count(unmapped.recordset[0]?.UnmappedActiveLegacySessions) !== 0)
            throw new Error("UNMAPPED_LEGACY_SESSIONS");

          const workstation = await bind(request(), [["workstationId", sql.NVarChar(20), scope.workstationId]])
            .query(workstationSessionRepositorySql.lockWorkstation);
          if (workstation.recordset.length !== 1 || workstation.recordset[0]?.WorkstationId !== scope.workstationId ||
              (workstation.recordset[0]?.IsActive !== true && workstation.recordset[0]?.IsActive !== 1) || workstation.recordset[0]?.RetiredAtUtc != null)
            throw new Error("WORKSTATION_INACTIVE");

          const credential = await common(request()).query(`SELECT CONVERT(VARCHAR(36),Id) AS CredentialId,
       CredentialVersion
FROM uqp.SharedWorkstationCredential WITH (UPDLOCK,HOLDLOCK)
WHERE Id=@credentialId AND WorkstationId=CONVERT(BIGINT,@workstationId)
  AND IsRevoked=0;`);
          if (credential.recordset.length !== 1 || typeof credential.recordset[0]?.CredentialId !== "string" ||
              credential.recordset[0].CredentialId.toLowerCase() !== scope.credentialId.toLowerCase() ||
              (scope.expectedCredentialVersion !== undefined && credential.recordset[0].CredentialVersion !== scope.expectedCredentialVersion))
            throw new Error("CREDENTIAL_SCOPE_UNPROVEN");

          if (scope.deviceSessionId !== undefined || scope.expectedCredentialVersion !== undefined) {
            if (typeof scope.deviceSessionId !== "string" || !UUID.test(scope.deviceSessionId) ||
                !Number.isSafeInteger(scope.expectedCredentialVersion) || scope.expectedCredentialVersion! <= 0 ||
                scope.expectedCredentialVersion! > 2_147_483_647) throw new Error("DEVICE_SCOPE_INVALID");
            const device = await bind(common(request()), [
              ["deviceSessionId", sql.UniqueIdentifier, scope.deviceSessionId],
              ["expectedCredentialVersion", sql.Int, scope.expectedCredentialVersion],
            ]).query(isolatedCredentialAtomicSql.lockCredentialDevice);
            if (device.recordset.length !== 1 || typeof device.recordset[0]?.DeviceSessionId !== "string" ||
                device.recordset[0].DeviceSessionId.toLowerCase() !== scope.deviceSessionId.toLowerCase() ||
                device.recordset[0].BoundCredentialVersion !== scope.expectedCredentialVersion)
              throw new Error("DEVICE_SCOPE_UNPROVEN");

            const devices = await common(request()).query(isolatedCredentialAtomicSql.lockDevices);
            if (!Array.isArray(devices.recordset) || devices.recordset.length === 0 ||
                devices.recordset.some(row => typeof row.SessionId !== "string" || !UUID.test(row.SessionId)) ||
                !devices.recordset.some(row => String(row.SessionId).toLowerCase() === scope.deviceSessionId!.toLowerCase()))
              throw new Error("DEVICE_SET_UNPROVEN");
            deviceSessionIds = devices.recordset.map(row => String(row.SessionId).toLowerCase());
            if (new Set(deviceSessionIds).size !== deviceSessionIds.length) throw new Error("DEVICE_SET_DUPLICATE");

            const state = await bind(request(), [["workstationId", sql.NVarChar(20), scope.workstationId]])
              .query(isolatedCredentialAtomicSql.lockOperator);
            const row = state.recordset[0];
            if (state.recordset.length !== 1 || typeof row?.DeviceSessionId !== "string" ||
                row.DeviceSessionId.toLowerCase() !== scope.deviceSessionId.toLowerCase() ||
                typeof row.Revision !== "string" || !REVISION.test(row.Revision) ||
                typeof row.Generation !== "string" || !safeBigint(row.Generation) || row.Generation === "9223372036854775807" ||
                typeof row.Incarnation !== "string" || !UUID.test(row.Incarnation))
              throw new Error("OPERATOR_STATE_UNPROVEN");
            operator = { revision: row.Revision, generation: row.Generation, incarnation: row.Incarnation.toLowerCase() };
          }

          const legacy = await common(request()).query(isolatedCredentialAtomicSql.lockLegacySessions);
          if (!Array.isArray(legacy.recordset) || legacy.recordset.length > 1 ||
              legacy.recordset.some(row => typeof row.SessionId !== "string" || !UUID.test(row.SessionId)))
            throw new Error("LEGACY_SET_UNPROVEN");
          legacySessionIds = legacy.recordset.map(row => String(row.SessionId).toLowerCase());
          const total = await bind(request(), [["workstationId", sql.NVarChar(20), scope.workstationId]])
            .query(isolatedCredentialAtomicSql.countActiveLegacyBeforeCas);
          if (total.recordset.length !== 1 || count(total.recordset[0]?.ActiveLegacySessions) !== legacySessionIds.length)
            throw new Error("LEGACY_LINEAGE_UNPROVEN");
          if (scope.deviceSessionId === undefined || scope.expectedCredentialVersion === undefined)
            throw new Error("DEVICE_BINDING_REQUIRED");
          scopeLocked = true;
        },

        async revokeCredentialAndSessions() {
          assertActive();
          if (!scopeLocked || mutationAttempted || !operator) throw new Error("MUTATION_ORDER_INVALID");
          mutationAttempted = true;
          requireWriteScope();
          if (scope!.nextIncarnation!.toLowerCase() === operator.incarnation) throw new Error("INCARNATION_NOT_ROTATED");
          const full = (req: WorkstationSqlRequest) => bind(common(req), [
            ["deviceSessionId", sql.UniqueIdentifier, scope!.deviceSessionId],
            ["expectedCredentialVersion", sql.Int, scope!.expectedCredentialVersion],
          ]);
          const credential = await full(request()).query(isolatedCredentialAtomicSql.credentialCas);
          if (credential.recordset.length !== 1 || !one(credential.recordset[0]?.CredentialAffected))
            throw new Error("CREDENTIAL_CAS_CONFLICT");
          const devices = await common(request()).query(isolatedCredentialAtomicSql.revokeDevices);
          const deviceRevoked = devices.recordset.length === 1 ? count(devices.recordset[0]?.DeviceSessionsRevoked) : null;
          if (deviceRevoked !== deviceSessionIds.length) throw new Error("DEVICE_REVOCATION_MISMATCH");

          const legacy = await bind(common(request()), [
            ["deviceSessionId", sql.UniqueIdentifier, scope!.deviceSessionId],
            ["expectedOperatorRevision", sql.VarChar(16), operator.revision],
            ["expectedGeneration", sql.VarChar(20), operator.generation],
            ["expectedIncarnation", sql.UniqueIdentifier, operator.incarnation],
          ]).query(isolatedCredentialAtomicSql.revokeLinkedLegacy);
          const revokedLegacy = legacy.recordset.map(row => typeof row.RevokedSessionId === "string" ? row.RevokedSessionId.toLowerCase() : null);
          if (revokedLegacy.some(id => id === null) || revokedLegacy.length !== legacySessionIds.length ||
              revokedLegacy.some(id => !legacySessionIds.includes(id!))) throw new Error("LEGACY_REVOCATION_MISMATCH");

          const operatorResult = await bind(common(request()), [
            ["deviceSessionId", sql.UniqueIdentifier, scope!.deviceSessionId],
            ["expectedOperatorRevision", sql.VarChar(16), operator.revision],
            ["expectedGeneration", sql.VarChar(20), operator.generation],
            ["expectedIncarnation", sql.UniqueIdentifier, operator.incarnation],
            ["nextIncarnation", sql.UniqueIdentifier, scope!.nextIncarnation],
          ]).query(isolatedCredentialAtomicSql.revokeOperatorCas);
          const next = operatorResult.recordset[0];
          if (operatorResult.recordset.length !== 1 || typeof next?.NextOperatorRevision !== "string" ||
              !REVISION.test(next.NextOperatorRevision) || next.NextOperatorRevision === operator.revision ||
              typeof next.NextGeneration !== "string" || !safeBigint(next.NextGeneration) ||
              BigInt(next.NextGeneration) !== BigInt(operator.generation) + 1n ||
              typeof next.NextIncarnation !== "string" || next.NextIncarnation.toLowerCase() !== scope!.nextIncarnation!.toLowerCase() ||
              next.NextIncarnation.toLowerCase() === operator.incarnation)
            throw new Error("OPERATOR_CAS_CONFLICT");
          operator = { ...operator, nextRevision: next.NextOperatorRevision, nextGeneration: next.NextGeneration,
            nextIncarnation: next.NextIncarnation.toLowerCase() };

          const remainingDevices = await common(request()).query(isolatedCredentialAtomicSql.remainingDevices);
          const remainingLegacy = await bind(request(), [["workstationId", sql.NVarChar(20), scope!.workstationId]])
            .query(isolatedCredentialAtomicSql.remainingLegacy);
          const deviceRemaining = remainingDevices.recordset.length === 1 ? count(remainingDevices.recordset[0]?.Remaining) : null;
          const legacyRemaining = remainingLegacy.recordset.length === 1 ? count(remainingLegacy.recordset[0]?.Remaining) : null;
          if (deviceRemaining !== 0 || legacyRemaining !== 0) throw new Error("POST_MUTATION_SCOPE_NOT_EMPTY");

          mutationWritten = true;
          mutationEvidence = Object.freeze({
            credentialMutationAffected: 1, expectedCredentialVersionMatched: true,
            deviceSessionsLocked: deviceSessionIds.length, deviceSessionsRevoked: deviceRevoked, deviceSessionsRemaining: 0,
            legacySessionsLocked: legacySessionIds.length, legacySessionsRevoked: revokedLegacy.length, legacySessionsRemaining: 0,
            operatorStatePresent: true, operatorCasAffected: 1, operatorGenerationAdvanced: true,
            operatorIncarnationRotated: true, requestReservationAffected: 0, auditAffected: 0, decisionAffected: 0,
            auditLogId: null, commitOutcome: "UNKNOWN",
          });
          return mutationEvidence;
        },

        async insertRequestAuditAndDecision() {
          assertActive();
          if (!mutationWritten || appendOnlyAttempted || !operator?.nextRevision || !operator.nextGeneration || !operator.nextIncarnation)
            throw new Error("APPEND_ONLY_ORDER_INVALID");
          appendOnlyAttempted = true;
          requireWriteScope();
          const digest = createHash("sha256").update(JSON.stringify({
            contract: "WORKSTATION_CREDENTIAL_REVOCATION_V1", requestId: scope!.requestId,
            workstationId: scope!.workstationId, credentialId: scope!.credentialId.toLowerCase(),
            deviceSessionId: scope!.deviceSessionId!.toLowerCase(), credentialVersion: scope!.expectedCredentialVersion,
            previousRevision: operator.revision, nextRevision: operator.nextRevision,
            previousGeneration: operator.generation, nextGeneration: operator.nextGeneration,
            previousIncarnation: operator.incarnation, nextIncarnation: operator.nextIncarnation,
          }), "utf8").digest("hex");
          const reservation = await bind(request(), [
            ["requestId", sql.UniqueIdentifier, scope!.requestId], ["workstationId", sql.NVarChar(20), scope!.workstationId],
            ["deviceSessionId", sql.UniqueIdentifier, scope!.deviceSessionId], ["requestDigest", sql.VarChar(64), digest],
          ]).query(isolatedCredentialAtomicSql.reserveRequest);
          if (reservation.recordset.length !== 1 || typeof reservation.recordset[0]?.RequestId !== "string" ||
              reservation.recordset[0].RequestId.toLowerCase() !== scope!.requestId!.toLowerCase())
            throw new Error("REQUEST_RESERVATION_FAILED");

          const parametersJson = JSON.stringify({ contract: "WORKSTATION_CREDENTIAL_REVOCATION_AUDIT_V1",
            requestId: scope!.requestId, workstationId: scope!.workstationId, deviceSessionId: scope!.deviceSessionId,
            credentialVersion: scope!.expectedCredentialVersion, deviceSessionsRevoked: deviceSessionIds.length,
            legacySessionsRevoked: legacySessionIds.length });
          const audit = await bind(request(), [["parametersJson", sql.NVarChar(sql.MAX), parametersJson]])
            .query(isolatedCredentialAtomicSql.insertAudit);
          const auditLogId = audit.recordset[0]?.AuditLogId;
          if (audit.recordset.length !== 1 || !exactSqlBigintReceipt(auditLogId)) throw new Error("AUDIT_RECEIPT_INVALID");

          const decision = await bind(request(), [
            ["requestId", sql.UniqueIdentifier, scope!.requestId], ["workstationId", sql.NVarChar(20), scope!.workstationId],
            ["deviceSessionId", sql.UniqueIdentifier, scope!.deviceSessionId],
            ["previousOperatorRevision", sql.VarChar(16), operator.revision],
            ["nextOperatorRevision", sql.VarChar(16), operator.nextRevision],
            ["previousGeneration", sql.VarChar(20), operator.generation],
            ["nextGeneration", sql.VarChar(20), operator.nextGeneration],
            ["previousIncarnation", sql.UniqueIdentifier, operator.incarnation],
            ["nextIncarnation", sql.UniqueIdentifier, operator.nextIncarnation],
            ["auditLogId", sql.VarChar(20), auditLogId],
            ["correlationId", sql.UniqueIdentifier, scope!.transactionCorrelationId],
          ]).query(isolatedCredentialAtomicSql.insertDecision);
          if (decision.recordset.length !== 1 || typeof decision.recordset[0]?.RequestId !== "string" ||
              decision.recordset[0].RequestId.toLowerCase() !== scope!.requestId!.toLowerCase())
            throw new Error("DECISION_RECEIPT_INVALID");
          appendOnlyWritten = true;
          return { requestReservationAffected: 1, auditAffected: 1, decisionAffected: 1, auditLogId };
        },

        async commit() {
          assertActive();
          if (!appendOnlyWritten || !mutationEvidence) throw new Error("COMMIT_ORDER_INVALID");
          completed = true;
          await tx.commit();
        },
        async rollback() {
          assertActive();
          try { await tx.rollback(); } finally { completed = true; }
        },
      };
    },
  };
}

export const isolatedSqlAdapterReleaseGate = Object.freeze({
  actualMssqlTransactionImplemented: true as const,
  productionWriterImplemented: false as const,
  activeLegacyLineageFailClosed: true as const,
  sqlAcceptance: "NOT_RUN" as const,
  credentialRevocationEnabled: false as const,
  runtimeRegistered: false as const,
});
