-- Additive security contract. Execute only after isolated validation; never in application startup.
-- Requires 907, DashboardDataSource, DatasetColumn and DatasetSensitiveColumn. Does not require 916-918.
SET XACT_ABORT ON;
BEGIN TRY
  BEGIN TRANSACTION;
  IF OBJECT_ID(N'uqp.DatasetPatientAuditConfig', N'U') IS NULL
     OR OBJECT_ID(N'uqp.Dataset', N'U') IS NULL
     OR OBJECT_ID(N'uqp.DatasetColumn', N'U') IS NULL
     OR OBJECT_ID(N'uqp.DatasetSensitiveColumn', N'U') IS NULL
     OR OBJECT_ID(N'uqp.DatasetSensitivePolicyVersion', N'U') IS NULL
     OR OBJECT_ID(N'uqp.Dashboard', N'U') IS NULL
     OR OBJECT_ID(N'uqp.DashboardDataSource', N'U') IS NULL
     OR OBJECT_ID(N'uqp.AuditLog', N'U') IS NULL
    THROW 51919, 'SECURITY_CONTRACT_PREREQUISITE_MISSING', 1;
  IF COL_LENGTH(N'uqp.DatasetPatientAuditConfig', N'UpdatedAtUtc') IS NULL
     OR COL_LENGTH(N'uqp.DatasetPatientAuditConfig', N'PatientKeyColumn') IS NULL
     OR COL_LENGTH(N'uqp.Dataset', N'SqlText') IS NULL
    THROW 51919, 'SECURITY_CONTRACT_PREREQUISITE_INVALID', 1;
  IF EXISTS (SELECT 1 FROM sys.objects WHERE schema_id=SCHEMA_ID(N'uqp')
      AND name IN (N'DatasetPatientAuditMetadata',N'DatasetPatientAuditConfig',N'Dashboard',N'DashboardDataSource') AND type<>N'U')
    THROW 51919, 'SECURITY_CONTRACT_OBJECT_CONFLICT', 1;
  -- Re-execution accepts only the exact owned column types, not a conflicting version field.
  IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'uqp.DatasetPatientAuditConfig')
      AND name=N'ConfigurationVersion' AND (system_type_id<>127 OR is_nullable<>0))
     OR EXISTS (SELECT 1 FROM sys.columns WHERE object_id IN (OBJECT_ID(N'uqp.Dashboard'),OBJECT_ID(N'uqp.DashboardDataSource'))
      AND name=N'ApprovalRowVersion' AND (system_type_id<>189 OR is_nullable<>0))
     OR EXISTS (SELECT 1 FROM sys.columns WHERE object_id IN (OBJECT_ID(N'uqp.Dashboard'),OBJECT_ID(N'uqp.DashboardDataSource'))
      AND system_type_id=189 AND name<>N'ApprovalRowVersion')
    THROW 51919, 'SECURITY_CONTRACT_SCHEMA_CONFLICT', 1;
  IF COL_LENGTH(N'uqp.DatasetPatientAuditConfig', N'ConfigurationVersion') IS NULL
    EXEC(N'ALTER TABLE uqp.DatasetPatientAuditConfig ADD ConfigurationVersion BIGINT NOT NULL
      CONSTRAINT DF_DatasetPatientAuditConfig_Version DEFAULT (1) WITH VALUES');
  IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID(N'uqp.DatasetPatientAuditConfig') AND name=N'CK_DatasetPatientAuditConfig_Version')
    EXEC(N'ALTER TABLE uqp.DatasetPatientAuditConfig WITH CHECK ADD CONSTRAINT CK_DatasetPatientAuditConfig_Version CHECK (ConfigurationVersion>=1)');
  EXEC(N'ALTER TABLE uqp.DatasetPatientAuditConfig WITH CHECK CHECK CONSTRAINT CK_DatasetPatientAuditConfig_Version');
  IF COL_LENGTH(N'uqp.Dashboard', N'ApprovalRowVersion') IS NULL
    EXEC(N'ALTER TABLE uqp.Dashboard ADD ApprovalRowVersion ROWVERSION NOT NULL');
  IF COL_LENGTH(N'uqp.DashboardDataSource', N'ApprovalRowVersion') IS NULL
    EXEC(N'ALTER TABLE uqp.DashboardDataSource ADD ApprovalRowVersion ROWVERSION NOT NULL');
  -- Existing column lists have no trustworthy provenance. No backfill or inferred approval.
  IF OBJECT_ID(N'uqp.DatasetPatientAuditMetadata', N'U') IS NULL
    EXEC(N'CREATE TABLE uqp.DatasetPatientAuditMetadata (
      DatasetId BIGINT NOT NULL CONSTRAINT PK_DatasetPatientAuditMetadata PRIMARY KEY,
      DefinitionHash CHAR(64) NOT NULL,
      ColumnsJson NVARCHAR(MAX) NOT NULL,
      CONSTRAINT FK_DatasetPatientAuditMetadata_Dataset FOREIGN KEY (DatasetId) REFERENCES uqp.Dataset(Id) ON DELETE CASCADE,
      CONSTRAINT CK_DatasetPatientAuditMetadata_Json CHECK (ISJSON(ColumnsJson)=1)
    )');
  ELSE IF ISNULL(COL_LENGTH(N'uqp.DatasetPatientAuditMetadata', N'DefinitionHash'),0)<>64
       OR ISNULL(COL_LENGTH(N'uqp.DatasetPatientAuditMetadata', N'ColumnsJson'),0)<>-1
       OR ISNULL(COL_LENGTH(N'uqp.DatasetPatientAuditMetadata', N'DatasetId'),0)<>8
    THROW 51919, 'SECURITY_CONTRACT_METADATA_SCHEMA_CONFLICT', 1;
  IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'uqp.DatasetPatientAuditMetadata') AND
      ((name=N'DatasetId' AND (system_type_id<>127 OR is_nullable<>0))
       OR (name=N'DefinitionHash' AND (system_type_id<>175 OR is_nullable<>0))
       OR (name=N'ColumnsJson' AND (system_type_id<>231 OR is_nullable<>0))))
    THROW 51919, 'SECURITY_CONTRACT_METADATA_SCHEMA_CONFLICT', 1;
  IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE parent_object_id=OBJECT_ID(N'uqp.DatasetPatientAuditMetadata')
      AND name=N'FK_DatasetPatientAuditMetadata_Dataset' AND referenced_object_id=OBJECT_ID(N'uqp.Dataset') AND is_disabled=0 AND is_not_trusted=0 AND delete_referential_action=1)
     OR NOT EXISTS (SELECT 1 FROM sys.key_constraints WHERE parent_object_id=OBJECT_ID(N'uqp.DatasetPatientAuditMetadata') AND name=N'PK_DatasetPatientAuditMetadata' AND type='PK')
     OR NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID(N'uqp.DatasetPatientAuditMetadata') AND name=N'CK_DatasetPatientAuditMetadata_Json' AND is_disabled=0 AND is_not_trusted=0)
    THROW 51919, 'SECURITY_CONTRACT_METADATA_CONSTRAINT_INVALID', 1;
  IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE parent_object_id IN
      (OBJECT_ID(N'uqp.DatasetPatientAuditConfig'),OBJECT_ID(N'uqp.DatasetPatientAuditMetadata')) AND is_not_trusted=1)
    THROW 51919, 'SECURITY_CONTRACT_UNTRUSTED_CONSTRAINT', 1;
  IF (SELECT COUNT(*) FROM sys.columns WHERE object_id=OBJECT_ID(N'uqp.DatasetPatientAuditMetadata'))<>3
    THROW 51919, 'SECURITY_CONTRACT_METADATA_SCHEMA_CONFLICT', 1;
  -- Recovery stage 1: names alone do not prove constraint semantics.
  -- Compare canonical expressions only; reject unfamiliar equivalents for manual review.
  IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id IN
      (OBJECT_ID(N'uqp.DatasetPatientAuditConfig'),OBJECT_ID(N'uqp.Dashboard'),OBJECT_ID(N'uqp.DashboardDataSource'),OBJECT_ID(N'uqp.DatasetPatientAuditMetadata'))
      AND name IN (N'ConfigurationVersion',N'ApprovalRowVersion',N'DatasetId',N'DefinitionHash',N'ColumnsJson')
      AND (is_computed=1 OR user_type_id<>system_type_id))
    THROW 51919, 'SECURITY_CONTRACT_COLUMN_CONFLICT', 1;
  IF NOT EXISTS (SELECT 1 FROM sys.default_constraints d JOIN sys.columns c
      ON c.object_id=d.parent_object_id AND c.column_id=d.parent_column_id
      WHERE d.parent_object_id=OBJECT_ID(N'uqp.DatasetPatientAuditConfig') AND c.name=N'ConfigurationVersion'
      AND REPLACE(REPLACE(REPLACE(d.definition,N'(',N''),N')',N''),N' ',N'')=N'1')
    THROW 51919, 'SECURITY_CONTRACT_DEFAULT_CONFLICT', 1;
  IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID(N'uqp.DatasetPatientAuditConfig')
      AND name=N'CK_DatasetPatientAuditConfig_Version' AND is_disabled=0 AND is_not_trusted=0 AND is_not_for_replication=0
      AND REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(LOWER(definition),N'[',N''),N']',N''),N'(',N''),N')',N''),N' ',N'')=N'configurationversion>=1')
    THROW 51919, 'SECURITY_CONTRACT_VERSION_CHECK_CONFLICT', 1;
  IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID(N'uqp.DatasetPatientAuditMetadata')
      AND name=N'CK_DatasetPatientAuditMetadata_Json' AND is_disabled=0 AND is_not_trusted=0 AND is_not_for_replication=0
      AND REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(LOWER(definition),N'[',N''),N']',N''),N'(',N''),N')',N''),N' ',N'')=N'isjsoncolumnsjson=1')
    THROW 51919, 'SECURITY_CONTRACT_METADATA_CHECK_CONFLICT', 1;
  IF NOT EXISTS (SELECT 1 FROM sys.key_constraints k JOIN sys.index_columns i
      ON i.object_id=k.parent_object_id AND i.index_id=k.unique_index_id
      JOIN sys.columns c ON c.object_id=i.object_id AND c.column_id=i.column_id
      JOIN sys.indexes x ON x.object_id=k.parent_object_id AND x.index_id=k.unique_index_id
      WHERE k.parent_object_id=OBJECT_ID(N'uqp.DatasetPatientAuditMetadata') AND k.name=N'PK_DatasetPatientAuditMetadata'
      AND k.type=N'PK' AND c.name=N'DatasetId' AND i.key_ordinal=1 AND x.is_disabled=0
      AND (SELECT COUNT(*) FROM sys.index_columns z WHERE z.object_id=k.parent_object_id AND z.index_id=k.unique_index_id AND z.key_ordinal>0)=1)
    THROW 51919, 'SECURITY_CONTRACT_METADATA_PK_CONFLICT', 1;
  IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys f JOIN sys.foreign_key_columns m ON m.constraint_object_id=f.object_id
      JOIN sys.columns pc ON pc.object_id=m.parent_object_id AND pc.column_id=m.parent_column_id
      JOIN sys.columns rc ON rc.object_id=m.referenced_object_id AND rc.column_id=m.referenced_column_id
      WHERE f.parent_object_id=OBJECT_ID(N'uqp.DatasetPatientAuditMetadata') AND f.name=N'FK_DatasetPatientAuditMetadata_Dataset'
      AND f.referenced_object_id=OBJECT_ID(N'uqp.Dataset') AND pc.name=N'DatasetId' AND rc.name=N'Id'
      AND f.is_disabled=0 AND f.is_not_trusted=0 AND f.is_not_for_replication=0
      AND f.delete_referential_action=1 AND f.update_referential_action=0
      AND (SELECT COUNT(*) FROM sys.foreign_key_columns z WHERE z.constraint_object_id=f.object_id)=1)
    THROW 51919, 'SECURITY_CONTRACT_METADATA_FK_CONFLICT', 1;
  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
