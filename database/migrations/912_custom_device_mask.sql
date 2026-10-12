-- Custom per-column display masking configuration. Existing policies remain unchanged.
IF OBJECT_ID(N'uqp.DatasetSensitiveColumn', N'U') IS NULL
    THROW 51012, 'DATASET_SENSITIVE_COLUMNS_REQUIRED', 1;
IF COL_LENGTH('uqp.DatasetSensitiveColumn', 'CustomMaskJson') IS NULL
    ALTER TABLE uqp.DatasetSensitiveColumn ADD CustomMaskJson NVARCHAR(256) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID(N'uqp.DatasetSensitiveColumn') AND name=N'CK_DatasetSensitiveColumn_CustomMask')
    ALTER TABLE uqp.DatasetSensitiveColumn WITH CHECK ADD CONSTRAINT CK_DatasetSensitiveColumn_CustomMask CHECK (
      DeviceMaskMode <> 'CUSTOM' OR (
        CustomMaskJson IS NOT NULL AND ISJSON(CustomMaskJson)=1
        AND TRY_CONVERT(INT, JSON_VALUE(CASE WHEN ISJSON(CustomMaskJson)=1 THEN CustomMaskJson ELSE N'{}' END, '$.prefix')) IS NOT NULL
        AND TRY_CONVERT(INT, JSON_VALUE(CASE WHEN ISJSON(CustomMaskJson)=1 THEN CustomMaskJson ELSE N'{}' END, '$.prefix')) BETWEEN 0 AND 100
        AND TRY_CONVERT(INT, JSON_VALUE(CASE WHEN ISJSON(CustomMaskJson)=1 THEN CustomMaskJson ELSE N'{}' END, '$.suffix')) IS NOT NULL
        AND TRY_CONVERT(INT, JSON_VALUE(CASE WHEN ISJSON(CustomMaskJson)=1 THEN CustomMaskJson ELSE N'{}' END, '$.suffix')) BETWEEN 0 AND 100
        AND JSON_VALUE(CASE WHEN ISJSON(CustomMaskJson)=1 THEN CustomMaskJson ELSE N'{}' END, '$.symbol') IS NOT NULL
        AND LEN((JSON_VALUE(CASE WHEN ISJSON(CustomMaskJson)=1 THEN CustomMaskJson ELSE N'{}' END, '$.symbol') + N'x') COLLATE Latin1_General_100_CI_AS_SC)=2
        AND DATALENGTH(JSON_VALUE(CASE WHEN ISJSON(CustomMaskJson)=1 THEN CustomMaskJson ELSE N'{}' END, '$.symbol')) BETWEEN 2 AND 4
        AND CHARINDEX(NCHAR(10), JSON_VALUE(CASE WHEN ISJSON(CustomMaskJson)=1 THEN CustomMaskJson ELSE N'{}' END, '$.symbol'))=0
        AND CHARINDEX(NCHAR(13), JSON_VALUE(CASE WHEN ISJSON(CustomMaskJson)=1 THEN CustomMaskJson ELSE N'{}' END, '$.symbol'))=0
        AND CHARINDEX(NCHAR(9), JSON_VALUE(CASE WHEN ISJSON(CustomMaskJson)=1 THEN CustomMaskJson ELSE N'{}' END, '$.symbol'))=0
      )
    );
GO
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID(N'uqp.DatasetSensitiveColumn') AND name=N'CK_DatasetSensitiveColumn_Mask')
    ALTER TABLE uqp.DatasetSensitiveColumn DROP CONSTRAINT CK_DatasetSensitiveColumn_Mask;
ALTER TABLE uqp.DatasetSensitiveColumn WITH CHECK ADD CONSTRAINT CK_DatasetSensitiveColumn_Mask
    CHECK (DeviceMaskMode IN ('NONE','NAME','MRN','PHONE','GENERIC','FULL','OMIT','CUSTOM'));
GO

-- Existing named constraints must also be enabled and trusted after a repeat deployment.
ALTER TABLE uqp.DatasetSensitiveColumn WITH CHECK CHECK CONSTRAINT CK_DatasetSensitiveColumn_CustomMask;
GO
