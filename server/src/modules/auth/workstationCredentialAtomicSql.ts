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
  // Only the current operator explicitly linked through this credential is in scope.
  // Unlinked historical sessions remain an admission blocker, not an implicit match.
  lockLegacySessions: `
SELECT CONVERT(VARCHAR(36), ls.Id) AS SessionId
FROM uqp.SharedWorkstationSession ls WITH (UPDLOCK,HOLDLOCK)
JOIN uqp.SharedWorkstationOperatorState os WITH (UPDLOCK,HOLDLOCK)
  ON os.OperatorSessionId=ls.Id AND os.WorkstationId=ls.WorkstationId
JOIN uqp.SharedWorkstationDeviceSession ds WITH (UPDLOCK,HOLDLOCK)
  ON ds.Id=os.DeviceSessionId AND ds.WorkstationId=os.WorkstationId
WHERE os.WorkstationId=CONVERT(BIGINT,@workstationId)
  AND ds.CredentialId=@credentialId AND ls.RevokedAtUtc IS NULL;`,
  lockOperator: `
SELECT CONVERT(VARCHAR(36), DeviceSessionId) AS DeviceSessionId,
       CONVERT(VARCHAR(20), Generation) AS Generation,
       CONVERT(VARCHAR(36), Incarnation) AS Incarnation,
       LOWER(CONVERT(VARCHAR(16), RowVersion,2)) AS Revision
FROM uqp.SharedWorkstationOperatorState WITH (UPDLOCK, HOLDLOCK)
WHERE WorkstationId=CONVERT(BIGINT,@workstationId);`,
  // Read and lock the particular active device binding BEFORE any credential
  // CAS or session revocation. A workstation-level credential alone is not
  // sufficient evidence that this device still belongs to that version.
  lockCredentialDevice: `
SELECT CONVERT(VARCHAR(36),Id) AS DeviceSessionId,
       BoundCredentialVersion
FROM uqp.SharedWorkstationDeviceSession WITH (UPDLOCK,HOLDLOCK)
WHERE Id=@deviceSessionId AND WorkstationId=CONVERT(BIGINT,@workstationId)
  AND CredentialId=@credentialId
  AND BoundCredentialVersion=@expectedCredentialVersion
  AND RevokedAtUtc IS NULL;`,
  credentialCas: `
SET NOCOUNT ON;
UPDATE uqp.SharedWorkstationCredential
SET IsRevoked=1, RevokedAtUtc=SYSUTCDATETIME()
WHERE Id=@credentialId AND WorkstationId=CONVERT(BIGINT,@workstationId)
  AND IsRevoked=0 AND CredentialVersion=@expectedCredentialVersion
  AND EXISTS (
    SELECT 1 FROM uqp.SharedWorkstationDeviceSession ds WITH (UPDLOCK,HOLDLOCK)
    WHERE ds.Id=@deviceSessionId
      AND ds.WorkstationId=CONVERT(BIGINT,@workstationId)
      AND ds.CredentialId=@credentialId
      AND ds.BoundCredentialVersion=@expectedCredentialVersion
      AND ds.RevokedAtUtc IS NULL
  );
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
  // Narrow mutation for the ONE credential-linked current operator only.
  // Caller must first verify zero unmapped legacy sessions inside the same
  // serializable owned transaction; this statement is not wired to Runtime.
  revokeLinkedLegacy: `
SET NOCOUNT ON;
UPDATE ls SET RevokedAtUtc=SYSUTCDATETIME()
OUTPUT CONVERT(VARCHAR(36),INSERTED.Id) AS RevokedSessionId
FROM uqp.SharedWorkstationSession ls
JOIN uqp.SharedWorkstationOperatorState os
  ON os.OperatorSessionId=ls.Id AND os.WorkstationId=ls.WorkstationId
JOIN uqp.SharedWorkstationDeviceSession ds
  ON ds.Id=os.DeviceSessionId AND ds.WorkstationId=os.WorkstationId
WHERE os.WorkstationId=CONVERT(BIGINT,@workstationId)
  AND os.DeviceSessionId=@deviceSessionId
  AND os.RowVersion=CONVERT(BINARY(8),@expectedOperatorRevision,2)
  AND os.Generation=CONVERT(BIGINT,@expectedGeneration)
  AND os.Incarnation=@expectedIncarnation
  AND ds.CredentialId=@credentialId
  AND ls.RevokedAtUtc IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM uqp.SharedWorkstationSession remaining WITH (UPDLOCK,HOLDLOCK)
    WHERE remaining.WorkstationId=CONVERT(BIGINT,@workstationId)
      AND remaining.RevokedAtUtc IS NULL
      AND remaining.Id<>ls.Id
  );`,
  revokeOperatorCas: `
SET NOCOUNT ON;
UPDATE uqp.SharedWorkstationOperatorState
SET StateCode=N'DEVICE_REVOKED',
    Generation=Generation+CONVERT(BIGINT,1),
    Incarnation=@nextIncarnation,
    OperatorSessionId=NULL, OperatorUserId=NULL,
    TokenVersion=NULL, PinVersion=NULL, AuthMethod=NULL,
    LastMutationAtUtc=SYSUTCDATETIME()
OUTPUT LOWER(CONVERT(VARCHAR(16),INSERTED.RowVersion,2)) AS NextOperatorRevision,
       CONVERT(VARCHAR(20),INSERTED.Generation) AS NextGeneration,
       CONVERT(VARCHAR(36),INSERTED.Incarnation) AS NextIncarnation
