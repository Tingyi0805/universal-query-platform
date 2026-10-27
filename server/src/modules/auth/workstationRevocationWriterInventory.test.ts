import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import {
  assessWorkstationRevocationCoverage,
  workstationRevocationWriterInventory,
  type RevocationWriterEvidence,
} from "./workstationRevocationWriterInventory.js";

const root = new URL("../../../../", import.meta.url);

test("legacy writer inventory has unique and traceable source paths", () => {
  const seen = new Set<string>();
  for (const writer of workstationRevocationWriterInventory) {
    assert.equal(seen.has(writer.id), false, writer.id);
    seen.add(writer.id);
    if (writer.source !== null) {
      assert.match(writer.source, /^server\/src\/modules\/.*\.ts$/u);
      assert.ok(existsSync(new URL(writer.source, root)), writer.source);
    }
  }
  assert.equal(workstationRevocationWriterInventory.length, 8);
});

test("no evidence or missing atomicity blocks admission without runtime authority", () => {
  const none = assessWorkstationRevocationCoverage([]);
  assert.equal(none.readyForReview, false);
  assert.equal(none.missing.length, workstationRevocationWriterInventory.length);
  assert.equal(none.runtimeEnabled, false);
  assert.equal(none.authority, "NONE");
  const evidence = workstationRevocationWriterInventory.map(writer => ({
    writerId: writer.id, transactionOwnerProven: true, sharedGateProven: true,
    invalidationAtomicityProven: true, auditAtomicityProven: true,
    sql2019Accepted: true,
  })) satisfies RevocationWriterEvidence[];
  const partial = assessWorkstationRevocationCoverage(evidence.map((x, i) =>
    i === 0 ? { ...x, auditAtomicityProven: false } : x));
  assert.deepEqual(partial.missing, workstationRevocationWriterInventory.map(writer => writer.id));
});

test("synthetic evidence cannot clear unknown DBA bypass or enable runtime", () => {
  const evidence: RevocationWriterEvidence[] = workstationRevocationWriterInventory.map(writer => ({
    writerId: writer.id, transactionOwnerProven: true, sharedGateProven: true,
    invalidationAtomicityProven: true, auditAtomicityProven: true,
    sql2019Accepted: true,
  }));
  const result = assessWorkstationRevocationCoverage(evidence);
  assert.equal(result.readyForReview, false);
  assert.deepEqual(result.missing, workstationRevocationWriterInventory.map(writer => writer.id));
  assert.equal(result.runtimeEnabled, false);
  assert.equal(result.authority, "NONE");
});
