-- H0-5A / Migration 926 read-only catalog witness.
-- Run only against an approved isolated SQL Server 2019 database in H0-5B.
-- This file reads metadata only. It neither installs nor repairs schema.
SET NOCOUNT ON;

/* R0: target witness. Database identity and isolation approval remain external evidence. */
SELECT
  N'R0_ENVIRONMENT' AS ResultSet,
  CONVERT(NVARCHAR(128),SERVERPROPERTY(N'ProductVersion')) AS ProductVersion,
  CONVERT(NVARCHAR(128),SERVERPROPERTY(N'Edition')) AS Edition,
  DB_NAME() AS DatabaseName,
  d.compatibility_level AS CompatibilityLevel,
  d.collation_name AS DatabaseCollation,
  d.snapshot_isolation_state_desc AS SnapshotIsolationState,
  d.is_read_committed_snapshot_on AS ReadCommittedSnapshotOn
FROM sys.databases AS d
WHERE d.database_id=DB_ID();

/* R1: all candidate objects and the two altered baseline objects. */
WITH ExpectedObject(ObjectName,ObjectType) AS (
  SELECT * FROM (VALUES
    (N'QuickPinPolicy',N'U'),
    (N'SharedWorkstationCredential',N'U'),
    (N'SharedWorkstationSession',N'U'),
    (N'SharedWorkstationDeviceSession',N'U'),
    (N'UserQuickPinSecurityBinding',N'U'),
    (N'SharedWorkstationPinAttemptState',N'U'),
    (N'SharedWorkstationOperatorState',N'U'),
    (N'SharedWorkstationSessionRequest',N'U'),
    (N'SharedWorkstationSessionDecision',N'U'),
    (N'TR_WorkstationSessionRequest_AppendOnly',N'TR'),
    (N'TR_WorkstationSessionDecision_AppendOnly',N'TR')
  ) AS v(ObjectName,ObjectType)
)
SELECT N'R1_OBJECTS' AS ResultSet,e.ObjectName,e.ObjectType,
  o.type AS ActualType,
  CASE WHEN o.object_id IS NULL THEN N'MISSING'
       WHEN o.type<>e.ObjectType THEN N'DIFFERENT'
       ELSE N'MATCH' END AS Status
FROM ExpectedObject AS e
LEFT JOIN sys.objects AS o
  ON o.schema_id=SCHEMA_ID(N'uqp') AND o.name=e.ObjectName
ORDER BY e.ObjectType,e.ObjectName;

