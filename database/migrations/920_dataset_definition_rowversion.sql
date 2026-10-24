-- Additive Dataset definition revision for future delivery-policy revalidation.
-- This migration does not rewrite Dataset definitions or sensitivity policies.
SET XACT_ABORT ON;
BEGIN TRY
  BEGIN TRANSACTION;

  IF OBJECT_ID(N'uqp.Dataset', N'U') IS NULL
    THROW 51920, 'DATASET_DEFINITION_VERSION_PREREQUISITE_MISSING', 1;

  -- SQL Server permits only one ROWVERSION column per table. Refuse an
  -- unfamiliar or partially installed shape instead of adopting it.
  IF EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id=OBJECT_ID(N'uqp.Dataset') AND system_type_id=189
      AND name<>N'DefinitionRowVersion'
  ) OR EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id=OBJECT_ID(N'uqp.Dataset') AND name=N'DefinitionRowVersion'
      AND (system_type_id<>189 OR user_type_id<>189 OR max_length<>8
        OR is_nullable<>0 OR is_computed<>0)
  )
    THROW 51920, 'DATASET_DEFINITION_VERSION_SCHEMA_CONFLICT', 1;

  IF COL_LENGTH(N'uqp.Dataset', N'DefinitionRowVersion') IS NULL
    EXEC(N'ALTER TABLE uqp.Dataset ADD DefinitionRowVersion ROWVERSION NOT NULL');

  IF (SELECT COUNT(*) FROM sys.columns
      WHERE object_id=OBJECT_ID(N'uqp.Dataset') AND system_type_id=189)<>1
    OR NOT EXISTS (
      SELECT 1 FROM sys.columns
      WHERE object_id=OBJECT_ID(N'uqp.Dataset') AND name=N'DefinitionRowVersion'
        AND system_type_id=189 AND user_type_id=189 AND max_length=8
        AND is_nullable=0 AND is_computed=0
    )
    THROW 51920, 'DATASET_DEFINITION_VERSION_SCHEMA_INVALID', 1;

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
