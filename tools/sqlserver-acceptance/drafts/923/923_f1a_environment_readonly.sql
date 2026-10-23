-- UQP 923 / F1A: READ-ONLY WITNESS, NOT AN INSTALLER.
-- MANUAL use only, on a separately provisioned SQL Server 2019 test INSTANCE.
-- NEVER use this as permission to execute 923 DDL or to enable the preview.
-- Capture results from TWO distinct connections and corroborate with VM/instance inventory.
-- T-SQL cannot itself prove the physical instance is isolated from production.
-- No connection strings, secrets, DML, DDL, dynamic SQL, or stored procedures.
SELECT
  N'F1A_READONLY_923_V1' AS WitnessFormat,
  CONVERT(nvarchar(128), SERVERPROPERTY(N'ServerName')) AS ReportedServerName,
  CONVERT(nvarchar(128), SERVERPROPERTY(N'MachineName')) AS ReportedMachineName,
  CONVERT(nvarchar(128), SERVERPROPERTY(N'InstanceName')) AS ReportedInstanceName,
  CONVERT(nvarchar(128), SERVERPROPERTY(N'ProductVersion')) AS ProductVersion,
  TRY_CONVERT(int, SERVERPROPERTY(N'ProductMajorVersion')) AS EngineMajor,
  CONVERT(nvarchar(128), SERVERPROPERTY(N'Edition')) AS Edition,
  CONVERT(nvarchar(128), SERVERPROPERTY(N'Collation')) AS ServerCollation,
  DB_NAME() AS DatabaseName,
  d.compatibility_level AS CompatibilityLevel,
  d.state_desc AS DatabaseState,
  d.is_read_only AS DatabaseReadOnly,
  ORIGINAL_LOGIN() AS OriginalLogin,
  USER_NAME() AS DatabasePrincipal,
  APP_NAME() AS ClientApplication,
  @@SPID AS SessionId,
  CASE
    WHEN TRY_CONVERT(int, SERVERPROPERTY(N'ProductMajorVersion')) <> 15
      THEN N'REJECT_ENGINE'
    WHEN d.compatibility_level <> 150 THEN N'REJECT_COMPATIBILITY'
    WHEN DB_NAME() IN (N'UniversalQueryPlatform', N'UniversalQueryPlatform_Old', N'master', N'model', N'msdb', N'tempdb')
      THEN N'REJECT_PROTECTED_DATABASE_NAME'
    WHEN d.state_desc <> N'ONLINE' THEN N'REJECT_DATABASE_STATE'
    ELSE N'UNVERIFIED_REQUIRES_OUT_OF_BAND_ISOLATION_REVIEW'
  END AS WitnessDisposition
FROM sys.databases AS d
WHERE d.database_id = DB_ID();

-- Snapshot only: missing objects may ALSO mean insufficient metadata visibility.
-- Only an independently approved catalog-privileged validator may interpret this result.
SELECT N'DatasetFieldSnapshot' AS TargetName,
  OBJECT_ID(N'uqp.DatasetFieldSnapshot', N'U') AS VisibleObjectId
UNION ALL SELECT N'DatasetSecurityScope', OBJECT_ID(N'uqp.DatasetSecurityScope', N'U')
UNION ALL SELECT N'DatasetSecurityDecision', OBJECT_ID(N'uqp.DatasetSecurityDecision', N'U')
UNION ALL SELECT N'DatasetSecurityConfirmation', OBJECT_ID(N'uqp.DatasetSecurityConfirmation', N'U')
UNION ALL SELECT N'DatasetSecurityDecisionSeq', OBJECT_ID(N'uqp.DatasetSecurityDecisionSeq', N'SO');
