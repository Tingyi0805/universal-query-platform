-- D0A: NOT EXECUTED. Inventory only; no lock, authority or delivery proof.
-- Future use only in an approved isolated database with complete metadata visibility.
-- Object names/column shapes are metadata. No business rows or module bodies are read.
-- Every result set must be retained; NULL/invisible objects are never evidence of absence.

-- R0: engine/configuration and the visibility prerequisite, without endpoint/login names.
SELECT N'R0_ENVIRONMENT' AS Section,
  CONVERT(nvarchar(128), SERVERPROPERTY(N'ProductVersion')) AS ProductVersion,
  CONVERT(nvarchar(128), SERVERPROPERTY(N'ProductLevel')) AS ProductLevel,
  CONVERT(nvarchar(128), SERVERPROPERTY(N'Edition')) AS Edition,
  SERVERPROPERTY(N'EngineEdition') AS EngineEdition,
  d.compatibility_level, d.collation_name, d.is_read_committed_snapshot_on,
  d.snapshot_isolation_state_desc,
  HAS_PERMS_BY_NAME(DB_NAME(), N'DATABASE', N'VIEW DEFINITION') AS DatabaseViewDefinition,
  N'NOT_A_READINESS_OR_LOCK_CERTIFICATE' AS Interpretation
FROM sys.databases AS d WHERE d.database_id = DB_ID();

-- R1: expected tables, including an absent schema or a same-name non-table object.
WITH Expected(TableName) AS (
  SELECT v.TableName FROM (VALUES
    (N'DataSource'),(N'Dataset'),(N'DatasetParameter'),(N'QueryDefinition'),
    (N'AppUser'),(N'Role'),(N'Permission'),(N'UserRole'),(N'RolePermission'),
    (N'RoleQueryAccess'),(N'UserQueryAccess'),(N'Dashboard'),(N'DashboardDataSource'),
    (N'DashboardDisplayProfile'),(N'DashboardWidget'),(N'DatasetNativeParameterContract'),
    (N'AuditLog'),(N'AuditLogArchive'),(N'DatasetVersion'),(N'QueryDefinitionVersion')
  ) AS v(TableName)
)
SELECT N'R1_EXPECTED_TABLES' AS Section, e.TableName, s.name AS SchemaName,
  o.type_desc, t.temporal_type, t.is_memory_optimized,
  HAS_PERMS_BY_NAME(N'uqp.' + e.TableName, N'OBJECT', N'VIEW DEFINITION') AS ObjectViewDefinition,
  CASE WHEN HAS_PERMS_BY_NAME(DB_NAME(),N'DATABASE',N'VIEW DEFINITION') <> 1
      OR HAS_PERMS_BY_NAME(DB_NAME(),N'DATABASE',N'VIEW DEFINITION') IS NULL THEN N'UNKNOWN_VISIBILITY'
    WHEN o.object_id IS NULL THEN N'ABSENT_OR_INVISIBLE_REQUIRES_DBA'
    WHEN o.type <> N'U' THEN N'SHAPE_CONFLICT' ELSE N'VISIBLE_TABLE_ONLY' END AS Observation
FROM Expected AS e
LEFT JOIN sys.schemas AS s ON s.name = N'uqp'
LEFT JOIN sys.objects AS o ON o.schema_id = s.schema_id AND o.name = e.TableName
LEFT JOIN sys.tables AS t ON t.object_id = o.object_id
ORDER BY e.TableName;

-- R2: all visible uqp table/column shapes, including aliases, collation and rowversion.
SELECT N'R2_COLUMNS' AS Section, s.name AS SchemaName, t.name AS TableName,
  t.temporal_type, t.is_memory_optimized, t.lock_escalation_desc,
  c.column_id, c.name AS ColumnName, ty.name AS DeclaredType,
  c.system_type_id, c.user_type_id, c.max_length, c.precision, c.scale,
  c.is_nullable, c.is_identity, c.is_computed, c.collation_name,
  CASE WHEN c.system_type_id = 189 THEN 1 ELSE 0 END AS IsRowversionType
