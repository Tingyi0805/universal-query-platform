-- D1 only. 922-925 are reserved by existing deployment drafts; no old migration is edited.
-- Nullable markers preserve legacy evidence. Never infer reenrollment from TokenHash.
-- Run only after independent target review; the normal runner owns SchemaMigration.
SET XACT_ABORT ON;
BEGIN TRY
 BEGIN TRANSACTION;
 DECLARE @lockResult INT;
 EXEC @lockResult=sys.sp_getapplock @Resource=N'UQP:926:DeviceLifecycle',@LockMode=N'Exclusive',@LockOwner=N'Transaction',@LockTimeout=10000;
 IF @lockResult<0 THROW 51926,'DEVICE_LIFECYCLE_INSTALL_LOCK_REQUIRED',1;
 IF OBJECT_ID(N'uqp.DashboardDisplayDevice',N'U') IS NULL
  OR COL_LENGTH(N'uqp.DashboardDisplayDevice',N'ArchivedAtUtc') IS NULL
  OR COL_LENGTH(N'uqp.DashboardDisplayDevice',N'QueryModeGrantVersion') IS NULL
  OR COL_LENGTH(N'uqp.DashboardDisplayDevice',N'DelegatorTokenVersion') IS NULL
  THROW 51926,'DEVICE_LIFECYCLE_025_900_918_REQUIRED',1;
 IF (COL_LENGTH(N'uqp.DashboardDisplayDevice',N'SuspendedAtUtc') IS NULL AND COL_LENGTH(N'uqp.DashboardDisplayDevice',N'ReenrollmentRequired') IS NOT NULL)
  OR (COL_LENGTH(N'uqp.DashboardDisplayDevice',N'SuspendedAtUtc') IS NOT NULL AND COL_LENGTH(N'uqp.DashboardDisplayDevice',N'ReenrollmentRequired') IS NULL)
  THROW 51926,'DEVICE_LIFECYCLE_PARTIAL_INSTALLATION',1;
 IF COL_LENGTH(N'uqp.DashboardDisplayDevice',N'SuspendedAtUtc') IS NULL
 BEGIN
  IF OBJECT_ID(N'uqp.TR_DashboardDevice_Lifecycle') IS NOT NULL
   OR EXISTS(SELECT 1 FROM sys.objects WHERE schema_id=SCHEMA_ID(N'uqp') AND name IN
    (N'CK_DashboardDevice_LifecycleTerminal',N'CK_DashboardDevice_LifecycleSuspended',N'CK_DashboardDevice_LifecycleEnrollment'))
   THROW 51926,'DEVICE_LIFECYCLE_OBJECT_CONFLICT',1;
  EXEC(N'ALTER TABLE uqp.DashboardDisplayDevice ADD SuspendedAtUtc DATETIME2(0) NULL, ReenrollmentRequired BIT NULL');
  EXEC(N'ALTER TABLE uqp.DashboardDisplayDevice WITH CHECK ADD CONSTRAINT CK_DashboardDevice_LifecycleTerminal CHECK (CASE WHEN RevokedAtUtc IS NOT NULL AND IsActive<>0 THEN 0 WHEN ArchivedAtUtc IS NOT NULL AND IsActive<>0 THEN 0 ELSE 1 END=1)');
  EXEC(N'ALTER TABLE uqp.DashboardDisplayDevice WITH CHECK ADD CONSTRAINT CK_DashboardDevice_LifecycleSuspended CHECK (CASE WHEN SuspendedAtUtc IS NULL THEN 1 WHEN IsActive=0 AND RevokedAtUtc IS NULL AND ArchivedAtUtc IS NULL AND ReenrollmentRequired=1 AND QueryModeGrantVersion IS NULL AND DelegatorTokenVersion IS NULL THEN 1 ELSE 0 END=1)');
  EXEC(N'ALTER TABLE uqp.DashboardDisplayDevice WITH CHECK ADD CONSTRAINT CK_DashboardDevice_LifecycleEnrollment CHECK (CASE WHEN ReenrollmentRequired IS NULL THEN 1 WHEN RevokedAtUtc IS NOT NULL THEN 0 WHEN ArchivedAtUtc IS NOT NULL THEN 0 WHEN SuspendedAtUtc IS NOT NULL THEN 1 WHEN IsActive=1 THEN 1 ELSE 0 END=1)');
  EXEC(N'CREATE TRIGGER uqp.TR_DashboardDevice_Lifecycle ON uqp.DashboardDisplayDevice AFTER UPDATE AS
BEGIN
 SET NOCOUNT ON;
 IF EXISTS(SELECT 1 FROM inserted i JOIN deleted d ON i.Id=d.Id WHERE
   d.RevokedAtUtc IS NOT NULL AND (i.RevokedAtUtc IS NULL OR i.RevokedAtUtc<>d.RevokedAtUtc))
  THROW 51926,''DEVICE_LIFECYCLE_REVOCATION_IRREVERSIBLE'',1;
 IF EXISTS(SELECT 1 FROM inserted i JOIN deleted d ON i.Id=d.Id WHERE
   d.ArchivedAtUtc IS NOT NULL AND (i.ArchivedAtUtc IS NULL OR i.ArchivedAtUtc<>d.ArchivedAtUtc))
  THROW 51926,''DEVICE_LIFECYCLE_ARCHIVE_IRREVERSIBLE'',1;
 IF EXISTS(SELECT 1 FROM inserted i JOIN deleted d ON i.Id=d.Id WHERE
   d.ArchivedAtUtc IS NULL AND i.ArchivedAtUtc IS NOT NULL AND d.RevokedAtUtc IS NULL)
  THROW 51926,''DEVICE_LIFECYCLE_REVOKE_BEFORE_ARCHIVE'',1;
 IF EXISTS(SELECT 1 FROM inserted i JOIN deleted d ON i.Id=d.Id WHERE
   d.SuspendedAtUtc IS NULL AND i.SuspendedAtUtc IS NOT NULL AND
   (d.IsActive<>1 OR d.RevokedAtUtc IS NOT NULL OR d.ArchivedAtUtc IS NOT NULL OR
    UPPER(i.TokenHash)=UPPER(d.TokenHash) OR
    (d.ExpiresAtUtc IS NOT NULL AND d.ExpiresAtUtc<=SYSUTCDATETIME())))
  THROW 51926,''DEVICE_LIFECYCLE_SUSPEND_REQUIRES_INVALIDATION'',1;
 IF EXISTS(SELECT 1 FROM inserted i JOIN deleted d ON i.Id=d.Id WHERE
   d.SuspendedAtUtc IS NOT NULL AND i.SuspendedAtUtc IS NOT NULL AND i.SuspendedAtUtc<>d.SuspendedAtUtc)
  THROW 51926,''DEVICE_LIFECYCLE_SUSPEND_TIME_IMMUTABLE'',1;
 IF EXISTS(SELECT 1 FROM inserted i JOIN deleted d ON i.Id=d.Id WHERE
   d.SuspendedAtUtc IS NOT NULL AND i.SuspendedAtUtc IS NULL AND i.RevokedAtUtc IS NULL AND
   (i.IsActive<>1 OR i.ReenrollmentRequired IS NULL OR i.ReenrollmentRequired<>1 OR
    i.QueryModeGrantVersion IS NOT NULL OR i.DelegatorTokenVersion IS NOT NULL OR
    UPPER(i.TokenHash)=UPPER(d.TokenHash) OR
    (d.ExpiresAtUtc IS NOT NULL AND d.ExpiresAtUtc<=SYSUTCDATETIME()) OR
    (d.ExpiresAtUtc IS NULL AND i.ExpiresAtUtc IS NOT NULL) OR
    (d.ExpiresAtUtc IS NOT NULL AND i.ExpiresAtUtc IS NULL) OR i.ExpiresAtUtc<>d.ExpiresAtUtc))
  THROW 51926,''DEVICE_LIFECYCLE_RESTORE_REQUIRES_FRESH_PENDING_GRANT'',1;
 IF EXISTS(SELECT 1 FROM inserted i JOIN deleted d ON i.Id=d.Id WHERE
   d.ReenrollmentRequired IS NOT NULL AND d.RevokedAtUtc IS NULL AND i.RevokedAtUtc IS NOT NULL AND
   UPPER(i.TokenHash)=UPPER(d.TokenHash))
  THROW 51926,''DEVICE_LIFECYCLE_REVOKE_REQUIRES_INVALIDATION'',1;
 IF EXISTS(SELECT 1 FROM inserted i JOIN deleted d ON i.Id=d.Id WHERE
   d.ReenrollmentRequired=1 AND i.ReenrollmentRequired IS NULL AND i.RevokedAtUtc IS NULL)
  THROW 51926,''DEVICE_LIFECYCLE_PENDING_MARKER_REQUIRED'',1;
 IF EXISTS(SELECT 1 FROM inserted i JOIN deleted d ON i.Id=d.Id WHERE
   d.ReenrollmentRequired=1 AND i.ReenrollmentRequired=0 AND
   (i.QueryModeGrantVersion IS NULL OR i.DelegatorTokenVersion IS NULL OR
    UPPER(i.TokenHash)<>UPPER(d.TokenHash)))
  THROW 51926,''DEVICE_LIFECYCLE_ENROLLMENT_PROOF_BOUNDARY'',1;
END');
 END;
-- BEGIN SHARED CATALOG VALIDATION

IF OBJECT_ID(N'uqp.DashboardDisplayDevice',N'U') IS NULL
 THROW 51926,'DEVICE_LIFECYCLE_SCHEMA_REQUIRED',1;
IF (SELECT COUNT(*) FROM sys.columns WHERE object_id=OBJECT_ID(N'uqp.DashboardDisplayDevice') AND
 ((name=N'SuspendedAtUtc' AND system_type_id=42 AND user_type_id=42 AND scale=0 AND is_nullable=1 AND is_computed=0 AND default_object_id=0)
 OR (name=N'ReenrollmentRequired' AND system_type_id=104 AND user_type_id=104 AND is_nullable=1 AND is_computed=0 AND default_object_id=0)))<>2
 THROW 51926,'DEVICE_LIFECYCLE_COLUMN_CONFLICT',1;
IF NOT EXISTS(SELECT 1 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID(N'uqp.DashboardDisplayDevice')
 AND name=N'CK_DashboardDevice_LifecycleTerminal' AND is_disabled=0 AND is_not_trusted=0 AND is_not_for_replication=0
 AND LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(definition,N'[',N''),N']',N''),N'(',N''),N')',N''),N' ',N''),CHAR(13),N''),CHAR(10),N''),CHAR(9),N''))=N'casewhenrevokedatutcisnotnullandisactive<>0then0whenarchivedatutcisnotnullandisactive<>0then0else1end=1')
 THROW 51926,'DEVICE_LIFECYCLE_CONSTRAINT_CONFLICT',1;
