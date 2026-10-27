import assert from "node:assert/strict";
import test from "node:test";
import { isolatedCredentialAtomicSql as s } from "./workstationCredentialAtomicSql.js";
import { readFileSync } from "node:fs";

test("isolated SQL statements are scoped and parameterized, with no commit", () => {
  for (const [name, value] of Object.entries(s)) {
    if (typeof value !== "string") continue;
    if (name !== "insertAudit") assert.match(value, /@workstationId/u, name);
    assert.doesNotMatch(value, /\bCOMMIT\b|\bBEGIN\s+TRAN(?:SACTION)?\b/iu, name);
  }
  assert.equal(s.productionReady, false);
  assert.equal(s.transactionsImplemented, false);
  assert.equal(s.auditDecisionIntegrated, false);
});

test("operator CAS rotates generation and incarnation; session writes are counted", () => {
  assert.match(s.revokeOperatorCas, /Generation=Generation\+CONVERT\(BIGINT,1\)/u);
  assert.match(s.revokeOperatorCas, /Incarnation=@nextIncarnation/u);
  assert.match(s.revokeOperatorCas, /Generation < CONVERT\(BIGINT, '9223372036854775807'\)/u);
  assert.match(s.revokeOperatorCas, /RowVersion=CONVERT\(BINARY\(8\),@expectedOperatorRevision,2\)/u);
  for (const sql of [s.credentialCas,s.revokeDevices]) {
    assert.match(sql, /@@ROWCOUNT/u);
  }
  assert.match(s.revokeOperatorCas, /OUTPUT LOWER\(CONVERT\(VARCHAR\(16\),INSERTED.RowVersion,2\)\)/u);
  assert.match(s.revokeOperatorCas, /DeviceSessionId=@deviceSessionId/u);
  assert.match(s.revokeOperatorCas, /ds.CredentialId=@credentialId/u);
  assert.equal(s.revokeLegacy, null);
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

test("legacy read scope is linked to credential through operator and device, not workstation alone", () => {
  for (const statement of [s.lockLegacySessions]) {
    assert.match(statement, /os.OperatorSessionId=ls.Id/u);
    assert.match(statement, /ds.Id=os.DeviceSessionId/u);
    assert.match(statement, /ds.CredentialId=@credentialId/u);
    assert.match(statement, /ls.RevokedAtUtc IS NULL/u);
  }
  assert.equal(s.revokeLegacy, null);
});

test("revocation request/audit/decision match 926 constrained operation and exact receipt", () => {
  assert.match(s.reserveRequest, /N'AUTHORIZATION_REVOKE'/u);
  assert.match(s.reserveRequest, /OUTPUT CONVERT\(VARCHAR\(36\),INSERTED.RequestId\)/u);
  assert.match(s.insertAudit, /OUTPUT CONVERT\(VARCHAR\(20\),INSERTED.Id\) AS AuditLogId/u);
  assert.match(s.insertDecision, /N'OPERATOR_STATE'/u);
  assert.match(s.insertDecision, /@nextOperatorRevision/u);
  assert.match(s.insertDecision, /@nextGeneration/u);
  assert.match(s.insertDecision, /CONVERT\(BIGINT,@auditLogId\)/u);
  for (const statement of [s.reserveRequest, s.insertAudit, s.insertDecision]) {
    assert.doesNotMatch(statement, /\bBEGIN\s+TRAN|\bCOMMIT\b|\bROLLBACK\b/iu);
  }
  assert.equal(s.auditDecisionIntegrated, false);
});

test("pre-CAS unlinked legacy scope cannot be hidden when operator link is cleared", () => {
  assert.match(s.countUnmappedLegacy, /COUNT_BIG\(\*\) AS UnmappedActiveLegacySessions/u);
  assert.match(s.countUnmappedLegacy, /NOT EXISTS/u);
  assert.match(s.countUnmappedLegacy, /os.OperatorSessionId=ls.Id/u);
  assert.match(s.countUnmappedLegacy, /ds.CredentialId=@credentialId/u);
  assert.equal(s.revokeLegacy, null);
});

test("total pre-CAS legacy count does not rely on mutable operator links", () => {
  assert.match(s.countActiveLegacyBeforeCas, /COUNT_BIG\(\*\) AS ActiveLegacySessions/u);
  assert.match(s.countActiveLegacyBeforeCas, /WorkstationId=CONVERT\(BIGINT,@workstationId\)/u);
  assert.doesNotMatch(s.countActiveLegacyBeforeCas, /OperatorSessionId|CredentialId|JOIN/iu);
  assert.match(s.countUnmappedLegacy, /NOT EXISTS/u);
  assert.equal(s.revokeLegacy, null);
});

test("linked legacy mutation targets only one credential-bound active operator and refuses extra sessions", () => {
  assert.match(s.revokeLinkedLegacy, /UPDATE ls SET RevokedAtUtc=/u);
  assert.match(s.revokeLinkedLegacy, /os.OperatorSessionId=ls.Id/u);
  assert.match(s.revokeLinkedLegacy, /ds.CredentialId=@credentialId/u);
  assert.match(s.revokeLinkedLegacy, /os.DeviceSessionId=@deviceSessionId/u);
  assert.match(s.revokeLinkedLegacy, /os.RowVersion=CONVERT\(BINARY\(8\),@expectedOperatorRevision,2\)/u);
  assert.match(s.revokeLinkedLegacy, /os.Generation=CONVERT\(BIGINT,@expectedGeneration\)/u);
  assert.match(s.revokeLinkedLegacy, /os.Incarnation=@expectedIncarnation/u);
  assert.match(s.revokeLinkedLegacy, /remaining.Id<>ls.Id/u);
  assert.match(s.revokeLinkedLegacy, /remaining.RevokedAtUtc IS NULL/u);
  assert.match(s.revokeLinkedLegacy, /OUTPUT CONVERT\(VARCHAR\(36\),INSERTED.Id\)/u);
  assert.equal(s.revokeLegacy, null);
  assert.equal(s.productionReady, false);
});

test("post-CAS legacy receipt counts all still-active sessions despite cleared operator link", () => {
  assert.match(s.remainingLegacy, /COUNT_BIG\(\*\) AS Remaining/u);
  assert.match(s.remainingLegacy, /WorkstationId=CONVERT\(BIGINT,@workstationId\)/u);
  assert.match(s.remainingLegacy, /RevokedAtUtc IS NULL/u);
  assert.doesNotMatch(s.remainingLegacy, /OperatorSessionId|CredentialId|JOIN/iu);
});

test("credential CAS is coupled to active device session and expected credential version", () => {
  assert.match(s.credentialCas, /ds.Id=@deviceSessionId/u);
  assert.match(s.credentialCas, /ds.CredentialId=@credentialId/u);
  assert.match(s.credentialCas, /ds.BoundCredentialVersion=@expectedCredentialVersion/u);
  assert.match(s.credentialCas, /ds.RevokedAtUtc IS NULL/u);
  assert.match(s.credentialCas, /@@ROWCOUNT AS CredentialAffected/u);
});

test("device preflight locks exact active version-bound session before CAS", () => {
  assert.match(s.lockCredentialDevice, /WITH \(UPDLOCK,HOLDLOCK\)/u);
  assert.match(s.lockCredentialDevice, /Id=@deviceSessionId/u);
  assert.match(s.lockCredentialDevice, /WorkstationId=CONVERT\(BIGINT,@workstationId\)/u);
  assert.match(s.lockCredentialDevice, /CredentialId=@credentialId/u);
  assert.match(s.lockCredentialDevice, /BoundCredentialVersion=@expectedCredentialVersion/u);
  assert.match(s.lockCredentialDevice, /RevokedAtUtc IS NULL/u);
  assert.equal(s.productionReady, false);
});
