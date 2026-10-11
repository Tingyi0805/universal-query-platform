import assert from "node:assert/strict";
import test from "node:test";
import { normalizePatientIdentity, parsePatientAuditHmacKey, patientIdentityDigest } from "./patientIdentityHmac.js";

const key = Buffer.alloc(32, 0x5a);
test("stable digest for same patient and source, different for another source", () => {
  const first = patientIdentityDigest(" 00001234 ", "HIS-ORACLE", key);
  const second = patientIdentityDigest("00001234", "HIS-ORACLE", key);
  const other = patientIdentityDigest("00001234", "OTHER-SOURCE", key);
  assert.equal(first.length, 32);
  assert.deepEqual(first, second);
  assert.notDeepEqual(first, other);
  assert.equal(first.includes(Buffer.from("00001234")), false);
});
test("identity normalization preserves leading zeros and rejects missing identifiers", () => {
  assert.equal(normalizePatientIdentity(" ００００１２３４ "), "00001234");
  assert.throws(() => normalizePatientIdentity(null), /PATIENT_IDENTITY_INVALID/);
  assert.throws(() => normalizePatientIdentity(" "), /PATIENT_IDENTITY_INVALID/);
});
test("key must be explicitly configured and at least 256 bits", () => {
  assert.deepEqual(parsePatientAuditHmacKey(key.toString("base64")), key);
  assert.throws(() => parsePatientAuditHmacKey(undefined), /NOT_CONFIGURED/);
  assert.throws(() => parsePatientAuditHmacKey(Buffer.alloc(16).toString("base64")), /INVALID/);
  assert.throws(() => patientIdentityDigest("123", "source", Buffer.alloc(16)), /INVALID/);
});
