/* UQP D5-C-5B: USER-RUN SSMS READ-ONLY PREDEPLOYMENT EVIDENCE ONLY.
Repository baseline: 8b27dac43d9b362dc0d5d266686bb7d41bd96f98.
Expected SSMS connection: EINOV-VPN; choose existing UniversalQueryPlatform database in the UI.
First run 00_ENVIRONMENT alone. Continue only after target/visibility review.
Every executable batch is SELECT/CTE only. GO is an SSMS batch separator.
No sqlcmd mode, configuration changes, transactions, installer, migration or backup/restore command.
Any SQL error, NULL permission, hidden definition, incomplete output or wrong context is BLOCKED.
The ledger and legacy-data batches require the existing tables/columns: run metadata first.
Does NOT output device names, addresses, TokenHash values, tokens, cookies or audit JSON.
Read-only scans can take locks/time. Results across batches are not an immutable snapshot.
*/

-- 00_ENVIRONMENT: names can be aliases. A mismatch requires human identity evidence, not a bypass.
SELECT N'00_ENVIRONMENT' AS Section,SYSUTCDATETIME() AS CapturedAtUtc,
 N'EINOV-VPN' AS ExpectedSsmsConnection,N'UniversalQueryPlatform' AS ExpectedDatabase,
 @@SERVERNAME AS ReportedServer,CONVERT(nvarchar(128),SERVERPROPERTY('MachineName')) AS MachineName,
 CONVERT(nvarchar(128),SERVERPROPERTY('ServerName')) AS ServerName,DB_NAME() AS DatabaseName,
 CONVERT(varchar(40),SERVERPROPERTY('ProductVersion')) AS ProductVersion,
 CONVERT(nvarchar(128),SERVERPROPERTY('Edition')) AS Edition,
 CONVERT(int,SERVERPROPERTY('EngineEdition')) AS EngineEdition,d.compatibility_level,
 d.state_desc,d.is_read_only,d.user_access_desc,d.recovery_model_desc,d.log_reuse_wait_desc,
 ORIGINAL_LOGIN() AS EvidenceLogin,USER_NAME() AS DatabaseUser,
 CASE WHEN DB_NAME()<>N'UniversalQueryPlatform' THEN N'BLOCKED_WRONG_DATABASE'
 WHEN CONVERT(int,SERVERPROPERTY('ProductMajorVersion'))<>15 OR CONVERT(int,SERVERPROPERTY('EngineEdition'))<>4 THEN N'BLOCKED_UNREVIEWED_ENGINE_OR_EDITION'
 WHEN d.state_desc<>N'ONLINE' OR d.is_read_only<>0 THEN N'BLOCKED_DATABASE_STATE'
 WHEN d.compatibility_level<>150 THEN N'BLOCKED_COMPATIBILITY_NOT_REHEARSED'
 WHEN UPPER(CONVERT(nvarchar(128),SERVERPROPERTY('MachineName')))<>N'EINOV-VPN'
  AND UPPER(CONVERT(nvarchar(128),SERVERPROPERTY('ServerName')))<>N'EINOV-VPN'
  AND UPPER(CONVERT(nvarchar(128),SERVERPROPERTY('ServerName'))) NOT LIKE N'EINOV-VPN\%'
 THEN N'BLOCKED_SERVER_ALIAS_MAPPING_REQUIRES_EVIDENCE'
 ELSE N'PASS_TARGET_METADATA_REQUIRES_SSMS_CONNECTION_CONFIRMATION' END AS Assessment
FROM sys.databases d WHERE d.database_id=DB_ID();
GO

-- 01_PERMISSIONS: observed query principal is not automatically the approved deployment identity.
SELECT N'01_PERMISSIONS' AS Section,SYSUTCDATETIME() AS CapturedAtUtc,
 ORIGINAL_LOGIN() AS EvidenceLogin,USER_NAME() AS DatabaseUser,
 IS_SRVROLEMEMBER(N'sysadmin') AS IsSysadmin,IS_MEMBER(N'db_owner') AS IsDbOwner,
 HAS_PERMS_BY_NAME(DB_NAME(),N'DATABASE',N'VIEW DEFINITION') AS DatabaseViewDefinition,
 HAS_PERMS_BY_NAME(NULL,NULL,N'VIEW SERVER STATE') AS ViewServerState,
 HAS_PERMS_BY_NAME(N'uqp.SchemaMigration',N'OBJECT',N'SELECT') AS LedgerSelect,
 HAS_PERMS_BY_NAME(N'uqp.DashboardDisplayDevice',N'OBJECT',N'SELECT') AS DeviceSelect,
 HAS_PERMS_BY_NAME(N'uqp.DashboardDisplayDevice',N'OBJECT',N'ALTER') AS DeviceAlter,
 HAS_PERMS_BY_NAME(N'uqp.SchemaMigration',N'OBJECT',N'INSERT') AS LedgerInsert,
 HAS_PERMS_BY_NAME(N'sys.sp_getapplock',N'OBJECT',N'EXECUTE') AS ApplicationLockExecute,
 CASE WHEN COALESCE(HAS_PERMS_BY_NAME(DB_NAME(),N'DATABASE',N'VIEW DEFINITION'),0)=1
  AND COALESCE(HAS_PERMS_BY_NAME(N'uqp.SchemaMigration',N'OBJECT',N'SELECT'),0)=1
  AND COALESCE(HAS_PERMS_BY_NAME(N'uqp.DashboardDisplayDevice',N'OBJECT',N'SELECT'),0)=1
 THEN N'PASS_READER_BASE_EVIDENCE' ELSE N'BLOCKED_METADATA_OR_SELECT_VISIBILITY' END AS ReaderAssessment,
 CASE WHEN COALESCE(HAS_PERMS_BY_NAME(N'uqp.DashboardDisplayDevice',N'OBJECT',N'ALTER'),0)=1
  AND COALESCE(HAS_PERMS_BY_NAME(N'uqp.SchemaMigration',N'OBJECT',N'INSERT'),0)=1
  AND COALESCE(HAS_PERMS_BY_NAME(N'sys.sp_getapplock',N'OBJECT',N'EXECUTE'),0)=1
 THEN N'CAPABILITIES_OBSERVED_STILL_REQUIRE_APPROVED_DEPLOYMENT_IDENTITY'
 ELSE N'BLOCKED_FOR_THIS_PRINCIPAL_OR_NOT_THE_DEPLOYMENT_PRINCIPAL' END AS DeploymentCapabilityEvidence;
