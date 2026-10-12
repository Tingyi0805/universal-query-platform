-- Independent paging settings for supplemental Dashboard Datasets.
IF OBJECT_ID(N'uqp.DashboardDataSource', N'U') IS NULL
    THROW 51014, 'DASHBOARD_SOURCE_MIGRATION_913_REQUIRED', 1;
IF COL_LENGTH(N'uqp.DashboardDataSource', N'PageSize') IS NULL
BEGIN
    ALTER TABLE uqp.DashboardDataSource ADD PageSize INT NOT NULL
        CONSTRAINT DF_DashboardDataSource_PageSize DEFAULT (10);
    ALTER TABLE uqp.DashboardDataSource ADD CONSTRAINT CK_DashboardDataSource_PageSize CHECK (PageSize BETWEEN 1 AND 100);
END;
IF COL_LENGTH(N'uqp.DashboardDataSource', N'PageSeconds') IS NULL
BEGIN
    ALTER TABLE uqp.DashboardDataSource ADD PageSeconds INT NOT NULL
        CONSTRAINT DF_DashboardDataSource_PageSeconds DEFAULT (15);
    ALTER TABLE uqp.DashboardDataSource ADD CONSTRAINT CK_DashboardDataSource_PageSeconds CHECK (PageSeconds BETWEEN 5 AND 3600);
END;
GO
