import assert from "node:assert/strict";
import test from "node:test";
import sql from "mssql";
import { createDeliveryAuditFinalizer, type defaultDeliveryAuditDependencies } from "./deliveryAudit.repository.js";

for (const failure of ["none", "write", "zero-rows", "validation", "commit", "validation-and-failed-write"] as const) {
  test(`delivery SUCCESS is atomic with post-audit validation: ${failure}`, async () => {
    let status = "STARTED", staged = status, commits = 0, rollbacks = 0, validations = 0;
    const tx = {
      begin: async (level: number) => { assert.equal(level, sql.ISOLATION_LEVEL.SERIALIZABLE); },
      commit: async () => { if (failure === "commit") throw new Error("commit"); status = staged; commits++; },
      rollback: async () => { staged = status; rollbacks++; },
    } as unknown as sql.Transaction;
    const request = {
      input() { return request; },
      query: async (statement: string) => {
        if (statement.includes("UPDATE uqp.AuditLog")) {
          assert.ok(statement.includes("Status='STARTED'"));
          if (failure === "write") throw new Error("write");
          if (failure === "zero-rows") return { rowsAffected: [0] };
          staged = "SUCCESS";
        }
        return { rowsAffected: [1] };
      },
    };
    const finalize = createDeliveryAuditFinalizer({ pool: async () => ({}) as sql.ConnectionPool,
      transaction: () => tx, request: actual => { assert.equal(actual, tx); return request as never; },
    } satisfies typeof defaultDeliveryAuditDependencies);
    const run = () => finalize(5, { rowCount: 1 }, async actual => {
      validations++; assert.equal(actual, tx); assert.equal(staged, "SUCCESS"); assert.equal(status, "STARTED");
      if (failure === "validation" || failure === "validation-and-failed-write") throw new Error("policy changed");
    });
    if (failure === "none") {
      await run(); assert.equal(status, "SUCCESS"); assert.equal(commits, 1); assert.equal(rollbacks, 0);
    } else {
      await assert.rejects(run());
      // Even if the outer best-effort failure write cannot run, SUCCESS was rolled back.
      assert.equal(status, "STARTED"); assert.equal(commits, 0); assert.equal(rollbacks, 1);
    }
    assert.equal(validations, failure === "write" || failure === "zero-rows" ? 0 : 1);
  });
}
