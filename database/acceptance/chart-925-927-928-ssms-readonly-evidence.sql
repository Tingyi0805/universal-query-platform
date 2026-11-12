/*
 UQP CHART / Issue #89 — one-pass SQL Server 2019/2022 SSMS read-only evidence.
 Purpose: capture target identity, 925 CHECK/DEFAULT name-level differences,
          926/927 catalog footprint+ledger, and 928 sidecar absence.
 This file is NOT the exact 925/926/927 source validator, a 928 migration,
 an installer, a signoff, or permission to switch any CHART runtime gate on.

 SAFETY:
 - Choose the intended existing UQP database in the SSMS database dropdown.
 - Replace the three "__FILL_..." values below with the values returned
   by an independent, approved DBA target-identity check.
 - Run once with an authorized metadata/ledger read-only login.
 - No USE, GO, EXEC, DDL, persistent DML, clinical-row SELECT, key or token read.
 - If target identity does not match, the batch stops BEFORE catalog checks.
 - Never execute any 925 installer/928 draft/SchemaMigration correction here.
*/
SET NOCOUNT ON;
DECLARE @ExpectedServer nvarchar(256)=N'__FILL_SERVER__';
DECLARE @ExpectedDatabase nvarchar(256)=N'__FILL_DATABASE__';
DECLARE @ExpectedOriginalLogin nvarchar(256)=N'__FILL_ORIGINAL_LOGIN__';

IF @ExpectedServer LIKE N'__FILL%' OR @ExpectedDatabase LIKE N'__FILL%'
   OR @ExpectedOriginalLogin LIKE N'__FILL%' OR
   LEN(@ExpectedServer)=0 OR LEN(@ExpectedDatabase)=0 OR
   LEN(@ExpectedOriginalLogin)=0
  THROW 51980,'UQP_CHART_EXPECTED_TARGET_IDENTITY_REQUIRED',1;
-- NULL identity is never proof of the selected target. SQL Server pads
-- VARCHAR/NVARCHAR for '=' and '<>' even under BIN2; compare actual byte
-- lengths as well, so 'UQP ' cannot impersonate an expected 'UQP'.
IF @@SERVERNAME IS NULL OR DB_NAME() IS NULL OR ORIGINAL_LOGIN() IS NULL
  THROW 51981,'UQP_CHART_TARGET_IDENTITY_MISMATCH',1;
IF CONVERT(nvarchar(256),@@SERVERNAME) COLLATE Latin1_General_100_BIN2
     <> @ExpectedServer COLLATE Latin1_General_100_BIN2
   OR DATALENGTH(CONVERT(nvarchar(256),@@SERVERNAME))
     <> DATALENGTH(@ExpectedServer)
   OR DB_NAME() COLLATE Latin1_General_100_BIN2
     <> @ExpectedDatabase COLLATE Latin1_General_100_BIN2
   OR DATALENGTH(DB_NAME()) <> DATALENGTH(@ExpectedDatabase)
   OR ORIGINAL_LOGIN() COLLATE Latin1_General_100_BIN2
     <> @ExpectedOriginalLogin COLLATE Latin1_General_100_BIN2
   OR DATALENGTH(ORIGINAL_LOGIN())
     <> DATALENGTH(@ExpectedOriginalLogin)
  THROW 51981,'UQP_CHART_TARGET_IDENTITY_MISMATCH',1;
IF CONVERT(int,SERVERPROPERTY(N'ProductMajorVersion')) NOT IN (15,16)
  THROW 51982,'UQP_CHART_SQL_VERSION_UNSUPPORTED',1;
IF OBJECT_ID(N'uqp.SchemaMigration',N'U') IS NULL
  THROW 51983,'UQP_CHART_LEDGER_NOT_VISIBLE_OR_MISSING',1;
IF COALESCE(HAS_PERMS_BY_NAME(DB_NAME(),N'DATABASE',N'VIEW DEFINITION'),0)<>1
  THROW 51984,'UQP_CHART_REVIEW_METADATA_VISIBILITY_REQUIRED',1;

