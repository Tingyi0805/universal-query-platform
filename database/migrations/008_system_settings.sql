IF NOT EXISTS (
    SELECT 1
    FROM sys.tables t
    INNER JOIN sys.schemas s ON s.schema_id=t.schema_id
    WHERE s.name='uqp' AND t.name='SystemSetting'
)
BEGIN
    CREATE TABLE uqp.SystemSetting (
        SettingKey      NVARCHAR(100) NOT NULL PRIMARY KEY,
        SettingValue    NVARCHAR(1000) NOT NULL,
        Description     NVARCHAR(500) NULL,
        UpdatedAtUtc    DATETIME2(0) NOT NULL CONSTRAINT DF_SystemSetting_UpdatedAt DEFAULT (SYSUTCDATETIME())
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM uqp.SystemSetting WHERE SettingKey='ORGANIZATION_NAME')
    INSERT INTO uqp.SystemSetting (SettingKey, SettingValue, Description)
    VALUES ('ORGANIZATION_NAME', '', N'機構或公司名稱');
GO

IF NOT EXISTS (SELECT 1 FROM uqp.SystemSetting WHERE SettingKey='PLATFORM_NAME')
    INSERT INTO uqp.SystemSetting (SettingKey, SettingValue, Description)
    VALUES ('PLATFORM_NAME', 'Universal Query Platform', N'平台英文或短名稱');
GO

IF NOT EXISTS (SELECT 1 FROM uqp.SystemSetting WHERE SettingKey='PLATFORM_TITLE')
    INSERT INTO uqp.SystemSetting (SettingKey, SettingValue, Description)
    VALUES ('PLATFORM_TITLE', N'通用資料查詢與報表平台', N'平台主要標題');
GO

IF NOT EXISTS (SELECT 1 FROM uqp.SystemSetting WHERE SettingKey='PLATFORM_SUBTITLE')
    INSERT INTO uqp.SystemSetting (SettingKey, SettingValue, Description)
    VALUES ('PLATFORM_SUBTITLE', N'低程式碼建立查詢、報表與使用者可操作的功能入口。', N'平台副標題');
GO

IF NOT EXISTS (SELECT 1 FROM uqp.Permission WHERE Code='MANAGE_SETTINGS')
BEGIN
    INSERT INTO uqp.Permission (Code, Name, Description)
    VALUES ('MANAGE_SETTINGS', N'管理系統設定', N'管理平台品牌與系統設定');
END;
GO

INSERT INTO uqp.RolePermission (RoleId, PermissionId)
SELECT r.Id, p.Id
FROM uqp.Role r
INNER JOIN uqp.Permission p ON p.Code='MANAGE_SETTINGS'
WHERE r.Code='SYSTEM_ADMIN'
  AND NOT EXISTS (
      SELECT 1
      FROM uqp.RolePermission rp
      WHERE rp.RoleId=r.Id AND rp.PermissionId=p.Id
  );
GO
