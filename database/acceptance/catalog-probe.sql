-- FUTURE ISOLATED READ-ONLY PROBE. Not executed in stage 4B-1.
-- No GO: a refusal stops this entire batch. A new session refuses by default.
-- Operator must bind SESSION_CONTEXT('uqp_acceptance_database') to the exact reviewed
-- UQP_ACCEPT_<12 lowercase hex> database and ('uqp_acceptance_isolated') to integer 1.
-- Session context/name checks are an acknowledgement, NOT proof of network isolation.
SET NOCOUNT ON;
DECLARE @expected nvarchar(128) = TRY_CONVERT(nvarchar(128), SESSION_CONTEXT(N'uqp_acceptance_database'));
IF @expected IS NULL OR DATALENGTH(@expected) <> 46
 OR LEFT(@expected,11) COLLATE Latin1_General_100_BIN2 <> N'UQP_ACCEPT_'
 OR SUBSTRING(@expected,12,12) COLLATE Latin1_General_100_BIN2 LIKE N'%[^a-f0-9]%'
 OR DB_NAME() COLLATE Latin1_General_100_BIN2 <> @expected COLLATE Latin1_General_100_BIN2
 OR ISNULL(TRY_CONVERT(int, SESSION_CONTEXT(N'uqp_acceptance_isolated')),0) <> 1
 THROW 51940, 'ISOLATED_ACCEPTANCE_CONTEXT_REQUIRED', 1;
IF ISNULL(TRY_CONVERT(int, SERVERPROPERTY('ProductMajorVersion')),0) <> 15
 OR (SELECT compatibility_level FROM sys.databases WHERE database_id=DB_ID()) <> 150
 THROW 51940, 'SQL_SERVER_2019_COMPATIBILITY_REQUIRED', 1;
IF ISNULL(HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'VIEW DEFINITION'),0) <> 1
 THROW 51940, 'CATALOG_VISIBILITY_REQUIRED', 1;

SELECT SERVERPROPERTY('ProductVersion') AS ProductVersion, DB_NAME() AS DatabaseName,
 compatibility_level FROM sys.databases WHERE database_id=DB_ID();
-- Catalog only: never SELECT Dataset.SqlText, ParametersJson, identities, credentials or audit values.
SELECT t.name AS TableName,c.name AS ColumnName,c.system_type_id,c.user_type_id,c.max_length,
 c.is_nullable,c.is_computed,d.definition AS DefaultDefinition
 FROM sys.tables t JOIN sys.columns c ON c.object_id=t.object_id
 LEFT JOIN sys.default_constraints d ON d.object_id=c.default_object_id
 WHERE t.schema_id=SCHEMA_ID(N'uqp') ORDER BY t.name,c.column_id;
SELECT OBJECT_NAME(parent_object_id) AS TableName,name,definition,is_disabled,is_not_trusted,is_not_for_replication
 FROM sys.check_constraints WHERE schema_id=SCHEMA_ID(N'uqp');
SELECT OBJECT_NAME(f.parent_object_id) AS TableName,f.name,pc.name AS ColumnName,
 OBJECT_SCHEMA_NAME(f.referenced_object_id) AS ReferencedSchema,OBJECT_NAME(f.referenced_object_id) AS ReferencedTable,
 rc.name AS ReferencedColumn,f.is_disabled,f.is_not_trusted,f.is_not_for_replication,
 f.delete_referential_action,f.update_referential_action
 FROM sys.foreign_keys f JOIN sys.foreign_key_columns m ON m.constraint_object_id=f.object_id
 JOIN sys.columns pc ON pc.object_id=m.parent_object_id AND pc.column_id=m.parent_column_id
 JOIN sys.columns rc ON rc.object_id=m.referenced_object_id AND rc.column_id=m.referenced_column_id
 WHERE f.schema_id=SCHEMA_ID(N'uqp');
SELECT OBJECT_NAME(k.parent_object_id) AS TableName,k.name,k.type,c.name AS ColumnName,i.key_ordinal,x.is_disabled
 FROM sys.key_constraints k JOIN sys.index_columns i ON i.object_id=k.parent_object_id AND i.index_id=k.unique_index_id
 JOIN sys.columns c ON c.object_id=i.object_id AND c.column_id=i.column_id
 JOIN sys.indexes x ON x.object_id=k.parent_object_id AND x.index_id=k.unique_index_id
 WHERE k.schema_id=SCHEMA_ID(N'uqp') AND i.key_ordinal>0;
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE schema_id=SCHEMA_ID(N'uqp') AND (is_disabled=1 OR is_not_trusted=1))
 OR EXISTS (SELECT 1 FROM sys.foreign_keys WHERE schema_id=SCHEMA_ID(N'uqp') AND (is_disabled=1 OR is_not_trusted=1))
 THROW 51940, 'DISABLED_OR_UNTRUSTED_CONSTRAINT', 1;
-- Reaching here proves neither full 919 shape nor API safety: compare evidence with the runbook/runtime catalog validator.
