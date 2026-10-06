IF EXISTS (
  SELECT 1 FROM sys.check_constraints
  WHERE name='CK_DataSource_Type'
)
BEGIN
  ALTER TABLE uqp.DataSource DROP CONSTRAINT CK_DataSource_Type;
END;
GO

ALTER TABLE uqp.DataSource
ADD CONSTRAINT CK_DataSource_Type
CHECK (Type IN ('SQLSERVER','ORACLE','MYSQL','POSTGRESQL'));
GO