GO

-- 02_TABLES: absence is conclusive only with full metadata visibility.
SELECT N'02_TABLES' AS Section,e.TableName,o.type_desc,
 CASE WHEN COALESCE(HAS_PERMS_BY_NAME(DB_NAME(),N'DATABASE',N'VIEW DEFINITION'),0)<>1 THEN N'BLOCKED_VISIBILITY'
 WHEN o.object_id IS NULL OR o.type<>N'U' THEN N'BLOCKED_MISSING_OR_WRONG_OBJECT_TYPE' ELSE N'PASS_EXISTS' END AS Assessment
FROM (VALUES(N'SchemaMigration'),(N'DashboardDisplayDevice'),(N'Dashboard'),(N'AppUser'),
 (N'DashboardDeviceArchivePolicy'),(N'DashboardDeviceArchiveHistory')) e(TableName)
LEFT JOIN sys.objects o ON o.schema_id=SCHEMA_ID(N'uqp') AND o.name=e.TableName;
GO

-- 02_LEDGER_COLUMNS: establish the fixed runner ledger shape before querying its rows.
SELECT N'02_LEDGER_COLUMNS' AS Section,e.Name AS ColumnName,ty.name AS ActualType,c.max_length,c.scale,c.is_nullable,c.is_computed,
 CASE WHEN COALESCE(HAS_PERMS_BY_NAME(DB_NAME(),N'DATABASE',N'VIEW DEFINITION'),0)<>1 THEN N'BLOCKED_VISIBILITY'
 WHEN c.column_id IS NULL OR c.system_type_id<>e.TypeId OR c.user_type_id<>e.TypeId OR c.is_nullable<>0 OR c.is_computed<>0
  OR (e.LengthBytes IS NOT NULL AND c.max_length<>e.LengthBytes) OR c.scale<>e.ScaleValue
 THEN N'BLOCKED_LEDGER_COLUMN_CONTRACT' ELSE N'PASS_LEDGER_COLUMN_CONTRACT' END AS Assessment
FROM (VALUES(N'FileName',231,510,0),(N'AppliedAtUtc',42,NULL,0)) e(Name,TypeId,LengthBytes,ScaleValue)
LEFT JOIN sys.columns c ON c.object_id=OBJECT_ID(N'uqp.SchemaMigration',N'U') AND c.name=e.Name
LEFT JOIN sys.types ty ON ty.user_type_id=c.user_type_id;
GO

-- 03_COLUMNS: exact target marker types/default rules; existing column defaults are shown for review.
;WITH Expected(Name,TypeId,LengthBytes,ScaleValue,NullableValue,IdentityValue,NoDefault,Phase) AS (SELECT * FROM (VALUES
(N'Id',127,8,0,0,1,0,N'PRE'),
 (N'DashboardId',127,8,0,0,0,0,N'PRE'),
 (N'DeviceName',231,400,0,0,0,0,N'PRE'),
 (N'TokenHash',175,64,0,0,0,1,N'PRE'),
 (N'IsActive',104,1,0,0,0,0,N'PRE'),
 (N'ExpiresAtUtc',42,NULL,0,1,0,0,N'PRE'),
 (N'LastUsedAtUtc',42,NULL,0,1,0,0,N'PRE'),
 (N'CreatedByUserId',127,8,0,0,0,0,N'PRE'),
 (N'CreatedAtUtc',42,NULL,0,0,0,0,N'PRE'),
 (N'RevokedAtUtc',42,NULL,0,1,0,0,N'PRE'),
 (N'ArchivedAtUtc',42,NULL,0,1,0,0,N'PRE'),
 (N'QueryModeGrantVersion',127,8,0,1,0,1,N'PRE'),
 (N'DelegatorTokenVersion',127,8,0,1,0,1,N'PRE'),
 (N'SuspendedAtUtc',42,NULL,0,1,0,1,N'926'),
 (N'ReenrollmentRequired',104,1,0,1,0,1,N'926')
) v(Name,TypeId,LengthBytes,ScaleValue,NullableValue,IdentityValue,NoDefault,Phase))
SELECT N'03_COLUMNS' AS Section,e.Phase,e.Name AS ColumnName,TYPE_NAME(e.TypeId) AS ExpectedType,e.LengthBytes AS ExpectedLengthBytes,
 e.ScaleValue AS ExpectedScale,e.NullableValue AS ExpectedNullable,e.IdentityValue AS ExpectedIdentity,
 ty.name AS ActualType,c.max_length,c.precision,c.scale,c.is_nullable,c.is_identity,c.is_computed,c.collation_name,
 dc.name AS DefaultName,CASE WHEN e.Name=N'TokenHash' AND dc.object_id IS NOT NULL THEN N'[REDACTED_UNEXPECTED_HASH_DEFAULT]' ELSE dc.definition END AS DefaultDefinition,
 CASE WHEN COALESCE(HAS_PERMS_BY_NAME(DB_NAME(),N'DATABASE',N'VIEW DEFINITION'),0)<>1 THEN N'BLOCKED_VISIBILITY'
 WHEN c.column_id IS NULL AND e.Phase=N'926' THEN N'ABSENT_926_MARKER'
 WHEN c.column_id IS NULL THEN N'BLOCKED_MISSING_PREREQUISITE_COLUMN'
 WHEN c.system_type_id<>e.TypeId OR c.user_type_id<>e.TypeId OR (e.LengthBytes IS NOT NULL AND c.max_length<>e.LengthBytes)
  OR c.scale<>e.ScaleValue OR c.is_nullable<>e.NullableValue OR c.is_identity<>e.IdentityValue OR c.is_computed<>0
  OR (e.NoDefault=1 AND c.default_object_id<>0) THEN N'BLOCKED_COLUMN_CONTRACT'
 ELSE N'PASS_MINIMUM_COLUMN_CONTRACT' END AS Assessment