FROM sys.schemas AS s JOIN sys.tables AS t ON t.schema_id = s.schema_id
JOIN sys.columns AS c ON c.object_id = t.object_id
JOIN sys.types AS ty ON ty.user_type_id = c.user_type_id
WHERE s.name = N'uqp' ORDER BY t.name, c.column_id;

-- R3: complete ordered keys/includes; filter text is hashed, never echoed as SQL/literals.
SELECT N'R3_INDEXES' AS Section, t.name AS TableName, x.name AS IndexName, x.index_id,
  x.type_desc, x.is_primary_key, x.is_unique, x.is_unique_constraint,
  x.is_disabled, x.is_hypothetical, x.has_filter,
  CONVERT(varchar(64), HASHBYTES('SHA2_256', CONVERT(varbinary(max), x.filter_definition)), 2) AS FilterDefinitionSha256,
  ic.index_column_id, ic.key_ordinal, ic.is_descending_key, ic.is_included_column,
  ic.partition_ordinal, c.name AS ColumnName, kc.name AS KeyConstraintName
FROM sys.tables AS t JOIN sys.schemas AS s ON s.schema_id = t.schema_id
JOIN sys.indexes AS x ON x.object_id = t.object_id
LEFT JOIN sys.index_columns AS ic ON ic.object_id = x.object_id AND ic.index_id = x.index_id
LEFT JOIN sys.columns AS c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
LEFT JOIN sys.key_constraints AS kc ON kc.parent_object_id = x.object_id AND kc.unique_index_id = x.index_id
WHERE s.name = N'uqp' ORDER BY t.name, x.index_id, ic.index_column_id;

-- R4: inbound AND outbound FKs, including other schemas referencing uqp.
SELECT N'R4_FOREIGN_KEYS' AS Section, f.name AS ForeignKeyName,
  ps.name AS ParentSchema, pt.name AS ParentTable, pc.name AS ParentColumn,
  rs.name AS ReferencedSchema, rt.name AS ReferencedTable, rc.name AS ReferencedColumn,
  m.constraint_column_id, f.delete_referential_action_desc, f.update_referential_action_desc,
  f.is_disabled, f.is_not_trusted, f.is_not_for_replication
FROM sys.foreign_keys AS f JOIN sys.foreign_key_columns AS m ON m.constraint_object_id = f.object_id
JOIN sys.tables AS pt ON pt.object_id = f.parent_object_id
JOIN sys.schemas AS ps ON ps.schema_id = pt.schema_id
JOIN sys.columns AS pc ON pc.object_id = m.parent_object_id AND pc.column_id = m.parent_column_id
JOIN sys.tables AS rt ON rt.object_id = f.referenced_object_id
JOIN sys.schemas AS rs ON rs.schema_id = rt.schema_id
JOIN sys.columns AS rc ON rc.object_id = m.referenced_object_id AND rc.column_id = m.referenced_column_id
WHERE ps.name = N'uqp' OR rs.name = N'uqp'
ORDER BY ps.name, pt.name, f.name, m.constraint_column_id;

-- R5: database-scope DDL triggers and table triggers, without executable definitions.
SELECT N'R5_TRIGGERS' AS Section, tr.name AS TriggerName, tr.parent_class_desc,
  s.name AS ParentSchema, o.name AS ParentObject, tr.type_desc,
  tr.is_disabled, tr.is_instead_of_trigger, tr.is_not_for_replication, ev.type_desc AS TriggerEvent
FROM sys.triggers AS tr LEFT JOIN sys.objects AS o ON o.object_id = tr.parent_id
LEFT JOIN sys.schemas AS s ON s.schema_id = o.schema_id
LEFT JOIN sys.trigger_events AS ev ON ev.object_id = tr.object_id
WHERE tr.parent_class = 0 OR s.name = N'uqp'
ORDER BY tr.parent_class, s.name, o.name, tr.name, ev.type_desc;

