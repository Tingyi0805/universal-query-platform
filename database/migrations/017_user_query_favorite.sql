IF OBJECT_ID('uqp.UserQueryFavorite', 'U') IS NULL
BEGIN
    CREATE TABLE uqp.UserQueryFavorite (
        UserId              BIGINT NOT NULL,
        QueryDefinitionId   BIGINT NOT NULL,
        CreatedAtUtc        DATETIME2(0) NOT NULL
            CONSTRAINT DF_UserQueryFavorite_CreatedAtUtc DEFAULT (SYSUTCDATETIME()),
        CONSTRAINT PK_UserQueryFavorite PRIMARY KEY (UserId, QueryDefinitionId),
        CONSTRAINT FK_UserQueryFavorite_User
            FOREIGN KEY (UserId) REFERENCES uqp.AppUser(Id) ON DELETE CASCADE,
        CONSTRAINT FK_UserQueryFavorite_Query
            FOREIGN KEY (QueryDefinitionId) REFERENCES uqp.QueryDefinition(Id) ON DELETE CASCADE
    );
END
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name='IX_UserQueryFavorite_QueryDefinitionId'
      AND object_id=OBJECT_ID('uqp.UserQueryFavorite')
)
BEGIN
    CREATE INDEX IX_UserQueryFavorite_QueryDefinitionId
    ON uqp.UserQueryFavorite(QueryDefinitionId, UserId);
END
GO
