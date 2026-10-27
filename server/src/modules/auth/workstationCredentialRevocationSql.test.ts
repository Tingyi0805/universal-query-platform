import assert from "node:assert/strict";
import test from "node:test";
import { isolatedCredentialRevocationSql as statement } from "./workstationCredentialRevocationSql.js";

test("credential revocation draft uses scoped parameter bindings and locks", () => {
  assert.match(statement.discover, /WITH \(UPDLOCK, HOLDLOCK\)/u);
  for (const part of [statement.discover, statement.mutate, statement.invalidateDevice]) {
    assert.match(part, /@credentialId/u);
    assert.match(part, /@workstationId/u);
    assert.doesNotMatch(part, /\$\{|GRANT\s|EXEC\s*\(/iu);
  }
});

test("device session revocation uses a permitted 926 reason and only active sessions", () => {
  assert.match(statement.invalidateDevice, /RevocationReason=N'CREDENTIAL_REVOKED'/u);
  assert.match(statement.invalidateDevice, /RevokedAtUtc IS NULL/u);
  assert.match(statement.invalidateDevice, /DeviceSessionsRevoked/u);
});

test("isolated statements cannot be mistaken for completed atomic operator revocation", () => {
  assert.equal(statement.operatorInvalidationImplemented, false);
  assert.equal(statement.atomicAuditImplemented, false);
  assert.equal(statement.productionReady, false);
  assert.deepEqual(statement.requiredBindings, ["credentialId", "workstationId"]);
});
