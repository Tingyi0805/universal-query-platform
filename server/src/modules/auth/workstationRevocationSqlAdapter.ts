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
export type IsolatedRevocationScope = Readonly<{ workstationId: string; credentialId: string }>;
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
          // Preliminary read-only scope validation; no writer authority granted.
          if (!safeScope(scope)) throw new Error("SCOPE_REQUIRED");
          const req = deps.request(tx);
          const result = await req.input("workstationId", sql.NVarChar(20), scope.workstationId)
            .input("credentialId", sql.UniqueIdentifier, scope.credentialId)
            .query(isolatedCredentialAtomicSql.countUnmappedLegacy);
          if (result.recordset.length !== 1 ||
              String(result.recordset[0]?.UnmappedActiveLegacySessions) !== "0")
            throw new Error("UNMAPPED_LEGACY_SESSIONS");
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
