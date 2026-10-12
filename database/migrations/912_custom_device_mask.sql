-- Custom per-column display masking configuration. Existing policies remain unchanged.
IF OBJECT_ID(N'uqp.DatasetSensitiveColumn', N'U') IS NULL
    THROW 51012, 'DATASET_SENSITIVE_COLUMNS_REQUIRED', 1;
IF COL_LENGTH('uqp.DatasetSensitiveColumn', 'CustomMaskJson') IS NULL
    ALTER TABLE uqp.DatasetSensitiveColumn ADD CustomMaskJson NVARCHAR(256) NULL;
GO
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID(N'uqp.DatasetSensitiveColumn') AND name=N'CK_DatasetSensitiveColumn_Mask')
    ALTER TABLE uqp.DatasetSensitiveColumn DROP CONSTRAINT CK_DatasetSensitiveColumn_Mask;
ALTER TABLE uqp.DatasetSensitiveColumn WITH CHECK ADD CONSTRAINT CK_DatasetSensitiveColumn_Mask
    CHECK (DeviceMaskMode IN ('NONE','NAME','MRN','PHONE','GENERIC','FULL','OMIT','CUSTOM'));
GO
