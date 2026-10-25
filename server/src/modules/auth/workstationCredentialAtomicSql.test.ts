import assert from "node:assert/strict";
import test from "node:test";
import { isolatedCredentialAtomicSql as s } from "./workstationCredentialAtomicSql.js";
import { readFileSync } from "node:fs";

test("isolated SQL statements are scoped and parameterized, with no commit", () => {
  for (const [name, value] of Object.entries(s)) {
    if (typeof value !== "string") continue;
    assert.match(value, /@workstationId/u, name);
    assert.doesNotMatch(value, /\bCOMMIT\b|\bBEGIN\s+TRAN(?:SACTION)?\b/iu, name);
  }
  assert.equal(s.productionReady, false);
  assert.equal(s.transactionsImplemented, false);
  assert.equal(s.auditDecisionIntegrated, false);
});

test("operator CAS rotates generation and incarnation; session writes are counted", () => {
  assert.match(s.revokeOperatorCas, /Generation=Generation\+CONVERT\(BIGINT,1\)/u);
  assert.match(s.revokeOperatorCas, /Incarnation=@nextIncarnation/u);
  assert.match(s.revokeOperatorCas, /RowVersion=CONVERT\(BINARY\(8\),@expectedOperatorRevision,2\)/u);
  for (const sql of [s.credentialCas,s.revokeDevices,s.revokeLegacy,s.revokeOperatorCas]) {
    assert.match(sql, /@@ROWCOUNT/u);
  }
  assert.match(s.remainingDevices, /COUNT_BIG\(\*\)/u);
  assert.match(s.remainingLegacy, /COUNT_BIG\(\*\)/u);
});

test("926 device revoke reason is constrained; legacy workstation string is an integration blocker", () => {
  const schema = readFileSync(new URL("../../../../database/drafts/926_shared_workstation_session_security.sql",import.meta.url),"utf8");
  assert.match(schema,/N'CREDENTIAL_REVOKED#'/u);
  assert.match(schema,/N'WORKSTATION_DISABLED#'/u);
  assert.doesNotMatch(schema,/N'WORKSTATION_REVOKED#'/u);
  assert.match(s.revokeDevices,/RevocationReason=N'CREDENTIAL_REVOKED'/u);
});
