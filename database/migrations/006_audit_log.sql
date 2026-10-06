CREATE TABLE uqp.AuditLog (
    Id                  BIGINT IDENTITY(1,1) PRIMARY KEY,
    EventType           NVARCHAR(50) NOT NULL,
    UserId              BIGINT NULL,
    QueryDefinitionId   BIGINT NULL,
    DatasetId           BIGINT NULL,
    Status              NVARCHAR(20) NOT NULL,
    ParametersJson      NVARCHAR(MAX) NULL,
    ResultRowCount            INT NULL,
    DurationMs          INT NULL,
    IpAddress           NVARCHAR(100) NULL,
    UserAgent           NVARCHAR(500) NULL,
    ErrorCode           NVARCHAR(200) NULL,
    CreatedAtUtc        DATETIME2(0) NOT NULL CONSTRAINT DF_AuditLog_CreatedAt DEFAULT (SYSUTCDATETIME()),
    CompletedAtUtc      DATETIME2(0) NULL,
    CONSTRAINT FK_AuditLog_User FOREIGN KEY (UserId) REFERENCES uqp.AppUser(Id),
    CONSTRAINT FK_AuditLog_Query FOREIGN KEY (QueryDefinitionId) REFERENCES uqp.QueryDefinition(Id),
    CONSTRAINT FK_AuditLog_Dataset FOREIGN KEY (DatasetId) REFERENCES uqp.Dataset(Id),
    CONSTRAINT CK_AuditLog_Status CHECK (Status IN ('STARTED','SUCCESS','FAILED'))
);
GO

CREATE INDEX IX_AuditLog_CreatedAtUtc ON uqp.AuditLog (CreatedAtUtc DESC);
CREATE INDEX IX_AuditLog_UserId_CreatedAtUtc ON uqp.AuditLog (UserId, CreatedAtUtc DESC);
CREATE INDEX IX_AuditLog_QueryDefinitionId_CreatedAtUtc ON uqp.AuditLog (QueryDefinitionId, CreatedAtUtc DESC);
GO
