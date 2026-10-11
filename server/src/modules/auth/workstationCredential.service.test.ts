import assert from "node:assert/strict";
import test from "node:test";
import { createDeviceSecret, hashDeviceSecret, matchesDeviceSecret } from "./workstationCredential.service.js";

test("workstation secrets are random and match only their own hash", () => {
  const first = createDeviceSecret();
  const second = createDeviceSecret();
  assert.equal(first.length, 43);
  assert.notEqual(first, second);
  assert.equal(matchesDeviceSecret(first, hashDeviceSecret(first)), true);
  assert.equal(matchesDeviceSecret(second, hashDeviceSecret(first)), false);
});

test("rejects malformed credential and malformed hash", () => {
  const secret = createDeviceSecret();
  assert.equal(matchesDeviceSecret("123", hashDeviceSecret(secret)), false);
  assert.equal(matchesDeviceSecret(secret, Buffer.alloc(1)), false);
  assert.equal(matchesDeviceSecret(secret + "x", hashDeviceSecret(secret)), false);
});
