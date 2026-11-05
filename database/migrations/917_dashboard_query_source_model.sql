-- Slice 3A-1: additive model only. Do not execute against the shared database.
-- PRIMARY remains virtual in uqp.Dashboard; no primary row is inserted here.
-- No Query mapping or permission grant is inferred from DatasetId.
SET XACT_ABORT ON;
BEGIN TRY
    BEGIN TRANSACTION;

    IF OBJECT_ID(N'uqp.Dashboard', N'U') IS NULL
       OR OBJECT_ID(N'uqp.DashboardDataSource', N'U') IS NULL
       OR OBJECT_ID(N'uqp.QueryDefinition', N'U') IS NULL
       OR COL_LENGTH(N'uqp.Dashboard', N'QueryDefinitionId') IS NULL
       OR COL_LENGTH(N'uqp.DashboardDataSource', N'DatasetId') IS NULL
       OR COL_LENGTH(N'uqp.DashboardDataSource', N'SourceKey') IS NULL
       OR COL_LENGTH(N'uqp.DashboardDataSource', N'PageSize') IS NULL
       OR COL_LENGTH(N'uqp.DashboardDataSource', N'PageSeconds') IS NULL
        THROW 51017, 'DASHBOARD_SOURCE_MODEL_PREREQUISITES_REQUIRED', 1;

    -- A partial/previous installation needs inspection, never automatic repair.
    -- The migration runner's SchemaMigration record normally prevents re-entry.
    IF COL_LENGTH(N'uqp.DashboardDataSource', N'QueryDefinitionId') IS NOT NULL
       OR COL_LENGTH(N'uqp.Dashboard', N'QuerySourceMaxRows') IS NOT NULL
       OR COL_LENGTH(N'uqp.DashboardDataSource', N'QueryBindingRevision') IS NOT NULL
       OR COL_LENGTH(N'uqp.DashboardDataSource', N'MaxRows') IS NOT NULL
       OR EXISTS (SELECT 1 FROM sys.columns
                  WHERE object_id=OBJECT_ID(N'uqp.DashboardDataSource')
                    AND name=N'QueryBindingState')
        THROW 51017, 'DASHBOARD_SOURCE_MODEL_ALREADY_OR_PARTIALLY_INSTALLED', 1;

    -- Nullable columns preserve legacy rows without assigning a Query or a limit.
    -- Separate dynamic statements are required: SQL Server binds CHECK/computed references at compile time.
    EXEC sys.sp_executesql N'
        ALTER TABLE uqp.Dashboard ADD QuerySourceMaxRows INT NULL;
    ';
    EXEC sys.sp_executesql N'
        ALTER TABLE uqp.Dashboard WITH CHECK ADD
            CONSTRAINT CK_Dashboard_QuerySourceMaxRows
                CHECK (QuerySourceMaxRows IS NULL OR QuerySourceMaxRows BETWEEN 1 AND 10000);
    ';
    EXEC sys.sp_executesql N'
        ALTER TABLE uqp.DashboardDataSource ADD
            QueryDefinitionId BIGINT NULL,
            QueryBindingRevision BIGINT NOT NULL
                CONSTRAINT DF_DashboardDataSource_QueryBindingRevision DEFAULT (0),
            MaxRows INT NULL;
    ';
    EXEC sys.sp_executesql N'
        ALTER TABLE uqp.DashboardDataSource ADD
            QueryBindingState AS CONVERT(VARCHAR(20), CASE
                WHEN QueryDefinitionId IS NULL THEN ''PENDING_CONVERSION''
                ELSE ''QUERY_BOUND'' END);
    ';
    EXEC sys.sp_executesql N'
        ALTER TABLE uqp.DashboardDataSource WITH CHECK ADD
            CONSTRAINT FK_DashboardDataSource_QueryDefinition
                FOREIGN KEY (QueryDefinitionId) REFERENCES uqp.QueryDefinition(Id),
            CONSTRAINT CK_DashboardDataSource_QueryBindingRevision
                CHECK (QueryBindingRevision >= 0),
            CONSTRAINT CK_DashboardDataSource_MaxRows
                CHECK (MaxRows IS NULL OR MaxRows BETWEEN 1 AND 10000),
            CONSTRAINT CK_DashboardDataSource_QueryBoundLimit
                CHECK (QueryDefinitionId IS NULL OR MaxRows IS NOT NULL);
    ';

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
