import sql from "mssql";
import { randomUUID } from "node:crypto";
import { getPlatformDbPool } from "../../config/database.js";
import type { WorkstationSqlRequest, WorkstationSqlTransaction } from "./workstationSessionSql.repository.js";
import type { RevocationOwnedSqlDriver, RevocationOwnedSqlTransaction } from "./workstationRevocationOwnedWriter.js";
import { workstationSessionRepositorySql } from "./workstationSessionSqlStatements.js";

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

export function createIsolatedRevocationSqlDriver(deps: Dependencies = defaults): RevocationOwnedSqlDriver {
  return {
    async beginSerializable(): Promise<RevocationOwnedSqlTransaction> {
      const pool = await deps.getPool();
      if (!pool) throw new Error("DATABASE_UNAVAILABLE");
      const tx = deps.transaction(pool);
      await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
      let gateAcquired = false;
      let completed = false;
      const assertActive = () => {
        if (completed) throw new Error("TRANSACTION_CLOSED");
      };
      return {
        async acquireSecurityGate() {
          assertActive();
          const result = await deps.request(tx).query(gateStatement);
          gateAcquired = result.recordset.length === 1 &&
            Number.isSafeInteger(result.recordset[0]?.GateResult) &&
            Number(result.recordset[0]?.GateResult) >= 0;
          return gateAcquired;
        },
        async lockAndRevalidateScope() {
          assertActive();
          if (!gateAcquired) throw new Error("GATE_NOT_HELD");
          // Exact scope and canonical lock order not yet accepted.
          throw new Error(WRITE_BLOCKED);
        },
        async revokeCredentialAndSessions() { throw new Error(WRITE_BLOCKED); },
        async insertRequestAuditAndDecision() { throw new Error(WRITE_BLOCKED); },
        async commit() { throw new Error(WRITE_BLOCKED); },
        async rollback() {
          assertActive();
          completed = true;
          await tx.rollback();
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
