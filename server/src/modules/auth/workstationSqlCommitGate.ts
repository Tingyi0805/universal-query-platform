/**
 * H0-5B: conservative SQL transaction outcome gate.
 *
 * This is an isolated policy helper, NOT a live SQL repository or audit writer.
 * No write is considered successful without an exact database audit receipt and
 * an explicitly confirmed commit. In particular, unknown commits are NEVER
 * automatically retried: doing so could double-apply a PIN or session mutation.
 */
const SQL_BIGINT_MAX = 9_223_372_036_854_775_807n;

export type WorkstationSqlCommitOutcome = "COMMITTED" | "ROLLED_BACK" | "UNKNOWN";

export type WorkstationSqlCommitEvidence = Readonly<{
  commitOutcome: WorkstationSqlCommitOutcome;
  affectedRows: number;
  auditAffectedRows: number;
  decisionAffectedRows: number;
  auditLogId: unknown;
}>;

export type WorkstationSqlCommitAssessment =
  | Readonly<{ ok: true; auditLogId: string; authority: "NONE" }>
  | Readonly<{ ok: false; code: "COMMIT_NOT_CONFIRMED" | "CAS_NOT_UNIQUE" | "AUDIT_MISSING" | "DECISION_MISSING" | "AUDIT_ID_INVALID"; authority: "NONE" }>;

export function exactSqlBigintReceipt(value: unknown): value is string {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,18}$/.test(value)) return false;
  try { return BigInt(value) <= SQL_BIGINT_MAX; } catch { return false; }
}

export function assessWorkstationSqlCommit(evidence: WorkstationSqlCommitEvidence): WorkstationSqlCommitAssessment {
  const deny = (code: Exclude<WorkstationSqlCommitAssessment, { ok: true }>["code"]) =>
    Object.freeze({ ok: false as const, code, authority: "NONE" as const });
  if (evidence.commitOutcome !== "COMMITTED") return deny("COMMIT_NOT_CONFIRMED");
  if (evidence.affectedRows !== 1) return deny("CAS_NOT_UNIQUE");
  if (evidence.auditAffectedRows !== 1) return deny("AUDIT_MISSING");
  if (evidence.decisionAffectedRows !== 1) return deny("DECISION_MISSING");
  if (!exactSqlBigintReceipt(evidence.auditLogId)) return deny("AUDIT_ID_INVALID");
  return Object.freeze({ ok: true, auditLogId: evidence.auditLogId, authority: "NONE" });
}

/** A failed or unknown SQL write cannot be retried without independent reconciliation. */
export function mayAutomaticallyRetryWorkstationWrite(_sqlErrorNumber: number | null, _outcome: WorkstationSqlCommitOutcome): false {
  return false;
}