/* R2: exact column type/nullability/collation/identity/ROWVERSION witness. */
WITH ExpectedColumn(TableName,Ordinal,ColumnName,TypeName,MaxLength,PrecisionValue,ScaleValue,Nullable,IdentityColumn,CollationName) AS (
  SELECT * FROM (VALUES
    (N'QuickPinPolicy',4,N'PolicyRevision',N'bigint',CONVERT(SMALLINT,8),CONVERT(TINYINT,19),CONVERT(TINYINT,0),CONVERT(BIT,0),CONVERT(BIT,0),CONVERT(SYSNAME,NULL)),
    (N'QuickPinPolicy',5,N'PolicyRowVersion',N'timestamp',CONVERT(SMALLINT,8),CONVERT(TINYINT,0),CONVERT(TINYINT,0),CONVERT(BIT,0),CONVERT(BIT,0),CONVERT(SYSNAME,NULL)),
    (N'SharedWorkstationDeviceSession',1,N'Id',N'uniqueidentifier',16,0,0,0,0,NULL),
    (N'SharedWorkstationDeviceSession',2,N'WorkstationId',N'bigint',8,19,0,0,0,NULL),
    (N'SharedWorkstationDeviceSession',3,N'CredentialId',N'uniqueidentifier',16,0,0,0,0,NULL),
    (N'SharedWorkstationDeviceSession',4,N'BoundCredentialVersion',N'int',4,10,0,0,0,NULL),
    (N'SharedWorkstationDeviceSession',5,N'SessionProofHash',N'varbinary',32,0,0,0,0,NULL),
    (N'SharedWorkstationDeviceSession',6,N'CreatedAtUtc',N'datetime2',8,27,3,0,0,NULL),
    (N'SharedWorkstationDeviceSession',7,N'LastActivityAtUtc',N'datetime2',8,27,3,0,0,NULL),
    (N'SharedWorkstationDeviceSession',8,N'IdleExpiresAtUtc',N'datetime2',8,27,3,0,0,NULL),
    (N'SharedWorkstationDeviceSession',9,N'AbsoluteExpiresAtUtc',N'datetime2',8,27,3,0,0,NULL),
    (N'SharedWorkstationDeviceSession',10,N'RevokedAtUtc',N'datetime2',8,27,3,1,0,NULL),
    (N'SharedWorkstationDeviceSession',11,N'RevocationReason',N'nvarchar',80,0,0,1,0,N'Latin1_General_100_BIN2'),
    (N'SharedWorkstationDeviceSession',12,N'RenewalCounter',N'bigint',8,19,0,0,0,NULL),
    (N'SharedWorkstationDeviceSession',13,N'RowVersion',N'timestamp',8,0,0,0,0,NULL),
    (N'UserQuickPinSecurityBinding',1,N'UserId',N'bigint',8,19,0,0,0,NULL),
    (N'UserQuickPinSecurityBinding',2,N'PinVersion',N'int',4,10,0,0,0,NULL),
    (N'UserQuickPinSecurityBinding',3,N'BoundTokenVersion',N'int',4,10,0,0,0,NULL),
    (N'UserQuickPinSecurityBinding',4,N'BoundPolicyRevision',N'bigint',8,19,0,0,0,NULL),
    (N'UserQuickPinSecurityBinding',5,N'BoundAtUtc',N'datetime2',8,27,3,0,0,NULL),
    (N'UserQuickPinSecurityBinding',6,N'RowVersion',N'timestamp',8,0,0,0,0,NULL),
    (N'SharedWorkstationPinAttemptState',1,N'UserId',N'bigint',8,19,0,0,0,NULL),
    (N'SharedWorkstationPinAttemptState',2,N'LastWorkstationId',N'bigint',8,19,0,0,0,NULL),
    (N'SharedWorkstationPinAttemptState',3,N'BoundPinVersion',N'int',4,10,0,0,0,NULL),
    (N'SharedWorkstationPinAttemptState',4,N'BoundPolicyRevision',N'bigint',8,19,0,0,0,NULL),
    (N'SharedWorkstationPinAttemptState',5,N'FailedAttempts',N'int',4,10,0,0,0,NULL),
    (N'SharedWorkstationPinAttemptState',6,N'AttemptWindowStartedAtUtc',N'datetime2',8,27,3,1,0,NULL),
    (N'SharedWorkstationPinAttemptState',7,N'LastAttemptAtUtc',N'datetime2',8,27,3,1,0,NULL),
    (N'SharedWorkstationPinAttemptState',8,N'LockedUntilUtc',N'datetime2',8,27,3,1,0,NULL),
    (N'SharedWorkstationPinAttemptState',9,N'RowVersion',N'timestamp',8,0,0,0,0,NULL),
    (N'SharedWorkstationOperatorState',1,N'WorkstationId',N'bigint',8,19,0,0,0,NULL),
    (N'SharedWorkstationOperatorState',2,N'DeviceSessionId',N'uniqueidentifier',16,0,0,0,0,NULL),
    (N'SharedWorkstationOperatorState',3,N'StateCode',N'nvarchar',48,0,0,0,0,N'Latin1_General_100_BIN2'),
    (N'SharedWorkstationOperatorState',4,N'Generation',N'bigint',8,19,0,0,0,NULL),
    (N'SharedWorkstationOperatorState',5,N'Incarnation',N'uniqueidentifier',16,0,0,0,0,NULL),
    (N'SharedWorkstationOperatorState',6,N'OperatorSessionId',N'uniqueidentifier',16,0,0,1,0,NULL),
    (N'SharedWorkstationOperatorState',7,N'OperatorUserId',N'bigint',8,19,0,1,0,NULL),
    (N'SharedWorkstationOperatorState',8,N'TokenVersion',N'int',4,10,0,1,0,NULL),
    (N'SharedWorkstationOperatorState',9,N'PinVersion',N'int',4,10,0,1,0,NULL),
    (N'SharedWorkstationOperatorState',10,N'AuthMethod',N'nvarchar',40,0,0,1,0,N'Latin1_General_100_BIN2'),
    (N'SharedWorkstationOperatorState',11,N'LastMutationAtUtc',N'datetime2',8,27,3,0,0,NULL),
    (N'SharedWorkstationOperatorState',12,N'RowVersion',N'timestamp',8,0,0,0,0,NULL),
    (N'SharedWorkstationSessionRequest',1,N'RequestId',N'uniqueidentifier',16,0,0,0,0,NULL),
    (N'SharedWorkstationSessionRequest',2,N'WorkstationId',N'bigint',8,19,0,0,0,NULL),
    (N'SharedWorkstationSessionRequest',3,N'DeviceSessionId',N'uniqueidentifier',16,0,0,0,0,NULL),
    (N'SharedWorkstationSessionRequest',4,N'OperationCode',N'nvarchar',64,0,0,0,0,N'Latin1_General_100_BIN2'),
    (N'SharedWorkstationSessionRequest',5,N'RequestDigest',N'binary',32,0,0,0,0,NULL),
    (N'SharedWorkstationSessionRequest',6,N'TargetUserId',N'bigint',8,19,0,1,0,NULL),
    (N'SharedWorkstationSessionRequest',7,N'CreatedAtUtc',N'datetime2',8,27,3,0,0,NULL),
    (N'SharedWorkstationSessionRequest',8,N'ReplayExpiresAtUtc',N'datetime2',8,27,3,0,0,NULL),
    (N'SharedWorkstationSessionDecision',1,N'DecisionId',N'bigint',8,19,0,0,1,NULL),
    (N'SharedWorkstationSessionDecision',2,N'RequestId',N'uniqueidentifier',16,0,0,0,0,NULL),
    (N'SharedWorkstationSessionDecision',3,N'WorkstationId',N'bigint',8,19,0,0,0,NULL),
    (N'SharedWorkstationSessionDecision',4,N'DeviceSessionId',N'uniqueidentifier',16,0,0,0,0,NULL),
    (N'SharedWorkstationSessionDecision',5,N'OperationCode',N'nvarchar',64,0,0,0,0,N'Latin1_General_100_BIN2'),
    (N'SharedWorkstationSessionDecision',6,N'DecisionStatus',N'nvarchar',24,0,0,0,0,N'Latin1_General_100_BIN2'),
    (N'SharedWorkstationSessionDecision',7,N'ReasonCode',N'nvarchar',128,0,0,1,0,N'Latin1_General_100_BIN2'),
    (N'SharedWorkstationSessionDecision',8,N'ActorUserId',N'bigint',8,19,0,1,0,NULL),
    (N'SharedWorkstationSessionDecision',9,N'TargetUserId',N'bigint',8,19,0,1,0,NULL),
    (N'SharedWorkstationSessionDecision',10,N'RevisionDomain',N'nvarchar',48,0,0,0,0,N'Latin1_General_100_BIN2'),
    (N'SharedWorkstationSessionDecision',11,N'PreviousRevision',N'binary',8,0,0,1,0,NULL),
    (N'SharedWorkstationSessionDecision',12,N'NextRevision',N'binary',8,0,0,1,0,NULL),
    (N'SharedWorkstationSessionDecision',13,N'PreviousGeneration',N'bigint',8,19,0,1,0,NULL),
    (N'SharedWorkstationSessionDecision',14,N'NextGeneration',N'bigint',8,19,0,1,0,NULL),
    (N'SharedWorkstationSessionDecision',15,N'PreviousIncarnation',N'uniqueidentifier',16,0,0,1,0,NULL),
    (N'SharedWorkstationSessionDecision',16,N'NextIncarnation',N'uniqueidentifier',16,0,0,1,0,NULL),
    (N'SharedWorkstationSessionDecision',17,N'AuditLogId',N'bigint',8,19,0,0,0,NULL),
    (N'SharedWorkstationSessionDecision',18,N'AuditEventType',N'nvarchar',100,0,0,0,0,N'Latin1_General_100_BIN2'),
    (N'SharedWorkstationSessionDecision',19,N'TransactionCorrelationId',N'uniqueidentifier',16,0,0,0,0,NULL),
    (N'SharedWorkstationSessionDecision',20,N'CreatedAtUtc',N'datetime2',8,27,3,0,0,NULL)
  ) AS v(TableName,Ordinal,ColumnName,TypeName,MaxLength,PrecisionValue,ScaleValue,Nullable,IdentityColumn,CollationName)
), ActualColumn AS (
  SELECT o.name AS TableName,c.column_id AS Ordinal,c.name AS ColumnName,t.name AS TypeName,
    c.max_length AS MaxLength,c.precision AS PrecisionValue,c.scale AS ScaleValue,
    c.is_nullable AS Nullable,c.is_identity AS IdentityColumn,c.collation_name AS CollationName
  FROM sys.tables AS o
  JOIN sys.columns AS c ON c.object_id=o.object_id
  JOIN sys.types AS t ON t.user_type_id=c.user_type_id
  WHERE o.schema_id=SCHEMA_ID(N'uqp')
    AND o.name IN (N'QuickPinPolicy',N'SharedWorkstationDeviceSession',N'UserQuickPinSecurityBinding',
      N'SharedWorkstationPinAttemptState',N'SharedWorkstationOperatorState',
      N'SharedWorkstationSessionRequest',N'SharedWorkstationSessionDecision')
)
SELECT N'R2_COLUMNS' AS ResultSet,e.*,a.Ordinal AS ActualOrdinal,a.TypeName AS ActualType,
  a.MaxLength AS ActualMaxLength,a.PrecisionValue AS ActualPrecision,a.ScaleValue AS ActualScale,
  a.Nullable AS ActualNullable,a.IdentityColumn AS ActualIdentity,a.CollationName AS ActualCollation,
  CASE WHEN a.ColumnName IS NULL THEN N'MISSING'
       WHEN a.Ordinal=e.Ordinal AND a.TypeName=e.TypeName AND a.MaxLength=e.MaxLength
        AND a.PrecisionValue=e.PrecisionValue AND a.ScaleValue=e.ScaleValue
        AND a.Nullable=e.Nullable AND a.IdentityColumn=e.IdentityColumn
        AND ISNULL(a.CollationName,N'')=ISNULL(e.CollationName,N'') THEN N'MATCH'
       ELSE N'DIFFERENT' END AS Status