FROM Expected e LEFT JOIN sys.columns c ON c.object_id=OBJECT_ID(N'uqp.DashboardDisplayDevice',N'U') AND c.name=e.Name
LEFT JOIN sys.types ty ON ty.user_type_id=c.user_type_id
LEFT JOIN sys.default_constraints dc ON dc.object_id=c.default_object_id ORDER BY e.Phase,e.Name;
GO

-- 04_PREREQUISITE_CHECKS: definition must also be reviewed against the fixed 918 source.
SELECT N'04_PREREQUISITE_CHECKS' AS Section,e.TableName,e.CheckName,c.definition,c.is_disabled,c.is_not_trusted,c.is_not_for_replication,
 CASE WHEN COALESCE(HAS_PERMS_BY_NAME(DB_NAME(),N'DATABASE',N'VIEW DEFINITION'),0)<>1 THEN N'BLOCKED_VISIBILITY'
 WHEN c.object_id IS NULL OR c.definition IS NULL THEN N'BLOCKED_MISSING_OR_HIDDEN_DEFINITION'
 WHEN c.is_disabled<>0 OR c.is_not_trusted<>0 OR c.is_not_for_replication<>0 THEN N'BLOCKED_UNTRUSTED_OR_DISABLED'
 ELSE N'PASS_FLAGS_DEFINITION_REQUIRES_918_SOURCE_COMPARISON' END AS Assessment
FROM (VALUES(N'Dashboard',N'CK_Dashboard_QueryMode'),(N'DashboardDisplayDevice',N'CK_DashboardDevice_QueryModeGrant')) e(TableName,CheckName)
LEFT JOIN sys.check_constraints c ON c.parent_object_id=OBJECT_ID(N'uqp.'+e.TableName,N'U') AND c.name=e.CheckName;
GO

-- 05_926_CHECKS: reuse the existing 926/runtime attestation comparison, not names/counts alone.
;WITH Expected(CheckName,ExpectedNormalizedDefinition) AS (SELECT * FROM (VALUES
(N'CK_DashboardDevice_LifecycleTerminal',N'casewhenrevokedatutcisnotnullandisactive<>0then0whenarchivedatutcisnotnullandisactive<>0then0else1end=1'),
 (N'CK_DashboardDevice_LifecycleSuspended',N'casewhensuspendedatutcisnullthen1whenisactive=0andrevokedatutcisnullandarchivedatutcisnullandreenrollmentrequired=1andquerymodegrantversionisnullanddelegatortokenversionisnullthen1else0end=1'),
 (N'CK_DashboardDevice_LifecycleEnrollment',N'casewhenreenrollmentrequiredisnullthen1whenrevokedatutcisnotnullthen0whenarchivedatutcisnotnullthen0whensuspendedatutcisnotnullthen1whenisactive=1then1else0end=1')
) v(CheckName,ExpectedNormalizedDefinition))
SELECT N'05_926_CHECKS' AS Section,e.CheckName,c.definition,c.is_disabled,c.is_not_trusted,c.is_not_for_replication,
 e.ExpectedNormalizedDefinition,LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(c.definition,N'[',N''),N']',N''),N'(',N''),N')',N''),N' ',N''),CHAR(13),N''),CHAR(10),N''),CHAR(9),N'')) AS ActualNormalizedDefinition,
 CASE WHEN COALESCE(HAS_PERMS_BY_NAME(DB_NAME(),N'DATABASE',N'VIEW DEFINITION'),0)<>1 THEN N'BLOCKED_VISIBILITY'
 WHEN c.object_id IS NULL THEN N'ABSENT_926_CHECK'
 WHEN c.definition IS NULL THEN N'BLOCKED_HIDDEN_DEFINITION'
 WHEN c.is_disabled<>0 OR c.is_not_trusted<>0 OR c.is_not_for_replication<>0 THEN N'BLOCKED_CHECK_FLAGS'
 WHEN LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(c.definition,N'[',N''),N']',N''),N'(',N''),N')',N''),N' ',N''),CHAR(13),N''),CHAR(10),N''),CHAR(9),N''))<>e.ExpectedNormalizedDefinition THEN N'BLOCKED_CHECK_DEFINITION'
 ELSE N'PASS_926_CHECK' END AS Assessment
FROM Expected e LEFT JOIN sys.check_constraints c ON c.parent_object_id=OBJECT_ID(N'uqp.DashboardDisplayDevice',N'U') AND c.name=e.CheckName;
GO

-- 06_926_TRIGGER: a trigger has no trusted flag. Check enabled/type/parent/event/hash instead.
SELECT N'06_926_TRIGGER' AS Section,N'uqp.TR_DashboardDevice_Lifecycle' AS TriggerName,
 tr.type_desc,OBJECT_SCHEMA_NAME(tr.parent_id) AS ParentSchema,OBJECT_NAME(tr.parent_id) AS ParentTable,
 tr.is_disabled,tr.is_instead_of_trigger,tr.is_not_for_replication,
 (SELECT COUNT_BIG(*) FROM sys.trigger_events ev WHERE ev.object_id=tr.object_id) AS EventCount,
 CONVERT(varchar(64),HASHBYTES('SHA2_256',LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(m.definition,N'[',N''),N']',N''),N' ',N''),CHAR(13),N''),CHAR(10),N''),CHAR(9),N''))),2) AS NormalizedDefinitionSha256,
 N'0f3259251e812fdc2e3acc303e0c469cf2aaf4590035099336da72b0dae4abfb' AS ExpectedSha256,
 N'NOT_APPLICABLE_TRIGGER_HAS_NO_TRUSTED_FLAG' AS TrustedAssessment,
 CASE WHEN COALESCE(HAS_PERMS_BY_NAME(DB_NAME(),N'DATABASE',N'VIEW DEFINITION'),0)<>1 THEN N'BLOCKED_VISIBILITY'
 WHEN tr.object_id IS NULL THEN N'ABSENT_926_TRIGGER'
 WHEN m.definition IS NULL THEN N'BLOCKED_HIDDEN_TRIGGER_DEFINITION'
 WHEN tr.type<>N'TR' OR tr.parent_id<>OBJECT_ID(N'uqp.DashboardDisplayDevice',N'U') OR tr.is_disabled<>0
  OR tr.is_instead_of_trigger<>0 OR tr.is_not_for_replication<>0
  OR (SELECT COUNT_BIG(*) FROM sys.trigger_events ev WHERE ev.object_id=tr.object_id)<>1
  OR NOT EXISTS(SELECT 1 FROM sys.trigger_events ev WHERE ev.object_id=tr.object_id AND ev.type_desc=N'UPDATE')
  OR HASHBYTES('SHA2_256',LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(m.definition,N'[',N''),N']',N''),N' ',N''),CHAR(13),N''),CHAR(10),N''),CHAR(9),N'')))<>0x0f3259251e812fdc2e3acc303e0c469cf2aaf4590035099336da72b0dae4abfb
 THEN N'BLOCKED_TRIGGER_CONTRACT' ELSE N'PASS_926_TRIGGER' END AS Assessment