-- R6: constraint inventories; unknown expressions need local, redacted DBA review.
SELECT N'R6_CHECKS' AS Section, t.name AS TableName, ck.name AS ConstraintName,
  ck.is_disabled, ck.is_not_trusted, ck.is_not_for_replication,
  CONVERT(varchar(64), HASHBYTES('SHA2_256', CONVERT(varbinary(max), ck.definition)), 2) AS DefinitionSha256
FROM sys.check_constraints AS ck JOIN sys.tables AS t ON t.object_id = ck.parent_object_id
JOIN sys.schemas AS s ON s.schema_id = t.schema_id
WHERE s.name = N'uqp' ORDER BY t.name, ck.name;

SELECT N'R6_DEFAULTS' AS Section, t.name AS TableName, c.name AS ColumnName, dc.name AS ConstraintName,
  CONVERT(varchar(64), HASHBYTES('SHA2_256', CONVERT(varbinary(max), dc.definition)), 2) AS DefinitionSha256
FROM sys.default_constraints AS dc JOIN sys.tables AS t ON t.object_id = dc.parent_object_id
JOIN sys.schemas AS s ON s.schema_id = t.schema_id
JOIN sys.columns AS c ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id
WHERE s.name = N'uqp' ORDER BY t.name, c.column_id;

-- R7: required forward/reverse equality prefixes, NOT plan or key-range proof.
WITH Predicates(TableName, Direction, Key1, Key2) AS (
  SELECT v.* FROM (VALUES
    (N'AppUser',N'NATURAL',N'Username',NULL), (N'Role',N'NATURAL',N'Code',NULL),
    (N'Permission',N'NATURAL',N'Code',NULL),
    (N'UserRole',N'USER_TO_ROLE',N'UserId',N'RoleId'), (N'UserRole',N'ROLE_TO_USER',N'RoleId',N'UserId'),
    (N'RolePermission',N'ROLE_TO_PERMISSION',N'RoleId',N'PermissionId'),
    (N'RolePermission',N'PERMISSION_TO_ROLE',N'PermissionId',N'RoleId'),
    (N'RoleQueryAccess',N'ROLE_TO_QUERY',N'RoleId',N'QueryDefinitionId'),
    (N'RoleQueryAccess',N'QUERY_TO_ROLE',N'QueryDefinitionId',N'RoleId'),
    (N'UserQueryAccess',N'USER_TO_QUERY',N'UserId',N'QueryDefinitionId'),
    (N'UserQueryAccess',N'QUERY_TO_USER',N'QueryDefinitionId',N'UserId'),
    (N'Dataset',N'SOURCE_TO_DATASET',N'DataSourceId',N'Id'),
    (N'QueryDefinition',N'DATASET_TO_QUERY',N'DatasetId',N'Id'),
    (N'QueryDefinition',N'PUBLISHER_TO_QUERY',N'PublishedByUserId',N'Id'),
    (N'DatasetParameter',N'OWNER_TO_NAME',N'DatasetId',N'Name'),
    (N'DatasetParameter',N'LOOKUP_TO_OWNER',N'LookupDatasetId',N'DatasetId'),
    (N'Dashboard',N'QUERY_TO_PRIMARY',N'QueryDefinitionId',N'IsActive'),
    (N'DashboardDataSource',N'DASHBOARD_TO_KEY',N'DashboardId',N'SourceKey'),
    (N'DashboardDataSource',N'QUERY_TO_SUPPLEMENTAL',N'QueryDefinitionId',N'DashboardId'),
    (N'DashboardDataSource',N'HISTORICAL_DATASET_TO_SOURCE',N'DatasetId',N'DashboardId'),
    (N'DatasetVersion',N'AUTHOR_TO_HISTORY',N'CreatedByUserId',N'Id'),
    (N'QueryDefinitionVersion',N'AUTHOR_TO_HISTORY',N'CreatedByUserId',N'Id'),
    (N'AuditLog',N'USER_TO_AUDIT',N'UserId',N'CreatedAtUtc'),
    (N'DatasetNativeParameterContract',N'SOURCE_TO_CONTRACT',N'DataSourceId',N'DatasetId')
  ) AS v(TableName, Direction, Key1, Key2)
)
SELECT N'R7_PREDICATE_PREFIXES' AS Section, p.*, x.name AS CandidateIndex,
  x.is_unique, x.is_disabled, x.is_hypothetical, x.has_filter,
  CASE WHEN t.object_id IS NULL THEN N'ABSENT_OR_INVISIBLE_REQUIRES_DBA'
    WHEN x.index_id IS NULL THEN N'GAP_NO_EXPLICIT_KEY_PREFIX'
    WHEN x.is_disabled = 1 OR x.is_hypothetical = 1 OR x.type NOT IN (1,2) THEN N'NOT_A_USABLE_ROWSTORE_CANDIDATE'
    WHEN x.has_filter = 1 THEN N'FILTER_REVIEW_REQUIRED'
    ELSE N'CANDIDATE_ONLY_PLAN_AND_RANGE_UNKNOWN' END AS Observation
