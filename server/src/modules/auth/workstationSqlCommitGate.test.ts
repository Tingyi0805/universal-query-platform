import assert from "node:assert/strict";
import test from "node:test";
import {
  assessWorkstationSqlCommit,
  exactSqlBigintReceipt,
  mayAutomaticallyRetryWorkstationWrite,
  type WorkstationSqlCommitEvidence,
} from "./workstationSqlCommitGate.js";

const valid = (): WorkstationSqlCommitEvidence => ({
  commitOutcome: "COMMITTED",
  affectedRows: 1,
  auditAffectedRows: 1,
  decisionAffectedRows: 1,
  auditLogId: "9007199254740993",
});

test("SQL receipt preserves audit ID beyond JavaScript safe integer", () => {
  assert.equal(exactSqlBigintReceipt("9007199254740993"), true);
  assert.deepEqual(assessWorkstationSqlCommit(valid()), {
    ok: true, auditLogId: "9007199254740993", authority: "NONE",
  });
  for (const bad of [1, 9007199254740993, "0", "01", "+1", "9223372036854775808", " 1", null]) {
    assert.equal(exactSqlBigintReceipt(bad), false);
  }
});

test("rollback or ambiguous commit cannot prove mutation", () => {
  for (const commitOutcome of ["ROLLED_BACK", "UNKNOWN"] as const) {
    assert.deepEqual(assessWorkstationSqlCommit({ ...valid(), commitOutcome }), {
      ok: false, code: "COMMIT_NOT_CONFIRMED", authority: "NONE",
    });
  }
});

test("CAS, audit and immutable decision require exactly one affected row each", () => {
  for (const [field, code] of [
    ["affectedRows", "CAS_NOT_UNIQUE"],
    ["auditAffectedRows", "AUDIT_MISSING"],
    ["decisionAffectedRows", "DECISION_MISSING"],
  ] as const) {
    for (const count of [0, 2, Number.NaN]) {
      assert.deepEqual(assessWorkstationSqlCommit({ ...valid(), [field]: count }), {
        ok: false, code, authority: "NONE",
      });
    }
  }
});

test("commit gate does not accept missing or imprecise audit receipts", () => {
  assert.deepEqual(assessWorkstationSqlCommit({ ...valid(), auditLogId: 9007199254740993 }), {
    ok: false, code: "AUDIT_ID_INVALID", authority: "NONE",
  });
});

test("1205, 1222 and unknown commit never implicitly repeat a write", () => {
  for (const code of [1205, 1222, null]) {
    for (const outcome of ["COMMITTED", "ROLLED_BACK", "UNKNOWN"] as const) {
      assert.equal(mayAutomaticallyRetryWorkstationWrite(code, outcome), false);
    }
  }
});