FROM (VALUES(1)) seed(n)
LEFT JOIN sys.triggers tr ON tr.object_id=OBJECT_ID(N'uqp.TR_DashboardDevice_Lifecycle')
LEFT JOIN sys.sql_modules m ON m.object_id=tr.object_id;
GO

-- 07_NAME_COLLISIONS_AND_OTHER_TRIGGERS: any unexpected enabled/disabled trigger needs review.
SELECT N'07_NAME_COLLISIONS' AS Section,e.ObjectName,o.type_desc,OBJECT_SCHEMA_NAME(o.parent_object_id) AS ParentSchema,OBJECT_NAME(o.parent_object_id) AS ParentObject,
 CASE WHEN COALESCE(HAS_PERMS_BY_NAME(DB_NAME(),N'DATABASE',N'VIEW DEFINITION'),0)<>1 THEN N'BLOCKED_VISIBILITY'
 WHEN o.object_id IS NULL THEN N'ABSENT_EXPECTED_NAME'
 WHEN o.parent_object_id<>COALESCE(OBJECT_ID(N'uqp.DashboardDisplayDevice',N'U'),-1) OR o.type<>e.ExpectedType THEN N'BLOCKED_NAME_COLLISION'
 ELSE N'EXPECTED_LOCATION_DEFINITION_CHECKS_STILL_REQUIRED' END AS Assessment
FROM (VALUES(N'CK_DashboardDevice_LifecycleTerminal',N'C'),(N'CK_DashboardDevice_LifecycleSuspended',N'C'),
 (N'CK_DashboardDevice_LifecycleEnrollment',N'C'),(N'TR_DashboardDevice_Lifecycle',N'TR')) e(ObjectName,ExpectedType)
LEFT JOIN sys.objects o ON o.schema_id=SCHEMA_ID(N'uqp') AND o.name=e.ObjectName;

SELECT N'07_OTHER_DEVICE_TRIGGERS' AS Section,OBJECT_SCHEMA_NAME(tr.object_id) AS SchemaName,tr.name,tr.type_desc,tr.is_disabled,
 tr.is_instead_of_trigger,tr.is_not_for_replication,
 CONVERT(varchar(64),HASHBYTES('SHA2_256',m.definition),2) AS RawDefinitionSha256,
 N'BLOCKED_UNREVIEWED_ADDITIONAL_TRIGGER' AS Assessment
FROM sys.triggers tr LEFT JOIN sys.sql_modules m ON m.object_id=tr.object_id
WHERE tr.parent_id=OBJECT_ID(N'uqp.DashboardDisplayDevice',N'U') AND tr.object_id<>COALESCE(OBJECT_ID(N'uqp.TR_DashboardDevice_Lifecycle'),-1);
GO

-- 07_DATABASE_DDL_TRIGGERS: an existing DDL trigger can reject or alter installation behavior.
SELECT N'07_DATABASE_DDL_TRIGGERS' AS Section,tr.name,tr.type_desc,tr.is_disabled,
 CONVERT(varchar(64),HASHBYTES('SHA2_256',m.definition),2) AS DefinitionSha256,
 N'BLOCKED_DATABASE_DDL_TRIGGER_REVIEW' AS Assessment
FROM sys.triggers tr LEFT JOIN sys.sql_modules m ON m.object_id=tr.object_id
WHERE tr.parent_class=0;
GO

-- 08_LEDGER: only run after 00-03 prove the existing ledger and SELECT visibility. Never bootstrap.
;WITH Expected(FileName,RequiredBefore926) AS (SELECT * FROM (VALUES
(N'025_dashboard_display_device.sql',1),(N'900_dashboard_device_archive.sql',1),(N'918_dashboard_query_playback_mode.sql',1),(N'926_dashboard_device_lifecycle.sql',0)
) v(FileName,RequiredBefore926))
SELECT N'08_LEDGER' AS Section,SYSUTCDATETIME() AS CapturedAtUtc,e.FileName,e.RequiredBefore926,
 COUNT_BIG(m.FileName) AS ExactNameRecordCount,MIN(m.AppliedAtUtc) AS FirstAppliedAtUtc,MAX(m.AppliedAtUtc) AS LastAppliedAtUtc,
 CASE WHEN COUNT_BIG(m.FileName)>1 THEN N'BLOCKED_DUPLICATE_LEDGER'
 WHEN COUNT_BIG(m.FileName)=0 AND e.RequiredBefore926=1 THEN N'BLOCKED_MISSING_PREREQUISITE_LEDGER'
 WHEN COUNT_BIG(m.FileName)=0 THEN N'926_NOT_RECORDED_AT_QUERY_TIME'
 ELSE N'RECORDED_SCHEMA_COMPARISON_REQUIRED' END AS Assessment
FROM Expected e LEFT JOIN uqp.SchemaMigration m ON CONVERT(nvarchar(max),m.FileName) COLLATE Latin1_General_100_BIN2=e.FileName COLLATE Latin1_General_100_BIN2
 AND DATALENGTH(CONVERT(nvarchar(max),m.FileName))=DATALENGTH(e.FileName)
GROUP BY e.FileName,e.RequiredBefore926 ORDER BY e.FileName;

