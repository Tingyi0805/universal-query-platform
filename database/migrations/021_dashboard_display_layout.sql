IF COL_LENGTH('uqp.Dashboard', 'DisplayMode') IS NULL
BEGIN
    ALTER TABLE uqp.Dashboard ADD
        DisplayMode NVARCHAR(20) NOT NULL
            CONSTRAINT DF_Dashboard_DisplayMode DEFAULT ('BIG_SCREEN'),
        DisplayTitle NVARCHAR(200) NULL,
        PageSize INT NOT NULL
            CONSTRAINT DF_Dashboard_PageSize DEFAULT (5),
        PageSeconds INT NOT NULL
            CONSTRAINT DF_Dashboard_PageSeconds DEFAULT (20),
        ShowClock BIT NOT NULL
            CONSTRAINT DF_Dashboard_ShowClock DEFAULT (1),
        ShowPageNumber BIT NOT NULL
            CONSTRAINT DF_Dashboard_ShowPageNumber DEFAULT (1),
        ShowCountdown BIT NOT NULL
            CONSTRAINT DF_Dashboard_ShowCountdown DEFAULT (1);
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE name='CK_Dashboard_DisplayMode'
      AND parent_object_id=OBJECT_ID('uqp.Dashboard')
)
BEGIN
    ALTER TABLE uqp.Dashboard
    ADD CONSTRAINT CK_Dashboard_DisplayMode
        CHECK (DisplayMode IN ('TABLE','BIG_SCREEN'));
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE name='CK_Dashboard_PageSize'
      AND parent_object_id=OBJECT_ID('uqp.Dashboard')
)
BEGIN
    ALTER TABLE uqp.Dashboard
    ADD CONSTRAINT CK_Dashboard_PageSize
        CHECK (PageSize BETWEEN 1 AND 50);
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE name='CK_Dashboard_PageSeconds'
      AND parent_object_id=OBJECT_ID('uqp.Dashboard')
)
BEGIN
    ALTER TABLE uqp.Dashboard
    ADD CONSTRAINT CK_Dashboard_PageSeconds
        CHECK (PageSeconds BETWEEN 5 AND 3600);
END
GO
