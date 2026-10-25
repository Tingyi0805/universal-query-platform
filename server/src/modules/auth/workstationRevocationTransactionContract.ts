import { sessionLockOrder } from "./workstationSessionSchema926.js";

/**
 * H0-5C-2A — isolated, fail-closed revocation transaction contract.
 * No legacy writer imports this yet. No database connection or privilege.
 */
/** Shared canonical lock order; avoid divergence from H0-5A/5B. */
export const workstationRevocationLockOrder = sessionLockOrder;

export type RevocationScope = "USER" | "WORKSTATION" | "CREDENTIAL" | "PIN_POLICY" | "ROLE";
export type RevocationMutation = Readonly<{
  scope: RevocationScope;
  /** Canonical SQL BIGINT decimal; not a JavaScript Number. */
  scopeId: string;
  transactionOwner: "REPOSITORY_OWNED";
  isolation: "SERIALIZABLE";
  xactAbort: true;
  securityGateHeld: boolean;
  locks: readonly string[];
  legacyMutationAffected: number;
  sessionInvalidationAffected: number;
  auditAffected: number;
  auditLogId: string;
  commitOutcome: "COMMITTED" | "ROLLED_BACK" | "UNKNOWN";
  /** Attestation is descriptive only; runtime authority is always disabled. */
  sqlServer2019Accepted: boolean;
}>;

const MAX = 9223372036854775807n;
const bigint = (value: unknown): value is string =>
  typeof value === "string" && /^[1-9][0-9]{0,18}$/.test(value) && BigInt(value) <= MAX;

export function assessRevocationTransaction(value: RevocationMutation): Readonly<{
  consistent: boolean;
  failures: readonly string[];
  runtimeEnabled: false;
  authority: "NONE";
}> {
  const failures: string[] = [];
  if (!["USER", "WORKSTATION", "CREDENTIAL", "PIN_POLICY", "ROLE"].includes(value.scope) || !bigint(value.scopeId)) failures.push("INVALID_SCOPE");
  if (value.transactionOwner !== "REPOSITORY_OWNED" || value.isolation !== "SERIALIZABLE" ||
    value.xactAbort !== true || value.securityGateHeld !== true) failures.push("TRANSACTION_NOT_PROVEN");
  if (value.locks.length !== workstationRevocationLockOrder.length ||
    !value.locks.every((x, i) => x === workstationRevocationLockOrder[i])) failures.push("LOCK_ORDER_INVALID");
  if (value.legacyMutationAffected !== 1 || !Number.isSafeInteger(value.sessionInvalidationAffected) ||
    value.sessionInvalidationAffected < 0) failures.push("MUTATION_NOT_PROVEN");
  if (value.auditAffected !== 1 || !bigint(value.auditLogId)) failures.push("AUDIT_NOT_PROVEN");
  if (value.commitOutcome !== "COMMITTED") failures.push("COMMIT_NOT_PROVEN");
  if (!value.sqlServer2019Accepted) failures.push("SQL_ACCEPTANCE_MISSING");
  return Object.freeze({
    consistent: failures.length === 0,
    failures: Object.freeze(failures),
    runtimeEnabled: false as const,
    authority: "NONE" as const,
  });
}
