/*
 UQP PR101 - Read-only platform database inventory before test reset.
 Run in SSMS against the intended UQP TEST database, never a clinical source.
 Set both expected names to the exact values shown by the first SELECT.
 This script does not delete, update, migrate, disable constraints, or back up.
 No account names, SQL definitions, connection strings or patient rows returned.
*/
SET NOCOUNT ON;
DECLARE @ExpectedServer sysname = NULL; -- exact SERVERPROPERTY('ServerName')
DECLARE @ExpectedDatabase sysname = NULL; -- exact test platform database

SELECT CONVERT(nvarchar(128), SERVERPROPERTY('ServerName')) AS ServerName,
       DB_NAME() AS DatabaseName,
       DATABASEPROPERTYEX(DB_NAME(), 'Status') AS DatabaseStatus,
       DATABASEPROPERTYEX(DB_NAME(), 'Updateability') AS Updateability;

IF @ExpectedServer IS NULL OR @ExpectedDatabase IS NULL
    THROW 51001, 'Set exact expected TEST server/database before inventory.', 1;
IF @ExpectedServer COLLATE Latin1_General_100_BIN2 <>
       CONVERT(nvarchar(128), SERVERPROPERTY('ServerName')) COLLATE Latin1_General_100_BIN2
   OR @ExpectedDatabase COLLATE Latin1_General_100_BIN2 <>
       DB_NAME() COLLATE Latin1_General_100_BIN2
   OR DB_ID() <= 4
    THROW 51002, 'Target mismatch or system database; inventory stopped.', 1;

IF OBJECT_ID(N'uqp.AppUser',N'U') IS NULL
   OR OBJECT_ID(N'uqp.Dataset',N'U') IS NULL
   OR OBJECT_ID(N'uqp.DataSource',N'U') IS NULL
   OR OBJECT_ID(N'uqp.SchemaMigration',N'U') IS NULL
    THROW 51003, 'Target lacks expected UQP platform objects.', 1;

SELECT FileName FROM uqp.SchemaMigration ORDER BY FileName;

-- Counts are metadata estimates, not application data. Inspect every table,
-- including any new dependencies, before considering a reset.
SELECT s.name AS SchemaName, t.name AS TableName,
       COALESCE(SUM(CASE WHEN p.index_id IN (0,1) THEN p.rows ELSE 0 END),0) AS ApproximateRows,
       CASE WHEN s.name <> N'uqp' THEN N'OUTSIDE_UQP_REVIEW'
            WHEN t.name IN (N'AppUser',N'Role',N'Permission',N'UserRole',N'RolePermission',N'DataSource',N'SchemaMigration')
                THEN N'PRESERVE_CANDIDATE'
            WHEN t.name LIKE N'%Audit%' OR t.name LIKE N'%Version%' OR t.name LIKE N'%Approval%' OR t.name LIKE N'%Review%'
                THEN N'HISTORY_OR_SECURITY_REVIEW'
            ELSE N'REVIEW_DEPENDENCIES'
       END AS ReviewCategory
FROM sys.tables t
JOIN sys.schemas s ON s.schema_id=t.schema_id
LEFT JOIN sys.partitions p ON p.object_id=t.object_id AND p.index_id IN (0,1)
WHERE t.is_ms_shipped=0
GROUP BY s.name,t.name
ORDER BY s.name,t.name;

-- FK dependency graph. No automatic disabling or cascade deletion.
SELECT fk.name AS ForeignKey, ps.name AS ReferencingSchema, pt.name AS ReferencingTable,
       rs.name AS ReferencedSchema, rt.name AS ReferencedTable,
       fk.delete_referential_action_desc AS DeleteAction,
       fk.is_disabled AS IsDisabled, fk.is_not_trusted AS IsNotTrusted
FROM sys.foreign_keys fk
JOIN sys.tables pt ON pt.object_id=fk.parent_object_id
JOIN sys.schemas ps ON ps.schema_id=pt.schema_id
JOIN sys.tables rt ON rt.object_id=fk.referenced_object_id
JOIN sys.schemas rs ON rs.schema_id=rt.schema_id
WHERE ps.name=N'uqp' OR rs.name=N'uqp'
ORDER BY ps.name,pt.name,fk.name;

SELECT N'UQP_TEST_INVENTORY_READ_ONLY_COMPLETE' AS Result;
