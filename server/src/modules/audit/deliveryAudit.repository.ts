import sql from "mssql";
import { getPlatformDbPool } from "../../config/database.js";

export type DeliveryAuditStats = { rowCount?: number; durationMs?: number };
export const defaultDeliveryAuditDependencies = {
  pool: getPlatformDbPool, transaction: (pool: sql.ConnectionPool) => new sql.Transaction(pool),
  request: (tx: sql.Transaction) => new sql.Request(tx),
};

/** SUCCESS remains uncommitted until post-audit authorization/version validation.
 * On rejection even a failed subsequent FAILED write cannot leave SUCCESS behind.
 * Validators that read AuditLog must use the supplied transaction, not another connection.
 */
export function createDeliveryAuditFinalizer(deps = defaultDeliveryAuditDependencies) {
  return async (id: number, stats: DeliveryAuditStats, validate: (tx: sql.Transaction) => Promise<void>): Promise<void> => {
    const pool = await deps.pool();
    if (!pool || !Number.isSafeInteger(id) || id <= 0) throw new Error("DELIVERY_AUDIT_REQUIRED");
    const tx = deps.transaction(pool);
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    try {
      await deps.request(tx).query("SET XACT_ABORT ON");
      const result = await deps.request(tx).input("id", sql.BigInt, id)
        .input("rowCount", sql.Int, stats.rowCount ?? null).input("durationMs", sql.Int, stats.durationMs ?? null)
        .query(`UPDATE uqp.AuditLog SET Status='SUCCESS', ResultRowCount=@rowCount, DurationMs=@durationMs,
          CompletedAtUtc=SYSUTCDATETIME() WHERE Id=@id AND Status='STARTED'`);
      if (result.rowsAffected.length !== 1 || result.rowsAffected[0] !== 1) throw new Error("DELIVERY_AUDIT_REQUIRED");
      await validate(tx);
      await tx.commit();
    } catch (error) {
      try { await tx.rollback(); } catch { /* never deliver; preserve the original error */ }
      throw error;
    }
  };
}
export const finalizeDeliveryAudit = createDeliveryAuditFinalizer();
