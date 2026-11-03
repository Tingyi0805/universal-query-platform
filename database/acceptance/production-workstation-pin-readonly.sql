-- PIN recovery batch 1: metadata only; DO NOT execute automatically.
-- No application rows, PIN/verifier values, credentials, sessions or patients are read.
-- Run manually only after approval, in the intended database. No USE or SET commands.
-- Missing metadata is UNKNOWN without VIEW DEFINITION; existence is not attestation.
-- Ledger rows and backups are deliberately not rechecked in this recovery batch.
SELECT N'00_CONTEXT' AS Section, @@SERVERNAME AS ServerName, DB_NAME() AS DatabaseName,
 CAST(SERVERPROPERTY(N'ProductVersion') AS nvarchar(128)) AS ProductVersion,
 CAST(SERVERPROPERTY(N'Edition') AS nvarchar(128)) AS Edition,
 HAS_PERMS_BY_NAME(DB_NAME(),N'DATABASE',N'VIEW DEFINITION') AS CanViewDefinition,
 CASE WHEN DB_NAME()<>N'UniversalQueryPlatform' THEN N'BLOCKED_WRONG_DATABASE'
 WHEN COALESCE(HAS_PERMS_BY_NAME(DB_NAME(),N'DATABASE',N'VIEW DEFINITION'),0)<>1
 THEN N'UNKNOWN_METADATA_VISIBILITY' ELSE N'REVIEW_EXPECTED_SERVER_SEPARATELY' END AS Assessment;
GO

-- Existing 902-905/916 contracts and proposed runtime names, not deployment claims.
SELECT N'01_OBJECTS' AS Section,e.ObjectName,o.type_desc,
 CASE WHEN COALESCE(HAS_PERMS_BY_NAME(DB_NAME(),N'DATABASE',N'VIEW DEFINITION'),0)<>1
 THEN N'UNKNOWN_METADATA_VISIBILITY'
 WHEN o.object_id IS NULL THEN N'NOT_FOUND' ELSE N'REVIEW_TYPE_AND_DEFINITION' END AS Assessment
FROM (VALUES (N'SchemaMigration'),(N'AppUser'),(N'SharedWorkstation'),
 (N'SharedWorkstationUser'),(N'UserQuickPin'),(N'QuickPinPolicy'),
 (N'SharedWorkstationCredential'),(N'SharedWorkstationSession'),
 (N'WorkstationAudience'),(N'WorkstationAudienceMember'),(N'SharedWorkstationAudience'),
 (N'DashboardAuthenticationPolicy'),(N'DashboardDisplayDevice'),(N'AuditLog'),
 (N'WorkstationPinAttemptBucket')) e(ObjectName)
LEFT JOIN sys.objects o ON o.schema_id=SCHEMA_ID(N'uqp') AND o.name=e.ObjectName;
GO

-- Only catalog descriptions; PinHash / SecretHash values are never selected.
-- New runtime fields, if absent, are evidence for forward review, not automatic repair.
SELECT N'02_COLUMNS' AS Section,t.name AS TableName,c.name AS ColumnName,
 ty.name AS TypeName,c.max_length,c.precision,c.scale,c.is_nullable,
 c.is_identity,c.is_computed,c.collation_name,dc.name AS DefaultName,dc.definition AS DefaultDefinition
FROM sys.tables t
JOIN sys.schemas s ON s.schema_id=t.schema_id
JOIN sys.columns c ON c.object_id=t.object_id
JOIN sys.types ty ON ty.user_type_id=c.user_type_id
LEFT JOIN sys.default_constraints dc ON dc.object_id=c.default_object_id
WHERE s.name=N'uqp' AND t.name IN
 (N'SchemaMigration',N'AppUser',N'SharedWorkstation',N'SharedWorkstationUser',
 N'UserQuickPin',N'QuickPinPolicy',N'SharedWorkstationCredential',N'SharedWorkstationSession',
 N'WorkstationAudience',N'WorkstationAudienceMember',N'SharedWorkstationAudience',
 N'DashboardAuthenticationPolicy',N'WorkstationPinAttemptBucket')
ORDER BY t.name,c.column_id;
GO

SELECT N'03_CHECKS' AS Section,t.name AS TableName,cc.name AS ConstraintName,
 cc.definition,cc.is_disabled,cc.is_not_trusted,cc.is_not_for_replication
FROM sys.check_constraints cc
JOIN sys.tables t ON t.object_id=cc.parent_object_id
WHERE t.schema_id=SCHEMA_ID(N'uqp') AND t.name IN
 (N'SharedWorkstation',N'UserQuickPin',N'QuickPinPolicy',N'SharedWorkstationCredential',
 N'SharedWorkstationSession',N'WorkstationAudience',N'DashboardAuthenticationPolicy',
 N'WorkstationPinAttemptBucket',N'DashboardDisplayDevice')
