/**
 * H0-5C-2E — scoped, isolated SQL statement contracts only.
 * No production imports, route registration or autonomous transaction.
 * A future single-owner writer must verify row counts, serialize all sessions,
 * reserve RequestId and write exact Audit+Decision before commit.
 */
export const isolatedCredentialAtomicSql = Object.freeze({
  lockDevices: `
SELECT CONVERT(VARCHAR(36), Id) AS SessionId
FROM uqp.SharedWorkstationDeviceSession WITH (UPDLOCK, HOLDLOCK)
WHERE WorkstationId=CONVERT(BIGINT,@workstationId)
  AND CredentialId=@credentialId AND RevokedAtUtc IS NULL
ORDER BY Id;`,
  lockLegacySessions: `
SELECT CONVERT(VARCHAR(36), Id) AS SessionId
FROM uqp.SharedWorkstationSession WITH (UPDLOCK, HOLDLOCK)
WHERE WorkstationId=CONVERT(BIGINT,@workstationId)
  AND RevokedAtUtc IS NULL ORDER BY Id;`,
  lockOperator: `
SELECT CONVERT(VARCHAR(20), Generation) AS Generation,
       CONVERT(VARCHAR(36), Incarnation) AS Incarnation,
       LOWER(CONVERT(VARCHAR(16), RowVersion,2)) AS Revision
FROM uqp.SharedWorkstationOperatorState WITH (UPDLOCK, HOLDLOCK)
WHERE WorkstationId=CONVERT(BIGINT,@workstationId);`,
  credentialCas: `
SET NOCOUNT ON;
UPDATE uqp.SharedWorkstationCredential
SET IsRevoked=1, RevokedAtUtc=SYSUTCDATETIME()
WHERE Id=@credentialId AND WorkstationId=CONVERT(BIGINT,@workstationId)
  AND IsRevoked=0 AND CredentialVersion=@expectedCredentialVersion;
SELECT @@ROWCOUNT AS CredentialAffected;`,
  revokeDevices: `
SET NOCOUNT ON;
UPDATE uqp.SharedWorkstationDeviceSession
SET RevokedAtUtc=SYSUTCDATETIME(), RevocationReason=N'CREDENTIAL_REVOKED'
WHERE WorkstationId=CONVERT(BIGINT,@workstationId)
  AND CredentialId=@credentialId AND RevokedAtUtc IS NULL;
SELECT @@ROWCOUNT AS DeviceSessionsRevoked;`,
  // Legacy sessions lack an authoritative credential relationship in 926.
  // No legacy mutation statement may be issued until schema lineage is reviewed.
  revokeLegacy: null as null,
  revokeOperatorCas: `
SET NOCOUNT ON;
UPDATE uqp.SharedWorkstationOperatorState
SET StateCode=N'DEVICE_REVOKED',
    Generation=Generation+CONVERT(BIGINT,1),
    Incarnation=@nextIncarnation,
    OperatorSessionId=NULL, OperatorUserId=NULL,
    TokenVersion=NULL, PinVersion=NULL, AuthMethod=NULL,
    LastMutationAtUtc=SYSUTCDATETIME()
WHERE WorkstationId=CONVERT(BIGINT,@workstationId)
  AND RowVersion=CONVERT(BINARY(8),@expectedOperatorRevision,2)
  AND Generation=CONVERT(BIGINT,@expectedGeneration)
  AND Incarnation=@expectedIncarnation
  AND Generation < CONVERT(BIGINT, '9223372036854775807');
SELECT @@ROWCOUNT AS OperatorAffected;`,
  remainingDevices: `
SELECT COUNT_BIG(*) AS Remaining
FROM uqp.SharedWorkstationDeviceSession WITH (UPDLOCK,HOLDLOCK)
WHERE WorkstationId=CONVERT(BIGINT,@workstationId)
  AND CredentialId=@credentialId AND RevokedAtUtc IS NULL;`,
  remainingLegacy: `
SELECT COUNT_BIG(*) AS Remaining
FROM uqp.SharedWorkstationSession WITH (UPDLOCK,HOLDLOCK)
WHERE WorkstationId=CONVERT(BIGINT,@workstationId) AND RevokedAtUtc IS NULL;`,
  productionReady: false as const,
  transactionsImplemented: false as const,
  auditDecisionIntegrated: false as const,
});
