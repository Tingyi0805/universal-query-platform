/**
 * H0-5C-2A: audited inventory of legacy writers that bypass the 926 session gate.
 * This file is intentionally isolated from production routes. It is an
 * admission blocker, not a simulated revocation implementation.
 */
export const workstationRevocationWriterInventory = Object.freeze([
  { id: "PIN_ENROLL_REVOKE", source: "server/src/modules/auth/quickPin.service.ts", state: "GAP" },
  { id: "PIN_POLICY", source: "server/src/modules/admin/quickPinPolicy.repository.ts", state: "GAP" },
  { id: "PASSWORD_TOKEN_VERSION", source: "server/src/modules/auth/auth.repository.ts", state: "GAP" },
  { id: "USER_ROLE_PERMISSION", source: "server/src/modules/admin/admin.repository.ts", state: "GAP" },
  { id: "WORKSTATION_CREDENTIAL", source: "server/src/modules/admin/workstationCredential.repository.ts", state: "GAP" },
  { id: "WORKSTATION_STATE", source: "server/src/modules/admin/sharedWorkstation.repository.ts", state: "GAP" },
  { id: "WORKSTATION_GRANTS", source: "server/src/modules/admin/workstationManagement.repository.ts", state: "GAP" },
  { id: "LEGACY_WORKERS_AND_DBA", source: null, state: "UNKNOWN" },
] as const);

/** Named paths, source-verifiable; a denial fence is NOT a converted 926 writer. */
export const workstationNamedWriterCoverage = Object.freeze([
  { source: "server/src/modules/admin/workstationCredential.repository.ts", functions: ["issueDeviceCredential", "revokeDeviceCredential"], coverage: "COMMON_GATE_DENY_ON_926" },
  { source: "server/src/modules/admin/workstationManagement.repository.ts", functions: ["create", "metadata", "retire", "removeUnused", "saveGrants", "saveAudience", "bindDevice"], coverage: "COMMON_GATE_DENY_ON_926" },
  { source: "server/src/modules/admin/sharedWorkstation.repository.ts", functions: ["createSharedWorkstation", "updateSharedWorkstation", "setWorkstationUsers"], coverage: "COMMON_GATE_DENY_ON_926" },
  { source: "server/src/modules/auth/quickPin.service.ts", functions: ["mutate"], coverage: "COMMON_GATE_DENY_ON_926" },
  { source: "server/src/modules/admin/quickPinPolicy.repository.ts", functions: ["updateQuickPinPolicy"], coverage: "COMMON_GATE_DENY_ON_926" },
  { source: "server/src/modules/auth/auth.repository.ts", functions: ["updateOwnLocalPassword"], coverage: "COMMON_OWNER_DENY_ON_926" },
  { source: "server/src/modules/admin/admin.repository.ts", functions: ["createInitialAdmin", "createUser", "updateUser", "resetUserPassword", "createRole", "updateRole", "deleteUser", "revokeUserSessions"], coverage: "COMMON_OWNER_DENY_ON_926" },
  { source: "server/src/modules/auth/workstationSessionSql.repository.ts", functions: ["compareAndSwapRenewal"], coverage: "ISOLATED_RENEWAL_AUDIT_CAS_ONLY" },
  { source: "server/src/modules/auth/workstationSessionSql.repository.ts", functions: ["revokeDevice"], coverage: "RETIRED_NO_SQL_SCOPE_BLOCKED" },
  { source: "server/src/modules/auth/workstationOperatorSql.repository.ts", functions: ["recordPinFailure", "compareAndSwapSwitch"], coverage: "ISOLATED_ONLY_RUNTIME_BLOCKED" },
  { source: "server/src/modules/auth/workstationUserRevocation.ts", functions: ["createIsolatedUserRevocationWriter"], coverage: "ISOLATED_USER_REVOCATION_SQL_NOT_RUN" },
  { source: "server/src/modules/auth/workstationRevocationSqlAdapter.ts", functions: ["revokeCredentialAndSessions"], coverage: "ISOLATED_ONLY_SQL_NOT_RUN" },
] as const);

/** Source inventory, NOT a grant of writer authority or proof of physical locks. */
export const workstationProtectedSqlSources = Object.freeze([
  "server/src/modules/admin/admin.repository.ts",
  "server/src/modules/admin/sharedWorkstation.repository.ts",
  "server/src/modules/admin/workstationCredential.repository.ts",
  "server/src/modules/admin/workstationManagement.repository.ts",
  "server/src/modules/admin/quickPinPolicy.repository.ts",
  "server/src/modules/auth/auth.repository.ts",
  "server/src/modules/auth/quickPin.service.ts",
  "server/src/modules/auth/workstationSessionSqlStatements.ts",
  "server/src/modules/auth/workstationCredentialAtomicSql.ts",
  "server/src/modules/auth/workstationUserRevocationSql.ts",
  "server/src/modules/auth/workstationCredentialRevocationSql.ts",
] as const);

export type RevocationWriterEvidence = Readonly<{
  writerId: typeof workstationRevocationWriterInventory[number]["id"];
  transactionOwnerProven: boolean;
  sharedGateProven: boolean;
  invalidationAtomicityProven: boolean;
  auditAtomicityProven: boolean;
  sql2019Accepted: boolean;
}>;

export function assessWorkstationRevocationCoverage(evidence: readonly RevocationWriterEvidence[]) {
  const missing = workstationRevocationWriterInventory
    .filter(writer => {
      const proof = evidence.find(item => item.writerId === writer.id);
      // Caller assertions cannot erase known source gaps or certify real SQL.
      return writer.state === "UNKNOWN" || writer.state === "GAP" || !proof || !proof.transactionOwnerProven || !proof.sharedGateProven ||
        !proof.invalidationAtomicityProven || !proof.auditAtomicityProven || !proof.sql2019Accepted;
    })
    .map(writer => writer.id);
  // This is an isolated admission assessment; real Runtime remains hard-disabled.
  return Object.freeze({
    readyForReview: missing.length === 0,
    missing: Object.freeze(missing),
    runtimeEnabled: false as const,
    authority: "NONE" as const,
  });
}
