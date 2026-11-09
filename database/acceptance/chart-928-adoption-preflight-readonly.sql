-- Issue #89 / Migration 928: NON-INSTALLING, METADATA-ONLY adoption evidence.
-- For SQL Server 2019/2022. Safe to examine as source and to execute as
-- read-only metadata checks IF an authorized DBA explicitly requests it.
-- Does NOT run db:migrate, bootstrap, ALTER/CREATE/DROP, grant rights, read
-- clinical tables, change SchemaMigration, or provide a deployment approval.
-- "AVAILABLE" below is an inventory fact, NEVER an exact-925 attestation.
-- The 925 exact validator and signer/Issuer/Writer approval are SEPARATE.
-- No GO separators: may be executed by node-mssql in disposable CI.

SELECT N'00_RELEASE_GATE' AS Section,
       DB_NAME() AS TargetDatabase,
       CONVERT(nvarchar(128),SERVERPROPERTY(N'ProductVersion')) AS SqlVersion,
       CONVERT(int,SERVERPROPERTY(N'ProductMajorVersion')) AS SqlMajor,
       SYSUTCDATETIME() AS CapturedAtUtc,
       N'BLOCKED_INDEPENDENT_APPROVAL_REQUIRED' AS Assessment,
       CONVERT(bit,0) AS MayInstall928,
       N'READ_ONLY_EVIDENCE_NOT_A_DEPLOYMENT_APPROVAL' AS Reason;

;WITH RequiredObjects AS (
 SELECT * FROM (VALUES
  (N'BASE',N'uqp.Dashboard',N'U'),
  (N'BASE',N'uqp.DashboardDisplayProfile',N'U'),
  (N'BASE',N'uqp.DashboardWidget',N'U'),
  (N'BASE',N'uqp.AppUser',N'U'),
  (N'BASE',N'uqp.QueryDefinition',N'U'),
  (N'BASE',N'uqp.Dataset',N'U'),
  (N'BASE',N'uqp.AuditLog',N'U'),
  (N'BASE',N'uqp.AuditLogArchive',N'U'),
  (N'MIGRATION_LEDGER',N'uqp.SchemaMigration',N'U'),
  (N'925_MINIMUM',N'uqp.DatasetPublicDisplayPolicy',N'U'),
  (N'925_MINIMUM',N'uqp.DatasetMaskTemplate',N'U'),
  (N'925_MINIMUM',N'uqp.DatasetMaskTemplateUse',N'U')
 ) q(ObjectGroup,ObjectName,ObjectType)
)
SELECT N'01_REQUIRED_OBJECTS' AS Section,ObjectGroup,ObjectName,
 CASE WHEN OBJECT_ID(ObjectName,ObjectType) IS NULL
      THEN N'BLOCKED_MISSING' ELSE N'PRESENT_NOT_EXACT_ATTESTED'
 END AS Assessment
FROM RequiredObjects
ORDER BY ObjectGroup,ObjectName;

;WITH B AS (
 SELECT
  CASE WHEN OBJECT_ID(N'uqp.DatasetPublicDisplayPolicy',N'U') IS NOT NULL
   AND OBJECT_ID(N'uqp.DatasetMaskTemplate',N'U') IS NOT NULL
   AND OBJECT_ID(N'uqp.DatasetMaskTemplateUse',N'U') IS NOT NULL
   THEN 1 ELSE 0 END AS Minimum925TablesPresent
)
SELECT N'02_925_EXACT_CATALOG' AS Section,Minimum925TablesPresent,
       CONVERT(bit,0) AS Exact925IndependentlyAttested,
       CASE WHEN Minimum925TablesPresent=0
            THEN N'BLOCKED_925_TABLES_MISSING'
            ELSE N'BLOCKED_925_EXACT_VALIDATOR_REQUIRED'
       END AS Assessment,
       N'Never infer 925 exact match from object counts or ledger; use the existing independent 925 catalog validator including column types, identities, constraints, FKs, indexes, defaults and triggers.' AS RequiredAction
FROM B;

;WITH RequiredCols AS (
 SELECT * FROM (VALUES
 (N'uqp.DashboardWidget',N'WidgetType'),
 (N'uqp.DashboardWidget',N'ConfigJson'),
 (N'uqp.DashboardWidget',N'SourceKey'),
 (N'uqp.AuditLog',N'EventCategory'),
 (N'uqp.AuditLog',N'IsImportant'),
 (N'uqp.AuditLog',N'EventType'),
 (N'uqp.AuditLog',N'UserId'),
 (N'uqp.AuditLog',N'Status'),
 (N'uqp.AuditLogArchive',N'EventType'),
 (N'uqp.AuditLogArchive',N'IsImportant'),
 (N'uqp.AuditLogArchive',N'UserId'),
 (N'uqp.AuditLogArchive',N'Status')
 ) x(ObjectName,ColumnName)
)
SELECT N'03_REQUIRED_COLUMNS' AS Section,ObjectName,ColumnName,
 CASE WHEN COL_LENGTH(ObjectName,ColumnName) IS NULL
      THEN N'BLOCKED_MISSING_OR_INVISIBLE'
      ELSE N'PRESENT_NOT_TYPE_ATTESTED' END AS Assessment
