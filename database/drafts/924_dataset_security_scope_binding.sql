-- REVIEW DRAFT: outside the migration runner. Never run against a user database without separate approval.
-- Requires installed 923. No 923 ALTER, automatic RolePermission/UserRole/Scope grant, or delivery enablement.
SET XACT_ABORT ON;
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
BEGIN TRY
  BEGIN TRANSACTION;
  IF OBJECT_ID(N'uqp.DatasetSecurityScope',N'U') IS NULL OR OBJECT_ID(N'uqp.DatasetSecurityDecision',N'U') IS NULL
    THROW 52924,'924_PREREQUISITES_REQUIRED',1;
  IF OBJECT_ID(N'uqp.DatasetSecurityScopeBinding') IS NOT NULL
    THROW 52924,'924_ALREADY_PRESENT_REQUIRES_EXACT_REVIEW',1;
  CREATE TABLE uqp.DatasetSecurityScopeBinding (
    DatasetId BIGINT NOT NULL,
    UserId BIGINT NOT NULL,
    ScopeKind NVARCHAR(8) COLLATE Latin1_General_100_BIN2 NOT NULL,
    ScopeVersion BINARY(8) NOT NULL,
    SubjectTokenVersion INT NOT NULL,
    DefinitionVersion BINARY(8) NOT NULL,
    ConfigurationVersion BINARY(8) NOT NULL,
    ParentScopeVersion BINARY(8) NULL,
    ParentTokenVersion INT NULL,
    PlatformIncarnation UNIQUEIDENTIFIER NOT NULL,
    CONSTRAINT PK_DatasetSecurityScopeBinding PRIMARY KEY CLUSTERED(DatasetId,UserId,ScopeKind),
    -- No new inbound FK on installed 923 objects: preserve the exact 923 Catalog contract.
    -- Scope association is enforced by same-transaction CAS plus the existing Decision->Scope FK.
    CONSTRAINT FK_DatasetSecurityScopeBinding_Dataset FOREIGN KEY(DatasetId) REFERENCES uqp.Dataset(Id) ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT FK_DatasetSecurityScopeBinding_User FOREIGN KEY(UserId) REFERENCES uqp.AppUser(Id) ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT CK_DatasetSecurityScopeBinding_Values CHECK(CASE WHEN DatasetId>0 AND UserId>0 AND SubjectTokenVersion>0
      AND ScopeVersion<>0x0000000000000000 AND DefinitionVersion<>0x0000000000000000 AND ConfigurationVersion<>0x0000000000000000
      AND ((ScopeKind=N'OWNER' AND DATALENGTH(ScopeKind)=10 AND ParentScopeVersion IS NULL AND ParentTokenVersion IS NULL)
        OR (ScopeKind=N'REVIEWER' AND DATALENGTH(ScopeKind)=16 AND ParentScopeVersion IS NOT NULL
          AND ParentScopeVersion<>0x0000000000000000 AND ParentTokenVersion IS NOT NULL AND ParentTokenVersion>0))
      THEN 1 ELSE 0 END=1)
  );
  -- Definitions only. Assignment to an existing role requires an explicit administrator operation.
  IF NOT EXISTS(SELECT 1 FROM uqp.Permission WHERE Code=N'MANAGE_DATASET_SECURITY_SCOPE')
    INSERT INTO uqp.Permission(Code,Name,Description) VALUES(N'MANAGE_DATASET_SECURITY_SCOPE',N'管理 Dataset 負責人',N'需有效 SYSTEM_ADMIN 並逐 Dataset 明確指派');
  IF NOT EXISTS(SELECT 1 FROM uqp.Permission WHERE Code=N'CONFIRM_DATASET_CLASSIFICATION')
    INSERT INTO uqp.Permission(Code,Name,Description) VALUES(N'CONFIRM_DATASET_CLASSIFICATION',N'確認 Dataset 分類',N'能力須與有效 Dataset Owner/Reviewer Scope 同時成立');
  -- Application principals must also lack CONTROL/ALTER. dbo/sysadmin bypass DENY and are refused by the API.
  DENY UPDATE,DELETE ON OBJECT::uqp.DatasetSecurityDecision TO public;
  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