WHERE WorkstationId=CONVERT(BIGINT,@workstationId)
  AND DeviceSessionId=@deviceSessionId
  AND EXISTS (SELECT 1 FROM uqp.SharedWorkstationDeviceSession ds WITH (UPDLOCK,HOLDLOCK)
              WHERE ds.Id=@deviceSessionId AND ds.WorkstationId=CONVERT(BIGINT,@workstationId)
                AND ds.CredentialId=@credentialId)
  AND RowVersion=CONVERT(BINARY(8),@expectedOperatorRevision,2)
  AND Generation=CONVERT(BIGINT,@expectedGeneration)
  AND Incarnation=@expectedIncarnation
  AND Generation < CONVERT(BIGINT, '9223372036854775807');
`,
  remainingDevices: `
SELECT COUNT_BIG(*) AS Remaining
FROM uqp.SharedWorkstationDeviceSession WITH (UPDLOCK,HOLDLOCK)
WHERE WorkstationId=CONVERT(BIGINT,@workstationId)
  AND CredentialId=@credentialId AND RevokedAtUtc IS NULL;`,
  // Post-CAS remaining check MUST NOT depend on OperatorSessionId: the CAS
  // clears it. Require zero active legacy sessions for this workstation.
  // This is a conservative release fence, never permission to mass-revoke.
  remainingLegacy: `
SELECT COUNT_BIG(*) AS Remaining
FROM uqp.SharedWorkstationSession WITH (UPDLOCK,HOLDLOCK)
WHERE WorkstationId=CONVERT(BIGINT,@workstationId)
  AND RevokedAtUtc IS NULL;`,
  // Must be checked BEFORE clearing OperatorSessionId: once the operator CAS
  // clears that link, a join-only remainingLegacy count could falsely read 0.
  // All active legacy sessions outside the one linked to this credential block
  // revocation admission until historical lineage is designed and validated.
  countUnmappedLegacy: `
SELECT COUNT_BIG(*) AS UnmappedActiveLegacySessions
FROM uqp.SharedWorkstationSession ls WITH (UPDLOCK,HOLDLOCK)
WHERE ls.WorkstationId=CONVERT(BIGINT,@workstationId)
  AND ls.RevokedAtUtc IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM uqp.SharedWorkstationOperatorState os WITH (UPDLOCK,HOLDLOCK)
    JOIN uqp.SharedWorkstationDeviceSession ds WITH (UPDLOCK,HOLDLOCK)
      ON ds.Id=os.DeviceSessionId AND ds.WorkstationId=os.WorkstationId
    WHERE os.WorkstationId=ls.WorkstationId
      AND os.OperatorSessionId=ls.Id AND ds.CredentialId=@credentialId
  );`,
  // The total count is deliberately independent of the mutable operator link.
  // Validate coverage BEFORE the CAS clears OperatorSessionId; a linked-only
  // remaining count after CAS cannot prove that all sessions were revoked.
  countActiveLegacyBeforeCas: `
SELECT COUNT_BIG(*) AS ActiveLegacySessions
FROM uqp.SharedWorkstationSession WITH (UPDLOCK,HOLDLOCK)
WHERE WorkstationId=CONVERT(BIGINT,@workstationId)
  AND RevokedAtUtc IS NULL;`,
  // Request reservation and exact audit receipt must run in the SAME owned
  // transaction after the scope locks; never issue these standalone.
  reserveRequest: `
INSERT uqp.SharedWorkstationSessionRequest
(RequestId,WorkstationId,DeviceSessionId,OperationCode,RequestDigest,TargetUserId,ReplayExpiresAtUtc)
OUTPUT CONVERT(VARCHAR(36),INSERTED.RequestId) AS RequestId
VALUES (@requestId,CONVERT(BIGINT,@workstationId),@deviceSessionId,
N'AUTHORIZATION_REVOKE',CONVERT(BINARY(32),@requestDigest,2),NULL,
DATEADD(DAY,1,SYSUTCDATETIME()));`,
  insertAudit: `
INSERT uqp.AuditLog(EventType,UserId,Status,ParametersJson,CreatedAtUtc,CompletedAtUtc)
OUTPUT CONVERT(VARCHAR(20),INSERTED.Id) AS AuditLogId
VALUES(N'WORKSTATION_CREDENTIAL_REVOKED',NULL,N'SUCCESS',
@parametersJson,SYSUTCDATETIME(),SYSUTCDATETIME());`,
  insertDecision: `
INSERT uqp.SharedWorkstationSessionDecision
(RequestId,WorkstationId,DeviceSessionId,OperationCode,DecisionStatus,ReasonCode,
ActorUserId,TargetUserId,RevisionDomain,PreviousRevision,NextRevision,
PreviousGeneration,NextGeneration,PreviousIncarnation,NextIncarnation,
AuditLogId,AuditEventType,TransactionCorrelationId)
OUTPUT CONVERT(VARCHAR(36),INSERTED.RequestId) AS RequestId
VALUES (@requestId,CONVERT(BIGINT,@workstationId),@deviceSessionId,
N'AUTHORIZATION_REVOKE',N'SUCCESS',NULL,NULL,NULL,N'OPERATOR_STATE',
CONVERT(BINARY(8),@previousOperatorRevision,2),
CONVERT(BINARY(8),@nextOperatorRevision,2),
CONVERT(BIGINT,@previousGeneration),CONVERT(BIGINT,@nextGeneration),
@previousIncarnation,@nextIncarnation,CONVERT(BIGINT,@auditLogId),
N'WORKSTATION_CREDENTIAL_REVOKED',@correlationId);`,
  productionReady: false as const,
  transactionsImplemented: false as const,
  auditDecisionIntegrated: false as const,
});
