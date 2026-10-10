IF COL_LENGTH('uqp.DatasetParameter', 'DateOutputMode') IS NULL
BEGIN
    ALTER TABLE uqp.DatasetParameter ADD
        DateOutputMode NVARCHAR(20) NOT NULL
            CONSTRAINT DF_DatasetParameter_DateOutputMode DEFAULT ('NATIVE'),
        DateCalendar NVARCHAR(20) NOT NULL
            CONSTRAINT DF_DatasetParameter_DateCalendar DEFAULT ('GREGORIAN'),
        DateFormat NVARCHAR(100) NULL;
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE name='CK_DatasetParameter_DateOutputMode'
      AND parent_object_id=OBJECT_ID('uqp.DatasetParameter')
)
BEGIN
    ALTER TABLE uqp.DatasetParameter
    ADD CONSTRAINT CK_DatasetParameter_DateOutputMode
        CHECK (DateOutputMode IN ('NATIVE','STRING'));
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE name='CK_DatasetParameter_DateCalendar'
      AND parent_object_id=OBJECT_ID('uqp.DatasetParameter')
)
BEGIN
    ALTER TABLE uqp.DatasetParameter
    ADD CONSTRAINT CK_DatasetParameter_DateCalendar
        CHECK (DateCalendar IN ('GREGORIAN','ROC'));
END
GO
