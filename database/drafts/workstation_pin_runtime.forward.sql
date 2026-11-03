-- RECOVERED DRAFT ONLY. Not a numbered migration; never execute automatically.
-- Isolation/rollback/re-run and exact-schema acceptance are pending.
-- Caller must use a dedicated connection with no outer transaction.
-- Existing 902-905 / 916 / 926 files are immutable. No PIN flag is enabled here.
SET XACT_ABORT ON;
IF @@TRANCOUNT<>0 THROW 51927,'PIN_DRAFT_REQUIRES_DEDICATED_CONNECTION',1;
BEGIN TRY
 BEGIN TRANSACTION;
 DECLARE @lockResult int;
 EXEC @lockResult=sys.sp_getapplock @Resource=N'UQP:WorkstationPinRuntime:Schema',
   @LockMode=N'Exclusive',@LockOwner=N'Transaction',@LockTimeout=10000;
 IF @lockResult<0 THROW 51927,'PIN_SCHEMA_LOCK_REQUIRED',1;
 IF OBJECT_ID(N'uqp.SharedWorkstation',N'U') IS NULL
  OR OBJECT_ID(N'uqp.UserQuickPin',N'U') IS NULL
  OR OBJECT_ID(N'uqp.QuickPinPolicy',N'U') IS NULL
  OR OBJECT_ID(N'uqp.SharedWorkstationCredential',N'U') IS NULL
  OR OBJECT_ID(N'uqp.SharedWorkstationSession',N'U') IS NULL
  OR COL_LENGTH(N'uqp.SharedWorkstation',N'PlatformCode') IS NULL
  OR COL_LENGTH(N'uqp.SharedWorkstation',N'PurposeCode') IS NULL
  OR COL_LENGTH(N'uqp.SharedWorkstation',N'RetiredAtUtc') IS NULL
  THROW 51927,'PIN_SCHEMA_PREREQUISITES_MISSING',1;
 -- No silent adoption, repair or resetting generation/counters on a rerun.
 -- Exact complete-state attestation must be added before numbering this draft.
 IF COL_LENGTH(N'uqp.SharedWorkstation',N'SwitchVersion') IS NOT NULL
  OR OBJECT_ID(N'uqp.WorkstationPinAttemptBucket') IS NOT NULL
  OR EXISTS (SELECT 1 FROM sys.objects WHERE schema_id=SCHEMA_ID(N'uqp') AND name IN
    (N'DF_Workstation_SwitchVersion',N'CK_Workstation_SwitchVersion',
     N'PK_WorkstationPinAttemptBucket',N'DF_PinAttempt_Failed',N'DF_PinAttempt_Updated',
     N'CK_PinAttempt_Scope',N'CK_PinAttempt_Failed',N'CK_PinAttempt_Blocked'))
  THROW 51927,'PIN_SCHEMA_EXISTING_OR_PARTIAL_REQUIRES_REVIEW',1;
 ALTER TABLE uqp.SharedWorkstation ADD SwitchVersion bigint NOT NULL
  CONSTRAINT DF_Workstation_SwitchVersion DEFAULT (0)
  CONSTRAINT CK_Workstation_SwitchVersion CHECK (SwitchVersion>=0);
 CREATE TABLE uqp.WorkstationPinAttemptBucket (
  ScopeCode nvarchar(16) NOT NULL,
  KeyDigest binary(32) NOT NULL,
  WindowStartedAtUtc datetime2(3) NOT NULL,
  FailedAttempts int NOT NULL CONSTRAINT DF_PinAttempt_Failed DEFAULT (0),
  BlockedUntilUtc datetime2(3) NULL,
  UpdatedAtUtc datetime2(3) NOT NULL CONSTRAINT DF_PinAttempt_Updated DEFAULT SYSUTCDATETIME(),
  CONSTRAINT PK_WorkstationPinAttemptBucket PRIMARY KEY (ScopeCode,KeyDigest),
  CONSTRAINT CK_PinAttempt_Scope CHECK (ScopeCode IN (N'ACCOUNT',N'WORKSTATION',N'NETWORK')),
  CONSTRAINT CK_PinAttempt_Failed CHECK (FailedAttempts>=0),
  CONSTRAINT CK_PinAttempt_Blocked CHECK (BlockedUntilUtc IS NULL OR BlockedUntilUtc>=WindowStartedAtUtc)
 );
 CREATE INDEX IX_PinAttempt_Updated ON uqp.WorkstationPinAttemptBucket(UpdatedAtUtc);
 COMMIT TRANSACTION;
END TRY
BEGIN CATCH
 IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
 THROW;
END CATCH;