IF NOT EXISTS(SELECT 1 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID(N'uqp.DashboardDisplayDevice')
 AND name=N'CK_DashboardDevice_LifecycleSuspended' AND is_disabled=0 AND is_not_trusted=0 AND is_not_for_replication=0
 AND LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(definition,N'[',N''),N']',N''),N'(',N''),N')',N''),N' ',N''),CHAR(13),N''),CHAR(10),N''),CHAR(9),N''))=N'casewhensuspendedatutcisnullthen1whenisactive=0andrevokedatutcisnullandarchivedatutcisnullandreenrollmentrequired=1andquerymodegrantversionisnullanddelegatortokenversionisnullthen1else0end=1')
 THROW 51926,'DEVICE_LIFECYCLE_CONSTRAINT_CONFLICT',1;
IF NOT EXISTS(SELECT 1 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID(N'uqp.DashboardDisplayDevice')
 AND name=N'CK_DashboardDevice_LifecycleEnrollment' AND is_disabled=0 AND is_not_trusted=0 AND is_not_for_replication=0
 AND LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(definition,N'[',N''),N']',N''),N'(',N''),N')',N''),N' ',N''),CHAR(13),N''),CHAR(10),N''),CHAR(9),N''))=N'casewhenreenrollmentrequiredisnullthen1whenrevokedatutcisnotnullthen0whenarchivedatutcisnotnullthen0whensuspendedatutcisnotnullthen1whenisactive=1then1else0end=1')
 THROW 51926,'DEVICE_LIFECYCLE_CONSTRAINT_CONFLICT',1;