FROM Predicates AS p LEFT JOIN sys.schemas AS s ON s.name = N'uqp'
LEFT JOIN sys.tables AS t ON t.schema_id = s.schema_id AND t.name = p.TableName
LEFT JOIN sys.indexes AS x ON x.object_id = t.object_id
  AND EXISTS (SELECT 1 FROM sys.index_columns AS ic JOIN sys.columns AS c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
    WHERE ic.object_id = x.object_id AND ic.index_id = x.index_id AND ic.key_ordinal = 1 AND c.name = p.Key1)
  AND (p.Key2 IS NULL OR EXISTS (SELECT 1 FROM sys.index_columns AS ic JOIN sys.columns AS c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
    WHERE ic.object_id = x.object_id AND ic.index_id = x.index_id AND ic.key_ordinal = 2 AND c.name = p.Key2))
ORDER BY p.TableName, p.Direction, x.index_id;

-- R8a: 920/921 rowversion requirements. A binary(8) snapshot is not rowversion.
WITH Expected(TableName, ColumnName) AS (
  SELECT v.* FROM (VALUES (N'Dataset',N'DefinitionRowVersion'),(N'DataSource',N'ConfigurationRowVersion'),
    (N'DatasetNativeParameterContract',N'ContractRowVersion')) AS v(TableName, ColumnName)
)
SELECT N'R8A_ROWVERSION' AS Section, e.*, c.system_type_id, c.user_type_id, c.max_length, c.is_nullable, c.is_computed,
  (SELECT COUNT(*) FROM sys.columns AS r WHERE r.object_id = t.object_id AND r.system_type_id = 189) AS RowversionCount,
  CASE WHEN c.system_type_id = 189 AND c.user_type_id = 189 AND c.max_length = 8 AND c.is_nullable = 0 AND c.is_computed = 0
    AND (SELECT COUNT(*) FROM sys.columns AS r WHERE r.object_id = t.object_id AND r.system_type_id = 189) = 1
    THEN N'VISIBLE_SHAPE_MATCH_ONLY' ELSE N'MISSING_INVISIBLE_OR_CONFLICT' END AS Observation
FROM Expected AS e LEFT JOIN sys.schemas AS s ON s.name = N'uqp'
LEFT JOIN sys.tables AS t ON t.schema_id = s.schema_id AND t.name = e.TableName
LEFT JOIN sys.columns AS c ON c.object_id = t.object_id AND c.name = e.ColumnName
ORDER BY e.TableName;

-- R8b: all eight exact 921 columns; count detects extra columns too.
WITH Expected(ColumnName, TypeId, MaxLength, Nullable) AS (
  SELECT v.* FROM (VALUES (N'DatasetId',127,8,0),(N'DefinitionRowVersion',173,8,0),
    (N'DataSourceId',127,8,0),(N'ConfigurationRowVersion',173,8,0),
    (N'NativeTypesJson',231,-1,1),(N'EvidenceSource',231,64,1),(N'State',231,32,0),(N'ContractRowVersion',189,8,0)
  ) AS v(ColumnName, TypeId, MaxLength, Nullable)
)
SELECT N'R8B_CONTRACT_COLUMNS' AS Section, e.*, c.system_type_id, c.user_type_id, c.max_length, c.is_nullable, c.is_identity, c.is_computed,
  (SELECT COUNT(*) FROM sys.columns WHERE object_id = OBJECT_ID(N'uqp.DatasetNativeParameterContract',N'U')) AS ActualColumnCount,
  CASE WHEN c.system_type_id = e.TypeId AND c.user_type_id = e.TypeId AND c.max_length = e.MaxLength
    AND c.is_nullable = e.Nullable AND c.is_computed = 0 AND c.is_identity = 0 THEN N'VISIBLE_SHAPE_MATCH_ONLY'
    ELSE N'MISSING_INVISIBLE_OR_CONFLICT' END AS Observation
