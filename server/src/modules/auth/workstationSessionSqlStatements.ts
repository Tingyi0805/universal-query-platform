/**
 * H0-5B/H0-5C-1 isolated SQL statement contract.
 * Adapters must bind every value inside a repository-owned SERIALIZABLE
 * transaction. No route, migration runner or production authorization path
 * imports these statements.
 */
export const deviceRenewalCasSql = `
SET NOCOUNT ON;
DECLARE @changed TABLE (Revision BINARY(8) NOT NULL);
UPDATE ds WITH (UPDLOCK, HOLDLOCK)
SET RenewalCounter = @nextCounter,
    LastActivityAtUtc = @lastActivityUtc,
    IdleExpiresAtUtc = @idleExpiresUtc
OUTPUT INSERTED.RowVersion INTO @changed(Revision)
FROM uqp.SharedWorkstationDeviceSession AS ds
INNER JOIN uqp.SharedWorkstation AS w WITH (UPDLOCK, HOLDLOCK)
  ON w.Id = ds.WorkstationId
INNER JOIN uqp.SharedWorkstationCredential AS c WITH (UPDLOCK, HOLDLOCK)
  ON c.Id = ds.CredentialId AND c.WorkstationId = ds.WorkstationId
WHERE ds.Id = @sessionId
  AND ds.WorkstationId = @workstationId
  AND ds.CredentialId = @credentialId
  AND ds.RowVersion = @expectedRevision
  AND ds.RenewalCounter = @expectedCounter
  AND ds.RenewalCounter < 9223372036854775807
  AND @nextCounter = ds.RenewalCounter + CONVERT(BIGINT, 1)
  AND ds.RevokedAtUtc IS NULL
  AND ds.IdleExpiresAtUtc > SYSUTCDATETIME()
  AND ds.AbsoluteExpiresAtUtc > SYSUTCDATETIME()
  AND @lastActivityUtc >= ds.LastActivityAtUtc
  AND @idleExpiresUtc > @lastActivityUtc
  AND @idleExpiresUtc <= ds.AbsoluteExpiresAtUtc
  AND w.IsActive = 1
  AND w.RetiredAtUtc IS NULL
  AND w.CredentialVersion = ds.BoundCredentialVersion
  AND c.IsRevoked = 0
  AND c.CredentialVersion = ds.BoundCredentialVersion;
SELECT CONVERT(VARCHAR(16), Revision, 2) AS NewRevision FROM @changed;
` as const;

/**
 * Audit insertion is deliberately not included: existing AuditLog schema and
 * mandatory atomic Decision writer must be reviewed before wiring this SQL.
 */
export const renewalCasRequiredBindings = Object.freeze([
  "sessionId", "workstationId", "credentialId", "expectedRevision",
  "expectedCounter", "nextCounter", "lastActivityUtc", "idleExpiresUtc",
] as const);

