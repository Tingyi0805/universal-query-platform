-- Dashboard supplemental Dataset sources (additive; primary QueryDefinition remains unchanged).
IF OBJECT_ID(N'uqp.Dashboard', N'U') IS NULL OR OBJECT_ID(N'uqp.Dataset', N'U') IS NULL
    THROW 51013, 'DASHBOARD_AND_DATASET_MIGRATIONS_REQUIRED', 1;
IF OBJECT_ID(N'uqp.DashboardDataSource', N'U') IS NULL
BEGIN
    CREATE TABLE uqp.DashboardDataSource (
        Id BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_DashboardDataSource PRIMARY KEY,
        DashboardId BIGINT NOT NULL,
        SourceKey NVARCHAR(64) NOT NULL,
        DatasetId BIGINT NOT NULL,
        RefreshSeconds INT NOT NULL CONSTRAINT DF_DashboardDataSource_RefreshSeconds DEFAULT (30),
        ParametersJson NVARCHAR(MAX) NOT NULL CONSTRAINT DF_DashboardDataSource_ParametersJson DEFAULT (N'{}'),
        IsEnabled BIT NOT NULL CONSTRAINT DF_DashboardDataSource_IsEnabled DEFAULT (1),
        CreatedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_DashboardDataSource_CreatedAt DEFAULT SYSUTCDATETIME(),
        UpdatedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_DashboardDataSource_UpdatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_DashboardDataSource_Dashboard FOREIGN KEY (DashboardId) REFERENCES uqp.Dashboard(Id) ON DELETE CASCADE,
        CONSTRAINT FK_DashboardDataSource_Dataset FOREIGN KEY (DatasetId) REFERENCES uqp.Dataset(Id),
        CONSTRAINT UQ_DashboardDataSource_Key UNIQUE (DashboardId, SourceKey),
        CONSTRAINT CK_DashboardDataSource_Refresh CHECK (RefreshSeconds BETWEEN 5 AND 3600),
        CONSTRAINT CK_DashboardDataSource_Parameters CHECK (ISJSON(ParametersJson) = 1)
    );
END;
GO
