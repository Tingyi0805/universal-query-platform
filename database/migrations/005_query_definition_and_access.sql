CREATE TABLE uqp.QueryDefinition (
    Id                  BIGINT IDENTITY(1,1) PRIMARY KEY,
    Code                NVARCHAR(100) NOT NULL,
    Name                NVARCHAR(200) NOT NULL,
    Description         NVARCHAR(1000) NULL,
    Category            NVARCHAR(100) NULL,
    Icon                NVARCHAR(100) NOT NULL CONSTRAINT DF_QueryDefinition_Icon DEFAULT ('Table2'),
    DatasetId           BIGINT NOT NULL,
    SortOrder           INT NOT NULL CONSTRAINT DF_QueryDefinition_SortOrder DEFAULT (0),
    AllowExcelExport    BIT NOT NULL CONSTRAINT DF_QueryDefinition_Excel DEFAULT (1),
    IsPublished         BIT NOT NULL CONSTRAINT DF_QueryDefinition_Published DEFAULT (0),
    IsActive            BIT NOT NULL CONSTRAINT DF_QueryDefinition_Active DEFAULT (1),
    PublishedAtUtc      DATETIME2(0) NULL,
    PublishedByUserId   BIGINT NULL,
    CreatedAtUtc        DATETIME2(0) NOT NULL CONSTRAINT DF_QueryDefinition_CreatedAt DEFAULT (SYSUTCDATETIME()),
    UpdatedAtUtc        DATETIME2(0) NOT NULL CONSTRAINT DF_QueryDefinition_UpdatedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT UQ_QueryDefinition_Code UNIQUE (Code),
    CONSTRAINT FK_QueryDefinition_Dataset FOREIGN KEY (DatasetId) REFERENCES uqp.Dataset(Id),
    CONSTRAINT FK_QueryDefinition_PublishedBy FOREIGN KEY (PublishedByUserId) REFERENCES uqp.AppUser(Id)
);
GO

CREATE TABLE uqp.RoleQueryAccess (
    RoleId              BIGINT NOT NULL,
    QueryDefinitionId   BIGINT NOT NULL,
    CanView             BIT NOT NULL CONSTRAINT DF_RoleQueryAccess_View DEFAULT (1),
    CanExecute          BIT NOT NULL CONSTRAINT DF_RoleQueryAccess_Execute DEFAULT (1),
    CanExport           BIT NOT NULL CONSTRAINT DF_RoleQueryAccess_Export DEFAULT (0),
    CONSTRAINT PK_RoleQueryAccess PRIMARY KEY (RoleId, QueryDefinitionId),
    CONSTRAINT FK_RoleQueryAccess_Role FOREIGN KEY (RoleId) REFERENCES uqp.Role(Id) ON DELETE CASCADE,
    CONSTRAINT FK_RoleQueryAccess_Query FOREIGN KEY (QueryDefinitionId) REFERENCES uqp.QueryDefinition(Id) ON DELETE CASCADE
);
GO

CREATE TABLE uqp.UserQueryAccess (
    UserId              BIGINT NOT NULL,
    QueryDefinitionId   BIGINT NOT NULL,
    CanView             BIT NOT NULL CONSTRAINT DF_UserQueryAccess_View DEFAULT (1),
    CanExecute          BIT NOT NULL CONSTRAINT DF_UserQueryAccess_Execute DEFAULT (1),
    CanExport           BIT NOT NULL CONSTRAINT DF_UserQueryAccess_Export DEFAULT (0),
    CONSTRAINT PK_UserQueryAccess PRIMARY KEY (UserId, QueryDefinitionId),
    CONSTRAINT FK_UserQueryAccess_User FOREIGN KEY (UserId) REFERENCES uqp.AppUser(Id) ON DELETE CASCADE,
    CONSTRAINT FK_UserQueryAccess_Query FOREIGN KEY (QueryDefinitionId) REFERENCES uqp.QueryDefinition(Id) ON DELETE CASCADE
);
GO
