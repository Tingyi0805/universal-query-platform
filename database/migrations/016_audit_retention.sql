IF COL_LENGTH('uqp.AuditLog', 'EventCategory') IS NULL
BEGIN
    ALTER TABLE uqp.AuditLog
    ADD EventCategory NVARCHAR(20) NOT NULL
        CONSTRAINT DF_AuditLog_EventCategory DEFAULT ('SYSTEM');
END
GO

IF COL_LENGTH('uqp.AuditLog', 'IsImportant') IS NULL
BEGIN
    ALTER TABLE uqp.AuditLog
    ADD IsImportant BIT NOT NULL
        CONSTRAINT DF_AuditLog_IsImportant DEFAULT (0);
END
GO

UPDATE uqp.AuditLog
SET EventCategory =
    CASE
      WHEN EventType IN ('QUERY_EXECUTE','QUERY_EXPORT_EXCEL','QUERY_EXPORT_CSV') THEN 'USAGE'
      WHEN EventType LIKE 'LOGIN%' OR EventType LIKE 'AUTH_%'
        OR EventType LIKE 'USER_%' OR EventType LIKE 'ROLE_%'
        OR EventType LIKE 'PERMISSION_%' THEN 'SECURITY'
      WHEN EventType LIKE 'DATASOURCE_%' OR EventType LIKE 'DATASET_%'
        OR EventType LIKE 'QUERY_%' OR EventType LIKE 'REPORT_%'
        OR EventType LIKE 'SETTING_%' THEN 'CONFIG'
      ELSE 'SYSTEM'
    END
WHERE EventCategory='SYSTEM';
GO

UPDATE uqp.AuditLog
SET IsImportant=1
WHERE EventCategory IN ('SECURITY','CONFIG');
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE name='CK_AuditLog_EventCategory'
)
BEGIN
    ALTER TABLE uqp.AuditLog
    ADD CONSTRAINT CK_AuditLog_EventCategory
    CHECK (EventCategory IN ('SECURITY','CONFIG','USAGE','SYSTEM'));
END
GO

IF OBJECT_ID('uqp.AuditLogArchive', 'U') IS NULL
BEGIN
    CREATE TABLE uqp.AuditLogArchive (
        Id                  BIGINT NOT NULL CONSTRAINT PK_AuditLogArchive PRIMARY KEY,
        EventType           NVARCHAR(50) NOT NULL,
        EventCategory       NVARCHAR(20) NOT NULL,
        IsImportant         BIT NOT NULL,
        UserId              BIGINT NULL,
        Username            NVARCHAR(100) NULL,
        DisplayName         NVARCHAR(200) NULL,
        QueryDefinitionId   BIGINT NULL,
        QueryCode           NVARCHAR(100) NULL,
        QueryName           NVARCHAR(200) NULL,
        DatasetId           BIGINT NULL,
        DatasetCode         NVARCHAR(100) NULL,
        DatasetName         NVARCHAR(200) NULL,
        Status              NVARCHAR(20) NOT NULL,
        ParametersJson      NVARCHAR(MAX) NULL,
        ResultRowCount      INT NULL,
        DurationMs          INT NULL,
        IpAddress           NVARCHAR(100) NULL,
        UserAgent           NVARCHAR(500) NULL,
        ErrorCode           NVARCHAR(200) NULL,
        CreatedAtUtc        DATETIME2(0) NOT NULL,
        CompletedAtUtc      DATETIME2(0) NULL,
        ArchivedAtUtc       DATETIME2(0) NOT NULL CONSTRAINT DF_AuditLogArchive_ArchivedAt DEFAULT (SYSUTCDATETIME()),
        CONSTRAINT CK_AuditLogArchive_EventCategory
          CHECK (EventCategory IN ('SECURITY','CONFIG','USAGE','SYSTEM')),
        CONSTRAINT CK_AuditLogArchive_Status
          CHECK (Status IN ('STARTED','SUCCESS','FAILED'))
    );
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name='IX_AuditLog_EventCategory_CreatedAtUtc'
      AND object_id=OBJECT_ID('uqp.AuditLog')
)
BEGIN
    CREATE INDEX IX_AuditLog_EventCategory_CreatedAtUtc
    ON uqp.AuditLog(EventCategory, CreatedAtUtc DESC);
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name='IX_AuditLog_EventType_CreatedAtUtc'
      AND object_id=OBJECT_ID('uqp.AuditLog')
)
BEGIN
    CREATE INDEX IX_AuditLog_EventType_CreatedAtUtc
    ON uqp.AuditLog(EventType, CreatedAtUtc DESC);
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name='IX_AuditLogArchive_CreatedAtUtc'
      AND object_id=OBJECT_ID('uqp.AuditLogArchive')
)
BEGIN
    CREATE INDEX IX_AuditLogArchive_CreatedAtUtc
    ON uqp.AuditLogArchive(CreatedAtUtc DESC);
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name='IX_AuditLogArchive_Category_CreatedAtUtc'
      AND object_id=OBJECT_ID('uqp.AuditLogArchive')
)
BEGIN
    CREATE INDEX IX_AuditLogArchive_Category_CreatedAtUtc
    ON uqp.AuditLogArchive(EventCategory, CreatedAtUtc DESC);
END
GO

IF NOT EXISTS (SELECT 1 FROM uqp.SystemSetting WHERE SettingKey='AUDIT_ONLINE_RETENTION_DAYS')
BEGIN
    INSERT INTO uqp.SystemSetting (SettingKey, SettingValue, Description)
    VALUES ('AUDIT_ONLINE_RETENTION_DAYS', '365', N'Audit Log 線上資料保留天數');
END
GO

IF NOT EXISTS (SELECT 1 FROM uqp.SystemSetting WHERE SettingKey='AUDIT_ARCHIVE_RETENTION_DAYS')
BEGIN
    INSERT INTO uqp.SystemSetting (SettingKey, SettingValue, Description)
    VALUES ('AUDIT_ARCHIVE_RETENTION_DAYS', '1825', N'Audit Archive 一般資料保留天數');
END
GO

IF NOT EXISTS (SELECT 1 FROM uqp.SystemSetting WHERE SettingKey='AUDIT_IMPORTANT_PERMANENT')
BEGIN
    INSERT INTO uqp.SystemSetting (SettingKey, SettingValue, Description)
    VALUES ('AUDIT_IMPORTANT_PERMANENT', 'true', N'重要 Audit 是否永久保留');
END
GO
