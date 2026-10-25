import assert from "node:assert/strict";
import test from "node:test";
import { assessRevocationTransaction, workstationRevocationLockOrder, type RevocationMutation } from "./workstationRevocationTransactionContract.js";

const valid = (): RevocationMutation => ({
  scope: "USER",
  scopeId: "9007199254740993",
  transactionOwner: "REPOSITORY_OWNED",
  isolation: "SERIALIZABLE",
  xactAbort: true,
  securityGateHeld: true,
  locks: [...workstationRevocationLockOrder],
  legacyMutationAffected: 1,
  sessionInvalidationAffected: 0,
  auditAffected: 1,
  auditLogId: "9007199254740993",
  commitOutcome: "COMMITTED",
  sqlServer2019Accepted: true,
});

test("complete synthetic transaction evidence cannot activate runtime", () => {
  const result = assessRevocationTransaction(valid());
  assert.equal(result.consistent, true);
  assert.equal(result.runtimeEnabled, false);
  assert.equal(result.authority, "NONE");
});

test("revocation requires canonical BIGINT IDs, no JS Number precision repair", () => {
  for (const scopeId of ["0", "01", "9223372036854775808", " 1", 9007199254740993]) {
    assert.ok(assessRevocationTransaction({ ...valid(), scopeId: scopeId as string }).failures.includes("INVALID_SCOPE"));
  }
});

test("missing gate, invalid lock order, absent audit, unknown commit and absent SQL acceptance block", () => {
  const cases: readonly Partial<RevocationMutation>[] = [
    { securityGateHeld: false }, { locks: [...workstationRevocationLockOrder].reverse() },
    { auditAffected: 0 }, { auditLogId: "01" }, { commitOutcome: "UNKNOWN" },
    { commitOutcome: "ROLLED_BACK" }, { sqlServer2019Accepted: false },
    { legacyMutationAffected: 0 }, { sessionInvalidationAffected: -1 },
  ];
  for (const change of cases) {
    const result = assessRevocationTransaction({ ...valid(), ...change });
    assert.equal(result.consistent, false, JSON.stringify(change));
    assert.equal(result.runtimeEnabled, false);
  }
});
