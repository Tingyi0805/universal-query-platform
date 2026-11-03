import assert from "node:assert/strict";
import test from "node:test";
import sql from "mssql";
import { createWorkstationPinState, pinAttemptBuckets } from "./workstationPinState.repository.js";

const buckets = () => pinAttemptBuckets("synthetic-account", 7, "synthetic-network", Buffer.alloc(32, 19));
function fixture() {
  const state = { enabled: true, pools: 0, commits: 0, rollbacks: 0, begins: 0,
    blocked: false, blockedScope: "", affected: 1, generation: "9007199254740993", failCommit: false,
    calls: [] as { text: string; values: Record<string, unknown> }[] };
  const tx = { begin: async (level: number) => { assert.equal(level, sql.ISOLATION_LEVEL.SERIALIZABLE); state.begins++; },
    commit: async () => { if (state.failCommit) throw new Error("synthetic-commit-error"); state.commits++; },
    rollback: async () => { state.rollbacks++; } } as unknown as sql.Transaction;
  const service = createWorkstationPinState({ enabled: () => state.enabled,
    getPool: async () => { state.pools++; return {} as sql.ConnectionPool; }, transaction: () => tx,
    request: current => {
      assert.equal(current, tx);
      const values: Record<string, unknown> = {};
      const req = { input(name: string, _type: unknown, value: unknown) { values[name] = value; return req; },
        async query(text: string) {
          state.calls.push({ text, values });
          return { recordset: text.includes("AS Generation") ? [{ Generation: state.generation }]
            : text.includes("AS IsBlocked") ? [{ IsBlocked: state.blocked && (!state.blockedScope || state.blockedScope === values.scope) ? 1 : 0 }] : [],
            rowsAffected: [state.affected] };
        } };
      return req as unknown as sql.Request;
    },
  });
  return { state, tx, service };
}

test("attempt digests are stable across instances, domain separated, and contain no raw identities", () => {
  const a = buckets(), b = buckets();
  assert.deepEqual(a, b);
  assert.equal(new Set(a.map(x => x.digest.toString("hex"))).size, 3);
  assert.deepEqual(a.map(x => x.limit), [5, 100, 20]);
  assert.notDeepEqual(a, pinAttemptBuckets("synthetic-account", 7, "synthetic-network", Buffer.alloc(32, 20)));
  assert.throws(() => pinAttemptBuckets("", 7, "synthetic-network", Buffer.alloc(32)), /INPUT_INVALID/);
});
test("failure acquires all exact-key locks before any verification and persists all three scopes", async () => {
  const f = fixture();
  assert.equal(await f.service.attempt(buckets().reverse(), async tx => {
    assert.equal(tx, f.tx);
    const locks = f.state.calls.filter(c => c.values.resource);
    assert.deepEqual(locks.map(c => String(c.values.resource).split(":")[1]), ["ACCOUNT", "NETWORK", "WORKSTATION"]);
    assert.equal(f.state.calls.filter(c => c.text.includes("AS IsBlocked")).length, 3);
    assert.equal(f.state.commits, 0);
    return false;
  }), "INVALID");
  const writes = f.state.calls.filter(c => c.values.limit);
  assert.equal(writes.length, 3);
  for (const c of f.state.calls) {
    assert.ok(!c.text.includes("synthetic-account"));
    assert.ok(!JSON.stringify(c.values).includes("synthetic-account"));
    assert.ok(!JSON.stringify(c.values).includes("synthetic-network"));
  }
  assert.equal(f.state.commits, 1);
});
test("blocked attempts do not run verifier or reset persisted failure history", async () => {
  const f = fixture(); f.state.blocked = true;
  assert.equal(await f.service.attempt(buckets(), async () => { throw new Error("must not run"); }), "LOCKED");
  assert.equal(f.state.calls.filter(c => c.values.limit).length, 0);
  assert.equal(f.state.calls.filter(c => c.text.includes("INSERT INTO")).length, 0);
  assert.equal(f.state.commits, 1);
});
test("valid account clears only account history; shared workstation/network failures survive", async () => {
  const f = fixture();
  assert.equal(await f.service.attempt(buckets(), async () => true), "OK");
  const resets = f.state.calls.filter(c => c.text.includes("WHERE ScopeCode=N'ACCOUNT'"));
  assert.equal(resets.length, 1);
  assert.deepEqual(resets[0]!.values.digest, buckets()[0]!.digest);
  assert.equal(f.state.calls.filter(c => c.values.limit).length, 0);
});
test("blocked network cannot allocate arbitrary new account bucket rows", async () => {
  const f = fixture(); f.state.blocked = true; f.state.blockedScope = "NETWORK";
  assert.equal(await f.service.attempt(buckets(), async () => { throw new Error("must not run"); }), "LOCKED");
  assert.equal(f.state.calls.filter(c => c.text.includes("AS IsBlocked")).length, 2);
  assert.equal(f.state.calls.filter(c => c.text.includes("INSERT INTO")).length, 0);
});
test("verification/audit/commit failures roll back and never return success", async () => {
  for (const failure of ["verifier", "audit", "commit"]) {
    const f = fixture(); f.state.failCommit = failure === "commit";
    await assert.rejects(f.service.attempt(buckets(), async () => {
      if (failure !== "commit") throw new Error(`synthetic-${failure}-error`);
      return true;
    }), /synthetic-/);
    assert.equal(f.state.commits, 0);
    assert.equal(f.state.rollbacks, 1);
  }
});
test("switch intent revokes A and audits before commit without rounding BIGINT generation", async () => {
  const f = fixture();
  const generation = await f.service.revokeForIntent(7, async (tx, version) => {
    assert.equal(tx, f.tx); assert.equal(version, "9007199254740993");
    assert.ok(f.state.calls.at(-1)!.text.includes("RevokedAtUtc=SYSUTCDATETIME()"));
    assert.equal(f.state.commits, 0);
  });
  assert.equal(generation, "9007199254740993");
  assert.equal(f.state.commits, 1);
});
test("revocation audit failure rolls back phase one; stale phase two cannot claim current generation", async () => {
  const f = fixture();
  await assert.rejects(f.service.revokeForIntent(7, async () => { throw new Error("audit-failed"); }), /audit-failed/);
  assert.equal(f.state.rollbacks, 1); assert.equal(f.state.commits, 0);
  f.state.affected = 0;
  assert.equal(await f.service.claimGeneration(f.tx, 7, "9007199254740993"), false);
  assert.equal(f.state.calls.at(-1)!.values.generation, "9007199254740993");
  assert.equal(f.state.begins, 1); // phase two uses caller's transaction, no independent commit.
  assert.equal(f.state.commits, 0);
});
test("invalid generation/buckets and disabled runtime cannot touch the DB", async () => {
  const f = fixture();
  await assert.rejects(f.service.attempt(buckets().slice(1), async () => true), /INPUT_INVALID/);
  for (const generation of ["0", "-1", "01", "1 OR 1=1", "9223372036854775808"]) {
    await assert.rejects(f.service.claimGeneration(f.tx, 7, generation), /GENERATION_INVALID/);
  }
  f.state.enabled = false;
  await assert.rejects(f.service.attempt(buckets(), async () => true), /RUNTIME_DISABLED/);
  await assert.rejects(f.service.revokeForIntent(7, async () => undefined), /RUNTIME_DISABLED/);
  await assert.rejects(f.service.claimGeneration(f.tx, 7, "1"), /RUNTIME_DISABLED/);
  assert.equal(f.state.pools, 0); assert.equal(f.state.calls.length, 0);
});
