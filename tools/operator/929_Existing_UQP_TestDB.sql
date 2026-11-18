/*
PR99 + PR100 unified operator installation SQL: TEST ENVIRONMENT ONLY.
Exact target: EINOV-VPN / UniversalQueryPlatform (existing test database).
Requires pre-change verified SQL backup and operator-controlled SSMS session.
Never auto-executed by Node, CI or ZIP updater. Do NOT run on hospital production.
Original PR100 reviewed 929 source preserved verbatim below.
*/
USE [UniversalQueryPlatform];
GO
SET NOCOUNT ON;
SET XACT_ABORT ON;
IF @@SERVERNAME <> N'EINOV-VPN'
    THROW 51929, 'PR100_EXISTING_TEST_SERVER_MISMATCH', 1;
IF DB_NAME() <> N'UniversalQueryPlatform'
    THROW 51929, 'PR100_EXISTING_TEST_DATABASE_MISMATCH', 1;
IF @@TRANCOUNT <> 0
    THROW 51929, 'PR100_EXTERNAL_TRANSACTION_NOT_ALLOWED', 1;
BEGIN TRY
    BEGIN TRANSACTION;
-- REVIEW DRAFT ONLY. Not scanned by db:migrate; no automatic installation.
-- 928 is reserved for CHART and is NOT a prerequisite. No existing data or grants.
-- An approved installer must own the transaction and verify the exact target first.
SET XACT_ABORT ON;
IF @@TRANCOUNT<>1 THROW 51929,'HIERARCHY_OWNED_INSTALL_TRANSACTION_REQUIRED',1;
IF OBJECT_ID(N'uqp.QueryDefinition',N'U') IS NULL OR OBJECT_ID(N'uqp.AppUser',N'U') IS NULL
 OR OBJECT_ID(N'uqp.AuditLog',N'U') IS NULL OR OBJECT_ID(N'uqp.QueryDefinitionVersion',N'U') IS NULL
 OR COL_LENGTH(N'uqp.Dataset',N'DefinitionRowVersion') IS NULL
 OR COL_LENGTH(N'uqp.DataSource',N'ConfigurationRowVersion') IS NULL
 THROW 51929,'HIERARCHY_BASELINE_REQUIRED',1;
IF OBJECT_ID(N'uqp.QueryHierarchyConfiguration') IS NOT NULL
 THROW 51929,'HIERARCHY_ALREADY_PRESENT_REQUIRES_EXACT_REVIEW',1;
CREATE TABLE uqp.QueryHierarchyConfiguration (
 RootQueryId BIGINT NOT NULL CONSTRAINT PK_QueryHierarchyConfiguration PRIMARY KEY,
 GraphJson NVARCHAR(MAX) NOT NULL,
 BindingJson NVARCHAR(MAX) NOT NULL,
 UpdatedByUserId BIGINT NOT NULL,
 UpdatedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_QueryHierarchy_Updated DEFAULT SYSUTCDATETIME(),
 AuditLogId BIGINT NOT NULL,
 ConfigRowVersion ROWVERSION NOT NULL,
 CONSTRAINT FK_QueryHierarchy_Query FOREIGN KEY(RootQueryId) REFERENCES uqp.QueryDefinition(Id) ON DELETE NO ACTION,
 CONSTRAINT FK_QueryHierarchy_Actor FOREIGN KEY(UpdatedByUserId) REFERENCES uqp.AppUser(Id) ON DELETE NO ACTION,
 CONSTRAINT CK_QueryHierarchy_Json CHECK(ISJSON(GraphJson)=1 AND DATALENGTH(GraphJson)<=65536),
 CONSTRAINT CK_QueryHierarchy_Bindings CHECK(ISJSON(BindingJson)=1 AND DATALENGTH(BindingJson)<=16384),
 CONSTRAINT CK_QueryHierarchy_Ids CHECK(RootQueryId>0 AND UpdatedByUserId>0 AND AuditLogId>0)
);
-- Audit receipt intentionally has no online AuditLog FK: archive/retention must work.
-- Root FK prevents silently deleting a configured root. Remove configuration via a
-- separately reviewed operation or leave the Query archived. Do not cascade history.

    DECLARE @t INT = OBJECT_ID(N'uqp.QueryHierarchyConfiguration', N'U');
    IF @t IS NULL
       OR (SELECT COUNT(*) FROM sys.columns WHERE object_id=@t) <> 7
       OR (SELECT COUNT(*) FROM sys.key_constraints WHERE parent_object_id=@t AND type='PK') <> 1
       OR (SELECT COUNT(*) FROM sys.foreign_keys WHERE parent_object_id=@t AND is_disabled=0 AND is_not_trusted=0) <> 2
       OR (SELECT COUNT(*) FROM sys.check_constraints WHERE parent_object_id=@t AND is_disabled=0 AND is_not_trusted=0) <> 3
       OR (SELECT COUNT(*) FROM sys.default_constraints WHERE parent_object_id=@t) <> 1
       THROW 51929, 'HIERARCHY_POST_INSTALL_CATALOG_MISMATCH', 1;
    COMMIT TRANSACTION;
    SELECT 'PR99_PR100_EXISTING_TEST_DB_929_INSTALL_PASS' AS Result,
           @@SERVERNAME AS ServerName, DB_NAME() AS DatabaseName;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
