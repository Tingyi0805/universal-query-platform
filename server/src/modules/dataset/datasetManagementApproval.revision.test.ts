import assert from "node:assert/strict";
import test from "node:test";
import { decodeDatasetApprovalRevision } from "./datasetManagementApproval.revision.js";

test("Dataset approval reads the native ROWVERSION as 16 exact hex digits", () => {
  assert.equal(
    decodeDatasetApprovalRevision(Buffer.from("00000000000000af", "hex")),
    "00000000000000af",
  );
  assert.equal(
    decodeDatasetApprovalRevision(Buffer.from("ffffffffffffffff", "hex")),
    "ffffffffffffffff",
  );
});

test("Dataset approval rejects VARCHAR, null and non-8-byte revisions", () => {
  for (const value of [null, undefined, 1, "00000000000000af", "0x00000000000000af",
    Buffer.alloc(7), Buffer.alloc(9), new Uint8Array(8)]) {
    assert.equal(decodeDatasetApprovalRevision(value), null);
  }
});
