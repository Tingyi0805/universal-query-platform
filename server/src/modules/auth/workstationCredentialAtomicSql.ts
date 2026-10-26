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
FROM uqp.SharedWorkstationSession ls WITH (UPDLOCK,HOLDLOCK)
JOIN uqp.SharedWorkstationOperatorState os WITH (UPDLOCK,HOLDLOCK)
  ON os.OperatorSessionId=ls.Id AND os.WorkstationId=ls.WorkstationId
JOIN uqp.SharedWorkstationDeviceSession ds WITH (UPDLOCK,HOLDLOCK)
  ON ds.Id=os.DeviceSessionId AND ds.WorkstationId=os.WorkstationId
WHERE os.WorkstationId=CONVERT(BIGINT,@workstationId)
  AND ds.CredentialId=@credentialId AND ls.RevokedAtUtc IS NULL;`,
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