SELECT N'00_PINNED_IDENTITY' AS Section,
       CONVERT(nvarchar(256),@@SERVERNAME) AS SqlServer,
       DB_NAME() AS DatabaseName,
       ORIGINAL_LOGIN() AS OriginalLogin,
       CONVERT(int,SERVERPROPERTY(N'ProductMajorVersion')) AS SqlMajor,
       SYSUTCDATETIME() AS ObservedAtUtc,
       N'READ_ONLY_NOT_A_MIGRATION_APPROVAL' AS Assessment,
       CONVERT(bit,0) AS MayInstall928,
       CONVERT(bit,0) AS ChartCanBeEnabled;

-- 925 CHECK + DEFAULT names below are transcribed from the reviewed checked-in
-- tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql.
-- Names/flags only. Matching all 16 does NOT compare SQL expressions, column
-- types, identity/collation, PK/FK/INDEX, triggers or source provenance.
;WITH Expected925(TableName,ConstraintKind,ConstraintName) AS (
  SELECT * FROM (VALUES
  (N'DatasetPublicDisplayPolicy',N'DEFAULT',N'DF_PublicDisplay_Confirmed'),
  (N'DatasetPublicDisplayPolicy',N'DEFAULT',N'DF_PublicDisplay_Updated'),
  (N'DatasetPublicDisplayPolicy',N'CHECK',N'CK_PublicDisplay_Values'),
  (N'DatasetPublicDisplayPolicy',N'CHECK',N'CK_PublicDisplay_Json'),
  (N'DatasetMaskTemplate',N'DEFAULT',N'DF_MaskTemplate_Public'),
  (N'DatasetMaskTemplate',N'DEFAULT',N'DF_MaskTemplate_Active'),
  (N'DatasetMaskTemplate',N'DEFAULT',N'DF_MaskTemplate_Revision'),
  (N'DatasetMaskTemplate',N'DEFAULT',N'DF_MaskTemplate_Created'),
  (N'DatasetMaskTemplate',N'DEFAULT',N'DF_MaskTemplate_Updated'),
  (N'DatasetMaskTemplate',N'CHECK',N'CK_MaskTemplate_Revision'),
  (N'DatasetMaskTemplate',N'CHECK',N'CK_MaskTemplate_Aliases'),
  (N'DatasetMaskTemplate',N'CHECK',N'CK_MaskTemplate_Mode'),
  (N'DatasetMaskTemplate',N'CHECK',N'CK_MaskTemplate_Custom'),
  (N'DatasetMaskTemplate',N'CHECK',N'CK_MaskTemplate_Public'),
  (N'DatasetMaskTemplateUse',N'DEFAULT',N'DF_MaskTemplateUse_Applied'),
  (N'DatasetMaskTemplateUse',N'CHECK',N'CK_MaskTemplateUse_Values')
  ) v(TableName,ConstraintKind,ConstraintName)
), Observed925 AS (
  SELECT t.name AS TableName,N'CHECK' AS ConstraintKind,c.name AS ConstraintName,
         c.is_disabled AS Disabled,c.is_not_trusted AS Untrusted,
         c.is_not_for_replication AS NotForReplication
  FROM sys.check_constraints c
  JOIN sys.tables t ON c.parent_object_id=t.object_id
  WHERE t.schema_id=SCHEMA_ID(N'uqp')
    AND t.name IN (N'DatasetPublicDisplayPolicy',N'DatasetMaskTemplate',
                   N'DatasetMaskTemplateUse')
  UNION ALL
  SELECT t.name,N'DEFAULT',c.name,0,0,0
  FROM sys.default_constraints c
  JOIN sys.tables t ON c.parent_object_id=t.object_id
  WHERE t.schema_id=SCHEMA_ID(N'uqp')
    AND t.name IN (N'DatasetPublicDisplayPolicy',N'DatasetMaskTemplate',
                   N'DatasetMaskTemplateUse')
)
SELECT N'01_925_CONSTRAINT_NAMES' AS Section,
       COALESCE(e.TableName,a.TableName) AS TableName,
       COALESCE(e.ConstraintKind,a.ConstraintKind) AS ConstraintKind,
       COALESCE(e.ConstraintName,a.ConstraintName) AS ConstraintName,
       CASE WHEN e.ConstraintName IS NULL THEN N'UNEXPECTED'
            WHEN a.ConstraintName IS NULL THEN N'MISSING'
            WHEN a.Disabled<>0 OR a.Untrusted<>0 OR a.NotForReplication<>0
              THEN N'BLOCKED_FLAGS'
            ELSE N'NAME_PRESENT_NOT_EXACT_ATTESTED' END AS Assessment