IF NOT EXISTS(SELECT 1 FROM sys.triggers t JOIN sys.sql_modules m ON m.object_id=t.object_id
 WHERE t.object_id=OBJECT_ID(N'uqp.TR_DashboardDevice_Lifecycle',N'TR')
 AND t.parent_id=OBJECT_ID(N'uqp.DashboardDisplayDevice') AND t.is_disabled=0 AND t.is_instead_of_trigger=0 AND t.is_not_for_replication=0
 AND (SELECT COUNT(*) FROM sys.trigger_events WHERE object_id=t.object_id)=1
 AND EXISTS(SELECT 1 FROM sys.trigger_events WHERE object_id=t.object_id AND type_desc=N'UPDATE')
 AND HASHBYTES('SHA2_256',LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(m.definition,N'[',N''),N']',N''),N' ',N''),CHAR(13),N''),CHAR(10),N''),CHAR(9),N'')))=0x0f3259251e812fdc2e3acc303e0c469cf2aaf4590035099336da72b0dae4abfb)
 THROW 51926,'DEVICE_LIFECYCLE_TRIGGER_CONFLICT',1;
-- END SHARED CATALOG VALIDATION
 COMMIT TRANSACTION;
END TRY
BEGIN CATCH
 IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
 THROW;
END CATCH;