export const workstationSessionRepositorySql = Object.freeze({
  acquireGate: `
SET XACT_ABORT ON;
SET LOCK_TIMEOUT 5000;
DECLARE @result INT;
EXEC @result = sys.sp_getapplock
  @Resource = N'UQP:WORKSTATION_SESSION_SECURITY:V1',
  @LockMode = N'Exclusive', @LockOwner = N'Transaction', @LockTimeout = 5000;
SELECT @result AS GateResult;`,
  discoverDevice: `
SELECT CONVERT(VARCHAR(20), WorkstationId) AS WorkstationId,
       CONVERT(VARCHAR(36), CredentialId) AS CredentialId
FROM uqp.SharedWorkstationDeviceSession
WHERE Id = @sessionId;`,
  lockWorkstation: `
SELECT CONVERT(VARCHAR(20), Id) AS WorkstationId, IsActive, CredentialVersion, RetiredAtUtc
FROM uqp.SharedWorkstation WITH (UPDLOCK, HOLDLOCK)
WHERE Id = CONVERT(BIGINT, @workstationId);`,
  lockCredential: `
SELECT CONVERT(VARCHAR(36), Id) AS CredentialId,
       CONVERT(VARCHAR(20), WorkstationId) AS WorkstationId,
       IsRevoked, CredentialVersion, RevokedAtUtc
FROM uqp.SharedWorkstationCredential WITH (UPDLOCK, HOLDLOCK)
WHERE Id = @credentialId;`,
  lockDevice: `
SELECT CONVERT(VARCHAR(36), Id) AS SessionId,
       CONVERT(VARCHAR(20), WorkstationId) AS WorkstationId,
       CONVERT(VARCHAR(36), CredentialId) AS CredentialId,
       BoundCredentialVersion, SessionProofHash, CreatedAtUtc, LastActivityAtUtc,
       IdleExpiresAtUtc, AbsoluteExpiresAtUtc, RevokedAtUtc,
       CONVERT(VARCHAR(20), RenewalCounter) AS RenewalCounter,
       LOWER(CONVERT(VARCHAR(16), RowVersion, 2)) AS RowVersion
FROM uqp.SharedWorkstationDeviceSession WITH (UPDLOCK, HOLDLOCK)
WHERE Id = @sessionId;`,
  readRequest: `
SELECT LOWER(CONVERT(VARCHAR(64), RequestDigest, 2)) AS RequestDigest,
       OperationCode, CONVERT(VARCHAR(20), WorkstationId) AS WorkstationId,
       CONVERT(VARCHAR(36), DeviceSessionId) AS DeviceSessionId
FROM uqp.SharedWorkstationSessionRequest WITH (UPDLOCK, HOLDLOCK)
WHERE RequestId = @requestId;`,
  insertRequest: `
INSERT uqp.SharedWorkstationSessionRequest
  (RequestId, WorkstationId, DeviceSessionId, OperationCode, RequestDigest, TargetUserId, ReplayExpiresAtUtc)
OUTPUT CONVERT(VARCHAR(36), INSERTED.RequestId) AS RequestId
VALUES
  (@requestId, CONVERT(BIGINT, @workstationId), @deviceSessionId, @operation,
   CONVERT(BINARY(32), @requestDigest, 2), NULL, DATEADD(DAY, 1, SYSUTCDATETIME()));`,
  insertAudit: `
INSERT uqp.AuditLog(EventType, UserId, Status, ParametersJson, CreatedAtUtc, CompletedAtUtc)
OUTPUT CONVERT(VARCHAR(20), INSERTED.Id) AS AuditLogId
VALUES(@eventType, NULL, @status, @parameters, SYSUTCDATETIME(), SYSUTCDATETIME());`,
  insertDecision: `
INSERT uqp.SharedWorkstationSessionDecision
  (RequestId, WorkstationId, DeviceSessionId, OperationCode, DecisionStatus, ReasonCode,
   ActorUserId, TargetUserId, RevisionDomain, PreviousRevision, NextRevision,
   PreviousGeneration, NextGeneration, PreviousIncarnation, NextIncarnation,
   AuditLogId, AuditEventType, TransactionCorrelationId)
OUTPUT CONVERT(VARCHAR(36), INSERTED.RequestId) AS RequestId
VALUES
  (@requestId, CONVERT(BIGINT, @workstationId), @deviceSessionId, @operation,
   @decisionStatus, @reason, NULL, NULL, N'DEVICE_SESSION',
   CONVERT(BINARY(8), @previousRevision, 2),
   CASE WHEN @nextRevision IS NULL THEN NULL ELSE CONVERT(BINARY(8), @nextRevision, 2) END,
   NULL, NULL, NULL, NULL, CONVERT(BIGINT, @auditLogId), @eventType, @correlationId);`,
  revokeDevice: `
UPDATE uqp.SharedWorkstationDeviceSession
SET RevokedAtUtc = SYSUTCDATETIME(), RevocationReason = @reason
OUTPUT LOWER(CONVERT(VARCHAR(16), INSERTED.RowVersion, 2)) AS NewRevision
WHERE Id = @sessionId
  AND WorkstationId = CONVERT(BIGINT, @workstationId)
  AND CredentialId = @credentialId
  AND RowVersion = CONVERT(BINARY(8), @expectedRevision, 2)
  AND RevokedAtUtc IS NULL;`,
  revokeDependents: `
UPDATE uqp.SharedWorkstationSession
SET RevokedAtUtc = COALESCE(RevokedAtUtc, SYSUTCDATETIME())
WHERE WorkstationId = CONVERT(BIGINT, @workstationId) AND RevokedAtUtc IS NULL;
UPDATE uqp.SharedWorkstationOperatorState
SET StateCode = N'DEVICE_REVOKED', Generation = Generation + CONVERT(BIGINT, 1),
    OperatorSessionId = NULL, OperatorUserId = NULL, TokenVersion = NULL,
    PinVersion = NULL, AuthMethod = NULL, LastMutationAtUtc = SYSUTCDATETIME()
WHERE WorkstationId = CONVERT(BIGINT, @workstationId) AND DeviceSessionId = @sessionId;`,
  revokeCredentialSessions: `
UPDATE uqp.SharedWorkstationDeviceSession
SET RevokedAtUtc = COALESCE(RevokedAtUtc, SYSUTCDATETIME()),
    RevocationReason = COALESCE(RevocationReason, N'CREDENTIAL_REVOKED')
WHERE WorkstationId = CONVERT(BIGINT, @workstationId)
  AND CredentialId = @credentialId AND RevokedAtUtc IS NULL;`,
  revokeWorkstationSessions: `
UPDATE uqp.SharedWorkstationDeviceSession
SET RevokedAtUtc = COALESCE(RevokedAtUtc, SYSUTCDATETIME()),
    RevocationReason = COALESCE(RevocationReason, N'WORKSTATION_REVOKED')
WHERE WorkstationId = CONVERT(BIGINT, @workstationId) AND RevokedAtUtc IS NULL;`,
} as const);