FROM Expected925 e FULL OUTER JOIN Observed925 a
 ON e.TableName=a.TableName AND e.ConstraintKind=a.ConstraintKind
 AND e.ConstraintName=a.ConstraintName
ORDER BY TableName,ConstraintKind,ConstraintName;

SELECT N'02_925_CATALOG_COUNTS_NOT_ATTESTATION' AS Section,
  CONVERT(int,16) AS ExpectedCheckDefaultNames,
  (SELECT COUNT(*) FROM sys.check_constraints c JOIN sys.tables t
      ON c.parent_object_id=t.object_id
   WHERE t.schema_id=SCHEMA_ID(N'uqp') AND
         t.name IN (N'DatasetPublicDisplayPolicy',N'DatasetMaskTemplate',
                    N'DatasetMaskTemplateUse'))
  +(SELECT COUNT(*) FROM sys.default_constraints c JOIN sys.tables t
      ON c.parent_object_id=t.object_id
    WHERE t.schema_id=SCHEMA_ID(N'uqp') AND
          t.name IN (N'DatasetPublicDisplayPolicy',N'DatasetMaskTemplate',
                     N'DatasetMaskTemplateUse')) AS ObservedCheckDefaultNames,
  (SELECT COUNT(*) FROM sys.tables t
    WHERE t.schema_id=SCHEMA_ID(N'uqp') AND
          t.name IN (N'DatasetPublicDisplayPolicy',N'DatasetMaskTemplate',
                     N'DatasetMaskTemplateUse')) AS Observed925Tables,
  N'EXACT_925_VALIDATOR_STILL_REQUIRED' AS Assessment;

SELECT N'03_926_FOOTPRINT_NOT_EXACT' AS Section,
  CASE WHEN OBJECT_ID(N'uqp.DashboardDisplayDevice',N'U') IS NULL
       THEN N'BLOCKED_BASELINE_MISSING'
       WHEN COL_LENGTH(N'uqp.DashboardDisplayDevice',N'SuspendedAtUtc') IS NULL
        AND COL_LENGTH(N'uqp.DashboardDisplayDevice',N'ReenrollmentRequired') IS NULL
        AND NOT EXISTS(SELECT 1 FROM sys.triggers
          WHERE parent_id=OBJECT_ID(N'uqp.DashboardDisplayDevice',N'U')
            AND name=N'TR_DashboardDevice_Lifecycle')
       THEN N'ABSENT'
       WHEN COL_LENGTH(N'uqp.DashboardDisplayDevice',N'SuspendedAtUtc') IS NOT NULL
        AND COL_LENGTH(N'uqp.DashboardDisplayDevice',N'ReenrollmentRequired') IS NOT NULL
        AND (SELECT COUNT_BIG(*) FROM sys.check_constraints
          WHERE parent_object_id=OBJECT_ID(N'uqp.DashboardDisplayDevice',N'U')
            AND name IN (N'CK_DashboardDevice_LifecycleTerminal',
                         N'CK_DashboardDevice_LifecycleSuspended',
                         N'CK_DashboardDevice_LifecycleEnrollment')
            AND is_disabled=0 AND is_not_trusted=0
            AND is_not_for_replication=0)=3
        AND EXISTS(SELECT 1 FROM sys.triggers
          WHERE parent_id=OBJECT_ID(N'uqp.DashboardDisplayDevice',N'U')
            AND name=N'TR_DashboardDevice_Lifecycle' AND is_disabled=0)
       THEN N'FOOTPRINT_PRESENT_EXACT_VALIDATOR_REQUIRED'
       ELSE N'BLOCKED_PARTIAL_OR_CONFLICT' END AS Assessment,
  CASE WHEN EXISTS(SELECT 1 FROM uqp.SchemaMigration
        WHERE FileName=N'926_dashboard_device_lifecycle.sql')
    THEN N'RECORDED_NOT_ATTESTED' ELSE N'NOT_RECORDED' END AS Ledger,
  CONVERT(bit,0) AS ExactAttested;

