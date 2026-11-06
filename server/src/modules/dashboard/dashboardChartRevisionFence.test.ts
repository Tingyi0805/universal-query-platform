import test from "node:test";
import assert from "node:assert/strict";
import {
  createFencedChartOperation, type ChartRevisionFence, type ChartFenceReader,
} from "./dashboardChartRevisionFence.js";
import type { ExecutionSubject } from "./dashboardQuerySourceExecution.js";

const subject: ExecutionSubject = { userId: 8, tokenVersion: 1,
  tokenHash: "synthetic", context: "designer" };
const scope: ChartRevisionFence = {
  dashboardId: 7, sourceKey: "PRIMARY", queryId: 9, datasetId: 10,
  userId: 8, tokenVersion: 1, version: "a".repeat(64),
};
function fixture(answers: Array<ChartRevisionFence | null>) {
  let reads = 0, called = 0;
  const read: ChartFenceReader = async () => answers[reads++] ?? null;
  const guarded = createFencedChartOperation(read, async () => {
    called++; return { chartType: "BAR", points: [{ label: "OR-01", value: 7 }] };
  });
  return { execute: () => guarded(7, "PRIMARY", 9, 10, subject),
    count: () => ({ reads, called }) };
}
test("stable before/after revision fence wraps exactly one audited operation", async () => {
  const f = fixture([scope, scope]);
  assert.deepEqual(await f.execute(), { chartType: "BAR", points: [{ label: "OR-01", value: 7 }] });
  assert.deepEqual(f.count(), { reads: 2, called: 1 });
});
test("missing or malformed initial evidence never invokes a Query operation", async () => {
  for (const evidence of [null, { ...scope, version: "bad" }]) {
    const f = fixture([evidence]); assert.equal(await f.execute(), null);
    assert.deepEqual(f.count(), { reads: 1, called: 0 });
  }
});
test("changed version, actor, source, query, dataset or absent final fence reject already read result", async () => {
  for (const changed of [
    null, { ...scope, version: "b".repeat(64) },
    { ...scope, dashboardId: 77 }, { ...scope, sourceKey: "EXTRA" },
    { ...scope, queryId: 44 }, { ...scope, datasetId: 45 },
    { ...scope, userId: 10 }, { ...scope, tokenVersion: 2 },
  ]) {
    const f = fixture([scope, changed]);
    assert.equal(await f.execute(), null);
    assert.deepEqual(f.count(), { reads: 2, called: 1 });
  }
});
test("fence is not an excuse to swallow errors from the existing audited delivery", async () => {
  const guarded = createFencedChartOperation(
    async () => scope, async () => { throw Error("MANDATORY_PATIENT_AUDIT_FAILED"); });
  await assert.rejects(guarded(7, "PRIMARY", 9, 10, subject), /MANDATORY_PATIENT_AUDIT_FAILED/);
});
