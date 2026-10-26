import sql from "mssql";
import { getPlatformDbPool } from "../../config/database.js";
import type { WorkstationSqlRequest, WorkstationSqlTransaction } from "./workstationSessionSql.repository.js";
import type { RevocationOwnedSqlDriver, RevocationOwnedSqlTransaction } from "./workstationRevocationOwnedWriter.js";
import { workstationSessionRepositorySql } from "./workstationSessionSqlStatements.js";
import { isolatedCredentialAtomicSql } from "./workstationCredentialAtomicSql.js";

/**
 * H0-5C-2G — real mssql connection/transaction and gate adapter, fail-closed.
 * Unlike the synthetic test driver this opens a genuine SQL transaction when
 * explicitly called. It is NOT registered in Runtime and refuses ALL writes.
 * Never invoke against an existing/production UQP database.
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
const gateStatement = workstationSessionRepositorySql.acquireGate;
const WRITE_BLOCKED = "H0_5C_2G_REVOCATION_WRITES_NOT_REVIEWED";
export type IsolatedRevocationScope = Readonly<{ workstationId: string; credentialId: string; deviceSessionId?: string; expectedCredentialVersion?: number }>;
const safeScope = (scope: IsolatedRevocationScope | undefined): scope is IsolatedRevocationScope =>
  !!scope && /^[1-9][0-9]{0,18}$/.test(scope.workstationId) &&
  BigInt(scope.workstationId) <= 9223372036854775807n &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(scope.credentialId);

export function createIsolatedRevocationSqlDriver(deps: Dependencies = defaults, scope?: IsolatedRevocationScope): RevocationOwnedSqlDriver {
  return {
    async beginSerializable(): Promise<RevocationOwnedSqlTransaction> {
      const pool = await deps.getPool();
      if (!pool) throw new Error("DATABASE_UNAVAILABLE");
      const tx = deps.transaction(pool);
      // A failed begin can leave a driver transaction in an uncertain state.
      // Best-effort cleanup before refusing to supply a transaction handle.
      try {
        await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
      } catch (beginError) {
        try { await tx.rollback(); } catch { /* begin failure remains untrusted */ }
        throw beginError;
      }
      let gateAcquired = false;
      let gateAttempted = false;
      let scopeAttempted = false;
      let completed = false;
      const assertActive = () => {
        if (completed) throw new Error("TRANSACTION_CLOSED");
      };
      return {
        async acquireSecurityGate() {
          assertActive();
          if (gateAttempted) throw new Error("GATE_ALREADY_ATTEMPTED");
          gateAttempted = true;
          const result = await deps.request(tx).query(gateStatement);
          gateAcquired = result.recordset.length === 1 &&
            Number.isSafeInteger(result.recordset[0]?.GateResult) &&
            Number(result.recordset[0]?.GateResult) >= 0;
          return gateAcquired;
        },
        async lockAndRevalidateScope() {
          assertActive();
          if (!gateAcquired) throw new Error("GATE_NOT_HELD");
          if (scopeAttempted) throw new Error("SCOPE_ALREADY_ATTEMPTED");
          scopeAttempted = true;
          // Preliminary read-only scope validation; no writer authority granted.
          if (!safeScope(scope)) throw new Error("SCOPE_REQUIRED");
          const req = deps.request(tx);
          const result = await req.input("workstationId", sql.NVarChar(20), scope.workstationId)
            .input("credentialId", sql.UniqueIdentifier, scope.credentialId)
            .query(isolatedCredentialAtomicSql.countUnmappedLegacy);
          // COUNT_BIG can be returned as a string, bigint or safe integer.
          // Never coerce a rounded JS number into authoritative SQL evidence.
          const count = result.recordset[0]?.UnmappedActiveLegacySessions;
          if (result.recordset.length !== 1 ||
              !(count === "0" || count === 0n || count === 0))
            throw new Error("UNMAPPED_LEGACY_SESSIONS");
          // Lock and verify the credential itself in the same transaction. A
          // zero unmapped count alone is insufficient: it may refer to a
          // nonexistent, revoked, or cross-workstation credential.
          const credential = await deps.request(tx)
            .input("workstationId", sql.NVarChar(20), scope.workstationId)
            .input("credentialId", sql.UniqueIdentifier, scope.credentialId)
            .query(`SELECT CONVERT(VARCHAR(36),Id) AS CredentialId
FROM uqp.SharedWorkstationCredential WITH (UPDLOCK,HOLDLOCK)
WHERE Id=@credentialId AND WorkstationId=CONVERT(BIGINT,@workstationId)
  AND IsRevoked=0;`);
          if (credential.recordset.length !== 1 ||
              typeof credential.recordset[0]?.CredentialId !== "string" ||
              credential.recordset[0].CredentialId.toLowerCase() !== scope.credentialId.toLowerCase())
            throw new Error("CREDENTIAL_SCOPE_UNPROVEN");
          // Device-bound admission is optional only for legacy read-only tests:
          // missing device proof always blocks the writer.
          if (scope.deviceSessionId !== undefined || scope.expectedCredentialVersion !== undefined) {
            if (typeof scope.deviceSessionId !== "string" ||
                !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(scope.deviceSessionId) ||
                !Number.isSafeInteger(scope.expectedCredentialVersion) ||
                scope.expectedCredentialVersion! <= 0 || scope.expectedCredentialVersion! > 2147483647)
              throw new Error("DEVICE_SCOPE_INVALID");
            const device = await deps.request(tx)
              .input("workstationId", sql.NVarChar(20), scope.workstationId)
              .input("credentialId", sql.UniqueIdentifier, scope.credentialId)
              .input("deviceSessionId", sql.UniqueIdentifier, scope.deviceSessionId)
              .input("expectedCredentialVersion", sql.Int, scope.expectedCredentialVersion)
              .query(isolatedCredentialAtomicSql.lockCredentialDevice);
            if (device.recordset.length !== 1 ||
                typeof device.recordset[0]?.DeviceSessionId !== "string" ||
                device.recordset[0].DeviceSessionId.toLowerCase() !== scope.deviceSessionId.toLowerCase() ||
                device.recordset[0].BoundCredentialVersion !== scope.expectedCredentialVersion)
              throw new Error("DEVICE_SCOPE_UNPROVEN");
          }
          // Still reject: a zero count does not establish historical writer coverage.
          throw new Error(WRITE_BLOCKED);
        },
        async revokeCredentialAndSessions() { throw new Error(WRITE_BLOCKED); },
        async insertRequestAuditAndDecision() { throw new Error(WRITE_BLOCKED); },
        async commit() { throw new Error(WRITE_BLOCKED); },
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
  sqlAcceptance: "NOT_RUN" as const,
  credentialRevocationEnabled: false as const,
  runtimeRegistered: false as const,
});
