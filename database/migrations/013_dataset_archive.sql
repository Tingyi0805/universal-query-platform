IF COL_LENGTH('uqp.Dataset', 'IsArchived') IS NULL
BEGIN
    ALTER TABLE uqp.Dataset
    ADD IsArchived BIT NOT NULL
        CONSTRAINT DF_Dataset_IsArchived DEFAULT (0);
END
GO

IF COL_LENGTH('uqp.Dataset', 'ArchivedAtUtc') IS NULL
BEGIN
    ALTER TABLE uqp.Dataset
    ADD ArchivedAtUtc DATETIME2(0) NULL;
END
GO

IF COL_LENGTH('uqp.Dataset', 'ArchivedByUserId') IS NULL
BEGIN
    ALTER TABLE uqp.Dataset
    ADD ArchivedByUserId BIGINT NULL;
END
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.foreign_keys
    WHERE name = 'FK_Dataset_ArchivedBy'
      AND parent_object_id = OBJECT_ID('uqp.Dataset')
)
BEGIN
    ALTER TABLE uqp.Dataset
    ADD CONSTRAINT FK_Dataset_ArchivedBy
    FOREIGN KEY (ArchivedByUserId) REFERENCES uqp.AppUser(Id)
    ON DELETE SET NULL;
END
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = 'IX_Dataset_IsArchived'
      AND object_id = OBJECT_ID('uqp.Dataset')
)
BEGIN
    CREATE INDEX IX_Dataset_IsArchived
    ON uqp.Dataset(IsArchived, IsActive);
END
GO