FROM ExpectedColumn AS e
LEFT JOIN ActualColumn AS a ON a.TableName=e.TableName AND a.ColumnName=e.ColumnName
ORDER BY e.TableName,e.Ordinal;

/* R3: actual key order, includes, filters and disabled state. */
SELECT N'R3_INDEXES' AS ResultSet,t.name AS TableName,i.name AS IndexName,i.is_unique,
  i.is_primary_key,i.is_disabled,i.has_filter,i.filter_definition,
  k.KeyColumns,n.IncludeColumns
FROM sys.tables AS t
JOIN sys.indexes AS i ON i.object_id=t.object_id AND i.index_id>0
OUTER APPLY (
  SELECT STRING_AGG(CONVERT(NVARCHAR(MAX),c.name),N',')
    WITHIN GROUP (ORDER BY ic.key_ordinal) AS KeyColumns
  FROM sys.index_columns ic JOIN sys.columns c ON c.object_id=ic.object_id AND c.column_id=ic.column_id
  WHERE ic.object_id=i.object_id AND ic.index_id=i.index_id AND ic.is_included_column=0
) k
OUTER APPLY (
  SELECT STRING_AGG(CONVERT(NVARCHAR(MAX),c.name),N',')
    WITHIN GROUP (ORDER BY ic.index_column_id) AS IncludeColumns
  FROM sys.index_columns ic JOIN sys.columns c ON c.object_id=ic.object_id AND c.column_id=ic.column_id
  WHERE ic.object_id=i.object_id AND ic.index_id=i.index_id AND ic.is_included_column=1
) n
WHERE t.schema_id=SCHEMA_ID(N'uqp')
  AND (t.name LIKE N'SharedWorkstation%' OR t.name=N'UserQuickPinSecurityBinding')
