IF COL_LENGTH('uqp.DatasetVersion', 'IsPinned') IS NULL
BEGIN
    ALTER TABLE uqp.DatasetVersion
    ADD IsPinned BIT NOT NULL
        CONSTRAINT DF_DatasetVersion_IsPinned DEFAULT (0);
END
GO

IF COL_LENGTH('uqp.DatasetVersion', 'IsPublishedSnapshot') IS NULL
BEGIN
    ALTER TABLE uqp.DatasetVersion
    ADD IsPublishedSnapshot BIT NOT NULL
        CONSTRAINT DF_DatasetVersion_IsPublishedSnapshot DEFAULT (0);
END
GO

IF COL_LENGTH('uqp.QueryDefinitionVersion', 'IsPinned') IS NULL
BEGIN
    ALTER TABLE uqp.QueryDefinitionVersion
    ADD IsPinned BIT NOT NULL
        CONSTRAINT DF_QueryDefinitionVersion_IsPinned DEFAULT (0);
END
GO

IF COL_LENGTH('uqp.QueryDefinitionVersion', 'IsPublishedSnapshot') IS NULL
BEGIN
    ALTER TABLE uqp.QueryDefinitionVersion
    ADD IsPublishedSnapshot BIT NOT NULL
        CONSTRAINT DF_QueryDefinitionVersion_IsPublishedSnapshot DEFAULT (0);
END
GO

IF NOT EXISTS (SELECT 1 FROM uqp.SystemSetting WHERE SettingKey='VERSION_RETENTION_COUNT')
BEGIN
    INSERT INTO uqp.SystemSetting (SettingKey, SettingValue, Description)
    VALUES ('VERSION_RETENTION_COUNT', '30', N'每個 Dataset / Query 至少保留的最近版本數');
END
GO

IF NOT EXISTS (SELECT 1 FROM uqp.SystemSetting WHERE SettingKey='VERSION_RETENTION_DAYS')
BEGIN
    INSERT INTO uqp.SystemSetting (SettingKey, SettingValue, Description)
    VALUES ('VERSION_RETENTION_DAYS', '365', N'一般版本至少保留天數；Pinned 與 Published Snapshot 不受此限制');
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name='IX_DatasetVersion_Retention'
      AND object_id=OBJECT_ID('uqp.DatasetVersion')
)
BEGIN
    CREATE INDEX IX_DatasetVersion_Retention
    ON uqp.DatasetVersion(DatasetId, VersionNo DESC, IsPinned, IsPublishedSnapshot, CreatedAtUtc);
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name='IX_QueryDefinitionVersion_Retention'
      AND object_id=OBJECT_ID('uqp.QueryDefinitionVersion')
)
BEGIN
    CREATE INDEX IX_QueryDefinitionVersion_Retention
    ON uqp.QueryDefinitionVersion(QueryDefinitionId, VersionNo DESC, IsPinned, IsPublishedSnapshot, CreatedAtUtc);
END
GO
