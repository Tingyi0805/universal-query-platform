import assert from "node:assert/strict";
import test from "node:test";
import type { RevocationSqlDriver } from "./workstationRevocationSqlBoundary.js";
import {
  probeIsolatedRevocationSqlBoundary, sqlRevocationBoundaryReleaseGate,
} from "./workstationRevocationSqlBoundary.js";

function fixture(opts: { noPool?: boolean; badGate?: boolean; failBegin?: boolean; failRollback?: boolean } = {}) {
  const calls: string[] = [];
  const driver: RevocationSqlDriver = {
    async getPool() { calls.push("pool"); return opts.noPool ? null : {}; },
    transaction() {
      calls.push("tx");
      return {
        async begin() { calls.push("begin"); if (opts.failBegin) throw Error("begin"); },
        async commit() { calls.push("COMMIT_FORBIDDEN"); throw Error("never"); },
        async rollback() { calls.push("rollback"); if (opts.failRollback) throw Error("rollback"); },
      };
    },
    request() {
      calls.push("request");
      return {
        input() { throw Error("no mutation binding"); },
        async query(statement) {
          calls.push("gate");
          assert.match(statement, /sp_getapplock/u);
          return { recordset: [{ GateResult: opts.badGate ? -1 : 0 }], rowsAffected: [] };
        },
      };
    },
  };
  return { calls, driver };
}

test("SQL boundary takes the transaction-owned security gate and ALWAYS rolls back", async () => {
  const f = fixture();
  const result = await probeIsolatedRevocationSqlBoundary(f.driver);
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.runtimeEnabled, false);
  assert.equal(result.authority, "NONE");
  assert.deepEqual(f.calls, ["pool", "tx", "begin", "request", "gate", "rollback"]);
  assert.equal(sqlRevocationBoundaryReleaseGate.credentialWriterIntegrated, false);
});

test("no pool, gate failure and rollback uncertainty never commit", async () => {
  for (const [options, expected] of [
    [{ noPool: true }, "DATABASE_UNAVAILABLE"],
    [{ badGate: true }, "GATE_REJECTED"],
    [{ failBegin: true }, "GATE_REJECTED"],
    [{ failRollback: true }, "ROLLBACK_UNKNOWN"],
  ] as const) {
    const f = fixture(options);
    const result = await probeIsolatedRevocationSqlBoundary(f.driver);
    assert.equal(result.status, expected);
    assert.equal(f.calls.includes("COMMIT_FORBIDDEN"), false);
  }
});