ORDER BY t.name,i.name;

/* R4: every candidate FK must remain enabled, trusted and NO ACTION. */
SELECT N'R4_FOREIGN_KEYS' AS ResultSet,OBJECT_NAME(f.parent_object_id) AS TableName,f.name,
  OBJECT_NAME(f.referenced_object_id) AS ReferencedTable,f.is_disabled,f.is_not_trusted,
  f.delete_referential_action_desc,f.update_referential_action_desc,
  STRING_AGG(pc.name,N',') WITHIN GROUP (ORDER BY fc.constraint_column_id) AS ParentColumns,
  STRING_AGG(rc.name,N',') WITHIN GROUP (ORDER BY fc.constraint_column_id) AS ReferencedColumns
FROM sys.foreign_keys AS f
JOIN sys.foreign_key_columns AS fc ON fc.constraint_object_id=f.object_id
JOIN sys.columns AS pc ON pc.object_id=fc.parent_object_id AND pc.column_id=fc.parent_column_id
JOIN sys.columns AS rc ON rc.object_id=fc.referenced_object_id AND rc.column_id=fc.referenced_column_id
WHERE OBJECT_SCHEMA_NAME(f.parent_object_id)=N'uqp'
  AND (OBJECT_NAME(f.parent_object_id) LIKE N'SharedWorkstation%' OR OBJECT_NAME(f.parent_object_id)=N'UserQuickPinSecurityBinding')