FROM Expected AS e LEFT JOIN sys.columns AS c
  ON c.object_id = OBJECT_ID(N'uqp.DatasetNativeParameterContract',N'U') AND c.name = e.ColumnName
ORDER BY e.ColumnName;

-- R8c: installation inventory, including partial 921 installs and unexpected triggers.
SELECT N'R8C_FOUNDATION_COUNTS' AS Section,
  OBJECT_ID(N'uqp.Dataset',N'U') AS DatasetObjectId, OBJECT_ID(N'uqp.DatasetParameter',N'U') AS ParameterObjectId,
  OBJECT_ID(N'uqp.DataSource',N'U') AS SourceObjectId, OBJECT_ID(N'uqp.DatasetNativeParameterContract',N'U') AS ContractObjectId,
  t.temporal_type, t.is_memory_optimized,
  (SELECT COUNT(*) FROM sys.columns WHERE object_id = t.object_id) AS ColumnsExpected8,
  (SELECT COUNT(*) FROM sys.triggers WHERE parent_id = t.object_id) AS TriggersExpected0,
  (SELECT COUNT(*) FROM sys.key_constraints WHERE parent_object_id = t.object_id) AS KeysExpected1,
  (SELECT COUNT(*) FROM sys.foreign_keys WHERE parent_object_id = t.object_id) AS ForeignKeysExpected2,
  (SELECT COUNT(*) FROM sys.check_constraints WHERE parent_object_id = t.object_id) AS ChecksExpected4,
  (SELECT COUNT(*) FROM sys.default_constraints WHERE parent_object_id = t.object_id) AS DefaultsExpected1
FROM (VALUES (1)) AS anchor(Ordinal) LEFT JOIN sys.tables AS t ON t.object_id = OBJECT_ID(N'uqp.DatasetNativeParameterContract',N'U');

SELECT N'R8D_CONTRACT_PK' AS Section, k.name, x.is_primary_key, x.is_unique, x.is_disabled, x.has_filter,
  CASE WHEN k.name = N'PK_DatasetNativeParameterContract' AND k.type = N'PK' AND x.is_primary_key = 1 AND x.is_unique = 1
    AND x.is_disabled = 0 AND x.has_filter = 0
    AND (SELECT COUNT(*) FROM sys.index_columns AS z WHERE z.object_id = x.object_id AND z.index_id = x.index_id AND z.key_ordinal > 0) = 1
    AND EXISTS (SELECT 1 FROM sys.index_columns AS i JOIN sys.columns AS c ON c.object_id = i.object_id AND c.column_id = i.column_id
      WHERE i.object_id = x.object_id AND i.index_id = x.index_id AND i.key_ordinal = 1 AND c.name = N'DatasetId')
    THEN N'VISIBLE_SHAPE_MATCH_ONLY' ELSE N'CONFLICT' END AS Observation
FROM sys.key_constraints AS k JOIN sys.indexes AS x ON x.object_id = k.parent_object_id AND x.index_id = k.unique_index_id
WHERE k.parent_object_id = OBJECT_ID(N'uqp.DatasetNativeParameterContract',N'U');

