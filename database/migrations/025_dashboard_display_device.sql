IF OBJECT_ID('uqp.DashboardDisplayDevice', 'U') IS NULL
BEGIN
    CREATE TABLE uqp.DashboardDisplayDevice (
        Id                BIGINT IDENTITY(1,1) PRIMARY KEY,
        DashboardId       BIGINT NOT NULL,
        DeviceName        NVARCHAR(200) NOT NULL,
        TokenHash         CHAR(64) NOT NULL,
        IsActive          BIT NOT NULL CONSTRAINT DF_DashboardDisplayDevice_IsActive DEFAULT (1),
        ExpiresAtUtc      DATETIME2(0) NULL,
        LastUsedAtUtc     DATETIME2(0) NULL,
        CreatedByUserId   BIGINT NOT NULL,
        CreatedAtUtc      DATETIME2(0) NOT NULL CONSTRAINT DF_DashboardDisplayDevice_CreatedAt DEFAULT (SYSUTCDATETIME()),
        RevokedAtUtc      DATETIME2(0) NULL,
        CONSTRAINT UQ_DashboardDisplayDevice_TokenHash UNIQUE (TokenHash),
        CONSTRAINT FK_DashboardDisplayDevice_Dashboard
            FOREIGN KEY (DashboardId) REFERENCES uqp.Dashboard(Id) ON DELETE CASCADE,
        CONSTRAINT FK_DashboardDisplayDevice_CreatedByUser
            FOREIGN KEY (CreatedByUserId) REFERENCES uqp.AppUser(Id)
    );
END
GO

IF OBJECT_ID('uqp.DashboardDisplayDevice', 'U') IS NOT NULL
   AND NOT EXISTS (
       SELECT 1
       FROM sys.indexes
       WHERE object_id = OBJECT_ID('uqp.DashboardDisplayDevice')
         AND name = 'IX_DashboardDisplayDevice_Dashboard'
   )
BEGIN
    CREATE INDEX IX_DashboardDisplayDevice_Dashboard
    ON uqp.DashboardDisplayDevice (DashboardId, IsActive, ExpiresAtUtc);
END
GO
