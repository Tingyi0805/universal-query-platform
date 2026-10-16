/*
UQP R0 - PRODUCTION READ-ONLY SCHEMA INVENTORY
Run in SSMS Query window with a dedicated READ-ONLY principal, selecting the *existing UQP database*.
Do not use sqlcmd mode; do not execute migration scripts.
No DML/DDL, no temp table, no EXEC, no stored procedures, no dynamic SQL.
Output is metadata ONLY. Inspect before sharing: identifiers can reveal confidential internal naming.
*/
SET NOCOUNT ON;
SELECT 'ENVIRONMENT' AS Section, @@SERVERNAME AS ServerName, DB_NAME() AS DatabaseName,
       CONVERT(varchar(30), SERVERPROPERTY('ProductVersion')) AS ProductVersion,
       CONVERT(varchar(120), SERVERPROPERTY('Edition')) AS Edition,
       d.compatibility_level AS CompatibilityLevel
FROM sys.databases AS d WHERE d.database_id = DB_ID();

SELECT 'TABLE' AS Section, s.name AS SchemaName, t.name AS TableName
FROM sys.tables AS t JOIN sys.schemas AS s ON s.schema_id=t.schema_id
WHERE s.name='uqp' ORDER BY s.name,t.name;

SELECT 'COLUMN' AS Section,s.name AS SchemaName,t.name AS TableName,
       c.column_id AS ColumnOrdinal,c.name AS ColumnName,ty.name AS DataType,
       c.max_length AS MaxLengthBytes,c.precision AS NumericPrecision,c.scale AS NumericScale,
       c.is_nullable AS IsNullable,c.is_identity AS IsIdentity,c.is_computed AS IsComputed,
       dc.definition AS DefaultDefinition
FROM sys.tables AS t JOIN sys.schemas AS s ON s.schema_id=t.schema_id
JOIN sys.columns AS c ON c.object_id=t.object_id
JOIN sys.types AS ty ON ty.user_type_id=c.user_type_id
LEFT JOIN sys.default_constraints AS dc ON dc.object_id=c.default_object_id
WHERE s.name='uqp' ORDER BY s.name,t.name,c.column_id;

SELECT 'INDEX' AS Section,s.name AS SchemaName,t.name AS TableName,
       i.name AS IndexName,i.type_desc AS IndexType,i.is_unique AS IsUnique,
       i.is_primary_key AS IsPrimaryKey,i.is_disabled AS IsDisabled,
       ic.key_ordinal AS KeyOrdinal,ic.is_included_column AS IsIncluded,
       c.name AS ColumnName,i.filter_definition AS FilterDefinition
FROM sys.tables t JOIN sys.schemas s ON s.schema_id=t.schema_id
JOIN sys.indexes i ON i.object_id=t.object_id AND i.index_id>0
LEFT JOIN sys.index_columns ic ON ic.object_id=i.object_id AND ic.index_id=i.index_id
LEFT JOIN sys.columns c ON c.object_id=ic.object_id AND c.column_id=ic.column_id
WHERE s.name='uqp' ORDER BY s.name,t.name,i.name,ic.key_ordinal,ic.index_column_id;

SELECT 'CONSTRAINT' AS Section,s.name AS SchemaName,t.name AS TableName,
       o.name AS ConstraintName,o.type_desc AS ConstraintType,
       cc.definition AS CheckDefinition,
       fk.is_disabled AS ForeignKeyDisabled,fk.is_not_trusted AS ForeignKeyNotTrusted
FROM sys.objects o JOIN sys.tables t ON t.object_id=o.parent_object_id
JOIN sys.schemas s ON s.schema_id=t.schema_id
LEFT JOIN sys.check_constraints cc ON cc.object_id=o.object_id
LEFT JOIN sys.foreign_keys fk ON fk.object_id=o.object_id
WHERE s.name='uqp' AND o.type IN ('PK','UQ','F','C','D')
ORDER BY s.name,t.name,o.name;

SELECT 'LEDGER_EXISTS' AS Section,
       CASE WHEN OBJECT_ID(N'uqp.SchemaMigration',N'U') IS NULL THEN 0 ELSE 1 END AS HasSchemaMigration;
-- Separately run the following SELECT only if the ledger exists and read-only SELECT permission is granted:
-- SELECT FileName, AppliedAtUtc FROM uqp.SchemaMigration ORDER BY FileName;
