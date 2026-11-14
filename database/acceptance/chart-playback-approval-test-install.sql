-- UQP CHART Gate 3: controlled TEST-ONLY SQL Server installation.
-- Does not install 928, activate routes, change existing UQP roles, or grant logins.
-- Requires an already installed, verified CHART 928 trust schema.
-- Run only against a disposable/test database after backup; not production.
SET NOCOUNT ON;
SET XACT_ABORT ON;
IF @@TRANCOUNT <> 0
    THROW 51929, 'CHART_APPROVAL_INSTALL_REQUIRES_NO_OUTER_TRANSACTION', 1;
IF OBJECT_ID(N'uqp.DashboardChartWidgetSeal', N'U') IS NULL
    OR OBJECT_ID(N'uqp.DashboardWidget', N'U') IS NULL
    OR OBJECT_ID(N'uqp.DashboardDisplayProfile', N'U') IS NULL
    OR OBJECT_ID(N'uqp.AppUser', N'U') IS NULL
    OR OBJECT_ID(N'uqp.AuditLog', N'U') IS NULL
    OR OBJECT_ID(N'uqp.AuditLogArchive', N'U') IS NULL
    THROW 51929, 'CHART_928_TRUST_SCHEMA_REQUIRED', 1;
IF OBJECT_ID(N'uqp.DashboardChartPlaybackApproval', N'U') IS NOT NULL
    THROW 51929, 'CHART_PLAYBACK_APPROVAL_ALREADY_EXISTS_REVIEW_FIRST', 1;
IF COL_LENGTH(N'uqp.DashboardChartWidgetSeal', N'SealRowVersion') IS NULL
    OR COL_LENGTH(N'uqp.DashboardChartWidgetSeal', N'IsActive') IS NULL
    OR COL_LENGTH(N'uqp.AuditLog', N'IsImportant') IS NULL
    THROW 51929, 'CHART_TRUST_SCHEMA_INCOMPATIBLE', 1;
BEGIN TRY
    BEGIN TRANSACTION;
    CREATE TABLE uqp.DashboardChartPlaybackApproval (
        DashboardId BIGINT NOT NULL,
        WidgetId BIGINT NOT NULL,
        WidgetRevision BINARY(8) NOT NULL,
        ConfigDigest CHAR(64) NOT NULL,
        Status VARCHAR(20) NOT NULL,
        ReviewerUserId BIGINT NOT NULL,
        AuditLogId BIGINT NOT NULL,
        ReviewedAtUtc DATETIME2(3) NOT NULL
            CONSTRAINT DF_ChartPlaybackApproval_Reviewed DEFAULT SYSUTCDATETIME(),
        DecisionRowVersion ROWVERSION NOT NULL,
        CONSTRAINT PK_DashboardChartPlaybackApproval PRIMARY KEY (DashboardId,WidgetId),
        CONSTRAINT FK_ChartPlaybackApproval_Dashboard FOREIGN KEY (DashboardId)
            REFERENCES uqp.Dashboard(Id),
        CONSTRAINT FK_ChartPlaybackApproval_Widget FOREIGN KEY (WidgetId)
            REFERENCES uqp.DashboardWidget(Id),
        CONSTRAINT FK_ChartPlaybackApproval_Reviewer FOREIGN KEY (ReviewerUserId)
            REFERENCES uqp.AppUser(Id),
        CONSTRAINT CK_ChartPlaybackApproval_Status CHECK (Status IN ('APPROVED','REVOKED')),
        CONSTRAINT CK_ChartPlaybackApproval_Digest CHECK (
            LEN(ConfigDigest)=64 AND ConfigDigest NOT LIKE '%[^0-9a-f]%' COLLATE Latin1_General_BIN2
        )
    );
    COMMIT TRANSACTION;
    PRINT 'CHART_PLAYBACK_APPROVAL_TEST_SCHEMA_INSTALLED';
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
