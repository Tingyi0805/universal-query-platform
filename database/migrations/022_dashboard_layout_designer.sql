IF OBJECT_ID('uqp.DashboardDisplayProfile', 'U') IS NULL
BEGIN
    CREATE TABLE uqp.DashboardDisplayProfile (
        Id              BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_DashboardDisplayProfile PRIMARY KEY,
        DashboardId     BIGINT NOT NULL,
        Name            NVARCHAR(100) NOT NULL,
        CanvasWidth     INT NOT NULL CONSTRAINT DF_DashboardDisplayProfile_Width DEFAULT (1920),
        CanvasHeight    INT NOT NULL CONSTRAINT DF_DashboardDisplayProfile_Height DEFAULT (1080),
        IsDefault       BIT NOT NULL CONSTRAINT DF_DashboardDisplayProfile_Default DEFAULT (0),
        SortOrder       INT NOT NULL CONSTRAINT DF_DashboardDisplayProfile_Sort DEFAULT (0),
        CreatedAtUtc    DATETIME2(0) NOT NULL CONSTRAINT DF_DashboardDisplayProfile_Created DEFAULT (SYSUTCDATETIME()),
        UpdatedAtUtc    DATETIME2(0) NOT NULL CONSTRAINT DF_DashboardDisplayProfile_Updated DEFAULT (SYSUTCDATETIME()),
        CONSTRAINT FK_DashboardDisplayProfile_Dashboard
            FOREIGN KEY (DashboardId) REFERENCES uqp.Dashboard(Id) ON DELETE CASCADE,
        CONSTRAINT UQ_DashboardDisplayProfile_Name UNIQUE (DashboardId, Name),
        CONSTRAINT CK_DashboardDisplayProfile_Width CHECK (CanvasWidth BETWEEN 320 AND 7680),
        CONSTRAINT CK_DashboardDisplayProfile_Height CHECK (CanvasHeight BETWEEN 240 AND 4320)
    );
END
GO

IF OBJECT_ID('uqp.DashboardWidget', 'U') IS NULL
BEGIN
    CREATE TABLE uqp.DashboardWidget (
        Id              BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_DashboardWidget PRIMARY KEY,
        ProfileId       BIGINT NOT NULL,
        WidgetType      NVARCHAR(30) NOT NULL,
        Title           NVARCHAR(200) NULL,
        SourceKey       NVARCHAR(256) NULL,
        StaticText      NVARCHAR(1000) NULL,
        X               INT NOT NULL,
        Y               INT NOT NULL,
        Width           INT NOT NULL,
        Height          INT NOT NULL,
        FontSize        INT NOT NULL CONSTRAINT DF_DashboardWidget_FontSize DEFAULT (36),
        Alignment       NVARCHAR(10) NOT NULL CONSTRAINT DF_DashboardWidget_Alignment DEFAULT ('CENTER'),
        ConfigJson      NVARCHAR(MAX) NOT NULL CONSTRAINT DF_DashboardWidget_Config DEFAULT ('{}'),
        SortOrder       INT NOT NULL CONSTRAINT DF_DashboardWidget_Sort DEFAULT (0),
        CreatedAtUtc    DATETIME2(0) NOT NULL CONSTRAINT DF_DashboardWidget_Created DEFAULT (SYSUTCDATETIME()),
        UpdatedAtUtc    DATETIME2(0) NOT NULL CONSTRAINT DF_DashboardWidget_Updated DEFAULT (SYSUTCDATETIME()),
        CONSTRAINT FK_DashboardWidget_Profile
            FOREIGN KEY (ProfileId) REFERENCES uqp.DashboardDisplayProfile(Id) ON DELETE CASCADE,
        CONSTRAINT CK_DashboardWidget_Type CHECK (
            WidgetType IN ('TEXT','PARAMETER','FIELD','CLOCK','PAGE_INFO','COUNTDOWN','TABLE')
        ),
        CONSTRAINT CK_DashboardWidget_Position CHECK (X >= 0 AND Y >= 0),
        CONSTRAINT CK_DashboardWidget_Size CHECK (Width >= 40 AND Height >= 30),
        CONSTRAINT CK_DashboardWidget_FontSize CHECK (FontSize BETWEEN 8 AND 240),
        CONSTRAINT CK_DashboardWidget_Alignment CHECK (Alignment IN ('LEFT','CENTER','RIGHT')),
        CONSTRAINT CK_DashboardWidget_ConfigJson CHECK (ISJSON(ConfigJson)=1)
    );
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name='IX_DashboardDisplayProfile_Dashboard'
      AND object_id=OBJECT_ID('uqp.DashboardDisplayProfile')
)
BEGIN
    CREATE INDEX IX_DashboardDisplayProfile_Dashboard
    ON uqp.DashboardDisplayProfile(DashboardId, IsDefault DESC, SortOrder, Id);
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name='IX_DashboardWidget_Profile'
      AND object_id=OBJECT_ID('uqp.DashboardWidget')
)
BEGIN
    CREATE INDEX IX_DashboardWidget_Profile
    ON uqp.DashboardWidget(ProfileId, SortOrder, Id);
END
GO

-- Existing Dashboards receive one default Full HD profile and a starter layout.
INSERT INTO uqp.DashboardDisplayProfile (DashboardId, Name, CanvasWidth, CanvasHeight, IsDefault, SortOrder)
SELECT d.Id, N'預設 Full HD', 1920, 1080, 1, 0
FROM uqp.Dashboard d
WHERE NOT EXISTS (
    SELECT 1 FROM uqp.DashboardDisplayProfile p WHERE p.DashboardId=d.Id
);
GO

INSERT INTO uqp.DashboardWidget (
    ProfileId, WidgetType, Title, SourceKey, StaticText,
    X, Y, Width, Height, FontSize, Alignment, ConfigJson, SortOrder
)
SELECT p.Id, v.WidgetType, v.Title, NULL, v.StaticText,
       v.X, v.Y, v.Width, v.Height, v.FontSize, v.Alignment, '{}', v.SortOrder
FROM uqp.DashboardDisplayProfile p
INNER JOIN uqp.Dashboard d ON d.Id=p.DashboardId
CROSS APPLY (VALUES
    ('TEXT',       NULL, COALESCE(d.DisplayTitle, d.Name),  40,  25, 1840, 110, 64, 'CENTER', 10),
    ('PAGE_INFO',  N'頁數', NULL,                         40, 145,  400,  55, 28, 'LEFT',   20),
    ('CLOCK',      N'時間', NULL,                        710, 145,  500,  55, 28, 'CENTER', 30),
    ('COUNTDOWN',  N'換頁倒數', NULL,                   1480, 145,  400,  55, 28, 'RIGHT',  40),
    ('TABLE',      NULL, NULL,                            40, 220, 1840, 760, 42, 'CENTER', 50)
) v(WidgetType, Title, StaticText, X, Y, Width, Height, FontSize, Alignment, SortOrder)
WHERE p.IsDefault=1
  AND NOT EXISTS (
      SELECT 1 FROM uqp.DashboardWidget w WHERE w.ProfileId=p.Id
  );
GO