SELECT N'08_LEDGER_VARIANTS' AS Section,m.FileName,m.AppliedAtUtc,N'BLOCKED_UNREVIEWED_LEDGER_FILENAME' AS Assessment
FROM uqp.SchemaMigration m WHERE (m.FileName LIKE N'025[_]%' OR m.FileName LIKE N'900[_]%' OR m.FileName LIKE N'918[_]%' OR m.FileName LIKE N'926[_]%')
 AND NOT EXISTS(SELECT 1 FROM (VALUES
(N'025_dashboard_display_device.sql',1),(N'900_dashboard_device_archive.sql',1),(N'918_dashboard_query_playback_mode.sql',1),(N'926_dashboard_device_lifecycle.sql',0)
) e(FileName,RequiredBefore926) WHERE CONVERT(nvarchar(max),m.FileName) COLLATE Latin1_General_100_BIN2=e.FileName COLLATE Latin1_General_100_BIN2 AND DATALENGTH(CONVERT(nvarchar(max),m.FileName))=DATALENGTH(e.FileName));
GO

-- 08_PREREQUISITE_PAIRS: minimum structural evidence, not full historical source provenance.
;WITH Facts AS (
 SELECT
 CASE WHEN OBJECT_ID(N'uqp.DashboardDisplayDevice',N'U') IS NOT NULL AND
  (SELECT COUNT_BIG(*) FROM sys.columns c WHERE c.object_id=OBJECT_ID(N'uqp.DashboardDisplayDevice',N'U')
   AND c.is_computed=0 AND c.user_type_id=c.system_type_id AND
   ((c.name=N'Id' AND c.system_type_id=127 AND c.is_nullable=0 AND c.is_identity=1)
    OR (c.name IN(N'DashboardId',N'CreatedByUserId') AND c.system_type_id=127 AND c.is_nullable=0)
    OR (c.name=N'DeviceName' AND c.system_type_id=231 AND c.max_length=400 AND c.is_nullable=0)
    OR (c.name=N'TokenHash' AND c.system_type_id=175 AND c.max_length=64 AND c.is_nullable=0 AND c.default_object_id=0)
    OR (c.name=N'IsActive' AND c.system_type_id=104 AND c.is_nullable=0)
    OR (c.name IN(N'ExpiresAtUtc',N'LastUsedAtUtc',N'RevokedAtUtc') AND c.system_type_id=42 AND c.scale=0 AND c.is_nullable=1)
    OR (c.name=N'CreatedAtUtc' AND c.system_type_id=42 AND c.scale=0 AND c.is_nullable=0)))=10 THEN 1 ELSE 0 END AS Ready025,
 CASE WHEN EXISTS(SELECT 1 FROM sys.columns c WHERE c.object_id=OBJECT_ID(N'uqp.DashboardDisplayDevice',N'U')
  AND c.name=N'ArchivedAtUtc' AND c.system_type_id=42 AND c.user_type_id=42 AND c.scale=0 AND c.is_nullable=1 AND c.is_computed=0)
  AND OBJECT_ID(N'uqp.DashboardDeviceArchivePolicy',N'U') IS NOT NULL
  AND OBJECT_ID(N'uqp.DashboardDeviceArchiveHistory',N'U') IS NOT NULL THEN 1 ELSE 0 END AS Ready900,
 CASE WHEN (SELECT COUNT_BIG(*) FROM sys.columns c WHERE c.object_id=OBJECT_ID(N'uqp.DashboardDisplayDevice',N'U')
  AND c.name IN(N'QueryModeGrantVersion',N'DelegatorTokenVersion') AND c.system_type_id=127 AND c.user_type_id=127
  AND c.is_nullable=1 AND c.is_computed=0 AND c.default_object_id=0)=2
  AND EXISTS(SELECT 1 FROM sys.columns c WHERE c.object_id=OBJECT_ID(N'uqp.Dashboard',N'U') AND c.name=N'QueryMode'
    AND c.system_type_id=167 AND c.user_type_id=167 AND c.max_length=24 AND c.is_nullable=0 AND c.is_computed=0)
  AND EXISTS(SELECT 1 FROM sys.columns c WHERE c.object_id=OBJECT_ID(N'uqp.Dashboard',N'U') AND c.name=N'QueryModeVersion'
    AND c.system_type_id=127 AND c.user_type_id=127 AND c.is_nullable=0 AND c.is_computed=0)
  AND EXISTS(SELECT 1 FROM sys.check_constraints c WHERE c.parent_object_id=OBJECT_ID(N'uqp.Dashboard',N'U')
    AND c.name=N'CK_Dashboard_QueryMode' AND c.is_disabled=0 AND c.is_not_trusted=0 AND c.is_not_for_replication=0)
  AND EXISTS(SELECT 1 FROM sys.check_constraints c WHERE c.parent_object_id=OBJECT_ID(N'uqp.DashboardDisplayDevice',N'U')
    AND c.name=N'CK_DashboardDevice_QueryModeGrant' AND c.is_disabled=0 AND c.is_not_trusted=0 AND c.is_not_for_replication=0)
  THEN 1 ELSE 0 END AS Ready918
), E AS (
 SELECT N'025_dashboard_display_device.sql' AS FileName,Ready025 AS MinimumSchemaReady FROM Facts
 UNION ALL SELECT N'900_dashboard_device_archive.sql',Ready900 FROM Facts
 UNION ALL SELECT N'918_dashboard_query_playback_mode.sql',Ready918 FROM Facts
)
SELECT N'08_PREREQUISITE_PAIRS' AS Section,e.FileName,e.MinimumSchemaReady,COUNT_BIG(m.FileName) AS LedgerCount,
 CASE WHEN COALESCE(HAS_PERMS_BY_NAME(DB_NAME(),N'DATABASE',N'VIEW DEFINITION'),0)<>1 THEN N'BLOCKED_VISIBILITY'
 WHEN COUNT_BIG(m.FileName)>1 THEN N'BLOCKED_DUPLICATE_LEDGER'
 WHEN COUNT_BIG(m.FileName)=1 AND e.MinimumSchemaReady=0 THEN N'BLOCKED_PREREQUISITE_LEDGER_SCHEMA_MISMATCH'
 WHEN COUNT_BIG(m.FileName)=0 AND e.MinimumSchemaReady=1 THEN N'BLOCKED_PREREQUISITE_SCHEMA_UNRECORDED'
 WHEN COUNT_BIG(m.FileName)=0 THEN N'BLOCKED_MISSING_PREREQUISITE'
 ELSE N'PASS_MINIMUM_PAIR_REQUIRES_ALL_COLUMN_AND_DEFINITION_GATES' END AS Assessment
