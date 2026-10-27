import sql from "mssql";
import { legacyWorkstationWriterFenceSql } from "./workstationLegacyWriterFence.js";

type Dependencies = Readonly<{
  transaction: (pool: sql.ConnectionPool) => sql.Transaction;
  request: (tx: sql.Transaction) => sql.Request;
}>;
const defaults: Dependencies = {
  transaction: pool => new sql.Transaction(pool), request: tx => new sql.Request(tx),
};
const domainErrors = new Set(["BOOTSTRAP_ALREADY_COMPLETED", "USER_NOT_FOUND", "LAST_SYSTEM_ADMIN",
  "USER_NOT_FOUND_OR_NOT_LOCAL", "ROLE_NOT_FOUND", "SYSTEM_ROLE_PROTECTED", "USER_HAS_HISTORY"]);
export type LegacyWriterFailure = "LEGACY_WRITER_BLOCKED" | "LEGACY_WRITE_FAILED" | "LEGACY_COMMIT_UNKNOWN" | "LEGACY_ROLLBACK_UNKNOWN";
export class LegacyWorkstationWriterError extends Error {
  constructor(readonly code: LegacyWriterFailure, readonly number?: number) { super(code); this.name = "LegacyWorkstationWriterError"; }
}

/**
 * Single owner for legacy identity mutations. Gate precedes all business locks.
 * 926/partial schema or unknown visibility DENIES work; this does not invent
 * sidecar invalidation, Audit/Decision receipts, or permission to enable Runtime.
 */
export async function withLegacyWorkstationTransaction<T>(
  pool: sql.ConnectionPool, work: (tx: sql.Transaction) => Promise<T>, deps: Dependencies = defaults,
): Promise<T> {
  let tx: sql.Transaction;
  try { tx = deps.transaction(pool); }
  catch { throw new LegacyWorkstationWriterError("LEGACY_WRITE_FAILED"); }
  let committing = false, gated = false;
  try {
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    await deps.request(tx).query(legacyWorkstationWriterFenceSql);
    gated = true;
    const result = await work(tx);
    committing = true;
    await tx.commit();
    return result;
  } catch (error) {
    if (committing) throw new LegacyWorkstationWriterError("LEGACY_COMMIT_UNKNOWN");
    try { await tx.rollback(); }
    catch { throw new LegacyWorkstationWriterError("LEGACY_ROLLBACK_UNKNOWN"); }
    if (gated && error instanceof Error && domainErrors.has(error.message)) throw new Error(error.message);
    // Preserve existing duplicate username/role HTTP conflict handling without
    // retaining the driver's SQL text, values or stack.
    const number = error && typeof error === "object" && "number" in error ? error.number : undefined;
    if (gated && (number === 2601 || number === 2627)) throw new LegacyWorkstationWriterError("LEGACY_WRITE_FAILED", number);
    throw new LegacyWorkstationWriterError(gated ? "LEGACY_WRITE_FAILED" : "LEGACY_WRITER_BLOCKED");
  }
}