export const workstationOperatorRepositorySql = Object.freeze({
  lockPolicy: `
SELECT PinLength, CONVERT(VARCHAR(20), PolicyRevision) AS PolicyRevision
FROM uqp.QuickPinPolicy WITH (UPDLOCK, HOLDLOCK) WHERE Id = 1;`,
  lockUser: `
SELECT CONVERT(VARCHAR(20), Id) AS UserId, IsActive, TokenVersion
FROM uqp.AppUser WITH (UPDLOCK, HOLDLOCK) WHERE Id = CONVERT(BIGINT, @userId);`,
  readPermissions: `
SELECT DISTINCT p.Code
FROM uqp.UserRole ur WITH (HOLDLOCK)
JOIN uqp.Role r WITH (HOLDLOCK) ON r.Id = ur.RoleId AND r.IsActive = 1
JOIN uqp.RolePermission rp WITH (HOLDLOCK) ON rp.RoleId = r.Id
JOIN uqp.Permission p WITH (HOLDLOCK) ON p.Id = rp.PermissionId
WHERE ur.UserId = CONVERT(BIGINT, @userId) ORDER BY p.Code;`,
  lockWorkstation: `
SELECT CONVERT(VARCHAR(20), Id) AS WorkstationId, IsActive, PinLoginEnabled,
       CredentialVersion, RetiredAtUtc
FROM uqp.SharedWorkstation WITH (UPDLOCK, HOLDLOCK)
WHERE Id = CONVERT(BIGINT, @workstationId);`,
  lockAccess: `
SELECT CASE WHEN EXISTS (
  SELECT 1 FROM uqp.SharedWorkstationUser WITH (UPDLOCK, HOLDLOCK)
  WHERE WorkstationId = CONVERT(BIGINT, @workstationId)
    AND UserId = CONVERT(BIGINT, @userId) AND IsAllowed = 1
) OR EXISTS (
  SELECT 1 FROM uqp.SharedWorkstationAudience wa WITH (UPDLOCK, HOLDLOCK)
  JOIN uqp.WorkstationAudience a WITH (UPDLOCK, HOLDLOCK)
    ON a.Id = wa.AudienceId AND a.IsActive = 1
  JOIN uqp.WorkstationAudienceMember am WITH (UPDLOCK, HOLDLOCK)
    ON am.AudienceId = a.Id
  WHERE wa.WorkstationId = CONVERT(BIGINT, @workstationId)
    AND am.UserId = CONVERT(BIGINT, @userId)
) THEN 1 ELSE 0 END AS IsAllowed;`,
  lockPin: `
SELECT CONVERT(VARCHAR(20), UserId) AS UserId, PinHash, PinVersion, IsEnabled
FROM uqp.UserQuickPin WITH (UPDLOCK, HOLDLOCK)
WHERE UserId = CONVERT(BIGINT, @userId);`,
  lockPinBinding: `
SELECT CONVERT(VARCHAR(20), UserId) AS UserId, PinVersion, BoundTokenVersion,
       CONVERT(VARCHAR(20), BoundPolicyRevision) AS BoundPolicyRevision
FROM uqp.UserQuickPinSecurityBinding WITH (UPDLOCK, HOLDLOCK)
WHERE UserId = CONVERT(BIGINT, @userId);`,
  lockPinAttempt: `
SELECT CONVERT(VARCHAR(20), UserId) AS UserId,
       CONVERT(VARCHAR(20), LastWorkstationId) AS LastWorkstationId,
       BoundPinVersion, CONVERT(VARCHAR(20), BoundPolicyRevision) AS BoundPolicyRevision,
       FailedAttempts, AttemptWindowStartedAtUtc, LastAttemptAtUtc, LockedUntilUtc,
       LOWER(CONVERT(VARCHAR(16), RowVersion, 2)) AS RowVersion
FROM uqp.SharedWorkstationPinAttemptState WITH (UPDLOCK, HOLDLOCK)
WHERE UserId = CONVERT(BIGINT, @userId);`,
  lockLegacyOperatorRange: `
SELECT CONVERT(VARCHAR(36), Id) AS SessionId
FROM uqp.SharedWorkstationSession WITH (UPDLOCK, HOLDLOCK)
WHERE WorkstationId = CONVERT(BIGINT, @workstationId) AND RevokedAtUtc IS NULL
ORDER BY Id;`,
  lockOperatorState: `
SELECT CONVERT(VARCHAR(20), WorkstationId) AS WorkstationId,
       CONVERT(VARCHAR(36), DeviceSessionId) AS DeviceSessionId, StateCode,
       CONVERT(VARCHAR(20), Generation) AS Generation,
       CONVERT(VARCHAR(36), Incarnation) AS Incarnation,
       CONVERT(VARCHAR(36), OperatorSessionId) AS OperatorSessionId,
       CONVERT(VARCHAR(20), OperatorUserId) AS OperatorUserId,
       TokenVersion, PinVersion, AuthMethod,
       LOWER(CONVERT(VARCHAR(16), RowVersion, 2)) AS RowVersion
FROM uqp.SharedWorkstationOperatorState WITH (UPDLOCK, HOLDLOCK)
WHERE WorkstationId = CONVERT(BIGINT, @workstationId);`,
  insertRequest: `
INSERT uqp.SharedWorkstationSessionRequest
  (RequestId, WorkstationId, DeviceSessionId, OperationCode, RequestDigest, TargetUserId, ReplayExpiresAtUtc)
OUTPUT CONVERT(VARCHAR(36), INSERTED.RequestId) AS RequestId
VALUES
  (@requestId, CONVERT(BIGINT, @workstationId), @deviceSessionId, N'OPERATOR_SWITCH',
   CONVERT(BINARY(32), @requestDigest, 2), CONVERT(BIGINT, @targetUserId),
   DATEADD(DAY, 1, SYSUTCDATETIME()));`,
  pinFailureCas: `
UPDATE uqp.SharedWorkstationPinAttemptState
SET LastWorkstationId = CONVERT(BIGINT, @workstationId), FailedAttempts = @failedAttempts,
    AttemptWindowStartedAtUtc = @windowStartedUtc, LastAttemptAtUtc = @nowUtc,
    LockedUntilUtc = @lockedUntilUtc
OUTPUT LOWER(CONVERT(VARCHAR(16), INSERTED.RowVersion, 2)) AS NewRevision
WHERE UserId = CONVERT(BIGINT, @userId)
  AND BoundPinVersion = @pinVersion
  AND BoundPolicyRevision = CONVERT(BIGINT, @policyRevision)
  AND RowVersion = CONVERT(BINARY(8), @expectedRevision, 2);`,
  switchCas: `
DECLARE @changed TABLE (NewRevision VARCHAR(16) NOT NULL);
UPDATE uqp.SharedWorkstationOperatorState
SET StateCode = N'OPERATOR_ACTIVE', Generation = CONVERT(BIGINT, @nextGeneration),
    Incarnation = @nextIncarnation, OperatorSessionId = NULL,
    OperatorUserId = CONVERT(BIGINT, @userId), TokenVersion = @tokenVersion,
    PinVersion = @pinVersion, AuthMethod = N'PIN', LastMutationAtUtc = @nowUtc
OUTPUT LOWER(CONVERT(VARCHAR(16), INSERTED.RowVersion, 2)) INTO @changed
WHERE WorkstationId = CONVERT(BIGINT, @workstationId)
  AND DeviceSessionId = @deviceSessionId AND StateCode = N'OPERATOR_LOCKED'
  AND Generation = CONVERT(BIGINT, @expectedGeneration)
  AND Incarnation = @expectedIncarnation
  AND RowVersion = CONVERT(BINARY(8), @expectedOperatorRevision, 2);
IF @@ROWCOUNT = 1
BEGIN
  UPDATE uqp.SharedWorkstationPinAttemptState
  SET FailedAttempts = 0, AttemptWindowStartedAtUtc = NULL,
      LastAttemptAtUtc = NULL, LockedUntilUtc = NULL
  WHERE UserId = CONVERT(BIGINT, @userId)
    AND BoundPinVersion = @pinVersion
    AND RowVersion = CONVERT(BINARY(8), @expectedPinRevision, 2);
  IF @@ROWCOUNT <> 1 THROW 52926, '926_PIN_RESET_CAS_CONFLICT', 1;
END;
SELECT NewRevision FROM @changed;`,
  insertAudit: `
INSERT uqp.AuditLog(EventType, UserId, Status, ParametersJson, CreatedAtUtc, CompletedAtUtc)
OUTPUT CONVERT(VARCHAR(20), INSERTED.Id) AS AuditLogId
VALUES(@eventType, CONVERT(BIGINT, @actorUserId), @status, @parameters,
       SYSUTCDATETIME(), SYSUTCDATETIME());`,
  insertDecision: `
INSERT uqp.SharedWorkstationSessionDecision
  (RequestId, WorkstationId, DeviceSessionId, OperationCode, DecisionStatus, ReasonCode,
   ActorUserId, TargetUserId, RevisionDomain, PreviousRevision, NextRevision,
   PreviousGeneration, NextGeneration, PreviousIncarnation, NextIncarnation,
   AuditLogId, AuditEventType, TransactionCorrelationId)
OUTPUT CONVERT(VARCHAR(36), INSERTED.RequestId) AS RequestId
VALUES
  (@requestId, CONVERT(BIGINT, @workstationId), @deviceSessionId, N'OPERATOR_SWITCH',
   @decisionStatus, @reason, CONVERT(BIGINT, @actorUserId), CONVERT(BIGINT, @targetUserId),
   @revisionDomain, CONVERT(BINARY(8), @previousRevision, 2),
   CASE WHEN @nextRevision IS NULL THEN NULL ELSE CONVERT(BINARY(8), @nextRevision, 2) END,
   CONVERT(BIGINT, @previousGeneration),
   CASE WHEN @nextGeneration IS NULL THEN NULL ELSE CONVERT(BIGINT, @nextGeneration) END,
   @previousIncarnation, @nextIncarnation, CONVERT(BIGINT, @auditLogId),
   @eventType, @correlationId);`,
} as const);
