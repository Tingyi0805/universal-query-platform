IF OBJECT_ID('uqp.DatasetVersion', 'U') IS NULL
BEGIN
    CREATE TABLE uqp.DatasetVersion (
        Id              BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_DatasetVersion PRIMARY KEY,
        DatasetId       BIGINT NOT NULL,
        VersionNo       INT NOT NULL,
        SnapshotJson    NVARCHAR(MAX) NOT NULL,
        Reason          NVARCHAR(100) NULL,
        CreatedByUserId BIGINT NULL,
        CreatedAtUtc    DATETIME2(0) NOT NULL CONSTRAINT DF_DatasetVersion_CreatedAt DEFAULT (SYSUTCDATETIME()),
        CONSTRAINT FK_DatasetVersion_Dataset FOREIGN KEY (DatasetId) REFERENCES uqp.Dataset(Id) ON DELETE CASCADE,
        CONSTRAINT FK_DatasetVersion_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES uqp.AppUser(Id) ON DELETE SET NULL,
        CONSTRAINT UQ_DatasetVersion UNIQUE (DatasetId, VersionNo)
    );

    CREATE INDEX IX_DatasetVersion_Dataset_Created
    ON uqp.DatasetVersion(DatasetId, CreatedAtUtc DESC);
END
GO

IF OBJECT_ID('uqp.QueryDefinitionVersion', 'U') IS NULL
BEGIN
    CREATE TABLE uqp.QueryDefinitionVersion (
        Id                  BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_QueryDefinitionVersion PRIMARY KEY,
        QueryDefinitionId   BIGINT NOT NULL,
        VersionNo           INT NOT NULL,
        SnapshotJson        NVARCHAR(MAX) NOT NULL,
        Reason              NVARCHAR(100) NULL,
        CreatedByUserId     BIGINT NULL,
        CreatedAtUtc        DATETIME2(0) NOT NULL CONSTRAINT DF_QueryDefinitionVersion_CreatedAt DEFAULT (SYSUTCDATETIME()),
        CONSTRAINT FK_QueryDefinitionVersion_Query FOREIGN KEY (QueryDefinitionId) REFERENCES uqp.QueryDefinition(Id) ON DELETE CASCADE,
        CONSTRAINT FK_QueryDefinitionVersion_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES uqp.AppUser(Id) ON DELETE SET NULL,
        CONSTRAINT UQ_QueryDefinitionVersion UNIQUE (QueryDefinitionId, VersionNo)
    );

    CREATE INDEX IX_QueryDefinitionVersion_Query_Created
    ON uqp.QueryDefinitionVersion(QueryDefinitionId, CreatedAtUtc DESC);
END
GO
