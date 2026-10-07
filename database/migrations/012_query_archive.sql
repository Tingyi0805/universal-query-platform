IF COL_LENGTH('uqp.QueryDefinition', 'IsArchived') IS NULL
BEGIN
    ALTER TABLE uqp.QueryDefinition
    ADD IsArchived BIT NOT NULL
        CONSTRAINT DF_QueryDefinition_Archived DEFAULT (0);
END
GO

IF COL_LENGTH('uqp.QueryDefinition', 'ArchivedAtUtc') IS NULL
BEGIN
    ALTER TABLE uqp.QueryDefinition
    ADD ArchivedAtUtc DATETIME2(0) NULL;
END
GO

IF COL_LENGTH('uqp.QueryDefinition', 'ArchivedByUserId') IS NULL
BEGIN
    ALTER TABLE uqp.QueryDefinition
    ADD ArchivedByUserId BIGINT NULL;
END
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.foreign_keys
    WHERE name = 'FK_QueryDefinition_ArchivedBy'
      AND parent_object_id = OBJECT_ID('uqp.QueryDefinition')
)
BEGIN
    ALTER TABLE uqp.QueryDefinition
    ADD CONSTRAINT FK_QueryDefinition_ArchivedBy
    FOREIGN KEY (ArchivedByUserId) REFERENCES uqp.AppUser(Id)
    ON DELETE SET NULL;
END
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = 'IX_QueryDefinition_IsArchived'
      AND object_id = OBJECT_ID('uqp.QueryDefinition')
)
BEGIN
    CREATE INDEX IX_QueryDefinition_IsArchived
    ON uqp.QueryDefinition(IsArchived, IsPublished, IsActive);
END
GO
