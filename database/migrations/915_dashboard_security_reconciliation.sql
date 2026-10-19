-- Additive reconciliation for databases that already recorded early versions of 912/914.
-- Never drops patient records or rewrites saved dashboard/dataset policies.
IF OBJECT_ID(N'uqp.DatasetSensitiveColumn', N'U') IS NULL OR COL_LENGTH(N'uqp.DatasetSensitiveColumn', N'CustomMaskJson') IS NULL
    THROW 51015, 'CUSTOM_MASK_MIGRATION_912_REQUIRED', 1;
IF COL_LENGTH(N'uqp.DashboardDataSource', N'PageSize') IS NULL OR COL_LENGTH(N'uqp.DashboardDataSource', N'PageSeconds') IS NULL
    THROW 51016, 'DASHBOARD_PAGING_MIGRATION_914_REQUIRED', 1;
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
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID(N'uqp.DashboardDataSource') AND name=N'CK_DashboardDataSource_PageSize')
    ALTER TABLE uqp.DashboardDataSource WITH CHECK ADD CONSTRAINT CK_DashboardDataSource_PageSize CHECK (PageSize BETWEEN 1 AND 100);
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID(N'uqp.DashboardDataSource') AND name=N'CK_DashboardDataSource_PageSeconds')
    ALTER TABLE uqp.DashboardDataSource WITH CHECK ADD CONSTRAINT CK_DashboardDataSource_PageSeconds CHECK (PageSeconds BETWEEN 5 AND 3600);
GO

-- Existing named constraints must also be enabled and trusted after a repeat deployment.
ALTER TABLE uqp.DatasetSensitiveColumn WITH CHECK CHECK CONSTRAINT CK_DatasetSensitiveColumn_CustomMask;
GO
ALTER TABLE uqp.DashboardDataSource WITH CHECK CHECK CONSTRAINT CK_DashboardDataSource_PageSize;
ALTER TABLE uqp.DashboardDataSource WITH CHECK CHECK CONSTRAINT CK_DashboardDataSource_PageSeconds;
GO
