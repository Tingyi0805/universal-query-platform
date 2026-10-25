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
      return !proof || !proof.transactionOwnerProven || !proof.sharedGateProven ||
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
