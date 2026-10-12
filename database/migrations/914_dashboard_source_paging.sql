-- Independent paging settings for supplemental Dashboard Datasets.
IF OBJECT_ID(N'uqp.DashboardDataSource', N'U') IS NULL
    THROW 51014, 'DASHBOARD_SOURCE_MIGRATION_913_REQUIRED', 1;
IF COL_LENGTH(N'uqp.DashboardDataSource', N'PageSize') IS NULL
BEGIN
    ALTER TABLE uqp.DashboardDataSource ADD PageSize INT NOT NULL
        CONSTRAINT DF_DashboardDataSource_PageSize DEFAULT (10);
END;
GO
IF COL_LENGTH(N'uqp.DashboardDataSource', N'PageSeconds') IS NULL
BEGIN
    ALTER TABLE uqp.DashboardDataSource ADD PageSeconds INT NOT NULL
        CONSTRAINT DF_DashboardDataSource_PageSeconds DEFAULT (15);
END;
GO
-- Separate batches resolve newly-added column names on SQL Server; repair missing checks on rerun.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID(N'uqp.DashboardDataSource') AND name=N'CK_DashboardDataSource_PageSize')
    ALTER TABLE uqp.DashboardDataSource WITH CHECK ADD CONSTRAINT CK_DashboardDataSource_PageSize CHECK (PageSize BETWEEN 1 AND 100);
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID(N'uqp.DashboardDataSource') AND name=N'CK_DashboardDataSource_PageSeconds')
    ALTER TABLE uqp.DashboardDataSource WITH CHECK ADD CONSTRAINT CK_DashboardDataSource_PageSeconds CHECK (PageSeconds BETWEEN 5 AND 3600);
GO
