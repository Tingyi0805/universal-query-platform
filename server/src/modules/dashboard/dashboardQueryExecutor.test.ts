import assert from "node:assert/strict";
import test from "node:test";
import { DashboardQueryExecutor } from "./dashboardQueryExecutor.js";

test("concurrent page loads share identical SQL work, while other sources respect the limit", async () => {
  const executor = new DashboardQueryExecutor(1, 1, 1000);
  let calls = 0; let release!: (value: number) => void;
  const first = executor.run("sourceA", () => { calls++; return new Promise<number>(resolve => { release = resolve; }); });
  const duplicate = executor.run("sourceA", async () => { calls++; return 2; });
  assert.equal(first, duplicate);
  const queued = executor.run("sourceB", async () => { calls++; return 3; });
  await assert.rejects(executor.run("sourceC", async () => 4), /DASHBOARD_QUERY_BUSY/);
  release(1); assert.equal(await first, 1); assert.equal(await queued, 3); assert.equal(calls, 2);
});
test("timed-out SQL holds its slot and deduplication key until driver completion", async () => {
  const executor = new DashboardQueryExecutor(1, 0, 10);
  let finish!: (value: number) => void;
  const first = executor.run("slow", () => new Promise<number>(resolve => { finish = resolve; }));
  await assert.rejects(first, /DASHBOARD_QUERY_TIMEOUT/);
  assert.equal(executor.run("slow", async () => 2), first);
  await assert.rejects(executor.run("other", async () => 3), /DASHBOARD_QUERY_BUSY/);
  finish(1); for (let i = 0; i < 8; i++) await Promise.resolve();
  assert.equal(await executor.run("other", async () => 3), 3);
});
test("a failed Dataset does not poison other sources or subsequent retries", async () => {
  const executor = new DashboardQueryExecutor(2, 1, 1000);
  const failed = executor.run("bad", async () => { throw new Error("synthetic failure"); });
  const good = executor.run("good", async () => 1);
  await assert.rejects(failed, /synthetic failure/); assert.equal(await good, 1);
  assert.equal(await executor.run("bad", async () => 2), 2);
});