SELECT N'04_927_FOOTPRINT_NOT_EXACT' AS Section,
  CASE WHEN OBJECT_ID(N'uqp.SharedWorkstation',N'U') IS NULL
       THEN N'BLOCKED_BASELINE_MISSING'
       WHEN COL_LENGTH(N'uqp.SharedWorkstation',N'SwitchVersion') IS NULL
        AND OBJECT_ID(N'uqp.WorkstationPinAttemptBucket',N'U') IS NULL
       THEN N'ABSENT'
       WHEN COL_LENGTH(N'uqp.SharedWorkstation',N'SwitchVersion') IS NOT NULL
        AND OBJECT_ID(N'uqp.WorkstationPinAttemptBucket',N'U') IS NOT NULL
        AND EXISTS(SELECT 1 FROM sys.indexes
           WHERE object_id=OBJECT_ID(N'uqp.WorkstationPinAttemptBucket',N'U')
            AND name=N'PK_WorkstationPinAttemptBucket' AND is_disabled=0
            AND is_unique=1 AND is_primary_key=1)
       THEN N'FOOTPRINT_PRESENT_EXACT_VALIDATOR_REQUIRED'
       ELSE N'BLOCKED_PARTIAL_OR_CONFLICT' END AS Assessment,
  CASE WHEN EXISTS(SELECT 1 FROM uqp.SchemaMigration
         WHERE FileName=N'927_workstation_pin_runtime.sql')
    THEN N'RECORDED_NOT_ATTESTED' ELSE N'NOT_RECORDED' END AS Ledger,
  CONVERT(bit,0) AS ExactAttested;

SELECT N'05_928_SIDECARS_NOT_APPROVED' AS Section,
  (CASE WHEN OBJECT_ID(N'uqp.DashboardChartWidgetSeal',N'U') IS NULL
      THEN 0 ELSE 1 END+
   CASE WHEN OBJECT_ID(N'uqp.DashboardChartPrivacyReview',N'U') IS NULL
      THEN 0 ELSE 1 END+
   CASE WHEN OBJECT_ID(N'uqp.DashboardChartTrustRequest',N'U') IS NULL
      THEN 0 ELSE 1 END) AS ObservedSidecarTables,
  3 AS ExpectedIf928WereInstalled,
  CASE WHEN OBJECT_ID(N'uqp.DashboardChartWidgetSeal',N'U') IS NULL
         AND OBJECT_ID(N'uqp.DashboardChartPrivacyReview',N'U') IS NULL
         AND OBJECT_ID(N'uqp.DashboardChartTrustRequest',N'U') IS NULL
       THEN N'ABSENT_NOT_AUTHORIZED'
       WHEN OBJECT_ID(N'uqp.DashboardChartWidgetSeal',N'U') IS NOT NULL
         AND OBJECT_ID(N'uqp.DashboardChartPrivacyReview',N'U') IS NOT NULL
         AND OBJECT_ID(N'uqp.DashboardChartTrustRequest',N'U') IS NOT NULL
       THEN N'PRESENT_REQUIRES_INDEPENDENT_EXACT_ATTESTATION'
       ELSE N'BLOCKED_PARTIAL_OR_CONFLICT' END AS Assessment,
  CONVERT(bit,0) AS MayInstall928,
  CONVERT(bit,0) AS ChartCanBeEnabled;

SELECT N'06_FINAL_RELEASE' AS Section,
  N'BLOCKED_INDEPENDENT_APPROVAL_REQUIRED' AS Assessment,
  N'Name/footprint/ledger inventory cannot substitute for reviewed exact 925/926/927 catalogs, signer/Issuer/Writer, 928 source review, patient privacy, backup and IIS UAT.' AS RequiredAction,
  CONVERT(bit,0) AS MayInstall928,
  CONVERT(bit,0) AS ChartCanBeEnabled;
