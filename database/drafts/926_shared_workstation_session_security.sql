-- MIGRATION 926 REVIEW CANDIDATE. Not scanned by db:migrate and not approved for a user database.
-- Additive H0 session persistence only. Does not enable PIN login, JWT issuance, Query, Export or patient data.
SET XACT_ABORT ON;
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;

BEGIN TRY
  BEGIN TRANSACTION;

  IF OBJECT_ID(N'uqp.SchemaMigration',N'U') IS NULL
    OR OBJECT_ID(N'uqp.AppUser',N'U') IS NULL
    OR OBJECT_ID(N'uqp.AuditLog',N'U') IS NULL
    OR OBJECT_ID(N'uqp.SharedWorkstation',N'U') IS NULL
    OR OBJECT_ID(N'uqp.SharedWorkstationCredential',N'U') IS NULL
    OR OBJECT_ID(N'uqp.SharedWorkstationSession',N'U') IS NULL
    OR OBJECT_ID(N'uqp.UserQuickPin',N'U') IS NULL
    OR OBJECT_ID(N'uqp.QuickPinPolicy',N'U') IS NULL
    OR COL_LENGTH(N'uqp.AppUser',N'TokenVersion') IS NULL
    THROW 52926, '926_BASELINE_001_921_REQUIRED', 1;

  IF OBJECT_ID(N'uqp.SharedWorkstationDeviceSession',N'U') IS NOT NULL
    OR OBJECT_ID(N'uqp.SharedWorkstationOperatorState',N'U') IS NOT NULL
    OR OBJECT_ID(N'uqp.UserQuickPinSecurityBinding',N'U') IS NOT NULL
    OR OBJECT_ID(N'uqp.SharedWorkstationPinAttemptState',N'U') IS NOT NULL
    OR OBJECT_ID(N'uqp.SharedWorkstationSessionRequest',N'U') IS NOT NULL
    OR OBJECT_ID(N'uqp.SharedWorkstationSessionDecision',N'U') IS NOT NULL
    OR COL_LENGTH(N'uqp.QuickPinPolicy',N'PolicyRevision') IS NOT NULL
    OR COL_LENGTH(N'uqp.QuickPinPolicy',N'PolicyRowVersion') IS NOT NULL
    THROW 52926, '926_ALREADY_OR_PARTIALLY_INSTALLED_REQUIRES_EXACT_VALIDATION', 1;

  IF EXISTS (SELECT 1 FROM uqp.SchemaMigration WHERE FileName=N'926_shared_workstation_session_security.sql')
    THROW 52926, '926_LEDGER_CONFLICT', 1;

  ALTER TABLE uqp.QuickPinPolicy ADD
    PolicyRevision BIGINT NOT NULL
      CONSTRAINT DF_QuickPinPolicy_PolicyRevision DEFAULT (1),
    PolicyRowVersion ROWVERSION NOT NULL;

  ALTER TABLE uqp.QuickPinPolicy ADD
    CONSTRAINT CK_QuickPinPolicy_PolicyRevision CHECK (PolicyRevision > 0);

  CREATE UNIQUE INDEX UX_SharedWorkstationCredential_Id_Workstation
    ON uqp.SharedWorkstationCredential(Id,WorkstationId);
  CREATE UNIQUE INDEX UX_SharedWorkstationSession_Id_Workstation_User
    ON uqp.SharedWorkstationSession(Id,WorkstationId,UserId);

  CREATE TABLE uqp.SharedWorkstationDeviceSession (
    Id UNIQUEIDENTIFIER NOT NULL
      CONSTRAINT PK_SharedWorkstationDeviceSession PRIMARY KEY,
    WorkstationId BIGINT NOT NULL,
    CredentialId UNIQUEIDENTIFIER NOT NULL,
    BoundCredentialVersion INT NOT NULL,
    SessionProofHash VARBINARY(32) NOT NULL,
    CreatedAtUtc DATETIME2(3) NOT NULL
      CONSTRAINT DF_WorkstationDeviceSession_Created DEFAULT SYSUTCDATETIME(),
    LastActivityAtUtc DATETIME2(3) NOT NULL,
    IdleExpiresAtUtc DATETIME2(3) NOT NULL,
    AbsoluteExpiresAtUtc DATETIME2(3) NOT NULL,
    RevokedAtUtc DATETIME2(3) NULL,
    RevocationReason NVARCHAR(40) COLLATE Latin1_General_100_BIN2 NULL,
    RenewalCounter BIGINT NOT NULL
      CONSTRAINT DF_WorkstationDeviceSession_Renewal DEFAULT (0),
    RowVersion ROWVERSION NOT NULL,
    CONSTRAINT FK_WorkstationDeviceSession_Workstation
      FOREIGN KEY(WorkstationId) REFERENCES uqp.SharedWorkstation(Id) ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT FK_WorkstationDeviceSession_Credential
      FOREIGN KEY(CredentialId,WorkstationId)
      REFERENCES uqp.SharedWorkstationCredential(Id,WorkstationId) ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT CK_WorkstationDeviceSession_Proof
      CHECK (DATALENGTH(SessionProofHash)=32),
    CONSTRAINT CK_WorkstationDeviceSession_Ids
      CHECK (WorkstationId>0
        AND Id<>CONVERT(UNIQUEIDENTIFIER,'00000000-0000-0000-0000-000000000000')
        AND CredentialId<>CONVERT(UNIQUEIDENTIFIER,'00000000-0000-0000-0000-000000000000')),
    CONSTRAINT CK_WorkstationDeviceSession_Version
      CHECK (BoundCredentialVersion>0 AND RenewalCounter>=0),
    CONSTRAINT CK_WorkstationDeviceSession_Time
      CHECK (LastActivityAtUtc>=CreatedAtUtc
        AND IdleExpiresAtUtc>LastActivityAtUtc
        AND AbsoluteExpiresAtUtc>CreatedAtUtc
        AND IdleExpiresAtUtc<=AbsoluteExpiresAtUtc
        AND (RevokedAtUtc IS NULL OR RevokedAtUtc>=CreatedAtUtc)),
    CONSTRAINT CK_WorkstationDeviceSession_Revocation
      CHECK (CASE WHEN (RevokedAtUtc IS NULL AND RevocationReason IS NULL)
        OR (RevokedAtUtc IS NOT NULL AND RevocationReason IS NOT NULL
          AND RevocationReason+N'#' IN
          (N'ADMIN_REVOKED#',N'CREDENTIAL_REVOKED#',N'CREDENTIAL_ROTATED#',N'WORKSTATION_DISABLED#',
           N'WORKSTATION_RETIRED#',N'IDLE_EXPIRED#',N'ABSOLUTE_EXPIRED#',N'SECURITY_FAILURE#'))
        THEN 1 ELSE 0 END=1)
  );

  CREATE UNIQUE INDEX UX_WorkstationDeviceSession_Id_Workstation
    ON uqp.SharedWorkstationDeviceSession(Id,WorkstationId);
  CREATE UNIQUE INDEX UX_WorkstationDeviceSession_ActiveCredential
    ON uqp.SharedWorkstationDeviceSession(CredentialId) WHERE RevokedAtUtc IS NULL;
  CREATE INDEX IX_WorkstationDeviceSession_ActiveExpiry
    ON uqp.SharedWorkstationDeviceSession(WorkstationId,RevokedAtUtc,IdleExpiresAtUtc,AbsoluteExpiresAtUtc)
    INCLUDE(CredentialId,BoundCredentialVersion,RenewalCounter,LastActivityAtUtc);

  CREATE TABLE uqp.UserQuickPinSecurityBinding (
    UserId BIGINT NOT NULL
      CONSTRAINT PK_UserQuickPinSecurityBinding PRIMARY KEY,
    PinVersion INT NOT NULL,
    BoundTokenVersion INT NOT NULL,
    BoundPolicyRevision BIGINT NOT NULL,
    BoundAtUtc DATETIME2(3) NOT NULL
      CONSTRAINT DF_UserQuickPinSecurityBinding_Bound DEFAULT SYSUTCDATETIME(),
    RowVersion ROWVERSION NOT NULL,
    CONSTRAINT FK_UserQuickPinSecurityBinding_Pin
      FOREIGN KEY(UserId) REFERENCES uqp.UserQuickPin(UserId) ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT FK_UserQuickPinSecurityBinding_User
      FOREIGN KEY(UserId) REFERENCES uqp.AppUser(Id) ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT CK_UserQuickPinSecurityBinding_Versions
      CHECK (UserId>0 AND PinVersion>0 AND BoundTokenVersion>0 AND BoundPolicyRevision>0)
  );

  CREATE TABLE uqp.SharedWorkstationPinAttemptState (
    UserId BIGINT NOT NULL
      CONSTRAINT PK_SharedWorkstationPinAttemptState PRIMARY KEY,
    LastWorkstationId BIGINT NOT NULL,
    BoundPinVersion INT NOT NULL,
    BoundPolicyRevision BIGINT NOT NULL,
    FailedAttempts INT NOT NULL,
    AttemptWindowStartedAtUtc DATETIME2(3) NULL,
    LastAttemptAtUtc DATETIME2(3) NULL,
    LockedUntilUtc DATETIME2(3) NULL,
    RowVersion ROWVERSION NOT NULL,
    CONSTRAINT FK_WorkstationPinAttempt_User
      FOREIGN KEY(UserId) REFERENCES uqp.AppUser(Id) ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT FK_WorkstationPinAttempt_Workstation
      FOREIGN KEY(LastWorkstationId) REFERENCES uqp.SharedWorkstation(Id) ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT CK_WorkstationPinAttempt_Versions
      CHECK (UserId>0 AND LastWorkstationId>0 AND BoundPinVersion>0 AND BoundPolicyRevision>0),
    CONSTRAINT CK_WorkstationPinAttempt_State
      CHECK (CASE WHEN (FailedAttempts=0 AND AttemptWindowStartedAtUtc IS NULL
          AND LastAttemptAtUtc IS NULL AND LockedUntilUtc IS NULL)
        OR (FailedAttempts BETWEEN 1 AND 100
          AND AttemptWindowStartedAtUtc IS NOT NULL
          AND LastAttemptAtUtc IS NOT NULL
          AND LastAttemptAtUtc>=AttemptWindowStartedAtUtc
          AND (LockedUntilUtc IS NULL OR LockedUntilUtc>=LastAttemptAtUtc))
        THEN 1 ELSE 0 END=1)
  );

  CREATE INDEX IX_WorkstationPinAttempt_Lock
    ON uqp.SharedWorkstationPinAttemptState(LockedUntilUtc,UserId)
    INCLUDE(FailedAttempts,BoundPinVersion,BoundPolicyRevision,LastWorkstationId);

  CREATE TABLE uqp.SharedWorkstationOperatorState (
    WorkstationId BIGINT NOT NULL
      CONSTRAINT PK_SharedWorkstationOperatorState PRIMARY KEY,
    DeviceSessionId UNIQUEIDENTIFIER NOT NULL,
    StateCode NVARCHAR(24) COLLATE Latin1_General_100_BIN2 NOT NULL,
    Generation BIGINT NOT NULL,
    Incarnation UNIQUEIDENTIFIER NOT NULL,
    OperatorSessionId UNIQUEIDENTIFIER NULL,
    OperatorUserId BIGINT NULL,
    TokenVersion INT NULL,
    PinVersion INT NULL,
    AuthMethod NVARCHAR(20) COLLATE Latin1_General_100_BIN2 NULL,
    LastMutationAtUtc DATETIME2(3) NOT NULL
      CONSTRAINT DF_WorkstationOperatorState_Mutated DEFAULT SYSUTCDATETIME(),
    RowVersion ROWVERSION NOT NULL,
    CONSTRAINT FK_WorkstationOperatorState_Workstation
      FOREIGN KEY(WorkstationId) REFERENCES uqp.SharedWorkstation(Id) ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT FK_WorkstationOperatorState_DeviceSession
      FOREIGN KEY(DeviceSessionId,WorkstationId)
      REFERENCES uqp.SharedWorkstationDeviceSession(Id,WorkstationId) ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT FK_WorkstationOperatorState_OperatorSession
      FOREIGN KEY(OperatorSessionId,WorkstationId,OperatorUserId)
      REFERENCES uqp.SharedWorkstationSession(Id,WorkstationId,UserId) ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT FK_WorkstationOperatorState_User
      FOREIGN KEY(OperatorUserId) REFERENCES uqp.AppUser(Id) ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT CK_WorkstationOperatorState_Generation CHECK (Generation>=0),
    CONSTRAINT CK_WorkstationOperatorState_Ids CHECK
      (WorkstationId>0
        AND DeviceSessionId<>CONVERT(UNIQUEIDENTIFIER,'00000000-0000-0000-0000-000000000000')
        AND Incarnation<>CONVERT(UNIQUEIDENTIFIER,'00000000-0000-0000-0000-000000000000')
        AND (OperatorSessionId IS NULL OR OperatorSessionId<>CONVERT(UNIQUEIDENTIFIER,'00000000-0000-0000-0000-000000000000'))
        AND (OperatorUserId IS NULL OR OperatorUserId>0)),
    CONSTRAINT CK_WorkstationOperatorState_State CHECK
      (StateCode+N'#' IN (N'DEVICE_READY#',N'OPERATOR_ACTIVE#',N'OPERATOR_LOCKED#',N'DEVICE_REVOKED#')),
    CONSTRAINT CK_WorkstationOperatorState_Active CHECK
      (CASE WHEN ((StateCode=N'OPERATOR_ACTIVE'
          AND OperatorSessionId IS NOT NULL AND OperatorUserId IS NOT NULL
          AND TokenVersion>0 AND AuthMethod IS NOT NULL
          AND AuthMethod+N'#' IN (N'PASSWORD#',N'PIN#',N'STEP_UP#')
          AND ((AuthMethod=N'PIN' AND PinVersion>0) OR (AuthMethod<>N'PIN' AND PinVersion IS NULL)))
        OR (StateCode<>N'OPERATOR_ACTIVE'
          AND OperatorSessionId IS NULL AND OperatorUserId IS NULL
          AND TokenVersion IS NULL AND PinVersion IS NULL AND AuthMethod IS NULL))
        THEN 1 ELSE 0 END=1)
  );

  CREATE UNIQUE INDEX UX_WorkstationOperatorState_OperatorSession
    ON uqp.SharedWorkstationOperatorState(OperatorSessionId) WHERE OperatorSessionId IS NOT NULL;
  CREATE INDEX IX_WorkstationOperatorState_Device
    ON uqp.SharedWorkstationOperatorState(DeviceSessionId,StateCode)
    INCLUDE(Generation,Incarnation,OperatorUserId,TokenVersion,PinVersion);

  CREATE TABLE uqp.SharedWorkstationSessionRequest (
    RequestId UNIQUEIDENTIFIER NOT NULL
      CONSTRAINT PK_SharedWorkstationSessionRequest PRIMARY KEY,
    WorkstationId BIGINT NOT NULL,
    DeviceSessionId UNIQUEIDENTIFIER NOT NULL,
    OperationCode NVARCHAR(32) COLLATE Latin1_General_100_BIN2 NOT NULL,
    RequestDigest BINARY(32) NOT NULL,
    TargetUserId BIGINT NULL,
    CreatedAtUtc DATETIME2(3) NOT NULL
      CONSTRAINT DF_WorkstationSessionRequest_Created DEFAULT SYSUTCDATETIME(),
    ReplayExpiresAtUtc DATETIME2(3) NOT NULL,
    CONSTRAINT FK_WorkstationSessionRequest_Workstation
      FOREIGN KEY(WorkstationId) REFERENCES uqp.SharedWorkstation(Id) ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT FK_WorkstationSessionRequest_DeviceSession
      FOREIGN KEY(DeviceSessionId,WorkstationId)
      REFERENCES uqp.SharedWorkstationDeviceSession(Id,WorkstationId) ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT CK_WorkstationSessionRequest_Operation CHECK
      (OperationCode+N'#' IN (N'DEVICE_RENEW#',N'OPERATOR_SWITCH#',N'PIN_FAILURE#',N'OPERATOR_LOCK#',
        N'OPERATOR_SIGNOUT#',N'DEVICE_REVOKE#',N'AUTHORIZATION_REVOKE#')),
    CONSTRAINT CK_WorkstationSessionRequest_Ids CHECK
      (WorkstationId>0
        AND RequestId<>CONVERT(UNIQUEIDENTIFIER,'00000000-0000-0000-0000-000000000000')
        AND DeviceSessionId<>CONVERT(UNIQUEIDENTIFIER,'00000000-0000-0000-0000-000000000000')
        AND (TargetUserId IS NULL OR TargetUserId>0)),
    CONSTRAINT CK_WorkstationSessionRequest_Digest CHECK (DATALENGTH(RequestDigest)=32),
    CONSTRAINT CK_WorkstationSessionRequest_Expiry CHECK (ReplayExpiresAtUtc>CreatedAtUtc)
  );

  CREATE INDEX IX_WorkstationSessionRequest_ReplayExpiry
    ON uqp.SharedWorkstationSessionRequest(ReplayExpiresAtUtc,WorkstationId)
    INCLUDE(OperationCode,TargetUserId);

  CREATE TABLE uqp.SharedWorkstationSessionDecision (
    DecisionId BIGINT IDENTITY(1,1) NOT NULL
      CONSTRAINT PK_SharedWorkstationSessionDecision PRIMARY KEY,
    RequestId UNIQUEIDENTIFIER NOT NULL,
    WorkstationId BIGINT NOT NULL,
    DeviceSessionId UNIQUEIDENTIFIER NOT NULL,
    OperationCode NVARCHAR(32) COLLATE Latin1_General_100_BIN2 NOT NULL,
    DecisionStatus NVARCHAR(12) COLLATE Latin1_General_100_BIN2 NOT NULL,
    ReasonCode NVARCHAR(64) COLLATE Latin1_General_100_BIN2 NULL,
    ActorUserId BIGINT NULL,
    TargetUserId BIGINT NULL,
    RevisionDomain NVARCHAR(24) COLLATE Latin1_General_100_BIN2 NOT NULL,
    PreviousRevision BINARY(8) NULL,
    NextRevision BINARY(8) NULL,
    PreviousGeneration BIGINT NULL,
    NextGeneration BIGINT NULL,
    PreviousIncarnation UNIQUEIDENTIFIER NULL,
    NextIncarnation UNIQUEIDENTIFIER NULL,
    AuditLogId BIGINT NOT NULL,
    AuditEventType NVARCHAR(50) COLLATE Latin1_General_100_BIN2 NOT NULL,
    TransactionCorrelationId UNIQUEIDENTIFIER NOT NULL,
    CreatedAtUtc DATETIME2(3) NOT NULL
      CONSTRAINT DF_WorkstationSessionDecision_Created DEFAULT SYSUTCDATETIME(),
    CONSTRAINT UQ_WorkstationSessionDecision_Request UNIQUE(RequestId),
    CONSTRAINT UQ_WorkstationSessionDecision_Audit UNIQUE(AuditLogId),
    CONSTRAINT UQ_WorkstationSessionDecision_Correlation UNIQUE(TransactionCorrelationId),
    CONSTRAINT FK_WorkstationSessionDecision_Request
      FOREIGN KEY(RequestId) REFERENCES uqp.SharedWorkstationSessionRequest(RequestId) ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT FK_WorkstationSessionDecision_Workstation
      FOREIGN KEY(WorkstationId) REFERENCES uqp.SharedWorkstation(Id) ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT FK_WorkstationSessionDecision_DeviceSession
      FOREIGN KEY(DeviceSessionId,WorkstationId)
      REFERENCES uqp.SharedWorkstationDeviceSession(Id,WorkstationId) ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT CK_WorkstationSessionDecision_Ids CHECK
      (WorkstationId>0 AND AuditLogId>0
        AND RequestId<>CONVERT(UNIQUEIDENTIFIER,'00000000-0000-0000-0000-000000000000')
        AND DeviceSessionId<>CONVERT(UNIQUEIDENTIFIER,'00000000-0000-0000-0000-000000000000')
        AND TransactionCorrelationId<>CONVERT(UNIQUEIDENTIFIER,'00000000-0000-0000-0000-000000000000')
        AND (ActorUserId IS NULL OR ActorUserId>0)
        AND (TargetUserId IS NULL OR TargetUserId>0)
        AND (PreviousIncarnation IS NULL OR PreviousIncarnation<>CONVERT(UNIQUEIDENTIFIER,'00000000-0000-0000-0000-000000000000'))
        AND (NextIncarnation IS NULL OR NextIncarnation<>CONVERT(UNIQUEIDENTIFIER,'00000000-0000-0000-0000-000000000000'))),
    CONSTRAINT CK_WorkstationSessionDecision_Operation CHECK
      (OperationCode+N'#' IN (N'DEVICE_RENEW#',N'OPERATOR_SWITCH#',N'PIN_FAILURE#',N'OPERATOR_LOCK#',
        N'OPERATOR_SIGNOUT#',N'DEVICE_REVOKE#',N'AUTHORIZATION_REVOKE#')),
    CONSTRAINT CK_WorkstationSessionDecision_Status CHECK
      (DecisionStatus+N'#' IN (N'SUCCESS#',N'REJECTED#')),
    CONSTRAINT CK_WorkstationSessionDecision_Domain CHECK
      (RevisionDomain+N'#' IN (N'DEVICE_SESSION#',N'OPERATOR_STATE#',N'PIN_ATTEMPT#')),
    CONSTRAINT CK_WorkstationSessionDecision_Audit CHECK
      (AuditLogId>0 AND LEN(AuditEventType)>0
        AND DATALENGTH(AuditEventType)=2*LEN(AuditEventType)),
    CONSTRAINT CK_WorkstationSessionDecision_Revision CHECK
      (CASE WHEN (DecisionStatus=N'SUCCESS' AND NextRevision IS NOT NULL)
        OR (DecisionStatus=N'REJECTED' AND NextRevision IS NULL)
        OR (DecisionStatus=N'REJECTED' AND OperationCode=N'PIN_FAILURE'
            AND RevisionDomain=N'PIN_ATTEMPT' AND NextRevision IS NOT NULL
            AND PreviousRevision IS NOT NULL AND NextRevision<>PreviousRevision)
        THEN 1 ELSE 0 END=1),
    CONSTRAINT CK_WorkstationSessionDecision_Generation CHECK
      ((PreviousGeneration IS NULL OR PreviousGeneration>=0)
        AND (NextGeneration IS NULL OR NextGeneration>=0)
        AND (PreviousGeneration IS NULL OR NextGeneration IS NULL OR NextGeneration>PreviousGeneration)),
    CONSTRAINT CK_WorkstationSessionDecision_Reason CHECK
      (CASE WHEN (DecisionStatus=N'SUCCESS' AND ReasonCode IS NULL)
        OR (DecisionStatus=N'REJECTED' AND ReasonCode IS NOT NULL AND LEN(ReasonCode)>0
          AND DATALENGTH(ReasonCode)=2*LEN(ReasonCode))
        THEN 1 ELSE 0 END=1)
  );

  CREATE INDEX IX_WorkstationSessionDecision_Workstation
    ON uqp.SharedWorkstationSessionDecision(WorkstationId,CreatedAtUtc,DecisionId)
    INCLUDE(OperationCode,DecisionStatus,TargetUserId,AuditLogId);
  CREATE INDEX IX_WorkstationSessionDecision_TargetUser
    ON uqp.SharedWorkstationSessionDecision(TargetUserId,CreatedAtUtc,DecisionId)
    INCLUDE(WorkstationId,OperationCode,DecisionStatus) WHERE TargetUserId IS NOT NULL;

  EXEC(N'CREATE TRIGGER uqp.TR_WorkstationSessionRequest_AppendOnly
    ON uqp.SharedWorkstationSessionRequest INSTEAD OF UPDATE,DELETE AS
    BEGIN SET NOCOUNT ON; THROW 52926, ''926_SESSION_REQUEST_APPEND_ONLY'', 1; END');
  EXEC(N'CREATE TRIGGER uqp.TR_WorkstationSessionDecision_AppendOnly
    ON uqp.SharedWorkstationSessionDecision INSTEAD OF UPDATE,DELETE AS
    BEGIN SET NOCOUNT ON; THROW 52926, ''926_SESSION_DECISION_APPEND_ONLY'', 1; END');

  -- The dedicated 926 installer will write SchemaMigration only after exact post-install validation.
  -- No role, user, PIN, workstation, session, authority or Runtime row is created by this candidate.
  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
