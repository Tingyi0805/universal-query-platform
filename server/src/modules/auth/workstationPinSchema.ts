// Shared catalog attestation, byte-matched by tests to Migration 927. No application DML.
export const workstationPinSchemaSql = String.raw` -- Complete-state attestation applies equally after creation and on a rerun.
 -- No application DML, generation/counter reset, partial repair or name adoption.
 DECLARE @workstation int=OBJECT_ID(N'uqp.SharedWorkstation',N'U');
 DECLARE @bucket int=OBJECT_ID(N'uqp.WorkstationPinAttemptBucket',N'U');
 IF @bucket IS NULL OR COL_LENGTH(N'uqp.SharedWorkstation',N'SwitchVersion') IS NULL
  THROW 51927,'PIN_SCHEMA_PARTIAL',1;
 IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=@workstation AND name=N'SwitchVersion'
   AND system_type_id=127 AND user_type_id=127 AND max_length=8 AND precision=19 AND scale=0
   AND is_nullable=0 AND is_identity=0 AND is_computed=0 AND is_sparse=0 AND is_hidden=0
   AND generated_always_type=0 AND encryption_type IS NULL AND is_masked=0)
  THROW 51927,'PIN_SCHEMA_GENERATION_INVALID',1;
 DECLARE @columns table (Name sysname,TypeId int,Length smallint,Scale tinyint,Nullable bit);
 INSERT INTO @columns VALUES
  (N'ScopeCode',231,32,0,0),(N'KeyDigest',173,32,0,0),
  (N'WindowStartedAtUtc',42,7,3,0),(N'FailedAttempts',56,4,0,0),
  (N'BlockedUntilUtc',42,7,3,1),(N'UpdatedAtUtc',42,7,3,0);
 IF (SELECT COUNT(*) FROM sys.columns WHERE object_id=@bucket)<>6
  OR EXISTS (SELECT 1 FROM @columns e LEFT JOIN sys.columns c ON c.object_id=@bucket AND c.name=e.Name
    WHERE c.column_id IS NULL OR c.system_type_id<>e.TypeId OR c.user_type_id<>e.TypeId
     OR c.max_length<>e.Length OR c.scale<>e.Scale OR c.is_nullable<>e.Nullable
     OR c.is_computed<>0 OR c.is_identity<>0 OR c.is_sparse<>0 OR c.is_hidden<>0
     OR c.generated_always_type<>0 OR c.encryption_type IS NOT NULL OR c.is_masked<>0
     OR (e.Name=N'ScopeCode' AND c.collation_name<>CONVERT(sysname,DATABASEPROPERTYEX(DB_NAME(),N'Collation'))))
  THROW 51927,'PIN_SCHEMA_BUCKET_COLUMNS_INVALID',1;
 DECLARE @checks table (ParentId int,Name sysname,Definition nvarchar(1000));
 INSERT INTO @checks VALUES
  (@workstation,N'CK_Workstation_SwitchVersion',N'SWITCHVERSION>=0'),
  (@bucket,N'CK_PinAttempt_Scope',N'SCOPECODEINN''ACCOUNT'',N''WORKSTATION'',N''NETWORK'''),
  (@bucket,N'CK_PinAttempt_Failed',N'FAILEDATTEMPTS>=0'),
  (@bucket,N'CK_PinAttempt_Blocked',N'BLOCKEDUNTILUTCISNULLORBLOCKEDUNTILUTC>=WINDOWSTARTEDATUTC');
 IF EXISTS (SELECT 1 FROM @checks e LEFT JOIN sys.check_constraints c ON c.parent_object_id=e.ParentId AND c.name=e.Name
    CROSS APPLY (SELECT UPPER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(c.definition,N'[',N''),N']',N''),N'(',N''),N')',N''),N' ',N''),CHAR(13),N''),CHAR(10),N'')) AS Definition) normalized
    WHERE c.object_id IS NULL OR c.is_disabled=1 OR c.is_not_trusted=1 OR c.is_not_for_replication=1
     OR (normalized.Definition<>e.Definition AND NOT (e.Name=N'CK_PinAttempt_Scope' AND normalized.Definition IN (
       -- SQL Server may persist IN as an OR equality tree. Accept only the six
       -- exact permutations of these three equalities, never arbitrary expressions.
       N'SCOPECODE=N''ACCOUNT''ORSCOPECODE=N''WORKSTATION''ORSCOPECODE=N''NETWORK''',
       N'SCOPECODE=N''ACCOUNT''ORSCOPECODE=N''NETWORK''ORSCOPECODE=N''WORKSTATION''',
       N'SCOPECODE=N''WORKSTATION''ORSCOPECODE=N''ACCOUNT''ORSCOPECODE=N''NETWORK''',
       N'SCOPECODE=N''WORKSTATION''ORSCOPECODE=N''NETWORK''ORSCOPECODE=N''ACCOUNT''',
       N'SCOPECODE=N''NETWORK''ORSCOPECODE=N''ACCOUNT''ORSCOPECODE=N''WORKSTATION''',
       N'SCOPECODE=N''NETWORK''ORSCOPECODE=N''WORKSTATION''ORSCOPECODE=N''ACCOUNT'''))))
  OR (SELECT COUNT(*) FROM sys.check_constraints WHERE parent_object_id=@bucket)<>3
  THROW 51927,'PIN_SCHEMA_CHECKS_INVALID',1;
 -- Whitespace/case normalization above must not change quoted scope values,
 -- particularly on a case-sensitive database. Verify these literals byte-wise.
 IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE parent_object_id=@bucket AND name=N'CK_PinAttempt_Scope'
   AND definition COLLATE Latin1_General_100_BIN2 LIKE N'%N''ACCOUNT''%'
   AND definition COLLATE Latin1_General_100_BIN2 LIKE N'%N''WORKSTATION''%'
   AND definition COLLATE Latin1_General_100_BIN2 LIKE N'%N''NETWORK''%')
  THROW 51927,'PIN_SCHEMA_SCOPE_LITERALS_INVALID',1;
 IF EXISTS (SELECT 1 FROM sys.index_columns ic JOIN sys.columns c ON c.object_id=ic.object_id AND c.column_id=ic.column_id
     WHERE c.object_id=@workstation AND c.name=N'SwitchVersion')
  OR EXISTS (SELECT 1 FROM sys.sql_expression_dependencies d
    JOIN sys.check_constraints ck ON ck.object_id=d.referencing_id AND ck.parent_object_id=@workstation
    JOIN sys.columns c ON c.object_id=d.referenced_id AND c.column_id=d.referenced_minor_id
    WHERE c.object_id=@workstation AND c.name=N'SwitchVersion' AND ck.name<>N'CK_Workstation_SwitchVersion')
  THROW 51927,'PIN_SCHEMA_GENERATION_DEPENDENCIES_INVALID',1;
 DECLARE @defaults table (ParentId int,Name sysname,ColumnName sysname,Definition nvarchar(100));
 INSERT INTO @defaults VALUES
  (@workstation,N'DF_Workstation_SwitchVersion',N'SwitchVersion',N'0'),
  (@bucket,N'DF_PinAttempt_Failed',N'FailedAttempts',N'0'),
  (@bucket,N'DF_PinAttempt_Updated',N'UpdatedAtUtc',N'SYSUTCDATETIME');
 IF EXISTS (SELECT 1 FROM @defaults e LEFT JOIN sys.default_constraints d ON d.parent_object_id=e.ParentId AND d.name=e.Name
    LEFT JOIN sys.columns c ON c.object_id=d.parent_object_id AND c.column_id=d.parent_column_id
    WHERE d.object_id IS NULL OR c.name<>e.ColumnName
     OR UPPER(REPLACE(REPLACE(REPLACE(d.definition,N'(',N''),N')',N''),N' ',N''))<>e.Definition)
  OR (SELECT COUNT(*) FROM sys.default_constraints WHERE parent_object_id=@bucket)<>2
  THROW 51927,'PIN_SCHEMA_DEFAULTS_INVALID',1;
 IF (SELECT COUNT(*) FROM sys.indexes WHERE object_id=@bucket)<>2
  OR NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=@bucket AND name=N'PK_WorkstationPinAttemptBucket'
    AND type=1 AND is_unique=1 AND is_primary_key=1 AND is_unique_constraint=0 AND has_filter=0 AND is_disabled=0 AND is_hypothetical=0
    AND ignore_dup_key=0 AND allow_row_locks=1 AND allow_page_locks=1)
  OR NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=@bucket AND name=N'IX_PinAttempt_Updated'
    AND type=2 AND is_unique=0 AND is_primary_key=0 AND is_unique_constraint=0 AND has_filter=0 AND is_disabled=0 AND is_hypothetical=0
    AND ignore_dup_key=0 AND allow_row_locks=1 AND allow_page_locks=1)
  THROW 51927,'PIN_SCHEMA_INDEXES_INVALID',1;
 DECLARE @keys table (IndexName sysname,ColumnName sysname,Ordinal tinyint);
 INSERT INTO @keys VALUES (N'PK_WorkstationPinAttemptBucket',N'ScopeCode',1),
  (N'PK_WorkstationPinAttemptBucket',N'KeyDigest',2),(N'IX_PinAttempt_Updated',N'UpdatedAtUtc',1);
 IF EXISTS (SELECT 1 FROM @keys e LEFT JOIN sys.indexes i ON i.object_id=@bucket AND i.name=e.IndexName
    LEFT JOIN sys.index_columns ic ON ic.object_id=i.object_id AND ic.index_id=i.index_id AND ic.key_ordinal=e.Ordinal
    LEFT JOIN sys.columns c ON c.object_id=ic.object_id AND c.column_id=ic.column_id
    WHERE c.name IS NULL OR c.name<>e.ColumnName OR ic.is_descending_key=1 OR ic.is_included_column=1)
  OR (SELECT COUNT(*) FROM sys.index_columns WHERE object_id=@bucket AND key_ordinal>0)<>3
  OR EXISTS (SELECT 1 FROM sys.index_columns WHERE object_id=@bucket AND is_included_column=1)
  OR (SELECT COUNT(*) FROM sys.key_constraints WHERE parent_object_id=@bucket AND type=N'PK' AND name=N'PK_WorkstationPinAttemptBucket')<>1
  OR (SELECT COUNT(*) FROM sys.key_constraints WHERE parent_object_id=@bucket)<>1
  THROW 51927,'PIN_SCHEMA_KEYS_INVALID',1;
 IF EXISTS (SELECT 1 FROM sys.triggers WHERE parent_id=@bucket)
  OR EXISTS (SELECT 1 FROM sys.foreign_keys WHERE parent_object_id=@bucket OR referenced_object_id=@bucket)
  OR EXISTS (SELECT 1 FROM sys.tables WHERE object_id=@bucket AND
    (is_memory_optimized=1 OR temporal_type<>0 OR is_filetable=1 OR is_tracked_by_cdc=1))
  OR EXISTS (SELECT 1 FROM sys.partitions WHERE object_id=@bucket AND (partition_number<>1 OR data_compression<>0))
  THROW 51927,'PIN_SCHEMA_UNEXPECTED_FEATURE',1;
`;
