// Catalog-only validation, also embedded verbatim in migration 921. No DDL or
// application configuration is loaded here. Unknown/partially installed shapes
// are refused rather than repaired by the reader.
export const versionFoundationSchemaSql = `
IF OBJECT_ID(N'uqp.DataSource',N'U') IS NULL
 OR OBJECT_ID(N'uqp.Dataset',N'U') IS NULL
 OR OBJECT_ID(N'uqp.DatasetParameter',N'U') IS NULL
 OR OBJECT_ID(N'uqp.DatasetNativeParameterContract',N'U') IS NULL
 THROW 51921, 'VERSION_FOUNDATION_SCHEMA_REQUIRED', 1;

IF (SELECT COUNT(*) FROM sys.columns WHERE object_id=OBJECT_ID(N'uqp.DataSource') AND system_type_id=189)<>1
 OR NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'uqp.DataSource')
   AND name=N'ConfigurationRowVersion' AND system_type_id=189 AND user_type_id=189
   AND max_length=8 AND is_nullable=0 AND is_computed=0)
 OR (SELECT COUNT(*) FROM sys.columns WHERE object_id=OBJECT_ID(N'uqp.Dataset') AND system_type_id=189)<>1
 OR NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'uqp.Dataset')
   AND name=N'DefinitionRowVersion' AND system_type_id=189 AND user_type_id=189
   AND max_length=8 AND is_nullable=0 AND is_computed=0)
 THROW 51921, 'VERSION_FOUNDATION_ROWVERSION_CONFLICT', 1;

DECLARE @ExpectedColumns TABLE (Name NVARCHAR(128),TypeId INT,MaxLength INT,Nullable BIT);
INSERT INTO @ExpectedColumns VALUES
 (N'DatasetId',127,8,0),(N'DefinitionRowVersion',173,8,0),
 (N'DataSourceId',127,8,0),(N'ConfigurationRowVersion',173,8,0),
 (N'NativeTypesJson',231,-1,1),(N'EvidenceSource',231,64,1),
 (N'State',231,32,0),(N'ContractRowVersion',189,8,0);
IF (SELECT COUNT(*) FROM sys.columns WHERE object_id=OBJECT_ID(N'uqp.DatasetNativeParameterContract'))<>8
 OR EXISTS (SELECT 1 FROM @ExpectedColumns e WHERE NOT EXISTS
   (SELECT 1 FROM sys.columns c WHERE c.object_id=OBJECT_ID(N'uqp.DatasetNativeParameterContract')
    AND c.name=e.Name AND c.system_type_id=e.TypeId AND c.user_type_id=e.TypeId
    AND c.max_length=e.MaxLength AND c.is_nullable=e.Nullable AND c.is_computed=0 AND c.is_identity=0))
 THROW 51921, 'VERSION_FOUNDATION_CONTRACT_COLUMNS_CONFLICT', 1;

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE object_id=OBJECT_ID(N'uqp.DatasetNativeParameterContract')
    AND temporal_type=0 AND is_memory_optimized=0)
 OR EXISTS (SELECT 1 FROM sys.triggers WHERE parent_id=OBJECT_ID(N'uqp.DatasetNativeParameterContract'))
 THROW 51921, 'VERSION_FOUNDATION_CONTRACT_TABLE_CONFLICT', 1;

IF (SELECT COUNT(*) FROM sys.key_constraints WHERE parent_object_id=OBJECT_ID(N'uqp.DatasetNativeParameterContract'))<>1
 OR NOT EXISTS (SELECT 1 FROM sys.key_constraints k JOIN sys.indexes x
    ON x.object_id=k.parent_object_id AND x.index_id=k.unique_index_id
    JOIN sys.index_columns i ON i.object_id=x.object_id AND i.index_id=x.index_id
    JOIN sys.columns c ON c.object_id=i.object_id AND c.column_id=i.column_id
    WHERE k.parent_object_id=OBJECT_ID(N'uqp.DatasetNativeParameterContract')
     AND k.name=N'PK_DatasetNativeParameterContract' AND k.type=N'PK'
     AND x.is_disabled=0 AND x.has_filter=0 AND c.name=N'DatasetId' AND i.key_ordinal=1
     AND (SELECT COUNT(*) FROM sys.index_columns z WHERE z.object_id=x.object_id AND z.index_id=x.index_id AND z.key_ordinal>0)=1)
 THROW 51921, 'VERSION_FOUNDATION_CONTRACT_KEY_CONFLICT', 1;

DECLARE @ExpectedForeignKeys TABLE (Name NVARCHAR(128),ColumnName NVARCHAR(128),TargetName NVARCHAR(128));
INSERT INTO @ExpectedForeignKeys VALUES
 (N'FK_DatasetNativeParameterContract_Dataset',N'DatasetId',N'Dataset'),
 (N'FK_DatasetNativeParameterContract_DataSource',N'DataSourceId',N'DataSource');
IF (SELECT COUNT(*) FROM sys.foreign_keys WHERE parent_object_id=OBJECT_ID(N'uqp.DatasetNativeParameterContract'))<>2
 OR EXISTS (SELECT 1 FROM @ExpectedForeignKeys e WHERE NOT EXISTS
   (SELECT 1 FROM sys.foreign_keys f JOIN sys.foreign_key_columns m ON m.constraint_object_id=f.object_id
    JOIN sys.columns pc ON pc.object_id=m.parent_object_id AND pc.column_id=m.parent_column_id
    JOIN sys.columns rc ON rc.object_id=m.referenced_object_id AND rc.column_id=m.referenced_column_id
    WHERE f.parent_object_id=OBJECT_ID(N'uqp.DatasetNativeParameterContract') AND f.name=e.Name
     AND f.referenced_object_id=OBJECT_ID(N'uqp.'+e.TargetName) AND pc.name=e.ColumnName AND rc.name=N'Id'
     AND f.is_disabled=0 AND f.is_not_trusted=0 AND f.is_not_for_replication=0
     AND f.delete_referential_action=0 AND f.update_referential_action=0
     AND (SELECT COUNT(*) FROM sys.foreign_key_columns z WHERE z.constraint_object_id=f.object_id)=1))
 THROW 51921, 'VERSION_FOUNDATION_CONTRACT_FK_CONFLICT', 1;

DECLARE @ExpectedChecks TABLE (Name NVARCHAR(128),Expression NVARCHAR(MAX));
INSERT INTO @ExpectedChecks VALUES
 (N'CK_DatasetNativeParameterContract_State',N'state=n''unconfirmed'''),
 (N'CK_DatasetNativeParameterContract_Json',N'nativetypesjsonisnullorisjsonnativetypesjson=1'),
 (N'CK_DatasetNativeParameterContract_Source',N'evidencesourceisnullorevidencesource=n''database_declaration''orevidencesource=n''explicit_runtime_bind'''),
 (N'CK_DatasetNativeParameterContract_Pair',N'casewhennativetypesjsonisnullandevidencesourceisnullthen1whennativetypesjsonisnotnullandevidencesourceisnotnullthen1else0end=1');
-- Each expression uses only one Boolean operator kind per branch. Removing
-- redundant catalog parentheses cannot adopt a different AND/OR grouping.
IF (SELECT COUNT(*) FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID(N'uqp.DatasetNativeParameterContract'))<>4
 OR EXISTS (SELECT 1 FROM @ExpectedChecks e WHERE NOT EXISTS
   (SELECT 1 FROM sys.check_constraints c WHERE c.parent_object_id=OBJECT_ID(N'uqp.DatasetNativeParameterContract')
    AND c.name=e.Name AND c.is_disabled=0 AND c.is_not_trusted=0 AND c.is_not_for_replication=0
    AND REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(LOWER(c.definition),N'[',N''),N']',N''),N'(',N''),N')',N''),N' ',N''),CHAR(9),N''),CHAR(10),N''),CHAR(13),N'')=e.Expression))
 THROW 51921, 'VERSION_FOUNDATION_CONTRACT_CHECK_CONFLICT', 1;

IF (SELECT COUNT(*) FROM sys.default_constraints WHERE parent_object_id=OBJECT_ID(N'uqp.DatasetNativeParameterContract'))<>1
 OR NOT EXISTS (SELECT 1 FROM sys.default_constraints d JOIN sys.columns c
   ON c.object_id=d.parent_object_id AND c.column_id=d.parent_column_id
   WHERE d.parent_object_id=OBJECT_ID(N'uqp.DatasetNativeParameterContract')
    AND d.name=N'DF_DatasetNativeParameterContract_State' AND c.name=N'State'
    AND REPLACE(REPLACE(REPLACE(LOWER(d.definition),N'(',N''),N')',N''),N' ',N'')=N'n''unconfirmed''')
 THROW 51921, 'VERSION_FOUNDATION_CONTRACT_DEFAULT_CONFLICT', 1;
SELECT 1 AS SchemaValid;
`;
