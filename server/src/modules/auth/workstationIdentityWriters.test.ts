/** Actual repository functions with test-local SQL constructors. No SQL connection. */
import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import sql from "mssql";
import { env } from "../../config/env.js";
import { closePlatformDbPool } from "../../config/database.js";
import * as admin from "../admin/admin.repository.js";
import { updateOwnLocalPassword } from "./auth.repository.js";
import { createSharedWorkstation } from "../admin/sharedWorkstation.repository.js";
import { legacyWorkstationWriterFenceSql } from "./workstationLegacyWriterFence.js";
import { LegacyWorkstationWriterError } from "./workstationLegacyTransaction.js";
import { logger } from "../../config/logger.js";

type Options = { gate?: string; failDml?: number; errorNumber?: number; commitUnknown?: boolean; rollbackUnknown?: boolean;
  lastAdmin?: boolean; history?: boolean; systemRole?: boolean; bootstrapDone?: boolean };
function fixture(t: TestContext, options: Options = {}) {
  const state = { events: [] as string[], queries: [] as { text: string; values: Record<string, unknown> }[],
    pending: [] as string[], committed: [] as string[], dml: 0 };
  const keys = ["PLATFORM_DB_SERVER","PLATFORM_DB_DATABASE","PLATFORM_DB_USER","PLATFORM_DB_PASSWORD"] as const;
  const saved = Object.fromEntries(keys.map(key => [key, env[key]]));
  Object.assign(env, { PLATFORM_DB_SERVER: "synthetic.invalid", PLATFORM_DB_DATABASE: "SYNTHETIC",
    PLATFORM_DB_USER: "synthetic", PLATFORM_DB_PASSWORD: "SYNTHETIC_NOT_A_CREDENTIAL" });
  t.mock.method(logger, "info", () => undefined); // Do not print "pool connected" for a fake pool.
  t.after(async () => { await closePlatformDbPool(); Object.assign(env, saved); });
  const tx = {
    async begin(level: number) { assert.equal(level, sql.ISOLATION_LEVEL.SERIALIZABLE); state.events.push("begin"); },
    async commit() {
      state.events.push("commit");
      if (options.commitUnknown) throw Error("SENSITIVE_DRIVER_DETAIL");
      state.committed = [...state.pending];
    },
    async rollback() { state.events.push("rollback"); if (options.rollbackUnknown) throw Error("SENSITIVE_ROLLBACK"); state.pending = []; },
  };
  const pool = { connected: true, async connect() { return pool; }, async close() {},
    request() { assert.fail("identity writer must not use autocommit pool requests"); } };
  t.mock.method(sql, "ConnectionPool", function () { return pool; } as never);
  t.mock.method(sql, "Transaction", function (owner: unknown) { assert.equal(owner, pool); return tx; } as never);
  t.mock.method(sql, "Request", function (owner: unknown) {
    assert.equal(owner, tx);
    const values: Record<string, unknown> = {};
    const request = {
      input(name: string, _type: unknown, value: unknown) { values[name] = value; return request; },
      async query(text: string) {
        state.queries.push({ text, values: { ...values } });
        if (text === legacyWorkstationWriterFenceSql) {
          state.events.push("gate");
          if (options.gate) throw Object.assign(Error("SENSITIVE_GATE_" + options.gate), { number: 52926 });
          return { recordset: [] };
        }
        state.events.push("business");
        if (/^\s*(INSERT|UPDATE|DELETE)\b/.test(text)) {
          state.dml++; state.pending.push(text);
          if (options.failDml === state.dml) throw Object.assign(Error("SENSITIVE_SQL_INPUT"), { number: options.errorNumber ?? 1205 });
        }
        if (text.includes("COUNT(1) AS Cnt FROM uqp.AppUser")) return { recordset: [{ Cnt: options.bootstrapDone ? 1 : 0 }] };
        if (text.includes("COUNT(DISTINCT")) return { recordset: [{ Cnt: options.lastAdmin ? 1 : 2 }] };
        if (text.includes("IsSystemAdmin")) return { recordset: [{ Id: 7, IsActive: true, IsSystemAdmin: !!options.lastAdmin }] };
        if (text.includes("AS AuditLogCount")) return { recordset: [{ AuditLogCount: options.history ? 1 : 0, PublishedQueryCount: 0 }] };
        if (text.includes("SELECT Code, IsSystem")) return { recordset: [{ Code: options.systemRole ? "SYSTEM_ADMIN" : "REPORT_USER", IsSystem: !!options.systemRole, IsActive: true }] };
        if (text.includes("SELECT r.Code")) return { recordset: [{ Code: "REPORT_USER" }] };
        if (text.includes("SELECT p.Code") || text.includes("SELECT Code FROM uqp.Permission")) return { recordset: [{ Code: "VIEW_QUERY" }] };
        if (text.includes("OUTPUT INSERTED.Id")) return { recordset: [{ Id: 7, id: 7 }] };
        if (text.includes("OUTPUT INSERTED.TokenVersion")) return { recordset: [{ TokenVersion: 2 }] };
        return { recordset: [{ Affected: 1 }] };
      },
    }; return request;
  } as never);
  return state;
}
const operations = {
  bootstrap: () => admin.createInitialAdmin({ username: "synthetic", displayName: "SYNTHETIC", passwordHash: "SYNTHETIC_HASH" }),
  createUser: () => admin.createUser({ username: "synthetic", displayName: "SYNTHETIC", passwordHash: "SYNTHETIC_HASH", roleCodes: ["REPORT_USER"] }),
  updateUser: () => admin.updateUser(7, { displayName: "SYNTHETIC", isActive: false, roleCodes: ["REPORT_USER"] }),
  resetPassword: () => admin.resetUserPassword(7, "SYNTHETIC_HASH"),
  ownPassword: () => updateOwnLocalPassword(7, "SYNTHETIC_HASH"),
  createRole: () => admin.createRole({ code: "SYNTHETIC", name: "SYNTHETIC", permissionCodes: ["VIEW_QUERY"] }),
  updateRole: () => admin.updateRole(2, { name: "SYNTHETIC", isActive: false, permissionCodes: ["VIEW_QUERY"] }),
  deleteUser: () => admin.deleteUser(7),
  revokeSessions: () => admin.revokeUserSessions(7),
  createWorkstation: () => createSharedWorkstation("SYNTHETIC", "SYNTHETIC", "UNKNOWN"),
};
for (const [name, work] of Object.entries(operations)) {
  test("real legacy repository uses one SERIALIZABLE owner/gate before business: " + name, async t => {
    const f = fixture(t); await work();
    assert.deepEqual(f.events.slice(0,2), ["begin","gate"]);
    assert.equal(f.events.at(-1), "commit"); assert.ok(f.dml > 0);
    assert.deepEqual(f.committed, f.pending); assert.ok(!f.events.includes("rollback"));
    if (name === "updateUser") assert.equal(f.queries.find(q => "securityChanged" in q.values)?.values.securityChanged, true);
    if (name === "updateRole") assert.ok(f.pending.some(q => q.includes("TokenVersion=TokenVersion+1")));
  });
  for (const gate of ["SCHEMA_926","PARTIAL_SCHEMA","VISIBILITY_UNKNOWN","GATE_DENIED"])
    test("deny before identity/RBAC DML: " + name + "/" + gate, async t => {
      const f = fixture(t, { gate });
      await assert.rejects(work(), (error: unknown) => error instanceof LegacyWorkstationWriterError && error.code === "LEGACY_WRITER_BLOCKED" &&
        !error.stack?.includes("SENSITIVE"));
      assert.deepEqual(f.events, ["begin","gate","rollback"]); assert.equal(f.dml, 0); assert.deepEqual(f.committed, []);
    });
}
for (const [name, work, options, message] of [
  ["last admin", operations.updateUser, { lastAdmin: true }, "LAST_SYSTEM_ADMIN"],
  ["user history", operations.deleteUser, { history: true }, "USER_HAS_HISTORY"],
  ["system role", operations.updateRole, { systemRole: true }, "SYSTEM_ROLE_PROTECTED"],
  ["bootstrap completed", operations.bootstrap, { bootstrapDone: true }, "BOOTSTRAP_ALREADY_COMPLETED"],
] as const) test("existing protection is preserved: " + name, async t => {
  const f = fixture(t, options);
  await assert.rejects(work(), { message }); assert.equal(f.dml, 0); assert.equal(f.events.at(-1), "rollback");
});
for (const number of [1205, 1222, 229]) test("mid-mutation SQL fault rolls back without exposing input or retry: " + number, async t => {
  const f = fixture(t, { failDml: 2, errorNumber: number });
  await assert.rejects(operations.updateUser(), (error: unknown) => error instanceof LegacyWorkstationWriterError && error.code === "LEGACY_WRITE_FAILED" &&
    !error.stack?.includes("SENSITIVE"));
  assert.equal(f.dml, 2); assert.deepEqual(f.committed, []); assert.equal(f.events.at(-1), "rollback");
});
test("commit unknown is never rolled back or retried as a known failure", async t => {
  const f = fixture(t, { commitUnknown: true });
  await assert.rejects(operations.revokeSessions(), (e: unknown) => e instanceof LegacyWorkstationWriterError && e.code === "LEGACY_COMMIT_UNKNOWN");
  assert.equal(f.events.filter(e => e === "commit").length, 1); assert.ok(!f.events.includes("rollback"));
});
test("rollback failure stays unknown; duplicate-key HTTP compatibility keeps only the numeric code", async t => {
  const f = fixture(t, { failDml: 1, rollbackUnknown: true });
  await assert.rejects(operations.revokeSessions(), (e: unknown) => e instanceof LegacyWorkstationWriterError && e.code === "LEGACY_ROLLBACK_UNKNOWN");
  assert.ok(!f.events.includes("commit"));
});
test("duplicate username/role SQL code remains available to existing HTTP 409 handlers", async t => {
  fixture(t, { failDml: 1, errorNumber: 2627 });
  await assert.rejects(operations.createUser(), (e: unknown) => e instanceof LegacyWorkstationWriterError && e.number === 2627 && !e.stack?.includes("SENSITIVE"));
});
