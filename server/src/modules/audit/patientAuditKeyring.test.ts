import assert from "node:assert/strict";
import test from "node:test";
import {
  hashPatientForDisclosure, hashPatientForHistoricalLookup, parsePatientAuditKeyring,
} from "./patientAuditKeyring.js";

const a = Buffer.alloc(32, 0x41).toString("base64");
const b = Buffer.alloc(32, 0x42).toString("base64");
test("new records use active version; historical lookups include retained versions", () => {
  const keyring = parsePatientAuditKeyring("2", JSON.stringify({ "1": a, "2": b }));
  const current = hashPatientForDisclosure("00001234", "HIS-A", keyring);
  const history = hashPatientForHistoricalLookup("00001234", "HIS-A", keyring);
  assert.equal(current.keyVersion, 2);
  assert.equal(history.length, 2);
  assert.deepEqual(history.find(item => item.keyVersion === 2)?.patientKeyHash, current.patientKeyHash);
  assert.notDeepEqual(history[0]!.patientKeyHash, current.patientKeyHash);
});
test("missing active version or weak key is rejected", () => {
  assert.throws(() => parsePatientAuditKeyring("3", JSON.stringify({ "1": a })), /ACTIVE_KEY_NOT_FOUND/);
  assert.throws(() => parsePatientAuditKeyring("1", JSON.stringify({ "1": Buffer.alloc(8).toString("base64") })), /KEY_INVALID/);
  assert.throws(() => parsePatientAuditKeyring("0", JSON.stringify({ "1": a })), /VERSION_INVALID/);
});
