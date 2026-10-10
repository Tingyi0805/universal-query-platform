IF COL_LENGTH('uqp.DashboardDisplayProfile', 'ConfigJson') IS NULL
BEGIN
    ALTER TABLE uqp.DashboardDisplayProfile
    ADD ConfigJson NVARCHAR(MAX) NOT NULL
        CONSTRAINT DF_DashboardDisplayProfile_Config DEFAULT ('{}');
END
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.check_constraints
    WHERE name='CK_DashboardDisplayProfile_ConfigJson'
      AND parent_object_id=OBJECT_ID('uqp.DashboardDisplayProfile')
)
BEGIN
    ALTER TABLE uqp.DashboardDisplayProfile
    ADD CONSTRAINT CK_DashboardDisplayProfile_ConfigJson
        CHECK (ISJSON(ConfigJson)=1);
END
GO

IF EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE name='CK_DashboardWidget_Type'
      AND parent_object_id=OBJECT_ID('uqp.DashboardWidget')
)
BEGIN
    ALTER TABLE uqp.DashboardWidget DROP CONSTRAINT CK_DashboardWidget_Type;
END
GO

ALTER TABLE uqp.DashboardWidget
ADD CONSTRAINT CK_DashboardWidget_Type CHECK (
    WidgetType IN ('TEXT','PARAMETER','FIELD','CLOCK','PAGE_INFO','COUNTDOWN','TABLE','CONTAINER')
);
GO