FROM E e LEFT JOIN uqp.SchemaMigration m ON CONVERT(nvarchar(max),m.FileName) COLLATE Latin1_General_100_BIN2=e.FileName COLLATE Latin1_General_100_BIN2
 AND DATALENGTH(CONVERT(nvarchar(max),m.FileName))=DATALENGTH(e.FileName)
GROUP BY e.FileName,e.MinimumSchemaReady;
GO

-- 09_LEDGER_SCHEMA_PAIR: a local pair assessment only. PASS here is not deployment approval.
;WITH ExpectedChecks(CheckName,DefinitionValue) AS (SELECT * FROM (VALUES
(N'CK_DashboardDevice_LifecycleTerminal',N'casewhenrevokedatutcisnotnullandisactive<>0then0whenarchivedatutcisnotnullandisactive<>0then0else1end=1'),
 (N'CK_DashboardDevice_LifecycleSuspended',N'casewhensuspendedatutcisnullthen1whenisactive=0andrevokedatutcisnullandarchivedatutcisnullandreenrollmentrequired=1andquerymodegrantversionisnullanddelegatortokenversionisnullthen1else0end=1'),
 (N'CK_DashboardDevice_LifecycleEnrollment',N'casewhenreenrollmentrequiredisnullthen1whenrevokedatutcisnotnullthen0whenarchivedatutcisnotnullthen0whensuspendedatutcisnotnullthen1whenisactive=1then1else0end=1')
) v(CheckName,DefinitionValue)), S AS (
 SELECT
 (SELECT COUNT_BIG(*) FROM sys.columns c WHERE c.object_id=OBJECT_ID(N'uqp.DashboardDisplayDevice',N'U') AND c.name IN(N'SuspendedAtUtc',N'ReenrollmentRequired')) AS MarkerCount,
 (SELECT COUNT_BIG(*) FROM sys.columns c WHERE c.object_id=OBJECT_ID(N'uqp.DashboardDisplayDevice',N'U') AND c.is_nullable=1 AND c.is_computed=0 AND c.default_object_id=0
   AND ((c.name=N'SuspendedAtUtc' AND c.system_type_id=42 AND c.user_type_id=42 AND c.scale=0) OR (c.name=N'ReenrollmentRequired' AND c.system_type_id=104 AND c.user_type_id=104))) AS ValidMarkerCount,
 (SELECT COUNT_BIG(*) FROM sys.objects o WHERE o.schema_id=SCHEMA_ID(N'uqp') AND o.name IN(N'CK_DashboardDevice_LifecycleTerminal',N'CK_DashboardDevice_LifecycleSuspended',N'CK_DashboardDevice_LifecycleEnrollment',N'TR_DashboardDevice_Lifecycle')) AS NamedObjectCount,
 (SELECT COUNT_BIG(*) FROM ExpectedChecks e JOIN sys.check_constraints c ON c.name=e.CheckName AND c.parent_object_id=OBJECT_ID(N'uqp.DashboardDisplayDevice',N'U')
   WHERE c.is_disabled=0 AND c.is_not_trusted=0 AND c.is_not_for_replication=0 AND LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(c.definition,N'[',N''),N']',N''),N'(',N''),N')',N''),N' ',N''),CHAR(13),N''),CHAR(10),N''),CHAR(9),N''))=e.DefinitionValue) AS ValidCheckCount,
 (SELECT COUNT_BIG(*) FROM sys.triggers tr JOIN sys.sql_modules m ON m.object_id=tr.object_id
   WHERE tr.object_id=OBJECT_ID(N'uqp.TR_DashboardDevice_Lifecycle',N'TR') AND tr.parent_id=OBJECT_ID(N'uqp.DashboardDisplayDevice',N'U') AND tr.is_disabled=0 AND tr.is_instead_of_trigger=0 AND tr.is_not_for_replication=0
   AND (SELECT COUNT_BIG(*) FROM sys.trigger_events ev WHERE ev.object_id=tr.object_id)=1
   AND EXISTS(SELECT 1 FROM sys.trigger_events ev WHERE ev.object_id=tr.object_id AND ev.type_desc=N'UPDATE')
   AND HASHBYTES('SHA2_256',LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(m.definition,N'[',N''),N']',N''),N' ',N''),CHAR(13),N''),CHAR(10),N''),CHAR(9),N'')))=0x0f3259251e812fdc2e3acc303e0c469cf2aaf4590035099336da72b0dae4abfb) AS ValidTriggerCount,
 (SELECT COUNT_BIG(*) FROM uqp.SchemaMigration WHERE CONVERT(nvarchar(max),FileName) COLLATE Latin1_General_100_BIN2=N'926_dashboard_device_lifecycle.sql' AND DATALENGTH(CONVERT(nvarchar(max),FileName))=DATALENGTH(N'926_dashboard_device_lifecycle.sql')) AS Ledger926Count
)
SELECT N'09_LEDGER_SCHEMA_PAIR' AS Section,SYSUTCDATETIME() AS CapturedAtUtc,S.*,
 CASE WHEN COALESCE(HAS_PERMS_BY_NAME(DB_NAME(),N'DATABASE',N'VIEW DEFINITION'),0)<>1 THEN N'BLOCKED_VISIBILITY'
 WHEN Ledger926Count>1 THEN N'BLOCKED_DUPLICATE_LEDGER'
 WHEN MarkerCount=0 AND NamedObjectCount=0 AND Ledger926Count=0 THEN N'PASS_PAIR_CLEAN_PRE926_PENDING_ALL_OTHER_GATES'
 WHEN ValidMarkerCount=2 AND ValidCheckCount=3 AND ValidTriggerCount=1 AND Ledger926Count=1 THEN N'PASS_PAIR_ALREADY_926_DO_NOT_RERUN'
 WHEN ValidMarkerCount=2 AND ValidCheckCount=3 AND ValidTriggerCount=1 AND Ledger926Count=0 THEN N'BLOCKED_SCHEMA_PRESENT_LEDGER_ABSENT_NO_AUTO_ADOPT'
 WHEN Ledger926Count=1 THEN N'BLOCKED_RECORDED_BUT_SCHEMA_INCOMPLETE'
 ELSE N'BLOCKED_PARTIAL_OR_CONFLICTING_SCHEMA' END AS Assessment
