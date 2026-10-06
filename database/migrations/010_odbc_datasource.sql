IF COL_LENGTH('uqp.DataSource', 'OdbcConnectionMode') IS NULL
BEGIN
  ALTER TABLE uqp.DataSource ADD OdbcConnectionMode NVARCHAR(30) NULL;
END;
GO

IF COL_LENGTH('uqp.DataSource', 'OdbcDsn') IS NULL
BEGIN
  ALTER TABLE uqp.DataSource ADD OdbcDsn NVARCHAR(255) NULL;
END;
GO

IF COL_LENGTH('uqp.DataSource', 'EncryptedOdbcConnectionString') IS NULL
BEGIN
  ALTER TABLE uqp.DataSource ADD EncryptedOdbcConnectionString NVARCHAR(4000) NULL;
END;
GO

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
CHECK (Type IN ('SQLSERVER','ORACLE','MYSQL','POSTGRESQL','ODBC'));
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.check_constraints
  WHERE name='CK_DataSource_OdbcMode'
)
BEGIN
  ALTER TABLE uqp.DataSource
  ADD CONSTRAINT CK_DataSource_OdbcMode
  CHECK (OdbcConnectionMode IS NULL OR OdbcConnectionMode IN ('DSN','CONNECTION_STRING'));
END;
GO
