/**
 * H0-5C-2A draft credential revocation statements; NOT registered in Runtime.
 * A future repository must execute these statements after the session-security
 * applock, inside one owned SERIALIZABLE/XACT_ABORT transaction, and then write
 * exact Audit + immutable Decision before committing. Never run alone.
 */
export const isolatedCredentialRevocationSql = Object.freeze({
  discover: `
SELECT Id, WorkstationId, CredentialVersion, IsRevoked
FROM uqp.SharedWorkstationCredential WITH (UPDLOCK, HOLDLOCK)
WHERE Id=@credentialId AND WorkstationId=@workstationId;
`,
  mutate: `
SET NOCOUNT ON;
UPDATE uqp.SharedWorkstationCredential
SET IsRevoked=1, RevokedAtUtc=SYSUTCDATETIME()
WHERE Id=@credentialId AND WorkstationId=@workstationId AND IsRevoked=0;
SELECT @@ROWCOUNT AS CredentialAffected;
`,
  invalidateDevice: `
SET NOCOUNT ON;
UPDATE uqp.SharedWorkstationDeviceSession
SET RevokedAtUtc=SYSUTCDATETIME(), RevocationReason=N'CREDENTIAL_REVOKED'
WHERE CredentialId=@credentialId AND WorkstationId=@workstationId
  AND RevokedAtUtc IS NULL;
SELECT @@ROWCOUNT AS DeviceSessionsRevoked;
`,
  // Operator state must be revoked in a reviewed, generation-advancing CAS,
  // not silently cleared by this draft. Existing operator sessions also need
  // transactionally consistent invalidation and Decision/Audit writes.
  operatorInvalidationImplemented: false as const,
  atomicAuditImplemented: false as const,
  productionReady: false as const,
  requiredBindings: Object.freeze(["credentialId", "workstationId"] as const),
});