ORDER BY t.name,cc.name;
GO

-- Includes key order, INCLUDE columns, filters and backing PK/UQ indexes.
SELECT N'04_INDEXES' AS Section,t.name AS TableName,i.name AS IndexName,i.type_desc,
 i.is_unique,i.is_primary_key,i.is_unique_constraint,i.is_disabled,i.has_filter,
 i.filter_definition,ic.key_ordinal,ic.index_column_id,ic.is_descending_key,
 ic.is_included_column,c.name AS ColumnName
FROM sys.tables t
JOIN sys.indexes i ON i.object_id=t.object_id
LEFT JOIN sys.index_columns ic ON ic.object_id=i.object_id AND ic.index_id=i.index_id
LEFT JOIN sys.columns c ON c.object_id=ic.object_id AND c.column_id=ic.column_id
WHERE t.schema_id=SCHEMA_ID(N'uqp') AND t.name IN
 (N'SharedWorkstation',N'SharedWorkstationUser',N'UserQuickPin',N'QuickPinPolicy',
 N'SharedWorkstationCredential',N'SharedWorkstationSession',N'WorkstationAudience',
 N'WorkstationAudienceMember',N'SharedWorkstationAudience',N'WorkstationPinAttemptBucket')
ORDER BY t.name,i.index_id,ic.index_column_id;
GO

-- All inbound and outbound FKs of the workstation/PIN objects.
SELECT N'05_FOREIGN_KEYS' AS Section,fk.name AS ConstraintName,
 ps.name AS ParentSchema,pt.name AS ParentTable,pc.name AS ParentColumn,
 rs.name AS ReferencedSchema,rt.name AS ReferencedTable,rc.name AS ReferencedColumn,
 fkc.constraint_column_id,fk.is_disabled,fk.is_not_trusted,fk.is_not_for_replication,
 fk.delete_referential_action_desc,fk.update_referential_action_desc
FROM sys.foreign_keys fk
JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id=fk.object_id
JOIN sys.tables pt ON pt.object_id=fk.parent_object_id
JOIN sys.schemas ps ON ps.schema_id=pt.schema_id
JOIN sys.columns pc ON pc.object_id=pt.object_id AND pc.column_id=fkc.parent_column_id
JOIN sys.tables rt ON rt.object_id=fk.referenced_object_id
JOIN sys.schemas rs ON rs.schema_id=rt.schema_id
JOIN sys.columns rc ON rc.object_id=rt.object_id AND rc.column_id=fkc.referenced_column_id
WHERE (ps.name=N'uqp' AND pt.name IN (N'SharedWorkstation',N'SharedWorkstationUser',
 N'UserQuickPin',N'QuickPinPolicy',N'SharedWorkstationCredential',N'SharedWorkstationSession',
 N'WorkstationAudience',N'WorkstationAudienceMember',N'SharedWorkstationAudience',N'WorkstationPinAttemptBucket'))
 OR (rs.name=N'uqp' AND rt.name IN (N'SharedWorkstation',N'SharedWorkstationUser',
 N'UserQuickPin',N'QuickPinPolicy',N'SharedWorkstationCredential',N'SharedWorkstationSession',
 N'WorkstationAudience',N'WorkstationAudienceMember',N'SharedWorkstationAudience',N'WorkstationPinAttemptBucket'))
ORDER BY ps.name,pt.name,fk.name,fkc.constraint_column_id;
GO

-- Existing 926 triggers are described, never executed or modified.
-- No module text is returned. Definition hash NULL means unavailable/encrypted.
SELECT N'06_TRIGGERS' AS Section,t.name AS TableName,tr.name AS TriggerName,
 tr.is_disabled,tr.is_instead_of_trigger,tr.is_not_for_replication,te.type_desc AS EventType,
 CONVERT(varchar(64),HASHBYTES(N'SHA2_256',CONVERT(varbinary(max),sm.definition)),2) AS DefinitionSha256
FROM sys.triggers tr
JOIN sys.tables t ON t.object_id=tr.parent_id
LEFT JOIN sys.trigger_events te ON te.object_id=tr.object_id
LEFT JOIN sys.sql_modules sm ON sm.object_id=tr.object_id
WHERE t.schema_id=SCHEMA_ID(N'uqp') AND t.name IN
 (N'SharedWorkstation',N'UserQuickPin',N'QuickPinPolicy',N'SharedWorkstationCredential',
 N'SharedWorkstationSession',N'WorkstationPinAttemptBucket',N'DashboardDisplayDevice')
ORDER BY t.name,tr.name,te.type_desc;
GO
