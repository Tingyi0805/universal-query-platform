IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = 'uqp')
    EXEC('CREATE SCHEMA uqp');
GO

CREATE TABLE uqp.AppUser (
    Id              BIGINT IDENTITY(1,1) PRIMARY KEY,
    Username        NVARCHAR(100) NOT NULL,
    DisplayName     NVARCHAR(200) NOT NULL,
    PasswordHash    NVARCHAR(255) NULL,
    AuthProvider    NVARCHAR(30) NOT NULL CONSTRAINT DF_AppUser_AuthProvider DEFAULT ('LOCAL'),
    IsActive        BIT NOT NULL CONSTRAINT DF_AppUser_IsActive DEFAULT (1),
    CreatedAtUtc    DATETIME2(0) NOT NULL CONSTRAINT DF_AppUser_CreatedAt DEFAULT (SYSUTCDATETIME()),
    UpdatedAtUtc    DATETIME2(0) NOT NULL CONSTRAINT DF_AppUser_UpdatedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT UQ_AppUser_Username UNIQUE (Username),
    CONSTRAINT CK_AppUser_AuthProvider CHECK (AuthProvider IN ('LOCAL','AD','ORACLE'))
);
GO

CREATE TABLE uqp.Role (
    Id              BIGINT IDENTITY(1,1) PRIMARY KEY,
    Code            NVARCHAR(100) NOT NULL,
    Name            NVARCHAR(200) NOT NULL,
    Description     NVARCHAR(500) NULL,
    IsSystem        BIT NOT NULL CONSTRAINT DF_Role_IsSystem DEFAULT (0),
    IsActive        BIT NOT NULL CONSTRAINT DF_Role_IsActive DEFAULT (1),
    CreatedAtUtc    DATETIME2(0) NOT NULL CONSTRAINT DF_Role_CreatedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT UQ_Role_Code UNIQUE (Code)
);
GO

CREATE TABLE uqp.Permission (
    Id              BIGINT IDENTITY(1,1) PRIMARY KEY,
    Code            NVARCHAR(100) NOT NULL,
    Name            NVARCHAR(200) NOT NULL,
    Description     NVARCHAR(500) NULL,
    CONSTRAINT UQ_Permission_Code UNIQUE (Code)
);
GO

CREATE TABLE uqp.UserRole (
    UserId          BIGINT NOT NULL,
    RoleId          BIGINT NOT NULL,
    CreatedAtUtc    DATETIME2(0) NOT NULL CONSTRAINT DF_UserRole_CreatedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT PK_UserRole PRIMARY KEY (UserId, RoleId),
    CONSTRAINT FK_UserRole_User FOREIGN KEY (UserId) REFERENCES uqp.AppUser(Id),
    CONSTRAINT FK_UserRole_Role FOREIGN KEY (RoleId) REFERENCES uqp.Role(Id)
);
GO

CREATE TABLE uqp.RolePermission (
    RoleId          BIGINT NOT NULL,
    PermissionId    BIGINT NOT NULL,
    CreatedAtUtc    DATETIME2(0) NOT NULL CONSTRAINT DF_RolePermission_CreatedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT PK_RolePermission PRIMARY KEY (RoleId, PermissionId),
    CONSTRAINT FK_RolePermission_Role FOREIGN KEY (RoleId) REFERENCES uqp.Role(Id),
    CONSTRAINT FK_RolePermission_Permission FOREIGN KEY (PermissionId) REFERENCES uqp.Permission(Id)
);
GO

INSERT INTO uqp.Permission (Code, Name, Description)
VALUES
('VIEW_QUERY','查看查詢','查看已發布查詢與報表'),
('EXECUTE_QUERY','執行查詢','執行已授權查詢'),
('EXPORT_QUERY','匯出查詢','匯出 Excel 等報表'),
('DESIGN_QUERY','設計查詢','建立或修改 Dataset / Query / Report'),
('PUBLISH_QUERY','發布查詢','將 Draft 發布給正式使用者'),
('MANAGE_DATASOURCE','管理資料來源','管理 SQL Server / Oracle DataSource'),
('MANAGE_USERS','管理使用者','管理 User / Role / Permission'),
('VIEW_AUDIT','查看稽核','查看 Audit Log');
GO

INSERT INTO uqp.Role (Code, Name, Description, IsSystem)
VALUES
('SYSTEM_ADMIN','系統管理員','完整平台管理權限',1),
('REPORT_DESIGNER','報表設計者','設計與發布查詢報表',1),
('REPORT_USER','一般使用者','執行已授權的查詢報表',1);
GO

INSERT INTO uqp.RolePermission (RoleId, PermissionId)
SELECT r.Id, p.Id
FROM uqp.Role r
CROSS JOIN uqp.Permission p
WHERE r.Code = 'SYSTEM_ADMIN';
GO

INSERT INTO uqp.RolePermission (RoleId, PermissionId)
SELECT r.Id, p.Id
FROM uqp.Role r
JOIN uqp.Permission p ON p.Code IN
('VIEW_QUERY','EXECUTE_QUERY','EXPORT_QUERY','DESIGN_QUERY','PUBLISH_QUERY')
WHERE r.Code = 'REPORT_DESIGNER';
GO

INSERT INTO uqp.RolePermission (RoleId, PermissionId)
SELECT r.Id, p.Id
FROM uqp.Role r
JOIN uqp.Permission p ON p.Code IN
('VIEW_QUERY','EXECUTE_QUERY','EXPORT_QUERY')
WHERE r.Code = 'REPORT_USER';
GO
