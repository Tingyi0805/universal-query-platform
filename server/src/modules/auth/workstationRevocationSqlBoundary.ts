import sql from "mssql";
import { workstationSessionRepositorySql } from "./workstationSessionSqlStatements.js";
import type { WorkstationSqlRequest, WorkstationSqlTransaction } from "./workstationSessionSql.repository.js";

/**
 * H0-5C-2D: real SQL transaction/gate primitive with injected SQL driver.
 * NOT a credential revocation writer: no mutation, audit or Decision SQL here.
 * It never commits until a future audited writer is reviewed and installed.
 */
export interface RevocationSqlDriver {
  getPool(): Promise<unknown | null>;
  transaction(pool: unknown): WorkstationSqlTransaction;
  request(tx: WorkstationSqlTransaction): WorkstationSqlRequest;
}
export type RevocationSqlBoundaryResult = Readonly<{
  status: "BLOCKED" | "DATABASE_UNAVAILABLE" | "GATE_REJECTED" | "ROLLBACK_UNKNOWN";
  authority: "NONE";
  runtimeEnabled: false;
}>;

function blocked(status: RevocationSqlBoundaryResult["status"]): RevocationSqlBoundaryResult {
  return Object.freeze({ status, authority: "NONE" as const, runtimeEnabled: false as const });
}

/**
 * Acquires the canonical cooperative gate in SERIALIZABLE, then rolls back.
 * Even if all infrastructure succeeds, returns BLOCKED: dependent invalidation,
 * operator CAS, AuditLog and Decision are NOT wired, and MUST NOT be faked.
 * This API must not be imported by an application route.
 */
export async function probeIsolatedRevocationSqlBoundary(
  driver: RevocationSqlDriver,
): Promise<RevocationSqlBoundaryResult> {
  let pool: unknown | null;
  try { pool = await driver.getPool(); } catch { return blocked("DATABASE_UNAVAILABLE"); }
  if (pool === null) return blocked("DATABASE_UNAVAILABLE");
  let tx: WorkstationSqlTransaction;
  try { tx = driver.transaction(pool); } catch { return blocked("DATABASE_UNAVAILABLE"); }
  let begun = false;
  let status: RevocationSqlBoundaryResult["status"] = "BLOCKED";
  try {
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    begun = true;
    const response = await driver.request(tx).query(workstationSessionRepositorySql.acquireGate);
    const gate = response.recordset[0]?.GateResult;
    if (!Number.isSafeInteger(gate) || Number(gate) < 0 || response.recordset.length !== 1) {
      status = "GATE_REJECTED";
    }
  } catch {
    status = "GATE_REJECTED";
  } finally {
    if (begun) {
      try { await tx.rollback(); } catch { status = "ROLLBACK_UNKNOWN"; }
    }
  }
  return blocked(status);
}

export const sqlRevocationBoundaryReleaseGate = Object.freeze({
  applicationRouteRegistered: false as const,
  credentialWriterIntegrated: false as const,
  operatorGenerationCasImplemented: false as const,
  auditedDecisionWriteImplemented: false as const,
  sql2019IntegrationAccepted: false as const,
  productionReady: false as const,
});