WITH Expected(FkName, ColumnName, TargetName) AS (
  SELECT v.* FROM (VALUES (N'FK_DatasetNativeParameterContract_Dataset',N'DatasetId',N'Dataset'),
    (N'FK_DatasetNativeParameterContract_DataSource',N'DataSourceId',N'DataSource')) AS v(FkName, ColumnName, TargetName)
)
SELECT N'R8E_CONTRACT_FK' AS Section, e.*,
  CASE WHEN EXISTS (SELECT 1 FROM sys.foreign_keys AS f JOIN sys.foreign_key_columns AS m ON m.constraint_object_id = f.object_id
    JOIN sys.columns AS pc ON pc.object_id = m.parent_object_id AND pc.column_id = m.parent_column_id
    JOIN sys.columns AS rc ON rc.object_id = m.referenced_object_id AND rc.column_id = m.referenced_column_id
    WHERE f.parent_object_id = OBJECT_ID(N'uqp.DatasetNativeParameterContract',N'U') AND f.name = e.FkName
      AND f.referenced_object_id = OBJECT_ID(N'uqp.' + e.TargetName,N'U') AND pc.name = e.ColumnName AND rc.name = N'Id'
      AND f.is_disabled = 0 AND f.is_not_trusted = 0 AND f.is_not_for_replication = 0
      AND f.delete_referential_action = 0 AND f.update_referential_action = 0
      AND (SELECT COUNT(*) FROM sys.foreign_key_columns AS z WHERE z.constraint_object_id = f.object_id) = 1)
    THEN N'VISIBLE_SHAPE_MATCH_ONLY' ELSE N'MISSING_INVISIBLE_OR_CONFLICT' END AS Observation
FROM Expected AS e ORDER BY e.FkName;

-- R8f/g: the same conservative expression normalization as 921; no raw definitions.
WITH Expected(CheckName, Expression) AS (
  SELECT v.* FROM (VALUES
    (N'CK_DatasetNativeParameterContract_State',N'state=n''unconfirmed'''),
    (N'CK_DatasetNativeParameterContract_Json',N'nativetypesjsonisnullorisjsonnativetypesjson=1'),
    (N'CK_DatasetNativeParameterContract_Source',N'evidencesourceisnullorevidencesource=n''database_declaration''orevidencesource=n''explicit_runtime_bind'''),
    (N'CK_DatasetNativeParameterContract_Pair',N'casewhennativetypesjsonisnullandevidencesourceisnullthen1whennativetypesjsonisnotnullandevidencesourceisnotnullthen1else0end=1')
  ) AS v(CheckName, Expression)
)
SELECT N'R8F_CONTRACT_CHECKS' AS Section, e.CheckName, ck.is_disabled, ck.is_not_trusted, ck.is_not_for_replication,
  CASE WHEN ck.is_disabled = 0 AND ck.is_not_trusted = 0 AND ck.is_not_for_replication = 0
    AND REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(LOWER(ck.definition),N'[',N''),N']',N''),N'(',N''),N')',N''),N' ',N''),CHAR(9),N''),CHAR(10),N''),CHAR(13),N'') = e.Expression
    THEN N'VISIBLE_SHAPE_MATCH_ONLY' ELSE N'MISSING_INVISIBLE_OR_CONFLICT' END AS Observation
FROM Expected AS e LEFT JOIN sys.check_constraints AS ck
  ON ck.parent_object_id = OBJECT_ID(N'uqp.DatasetNativeParameterContract',N'U') AND ck.name = e.CheckName
ORDER BY e.CheckName;

SELECT N'R8G_CONTRACT_DEFAULT' AS Section,
  CASE WHEN EXISTS (SELECT 1 FROM sys.default_constraints AS dc JOIN sys.columns AS c
    ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id
    WHERE dc.parent_object_id = OBJECT_ID(N'uqp.DatasetNativeParameterContract',N'U')
      AND dc.name = N'DF_DatasetNativeParameterContract_State' AND c.name = N'State'
      AND REPLACE(REPLACE(REPLACE(LOWER(dc.definition),N'(',N''),N')',N''),N' ',N'') = N'n''unconfirmed''')
    THEN N'VISIBLE_SHAPE_MATCH_ONLY' ELSE N'MISSING_INVISIBLE_OR_CONFLICT' END AS Observation;