FROM S;
GO

-- 10_LEGACY_DATA: requires minimum PRE column contracts. Aggregate only, no credentials/identifiers.
;WITH D AS (
 SELECT CASE WHEN RevokedAtUtc IS NOT NULL AND IsActive<>0 THEN 0 WHEN ArchivedAtUtc IS NOT NULL AND IsActive<>0 THEN 0 ELSE 1 END AS TerminalPass,
 CASE WHEN (QueryModeGrantVersion IS NULL AND DelegatorTokenVersion IS NULL) OR (QueryModeGrantVersion IS NOT NULL AND DelegatorTokenVersion IS NOT NULL AND QueryModeGrantVersion>0 AND DelegatorTokenVersion>0) THEN 1 ELSE 0 END AS GrantPairPass,
 CASE WHEN IsActive=1 AND ExpiresAtUtc<=SYSUTCDATETIME() THEN 1 ELSE 0 END AS ActiveExpiredInfo,
 CASE WHEN IsActive=0 AND RevokedAtUtc IS NULL AND ArchivedAtUtc IS NOT NULL THEN 1 ELSE 0 END AS LegacyArchiveWithoutRevokeInfo
 FROM uqp.DashboardDisplayDevice WHERE DB_NAME()=N'UniversalQueryPlatform'
), A AS (
 SELECT COUNT_BIG(*) AS DeviceCount,COALESCE(SUM(CONVERT(bigint,1-TerminalPass)),0) AS TerminalViolations,
 COALESCE(SUM(CONVERT(bigint,1-GrantPairPass)),0) AS GrantPairViolations,
 COALESCE(SUM(CONVERT(bigint,ActiveExpiredInfo)),0) AS ActiveExpiredInformational,
 COALESCE(SUM(CONVERT(bigint,LegacyArchiveWithoutRevokeInfo)),0) AS LegacyArchiveWithoutRevokeInformational FROM D
)
SELECT N'10_LEGACY_DATA' AS Section,SYSUTCDATETIME() AS CapturedAtUtc,A.*,
 CASE WHEN COL_LENGTH(N'uqp.DashboardDisplayDevice',N'SuspendedAtUtc') IS NULL AND COL_LENGTH(N'uqp.DashboardDisplayDevice',N'ReenrollmentRequired') IS NULL
 THEN N'NEW_MARKERS_NULL_ON_UPGRADE_MAKE_SUSPENDED_AND_ENROLLMENT_CHECKS_TRUE'
 ELSE N'EXISTING_OR_PARTIAL_MARKERS_REQUIRE_INSTALLED_STATE_QUERY' END AS MarkerAssessment,
 CASE WHEN DB_NAME()<>N'UniversalQueryPlatform' THEN N'BLOCKED_WRONG_DATABASE'
 WHEN TerminalViolations<>0 OR GrantPairViolations<>0 THEN N'BLOCKED_EXISTING_DATA'
 ELSE N'PASS_LEGACY_BASE_DATA_ONLY_NOT_INSTALLED_MARKER_STATE' END AS Assessment FROM A;
GO

-- 11_DATABASE_FILES: current database only; no automatic headroom budget is invented.
SELECT N'11_DATABASE_FILES' AS Section,f.file_id,f.name,f.type_desc,f.physical_name,
 CONVERT(decimal(19,2),CONVERT(bigint,f.size)*8.0/1024) AS AllocatedMb,
 CASE WHEN f.type=0 THEN CONVERT(decimal(19,2),CONVERT(bigint,FILEPROPERTY(f.name,'SpaceUsed'))*8.0/1024) END AS UsedDataMb,
 CASE WHEN f.type=0 THEN CONVERT(decimal(19,2),(CONVERT(bigint,f.size)-CONVERT(bigint,FILEPROPERTY(f.name,'SpaceUsed')))*8.0/1024) END AS FreeInsideDataFileMb,
 f.max_size,f.growth,f.is_percent_growth,
 CASE WHEN f.max_size=-1 AND f.type=0 THEN N'FILE_SETTING_UNLIMITED_EXPRESS_DATA_CAP_STILL_APPLIES'
 WHEN f.max_size=-1 THEN N'FILE_SETTING_UNLIMITED_ENGINE_AND_STORAGE_LIMITS_STILL_APPLY'
 WHEN f.max_size=0 THEN N'NO_FILE_GROWTH_ALLOWED' ELSE N'FILE_MAX_SIZE_IS_IN_8KB_PAGES' END AS FileLimitNote,
 N'CAPACITY_BUDGET_AND_EXISTING_BACKUP_RECORD_REQUIRE_MANUAL_REVIEW' AS Assessment
FROM sys.database_files f WHERE DB_NAME()=N'UniversalQueryPlatform' ORDER BY f.file_id;