GROUP BY f.parent_object_id,f.name,f.referenced_object_id,f.is_disabled,f.is_not_trusted,
  f.delete_referential_action_desc,f.update_referential_action_desc
ORDER BY TableName,f.name;

/* R5: definitions are evidence for review; textual equivalence is decided by the exact validator. */
SELECT N'R5_CHECKS_DEFAULTS_TRIGGERS' AS ResultSet,o.type_desc,o.name AS ObjectName,
  OBJECT_NAME(o.parent_object_id) AS ParentName,
  CASE WHEN o.type IN (N'C',N'D',N'TR') THEN OBJECT_DEFINITION(o.object_id) END AS Definition,
  CASE WHEN o.type=N'C' THEN CONVERT(INT,OBJECTPROPERTYEX(o.object_id,N'CnstIsNotTrusted')) END AS IsNotTrusted,
  CASE WHEN o.type=N'TR' THEN CONVERT(INT,OBJECTPROPERTYEX(o.object_id,N'ExecIsTriggerDisabled')) END AS IsDisabled
FROM sys.objects AS o
WHERE o.schema_id=SCHEMA_ID(N'uqp')
  AND (OBJECT_NAME(o.parent_object_id) LIKE N'SharedWorkstation%'
    OR OBJECT_NAME(o.parent_object_id) IN (N'UserQuickPinSecurityBinding',N'QuickPinPolicy'))
  AND o.type IN (N'C',N'D',N'TR')
ORDER BY ParentName,o.type,o.name;

/* R6: unexpected columns and ROWVERSION cardinality. */
SELECT N'R6_TABLE_SHAPE' AS ResultSet,t.name AS TableName,COUNT(*) AS ColumnCount,
  SUM(CASE WHEN ty.name=N'timestamp' THEN 1 ELSE 0 END) AS RowVersionCount,
  SUM(CASE WHEN c.is_computed=1 THEN 1 ELSE 0 END) AS ComputedColumnCount
FROM sys.tables AS t
JOIN sys.columns AS c ON c.object_id=t.object_id
JOIN sys.types AS ty ON ty.user_type_id=c.user_type_id
WHERE t.schema_id=SCHEMA_ID(N'uqp')
  AND t.name IN (N'SharedWorkstationDeviceSession',N'UserQuickPinSecurityBinding',
    N'SharedWorkstationPinAttemptState',N'SharedWorkstationOperatorState',
    N'SharedWorkstationSessionRequest',N'SharedWorkstationSessionDecision')
GROUP BY t.name
ORDER BY t.name;

/* R7: ledger observation only. Presence never substitutes for exact catalog validation. */
SELECT N'R7_LEDGER' AS ResultSet,FileName,AppliedAtUtc
FROM uqp.SchemaMigration
WHERE FileName=N'926_shared_workstation_session_security.sql';