FROM RequiredCols ORDER BY ObjectName,ColumnName;

;WITH Sidecars AS (
 SELECT * FROM (VALUES
  (N'uqp.DashboardChartWidgetSeal',N'U'),
  (N'uqp.DashboardChartPrivacyReview',N'U'),
  (N'uqp.DashboardChartTrustRequest',N'U')
 ) x(Name,ObjectType)
), Facts AS (
 SELECT COUNT_BIG(*) AS Expected,
   SUM(CASE WHEN OBJECT_ID(Name,ObjectType) IS NOT NULL THEN 1 ELSE 0 END)
      AS Present FROM Sidecars
)
SELECT N'04_928_PHASE' AS Section,Expected,Present,
       CASE WHEN Present=0 THEN N'ABSENT_NOT_AUTHORIZED'
            WHEN Present=Expected THEN N'PRESENT_REQUIRES_EXACT_ATTESTATION'
            ELSE N'BLOCKED_PARTIAL_OR_CONFLICT' END AS Assessment,
       CONVERT(bit,0) AS ChartCanBeEnabled,
       N'Never promote or adopt a partial 928 installation or infer runtime permission from table existence.' AS Reason
FROM Facts;

;WITH Artifacts AS (
 SELECT * FROM (VALUES
 (N'PK',N'uqp.DashboardChartWidgetSeal',N'U'),
 (N'PK',N'uqp.DashboardChartPrivacyReview',N'U'),
 (N'PK',N'uqp.DashboardChartTrustRequest',N'U'),
 (N'TRIGGER',N'uqp.TR_DashboardWidget_ChartFreeze',N'TR'),
 (N'TRIGGER',N'uqp.TR_ChartSeal_DeleteBlock',N'TR'),
 (N'TRIGGER',N'uqp.TR_ChartReview_Transition',N'TR'),
 (N'TRIGGER',N'uqp.TR_ChartTrustRequest_Immutable',N'TR'),
 (N'TRIGGER',N'uqp.TR_ChartSeal_AuditReceipt',N'TR'),
 (N'TRIGGER',N'uqp.TR_ChartReview_AuditReceipt',N'TR'),
 (N'TRIGGER',N'uqp.TR_ChartTrustRequest_AuditReceipt',N'TR')
 ) x(ArtifactType,ObjectName,ObjectType)
)
SELECT N'05_928_ARTIFACT_INVENTORY' AS Section,ArtifactType,ObjectName,
 CASE WHEN OBJECT_ID(ObjectName,ObjectType) IS NULL THEN N'ABSENT'
      ELSE N'PRESENT_REQUIRES_EXACT_DEFINITION_CHECK' END AS Assessment
FROM Artifacts ORDER BY ArtifactType,ObjectName;

SELECT N'06_WIDGET_BASE_CONSTRAINT' AS Section,c.name AS ConstraintName,
       c.is_disabled,c.is_not_trusted,c.is_not_for_replication,
       CASE WHEN c.object_id IS NULL THEN N'BLOCKED_MISSING'
            WHEN c.is_disabled<>0 OR c.is_not_trusted<>0
                OR c.is_not_for_replication<>0 THEN N'BLOCKED_FLAGS'
            WHEN c.definition LIKE N'%CHART%'
              THEN N'CHART_NAMED_REQUIRES_FREEZE_TRIGGER_AND_EXACT_ATTESTATION'
            ELSE N'BASE_NO_CHART_REQUIRES_EXACT_DEFINITION_ATTESTATION'
       END AS Assessment
FROM (SELECT N'CK_DashboardWidget_Type' AS ExpectedName) e
LEFT JOIN sys.check_constraints c
 ON c.parent_object_id=OBJECT_ID(N'uqp.DashboardWidget',N'U')
 AND c.name=e.ExpectedName;

SELECT N'07_DB_VISIBILITY' AS Section,
       COALESCE(HAS_PERMS_BY_NAME(DB_NAME(),N'DATABASE',N'VIEW DEFINITION'),0)
          AS CanViewDefinition,
       CASE WHEN COALESCE(HAS_PERMS_BY_NAME(DB_NAME(),N'DATABASE',N'VIEW DEFINITION'),0)=1
         THEN N'VISIBLE_ONLY_NOT_APPROVED'
         ELSE N'BLOCKED_CATALOG_VISIBILITY' END AS Assessment;

SELECT N'08_APPROVAL_REQUIREMENTS' AS Section,Requirement,
       N'BLOCKED_REQUIRES_SEPARATE_APPROVAL' AS Assessment
FROM (VALUES
(N'925 exact catalog/identity/index/constraint/schema source attestation'),
(N'928 writer/issuer/grant procedures, SQL principal SID and stored procedure provenance'),
(N'External independent signer deployment, mTLS identity, Ed25519/HMAC key custody and rotation'),
(N'SQL 2019/2022 dry-run plan, rollback and verified backup for target release'),
(N'Patient privacy signed public grouped-count review, Query ACL and device audit'),
(N'Explicit human deployment approval; all runtime Chart gates remain disabled')
) q(Requirement);