;WITH F AS (
 SELECT size,type,CASE WHEN type=0 THEN FILEPROPERTY(name,'SpaceUsed') END AS UsedPages FROM sys.database_files
), A AS (
 SELECT SUM(CASE WHEN type=0 THEN CONVERT(bigint,size) ELSE 0 END) AS DataPages,
 SUM(CASE WHEN type=0 THEN CONVERT(bigint,UsedPages) ELSE 0 END) AS DataUsedPages,
 SUM(CASE WHEN type=0 AND UsedPages IS NULL THEN 1 ELSE 0 END) AS MissingUsageCount,
 SUM(CASE WHEN type NOT IN(0,1) THEN 1 ELSE 0 END) AS NonstandardFiles FROM F
)
SELECT N'11_EXPRESS_DATA_CAP' AS Section,CONVERT(decimal(19,2),DataPages*8.0/1024) AS AllocatedRowsMb,
 CONVERT(decimal(19,2),10240-DataPages*8.0/1024) AS HeadroomToExpress10GbMb,
 CASE WHEN MissingUsageCount=0 THEN CONVERT(decimal(19,2),(DataPages-DataUsedPages)*8.0/1024) END AS FreeInsideRowsFilesMb,
 MissingUsageCount,NonstandardFiles,
 CASE WHEN DB_NAME()<>N'UniversalQueryPlatform' THEN N'BLOCKED_WRONG_DATABASE'
 WHEN MissingUsageCount<>0 OR NonstandardFiles<>0 THEN N'BLOCKED_CAPACITY_EVIDENCE_REVIEW'
 WHEN DataPages*8.0/1024>10240 THEN N'BLOCKED_EXPRESS_CAP'
 ELSE N'BLOCKED_CAPACITY_BUDGET_NOT_CONFIRMED_BY_SQL' END AS Assessment FROM A;
GO

-- 12_VOLUMES_LOG_TEMPDB: privileged read-only DMVs; permission errors are BLOCKED evidence, not zero.
-- Repeated available_bytes for files on the same volume must NOT be added together.
SELECT N'12_DATABASE_VOLUMES' AS Section,v.volume_mount_point,v.logical_volume_name,
 MIN(v.total_bytes) AS VolumeTotalBytes,MIN(v.available_bytes) AS VolumeAvailableBytes,COUNT_BIG(*) AS FilesOnVolume
FROM sys.database_files f CROSS APPLY sys.dm_os_volume_stats(DB_ID(),f.file_id) v
WHERE DB_NAME()=N'UniversalQueryPlatform' GROUP BY v.volume_mount_point,v.logical_volume_name;

SELECT N'12_LOG_SPACE' AS Section,total_log_size_in_bytes,used_log_space_in_bytes,used_log_space_in_percent,
 log_space_in_bytes_since_last_backup FROM sys.dm_db_log_space_usage WHERE DB_NAME()=N'UniversalQueryPlatform';

SELECT N'12_TEMPDB_SPACE' AS Section,file_id,total_page_count,allocated_extent_page_count,unallocated_extent_page_count,
 user_object_reserved_page_count,internal_object_reserved_page_count,version_store_reserved_page_count
FROM tempdb.sys.dm_db_file_space_usage WHERE DB_NAME()=N'UniversalQueryPlatform' ORDER BY file_id;

SELECT N'12_TEMPDB_VOLUMES' AS Section,v.volume_mount_point,v.logical_volume_name,
 MIN(v.total_bytes) AS VolumeTotalBytes,MIN(v.available_bytes) AS VolumeAvailableBytes,COUNT_BIG(*) AS FilesOnVolume
FROM sys.master_files f CROSS APPLY sys.dm_os_volume_stats(f.database_id,f.file_id) v
WHERE f.database_id=2 AND DB_NAME()=N'UniversalQueryPlatform' GROUP BY v.volume_mount_point,v.logical_volume_name;
GO

-- 13_EXISTING_BACKUP_RECORDS: history SELECT only. Does not start/verify/restore any backup.
-- History presence/checksum flags do NOT prove VERIFYONLY or a successful recovery of the intended artifact.
SELECT TOP(20) N'13_EXISTING_BACKUP_HISTORY' AS Section,b.backup_set_id,b.backup_set_uuid,b.server_name,b.machine_name,
 b.database_name,b.database_guid,b.family_guid,b.database_creation_date,b.type,b.backup_start_date,b.backup_finish_date,b.is_copy_only,b.has_backup_checksums,b.is_damaged,
 b.backup_size,b.compressed_backup_size,b.first_lsn,b.last_lsn,b.checkpoint_lsn,b.database_backup_lsn,b.recovery_model
FROM msdb.dbo.backupset b WHERE b.database_name=N'UniversalQueryPlatform' AND DB_NAME()=N'UniversalQueryPlatform'
ORDER BY b.backup_finish_date DESC,b.backup_set_id DESC;

SELECT TOP(20) N'13_EXISTING_RESTORE_HISTORY' AS Section,r.restore_history_id,r.backup_set_id,r.restore_date,
 r.destination_database_name,r.restore_type,r.recovery,b.backup_set_uuid,b.backup_finish_date
FROM msdb.dbo.restorehistory r JOIN msdb.dbo.backupset b ON b.backup_set_id=r.backup_set_id
WHERE b.database_name=N'UniversalQueryPlatform' AND DB_NAME()=N'UniversalQueryPlatform'
ORDER BY r.restore_date DESC,r.restore_history_id DESC;
GO

-- 14_NON_SQL_GATES: never infer application version, backup validation or approval from Ledger rows.
SELECT N'14_NON_SQL_GATES' AS Section,e.GateName,e.RequiredEvidence,N'BLOCKED_UNTIL_EXISTING_EVIDENCE_REVIEWED' AS Assessment
FROM (VALUES
 (N'CURRENT_APPLICATION_VERSION',N'Existing deployed Server/Client manifest, commit and file hashes; not package version alone. No .env or secret values.'),
 (N'CANDIDATE_APPLICATION_COMPATIBILITY',N'926-compatible release manifest tied to D5-C-5A CI #1251; old UPDATE OUTPUT without INTO is incompatible.'),
 (N'EXISTING_VERIFIED_BACKUP',N'Existing matching backup identifier, verification/restore evidence, age/RPO and retention. No new backup or verification command in this task.'),
 (N'CAPACITY_AND_MAINTENANCE',N'Approved data/log/tempdb/volume budget and bounded maintenance/locking window; no arbitrary MB threshold inferred.'),
 (N'APPROVED_DEPLOYMENT_IDENTITY',N'Observed capabilities must belong to the separately approved deployment principal, not merely this read-only evidence login.'),
 (N'POST_BACKUP_TERMINAL_EVENTS',N'Existing plan must preserve later revocations, enrollment and Audit; otherwise backup-based rollback is blocked.')
) e(GateName,RequiredEvidence);
