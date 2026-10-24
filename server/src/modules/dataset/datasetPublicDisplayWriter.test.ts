import assert from "node:assert/strict";
import test from "node:test";
import { saveDatasetPublicDisplayConfirmation, type DatasetPublicDisplayWriter } from "./datasetPublicDisplayWriter.js";
const sensitivity = { version: 8, columns: [{ columnName: "NAME", sensitivityType: "NAME", deviceMaskMode: "FULL" as const }] };
test("public display writer persists version-confirmed policy and audit in one transaction contract", async () => {
  const operations: string[] = [];
  const writer: DatasetPublicDisplayWriter = { transaction: async (_id, work) => {
    operations.push("BEGIN");
    const result = await work({
      readSensitivity: async () => sensitivity,
      readPolicy: async () => null,
      writePolicy: async () => { operations.push("WRITE"); },
      auditConfirmation: async () => { operations.push("AUDIT"); },
    });
    operations.push("COMMIT"); return result;
  } };
  const result = await saveDatasetPublicDisplayConfirmation(writer, 12, 2, { expectedSensitivityVersion: 8,
    expectedPolicyDigest: null, grants: [{ columnName: "NAME", permitted: true }] });
  assert.deepEqual(operations, ["BEGIN", "WRITE", "AUDIT", "COMMIT"]);
  assert.equal(result.policy.confirmed, true);
  assert.match(result.digest, /^[a-f0-9]{64}$/);
});
test("conflicts and invalid grants cannot reach persistence or audit", async () => {
  let writes = 0;
  const writer: DatasetPublicDisplayWriter = { transaction: async (_id, work) => work({
    readSensitivity: async () => sensitivity, readPolicy: async () => null,
    writePolicy: async () => { writes++; }, auditConfirmation: async () => { writes++; },
  }) };
  await assert.rejects(saveDatasetPublicDisplayConfirmation(writer, 12, 2, { expectedSensitivityVersion: 7,
    expectedPolicyDigest: null, grants: [{ columnName: "NAME", permitted: true }] }), /VERSION_CONFLICT/);
  await assert.rejects(saveDatasetPublicDisplayConfirmation(writer, 12, 2, { expectedSensitivityVersion: 8,
    expectedPolicyDigest: null, grants: [{ columnName: "UNLISTED", permitted: true }] }), /POLICY_DENIED/);
  assert.equal(writes, 0);
});
test("an audit failure must be propagated and never reported as committed success", async () => {
  const writer: DatasetPublicDisplayWriter = { transaction: async (_id, work) => work({
    readSensitivity: async () => sensitivity, readPolicy: async () => null,
    writePolicy: async () => {}, auditConfirmation: async () => { throw new Error("AUDIT_FAILED"); },
  }) };
  await assert.rejects(saveDatasetPublicDisplayConfirmation(writer, 12, 2, { expectedSensitivityVersion: 8,
    expectedPolicyDigest: null, grants: [{ columnName: "NAME", permitted: true }] }), /AUDIT_FAILED/);
});
