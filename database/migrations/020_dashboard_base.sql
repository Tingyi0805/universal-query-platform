IF OBJECT_ID('uqp.Dashboard', 'U') IS NULL
BEGIN
    CREATE TABLE uqp.Dashboard (
        Id                  BIGINT IDENTITY(1,1) NOT NULL
            CONSTRAINT PK_Dashboard PRIMARY KEY,
        Code                NVARCHAR(100) NOT NULL,
        Name                NVARCHAR(200) NOT NULL,
        Description         NVARCHAR(1000) NULL,
        QueryDefinitionId   BIGINT NOT NULL,
        RefreshSeconds      INT NOT NULL
            CONSTRAINT DF_Dashboard_RefreshSeconds DEFAULT (10),
        ParametersJson      NVARCHAR(MAX) NOT NULL
            CONSTRAINT DF_Dashboard_ParametersJson DEFAULT ('{}'),
        IsActive            BIT NOT NULL
            CONSTRAINT DF_Dashboard_IsActive DEFAULT (1),
        CreatedByUserId     BIGINT NULL,
        UpdatedByUserId     BIGINT NULL,
        CreatedAtUtc        DATETIME2(0) NOT NULL
            CONSTRAINT DF_Dashboard_CreatedAtUtc DEFAULT (SYSUTCDATETIME()),
        UpdatedAtUtc        DATETIME2(0) NOT NULL
            CONSTRAINT DF_Dashboard_UpdatedAtUtc DEFAULT (SYSUTCDATETIME()),

        CONSTRAINT UQ_Dashboard_Code UNIQUE (Code),
        CONSTRAINT FK_Dashboard_QueryDefinition
            FOREIGN KEY (QueryDefinitionId) REFERENCES uqp.QueryDefinition(Id),
        CONSTRAINT FK_Dashboard_CreatedByUser
            FOREIGN KEY (CreatedByUserId) REFERENCES uqp.AppUser(Id),
        CONSTRAINT FK_Dashboard_UpdatedByUser
            FOREIGN KEY (UpdatedByUserId) REFERENCES uqp.AppUser(Id),
        CONSTRAINT CK_Dashboard_RefreshSeconds
            CHECK (RefreshSeconds BETWEEN 5 AND 3600),
        CONSTRAINT CK_Dashboard_ParametersJson
            CHECK (ISJSON(ParametersJson)=1)
    );
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name='IX_Dashboard_QueryDefinitionId'
      AND object_id=OBJECT_ID('uqp.Dashboard')
)
BEGIN
    CREATE INDEX IX_Dashboard_QueryDefinitionId
    ON uqp.Dashboard(QueryDefinitionId, IsActive);
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name='IX_Dashboard_IsActive_Name'
      AND object_id=OBJECT_ID('uqp.Dashboard')
)
BEGIN
    CREATE INDEX IX_Dashboard_IsActive_Name
    ON uqp.Dashboard(IsActive, Name);
END
GO
