-- OFFLINE SOURCE ONLY. Do not execute without separate isolated-environment authorization.
-- Exact expression text is intentional: unobserved SQL Server serialization is rejected, never normalized away.
-- No business rows, SchemaMigration, permissions writes, dynamic SQL or 922 dependency.
;WITH Expected(category,owner,name,signature) AS (
  SELECT CONVERT(nvarchar(32),v.category) COLLATE Latin1_General_100_BIN2, CONVERT(nvarchar(128),v.owner) COLLATE Latin1_General_100_BIN2,
         CONVERT(nvarchar(128),v.name) COLLATE Latin1_General_100_BIN2, CONVERT(nvarchar(max),v.signature) COLLATE Latin1_General_100_BIN2
  FROM (VALUES
    (N'OBJECT',N'uqp',N'DatasetSecurityDecisionSeq',N'SO|0'),
    (N'SEQUENCE',N'uqp',N'DatasetSecurityDecisionSeq',N'bigint|8|19|0|1|1|1|9223372036854775807|0|0|NULL|0'),
    (N'OBJECT',N'uqp',N'DatasetFieldSnapshot',N'U|0'),
    (N'TABLE',N'DatasetFieldSnapshot',N'DatasetFieldSnapshot',N'0|0|0|0|0|0'),
    (N'ROWVERSION_COUNT',N'DatasetFieldSnapshot',N'DatasetFieldSnapshot',N'1'),
    (N'COLUMN',N'DatasetFieldSnapshot',N'Id',N'1|bigint|8|19|0|0|NULL|1|1|1|0|0|0|0|0|0|0|0'),
    (N'COLUMN',N'DatasetFieldSnapshot',N'DatasetId',N'2|bigint|8|19|0|0|NULL|0|NULL|NULL|0|0|0|0|0|0|0|0'),
    (N'COLUMN',N'DatasetFieldSnapshot',N'DataSourceId',N'3|bigint|8|19|0|0|NULL|0|NULL|NULL|0|0|0|0|0|0|0|0'),
    (N'COLUMN',N'DatasetFieldSnapshot',N'PlatformIncarnation',N'4|uniqueidentifier|16|0|0|0|NULL|0|NULL|NULL|0|0|0|0|0|0|0|0'),
    (N'COLUMN',N'DatasetFieldSnapshot',N'DefinitionVersion',N'5|binary|8|0|0|0|NULL|0|NULL|NULL|0|0|0|0|0|0|0|0'),
    (N'COLUMN',N'DatasetFieldSnapshot',N'ConfigurationVersion',N'6|binary|8|0|0|0|NULL|0|NULL|NULL|0|0|0|0|0|0|0|0'),
    (N'COLUMN',N'DatasetFieldSnapshot',N'BaseContractVersion',N'7|binary|8|0|0|1|NULL|0|NULL|NULL|0|0|0|0|0|0|0|0'),
    (N'COLUMN',N'DatasetFieldSnapshot',N'SqlDigest',N'8|binary|32|0|0|0|NULL|0|NULL|NULL|0|0|0|0|0|0|0|0'),
    (N'COLUMN',N'DatasetFieldSnapshot',N'ParameterDigest',N'9|binary|32|0|0|0|NULL|0|NULL|NULL|0|0|0|0|0|0|0|0'),
    (N'COLUMN',N'DatasetFieldSnapshot',N'NativeTypesDigest',N'10|binary|32|0|0|0|NULL|0|NULL|NULL|0|0|0|0|0|0|0|0'),
    (N'COLUMN',N'DatasetFieldSnapshot',N'ColumnsDigest',N'11|binary|32|0|0|0|NULL|0|NULL|NULL|0|0|0|0|0|0|0|0'),
    (N'COLUMN',N'DatasetFieldSnapshot',N'ColumnsJson',N'12|nvarchar|-1|0|0|0|Latin1_General_100_BIN2|0|NULL|NULL|0|0|0|0|0|0|0|0'),
    (N'COLUMN',N'DatasetFieldSnapshot',N'NativeBindingsJson',N'13|nvarchar|-1|0|0|0|Latin1_General_100_BIN2|0|NULL|NULL|0|0|0|0|0|0|0|0'),
    (N'COLUMN',N'DatasetFieldSnapshot',N'ParameterMode',N'14|nvarchar|32|0|0|0|Latin1_General_100_BIN2|0|NULL|NULL|0|0|0|0|0|0|0|0'),
    (N'COLUMN',N'DatasetFieldSnapshot',N'CollectorVersion',N'15|nvarchar|128|0|0|0|Latin1_General_100_BIN2|0|NULL|NULL|0|0|0|0|0|0|0|0'),
    (N'COLUMN',N'DatasetFieldSnapshot',N'CodecVersion',N'16|nvarchar|128|0|0|0|Latin1_General_100_BIN2|0|NULL|NULL|0|0|0|0|0|0|0|0'),
    (N'COLUMN',N'DatasetFieldSnapshot',N'PlanVersion',N'17|nvarchar|128|0|0|0|Latin1_General_100_BIN2|0|NULL|NULL|0|0|0|0|0|0|0|0'),
    (N'COLUMN',N'DatasetFieldSnapshot',N'DriverVersion',N'18|nvarchar|128|0|0|0|Latin1_General_100_BIN2|0|NULL|NULL|0|0|0|0|0|0|0|0'),
    (N'COLUMN',N'DatasetFieldSnapshot',N'CollectedAt',N'19|datetime2|8|27|7|0|NULL|0|NULL|NULL|0|0|0|0|0|0|0|0'),
    (N'COLUMN',N'DatasetFieldSnapshot',N'ExpiresAt',N'20|datetime2|8|27|7|0|NULL|0|NULL|NULL|0|0|0|0|0|0|0|0'),
    (N'COLUMN',N'DatasetFieldSnapshot',N'State',N'21|nvarchar|32|0|0|0|Latin1_General_100_BIN2|0|NULL|NULL|0|0|0|0|0|0|0|0'),
    (N'DEFAULT',N'DatasetFieldSnapshot',N'DF_DatasetFieldSnapshot_State',N'State|(N''DESCRIBED'')|0'),
    (N'COLUMN',N'DatasetFieldSnapshot',N'StateRowVersion',N'22|timestamp|8|0|0|0|NULL|0|NULL|NULL|0|0|0|0|0|0|0|0'),
    (N'COLUMN',N'DatasetFieldSnapshot',N'SourceIdentity',N'23|uniqueidentifier|16|0|0|1|NULL|0|NULL|NULL|0|0|0|0|0|0|0|0'),
    (N'COLUMN',N'DatasetFieldSnapshot',N'SourceIncarnation',N'24|uniqueidentifier|16|0|0|1|NULL|0|NULL|NULL|0|0|0|0|0|0|0|0'),
    (N'COLUMN',N'DatasetFieldSnapshot',N'LeaseId',N'25|uniqueidentifier|16|0|0|1|NULL|0|NULL|NULL|0|0|0|0|0|0|0|0'),
    (N'COLUMN',N'DatasetFieldSnapshot',N'SourceGeneration',N'26|bigint|8|19|0|1|NULL|0|NULL|NULL|0|0|0|0|0|0|0|0'),
    (N'COLUMN',N'DatasetFieldSnapshot',N'LeaseVersion',N'27|bigint|8|19|0|1|NULL|0|NULL|NULL|0|0|0|0|0|0|0|0'),
    (N'COLUMN',N'DatasetFieldSnapshot',N'SourceCollation',N'28|nvarchar|256|0|0|1|Latin1_General_100_BIN2|0|NULL|NULL|0|0|0|0|0|0|0|0'),
    (N'COLUMN',N'DatasetFieldSnapshot',N'CollectorEvidenceDigest',N'29|binary|32|0|0|1|NULL|0|NULL|NULL|0|0|0|0|0|0|0|0'),
    (N'COLUMN',N'DatasetFieldSnapshot',N'SourceEvidenceJson',N'30|nvarchar|-1|0|0|1|Latin1_General_100_BIN2|0|NULL|NULL|0|0|0|0|0|0|0|0'),
    (N'INDEX',N'DatasetFieldSnapshot',N'PK_DatasetFieldSnapshot',N'1|1|0|0|0|1|0|Id:ASC||NULL|0|1|1|0'),
    (N'KEY',N'DatasetFieldSnapshot',N'PK_DatasetFieldSnapshot',N'PK|PK_DatasetFieldSnapshot|0'),
    (N'INDEX',N'DatasetFieldSnapshot',N'UQ_DatasetFieldSnapshot_DatasetId_Id',N'2|1|0|0|0|0|1|DatasetId:ASC,Id:ASC||NULL|0|1|1|0'),
    (N'KEY',N'DatasetFieldSnapshot',N'UQ_DatasetFieldSnapshot_DatasetId_Id',N'UQ|UQ_DatasetFieldSnapshot_DatasetId_Id|0'),
    (N'INDEX',N'DatasetFieldSnapshot',N'IX_FieldSnapshot_DatasetState',N'2|0|0|0|0|0|0|DatasetId:ASC,State:ASC,Id:ASC|DefinitionVersion,ConfigurationVersion,ExpiresAt|NULL|0|1|1|0'),
    (N'INDEX',N'DatasetFieldSnapshot',N'IX_FieldSnapshot_Source',N'2|0|0|0|0|0|0|DataSourceId:ASC,DatasetId:ASC,Id:ASC||NULL|0|1|1|0'),
    (N'CHECK',N'DatasetFieldSnapshot',N'CK_DatasetFieldSnapshot_Ids',N'(CASE WHEN (([Id] IS NULL OR ([Id]>(0))) AND ([DatasetId] IS NULL OR ([DatasetId]>(0))) AND ([DataSourceId] IS NULL OR ([DataSourceId]>(0))) AND ([SourceGeneration] IS NULL OR ([SourceGeneration]>(0))) AND ([LeaseVersion] IS NULL OR ([LeaseVersion]>(0)))) THEN (1) ELSE (0) END=(1))|0|0|0|0|0|0'),
    (N'CHECK',N'DatasetFieldSnapshot',N'CK_DatasetFieldSnapshot_Versions',N'(CASE WHEN (([DefinitionVersion] IS NULL OR ([DefinitionVersion]<>0x0000000000000000)) AND ([ConfigurationVersion] IS NULL OR ([ConfigurationVersion]<>0x0000000000000000)) AND ([BaseContractVersion] IS NULL OR ([BaseContractVersion]<>0x0000000000000000))) THEN (1) ELSE (0) END=(1))|0|0|0|0|0|0'),
    (N'CHECK',N'DatasetFieldSnapshot',N'CK_DatasetFieldSnapshot_State',N'(CASE WHEN ((([State]=N''DESCRIBED'' AND DATALENGTH([State])=(18)) OR ([State]=N''SOURCE_BOUND'' AND DATALENGTH([State])=(24)) OR ([State]=N''INVALIDATED'' AND DATALENGTH([State])=(22)) OR ([State]=N''EXPIRED'' AND DATALENGTH([State])=(14)))) THEN (1) ELSE (0) END=(1))|0|0|0|0|0|0'),
    (N'CHECK',N'DatasetFieldSnapshot',N'CK_DatasetFieldSnapshot_ParameterMode',N'(CASE WHEN ((([ParameterMode]=N''NO_PARAMETERS'' AND DATALENGTH([ParameterMode])=(26)) OR ([ParameterMode]=N''UNPROVEN'' AND DATALENGTH([ParameterMode])=(16)))) THEN (1) ELSE (0) END=(1))|0|0|0|0|0|0'),
    (N'CHECK',N'DatasetFieldSnapshot',N'CK_DatasetFieldSnapshot_Expiry',N'(CASE WHEN ([ExpiresAt]>[CollectedAt]) THEN (1) ELSE (0) END=(1))|0|0|0|0|0|0'),
    (N'CHECK',N'DatasetFieldSnapshot',N'CK_DatasetFieldSnapshot_Json',N'(CASE WHEN (ISJSON([ColumnsJson])=(1) AND DATALENGTH([ColumnsJson])<=(1048576) AND ISJSON([NativeBindingsJson])=(1) AND DATALENGTH([NativeBindingsJson])<=(1048576) AND ([SourceEvidenceJson] IS NULL OR (ISJSON([SourceEvidenceJson])=(1) AND DATALENGTH([SourceEvidenceJson])<=(65536)))) THEN (1) ELSE (0) END=(1))|0|0|0|0|0|0'),
    (N'CHECK',N'DatasetFieldSnapshot',N'CK_DatasetFieldSnapshot_SourceBound',N'(CASE WHEN ([State]<>N''SOURCE_BOUND'' OR ([ParameterMode]=N''NO_PARAMETERS'' AND [SourceIdentity] IS NOT NULL AND [SourceIncarnation] IS NOT NULL AND [LeaseId] IS NOT NULL AND [SourceGeneration] IS NOT NULL AND [LeaseVersion] IS NOT NULL AND [SourceCollation] IS NOT NULL AND [CollectorEvidenceDigest] IS NOT NULL AND [SourceEvidenceJson] IS NOT NULL)) THEN (1) ELSE (0) END=(1))|0|0|0|0|0|0'),
    (N'FK',N'DatasetFieldSnapshot',N'FK_DatasetFieldSnapshot_Dataset',N'DatasetId|uqp.Dataset|Id|0|0|0|0|0|0'),
    (N'FK',N'DatasetFieldSnapshot',N'FK_DatasetFieldSnapshot_DataSource',N'DataSourceId|uqp.DataSource|Id|0|0|0|0|0|0'),
    (N'OBJECT',N'uqp',N'DatasetSecurityScope',N'U|0'),
    (N'TABLE',N'DatasetSecurityScope',N'DatasetSecurityScope',N'0|0|0|0|0|0'),
    (N'ROWVERSION_COUNT',N'DatasetSecurityScope',N'DatasetSecurityScope',N'1'),
    (N'COLUMN',N'DatasetSecurityScope',N'DatasetId',N'1|bigint|8|19|0|0|NULL|0|NULL|NULL|0|0|0|0|0|0|0|0'),
    (N'COLUMN',N'DatasetSecurityScope',N'UserId',N'2|bigint|8|19|0|0|NULL|0|NULL|NULL|0|0|0|0|0|0|0|0'),
    (N'COLUMN',N'DatasetSecurityScope',N'ScopeKind',N'3|nvarchar|16|0|0|0|Latin1_General_100_BIN2|0|NULL|NULL|0|0|0|0|0|0|0|0'),
    (N'COLUMN',N'DatasetSecurityScope',N'BoundDataSourceId',N'4|bigint|8|19|0|0|NULL|0|NULL|NULL|0|0|0|0|0|0|0|0'),
    (N'COLUMN',N'DatasetSecurityScope',N'State',N'5|nvarchar|16|0|0|0|Latin1_General_100_BIN2|0|NULL|NULL|0|0|0|0|0|0|0|0'),
    (N'DEFAULT',N'DatasetSecurityScope',N'DF_DatasetSecurityScope_State',N'State|(N''REVOKED'')|0'),
    (N'COLUMN',N'DatasetSecurityScope',N'ParentOwnerUserId',N'6|bigint|8|19|0|1|NULL|0|NULL|NULL|0|0|0|0|0|0|0|0'),
    (N'COLUMN',N'DatasetSecurityScope',N'ParentOwnerKind',N'7|nvarchar|16|0|0|1|Latin1_General_100_BIN2|0|NULL|NULL|0|0|0|0|0|0|0|0'),
    (N'COLUMN',N'DatasetSecurityScope',N'ChangedByUserId',N'8|bigint|8|19|0|0|NULL|0|NULL|NULL|0|0|0|0|0|0|0|0'),
    (N'COLUMN',N'DatasetSecurityScope',N'LastRequestId',N'9|uniqueidentifier|16|0|0|0|NULL|0|NULL|NULL|0|0|0|0|0|0|0|0'),
    (N'COLUMN',N'DatasetSecurityScope',N'LastReasonCode',N'10|nvarchar|64|0|0|0|Latin1_General_100_BIN2|0|NULL|NULL|0|0|0|0|0|0|0|0'),
    (N'COLUMN',N'DatasetSecurityScope',N'GrantedAt',N'11|datetime2|8|27|7|0|NULL|0|NULL|NULL|0|0|0|0|0|0|0|0'),
    (N'COLUMN',N'DatasetSecurityScope',N'ChangedAt',N'12|datetime2|8|27|7|0|NULL|0|NULL|NULL|0|0|0|0|0|0|0|0'),
    (N'COLUMN',N'DatasetSecurityScope',N'ScopeRowVersion',N'13|timestamp|8|0|0|0|NULL|0|NULL|NULL|0|0|0|0|0|0|0|0'),
    (N'INDEX',N'DatasetSecurityScope',N'PK_DatasetSecurityScope',N'1|1|0|0|0|1|0|DatasetId:ASC,UserId:ASC,ScopeKind:ASC||NULL|0|1|1|0'),
    (N'KEY',N'DatasetSecurityScope',N'PK_DatasetSecurityScope',N'PK|PK_DatasetSecurityScope|0'),
    (N'INDEX',N'DatasetSecurityScope',N'UQ_DatasetSecurityScope_LastRequestId',N'2|1|0|0|0|0|1|LastRequestId:ASC||NULL|0|1|1|0'),
    (N'KEY',N'DatasetSecurityScope',N'UQ_DatasetSecurityScope_LastRequestId',N'UQ|UQ_DatasetSecurityScope_LastRequestId|0'),
    (N'INDEX',N'DatasetSecurityScope',N'IX_SecurityScope_User',N'2|0|0|0|0|0|0|UserId:ASC,State:ASC,DatasetId:ASC,ScopeKind:ASC|BoundDataSourceId,ParentOwnerUserId|NULL|0|1|1|0'),
    (N'INDEX',N'DatasetSecurityScope',N'IX_SecurityScope_Parent',N'2|0|0|0|0|0|0|DatasetId:ASC,ParentOwnerUserId:ASC,ParentOwnerKind:ASC,State:ASC,UserId:ASC||NULL|0|1|1|0'),
    (N'INDEX',N'DatasetSecurityScope',N'IX_SecurityScope_Source',N'2|0|0|0|0|0|0|BoundDataSourceId:ASC,DatasetId:ASC,UserId:ASC,ScopeKind:ASC||NULL|0|1|1|0'),
    (N'CHECK',N'DatasetSecurityScope',N'CK_DatasetSecurityScope_Ids',N'(CASE WHEN (([DatasetId] IS NULL OR ([DatasetId]>(0))) AND ([UserId] IS NULL OR ([UserId]>(0))) AND ([BoundDataSourceId] IS NULL OR ([BoundDataSourceId]>(0))) AND ([ChangedByUserId] IS NULL OR ([ChangedByUserId]>(0))) AND ([ParentOwnerUserId] IS NULL OR ([ParentOwnerUserId]>(0)))) THEN (1) ELSE (0) END=(1))|0|0|0|0|0|0'),
    (N'CHECK',N'DatasetSecurityScope',N'CK_DatasetSecurityScope_State',N'(CASE WHEN ((([State]=N''ACTIVE'' AND DATALENGTH([State])=(12)) OR ([State]=N''REVOKED'' AND DATALENGTH([State])=(14)))) THEN (1) ELSE (0) END=(1))|0|0|0|0|0|0'),
    (N'CHECK',N'DatasetSecurityScope',N'CK_DatasetSecurityScope_Parent',N'(CASE WHEN ((([ScopeKind]=N''OWNER'' AND [ParentOwnerUserId] IS NULL AND [ParentOwnerKind] IS NULL) OR ([ScopeKind]=N''REVIEWER'' AND [ParentOwnerUserId] IS NOT NULL AND [ParentOwnerKind] IS NOT NULL AND [ParentOwnerKind]=N''OWNER'' AND [UserId]<>[ParentOwnerUserId])) AND ((([ScopeKind]=N''OWNER'' AND DATALENGTH([ScopeKind])=(10)) OR ([ScopeKind]=N''REVIEWER'' AND DATALENGTH([ScopeKind])=(16))) AND ([ParentOwnerKind] IS NULL OR ((([ParentOwnerKind]=N''OWNER'' AND DATALENGTH([ParentOwnerKind])=(10))))))) THEN (1) ELSE (0) END=(1))|0|0|0|0|0|0'),
    (N'FK',N'DatasetSecurityScope',N'FK_DatasetSecurityScope_Dataset',N'DatasetId|uqp.Dataset|Id|0|0|0|0|0|0'),
    (N'FK',N'DatasetSecurityScope',N'FK_DatasetSecurityScope_User',N'UserId|uqp.AppUser|Id|0|0|0|0|0|0'),
    (N'FK',N'DatasetSecurityScope',N'FK_DatasetSecurityScope_DataSource',N'BoundDataSourceId|uqp.DataSource|Id|0|0|0|0|0|0'),
    (N'FK',N'DatasetSecurityScope',N'FK_DatasetSecurityScope_ParentOwner',N'DatasetId,ParentOwnerUserId,ParentOwnerKind|uqp.DatasetSecurityScope|DatasetId,UserId,ScopeKind|0|0|0|0|0|0'),
    (N'OBJECT',N'uqp',N'DatasetSecurityDecision',N'U|0'),
    (N'TABLE',N'DatasetSecurityDecision',N'DatasetSecurityDecision',N'0|0|0|0|0|0'),
    (N'ROWVERSION_COUNT',N'DatasetSecurityDecision',N'DatasetSecurityDecision',N'0'),
    (N'COLUMN',N'DatasetSecurityDecision',N'Id',N'1|bigint|8|19|0|0|NULL|0|NULL|NULL|0|0|0|0|0|0|0|0'),
    (N'DEFAULT',N'DatasetSecurityDecision',N'DF_DatasetSecurityDecision_Id',N'Id|(NEXT VALUE FOR [uqp].[DatasetSecurityDecisionSeq])|0'),
    (N'COLUMN',N'DatasetSecurityDecision',N'DatasetId',N'2|bigint|8|19|0|0|NULL|0|NULL|NULL|0|0|0|0|0|0|0|0'),
    (N'COLUMN',N'DatasetSecurityDecision',N'Kind',N'3|nvarchar|32|0|0|0|Latin1_General_100_BIN2|0|NULL|NULL|0|0|0|0|0|0|0|0'),
    (N'COLUMN',N'DatasetSecurityDecision',N'SnapshotId',N'4|bigint|8|19|0|1|NULL|0|NULL|NULL|0|0|0|0|0|0|0|0'),
    (N'COLUMN',N'DatasetSecurityDecision',N'SubjectUserId',N'5|bigint|8|19|0|1|NULL|0|NULL|NULL|0|0|0|0|0|0|0|0'),
    (N'COLUMN',N'DatasetSecurityDecision',N'ScopeKind',N'6|nvarchar|16|0|0|1|Latin1_General_100_BIN2|0|NULL|NULL|0|0|0|0|0|0|0|0'),
    (N'COLUMN',N'DatasetSecurityDecision',N'RequestId',N'7|uniqueidentifier|16|0|0|0|NULL|0|NULL|NULL|0|0|0|0|0|0|0|0'),
    (N'COLUMN',N'DatasetSecurityDecision',N'CommandDigest',N'8|binary|32|0|0|0|NULL|0|NULL|NULL|0|0|0|0|0|0|0|0'),
    (N'COLUMN',N'DatasetSecurityDecision',N'ActorId',N'9|bigint|8|19|0|0|NULL|0|NULL|NULL|0|0|0|0|0|0|0|0'),
    (N'COLUMN',N'DatasetSecurityDecision',N'ActorTokenVersion',N'10|bigint|8|19|0|0|NULL|0|NULL|NULL|0|0|0|0|0|0|0|0'),
    (N'COLUMN',N'DatasetSecurityDecision',N'Action',N'11|nvarchar|64|0|0|0|Latin1_General_100_BIN2|0|NULL|NULL|0|0|0|0|0|0|0|0'),
    (N'COLUMN',N'DatasetSecurityDecision',N'ReasonCode',N'12|nvarchar|64|0|0|0|Latin1_General_100_BIN2|0|NULL|NULL|0|0|0|0|0|0|0|0'),
    (N'COLUMN',N'DatasetSecurityDecision',N'PreviousState',N'13|nvarchar|32|0|0|0|Latin1_General_100_BIN2|0|NULL|NULL|0|0|0|0|0|0|0|0'),
    (N'COLUMN',N'DatasetSecurityDecision',N'NextState',N'14|nvarchar|32|0|0|0|Latin1_General_100_BIN2|0|NULL|NULL|0|0|0|0|0|0|0|0'),
    (N'COLUMN',N'DatasetSecurityDecision',N'PreviousStateVersion',N'15|binary|8|0|0|1|NULL|0|NULL|NULL|0|0|0|0|0|0|0|0'),
    (N'COLUMN',N'DatasetSecurityDecision',N'NextStateVersion',N'16|binary|8|0|0|0|NULL|0|NULL|NULL|0|0|0|0|0|0|0|0'),
    (N'COLUMN',N'DatasetSecurityDecision',N'SnapshotDigest',N'17|binary|32|0|0|1|NULL|0|NULL|NULL|0|0|0|0|0|0|0|0'),
    (N'COLUMN',N'DatasetSecurityDecision',N'PolicyDigest',N'18|binary|32|0|0|1|NULL|0|NULL|NULL|0|0|0|0|0|0|0|0'),
    (N'COLUMN',N'DatasetSecurityDecision',N'SourceOperationEvidenceDigest',N'19|binary|32|0|0|1|NULL|0|NULL|NULL|0|0|0|0|0|0|0|0'),
    (N'COLUMN',N'DatasetSecurityDecision',N'AuthorizationEvidenceJson',N'20|nvarchar|-1|0|0|0|Latin1_General_100_BIN2|0|NULL|NULL|0|0|0|0|0|0|0|0'),
    (N'COLUMN',N'DatasetSecurityDecision',N'DetailsJson',N'21|nvarchar|-1|0|0|0|Latin1_General_100_BIN2|0|NULL|NULL|0|0|0|0|0|0|0|0'),
    (N'COLUMN',N'DatasetSecurityDecision',N'AuditLogId',N'22|bigint|8|19|0|0|NULL|0|NULL|NULL|0|0|0|0|0|0|0|0'),
    (N'COLUMN',N'DatasetSecurityDecision',N'TransactionReference',N'23|uniqueidentifier|16|0|0|0|NULL|0|NULL|NULL|0|0|0|0|0|0|0|0'),
    (N'COLUMN',N'DatasetSecurityDecision',N'PlatformIncarnation',N'24|uniqueidentifier|16|0|0|0|NULL|0|NULL|NULL|0|0|0|0|0|0|0|0'),
    (N'COLUMN',N'DatasetSecurityDecision',N'DecidedAt',N'25|datetime2|8|27|7|0|NULL|0|NULL|NULL|0|0|0|0|0|0|0|0'),
    (N'INDEX',N'DatasetSecurityDecision',N'PK_DatasetSecurityDecision',N'1|1|0|0|0|1|0|Id:ASC||NULL|0|1|1|0'),
    (N'KEY',N'DatasetSecurityDecision',N'PK_DatasetSecurityDecision',N'PK|PK_DatasetSecurityDecision|0'),
    (N'INDEX',N'DatasetSecurityDecision',N'UQ_DatasetSecurityDecision_RequestId',N'2|1|0|0|0|0|1|RequestId:ASC||NULL|0|1|1|0'),
    (N'KEY',N'DatasetSecurityDecision',N'UQ_DatasetSecurityDecision_RequestId',N'UQ|UQ_DatasetSecurityDecision_RequestId|0'),
    (N'INDEX',N'DatasetSecurityDecision',N'IX_SecurityDecision_Dataset',N'2|0|0|0|0|0|0|DatasetId:ASC,Id:ASC||NULL|0|1|1|0'),
    (N'INDEX',N'DatasetSecurityDecision',N'IX_SecurityDecision_Snapshot',N'2|0|0|0|0|0|0|SnapshotId:ASC,Id:ASC||NULL|0|1|1|0'),
    (N'INDEX',N'DatasetSecurityDecision',N'UX_SecurityDecision_CollectionSnapshot',N'2|1|0|0|0|0|0|SnapshotId:ASC||([Kind]=N''SNAPSHOT'' AND [Action]=N''COLLECT_METADATA'')|0|1|1|0'),
    (N'CHECK',N'DatasetSecurityDecision',N'CK_DatasetSecurityDecision_Ids',N'(CASE WHEN (([Id] IS NULL OR ([Id]>(0))) AND ([DatasetId] IS NULL OR ([DatasetId]>(0))) AND ([SnapshotId] IS NULL OR ([SnapshotId]>(0))) AND ([SubjectUserId] IS NULL OR ([SubjectUserId]>(0))) AND ([ActorId] IS NULL OR ([ActorId]>(0))) AND ([ActorTokenVersion] IS NULL OR ([ActorTokenVersion]>(0))) AND ([AuditLogId] IS NULL OR ([AuditLogId]>(0)))) THEN (1) ELSE (0) END=(1))|0|0|0|0|0|0'),
    (N'CHECK',N'DatasetSecurityDecision',N'CK_DatasetSecurityDecision_Shape',N'(CASE WHEN ((([Kind]=N''SCOPE'' AND [SubjectUserId] IS NOT NULL AND [ScopeKind] IS NOT NULL AND [ScopeKind] IN (N''OWNER'',N''REVIEWER'') AND [SnapshotId] IS NULL) OR ([Kind] IN (N''SNAPSHOT'',N''CONFIRMATION'') AND [SubjectUserId] IS NULL AND [ScopeKind] IS NULL AND [SnapshotId] IS NOT NULL)) AND ((([Kind]=N''SNAPSHOT'' AND DATALENGTH([Kind])=(16)) OR ([Kind]=N''SCOPE'' AND DATALENGTH([Kind])=(10)) OR ([Kind]=N''CONFIRMATION'' AND DATALENGTH([Kind])=(24))) AND ([ScopeKind] IS NULL OR ((([ScopeKind]=N''OWNER'' AND DATALENGTH([ScopeKind])=(10)) OR ([ScopeKind]=N''REVIEWER'' AND DATALENGTH([ScopeKind])=(16))))))) THEN (1) ELSE (0) END=(1))|0|0|0|0|0|0'),
    (N'CHECK',N'DatasetSecurityDecision',N'CK_DatasetSecurityDecision_Action',N'(CASE WHEN ((([Kind]=N''SNAPSHOT'' AND [Action] IN (N''COLLECT_METADATA'',N''INVALIDATE'')) OR ([Kind]=N''SCOPE'' AND [Action] IN (N''GRANT_SCOPE'',N''REVOKE_SCOPE'')) OR ([Kind]=N''CONFIRMATION'' AND [Action] IN (N''CONFIRM'',N''REJECT'',N''REVOKE'',N''INVALIDATE''))) AND ((([Action]=N''COLLECT_METADATA'' AND DATALENGTH([Action])=(32)) OR ([Action]=N''GRANT_SCOPE'' AND DATALENGTH([Action])=(22)) OR ([Action]=N''REVOKE_SCOPE'' AND DATALENGTH([Action])=(24)) OR ([Action]=N''CONFIRM'' AND DATALENGTH([Action])=(14)) OR ([Action]=N''REJECT'' AND DATALENGTH([Action])=(12)) OR ([Action]=N''REVOKE'' AND DATALENGTH([Action])=(12)) OR ([Action]=N''INVALIDATE'' AND DATALENGTH([Action])=(20))))) THEN (1) ELSE (0) END=(1))|0|0|0|0|0|0'),
    (N'CHECK',N'DatasetSecurityDecision',N'CK_DatasetSecurityDecision_Reason',N'(CASE WHEN ((([ReasonCode]=N''METADATA_COLLECTED'' AND DATALENGTH([ReasonCode])=(36)) OR ([ReasonCode]=N''OWNER_APPOINTED'' AND DATALENGTH([ReasonCode])=(30)) OR ([ReasonCode]=N''REVIEWER_APPOINTED'' AND DATALENGTH([ReasonCode])=(36)) OR ([ReasonCode]=N''SCOPE_REBOUND'' AND DATALENGTH([ReasonCode])=(26)) OR ([ReasonCode]=N''SCOPE_REVOKED'' AND DATALENGTH([ReasonCode])=(26)) OR ([ReasonCode]=N''CLASSIFICATION_ACCEPTED'' AND DATALENGTH([ReasonCode])=(46)) OR ([ReasonCode]=N''POLICY_REJECTED'' AND DATALENGTH([ReasonCode])=(30)) OR ([ReasonCode]=N''AUTHORIZATION_REVOKED'' AND DATALENGTH([ReasonCode])=(42)) OR ([ReasonCode]=N''EVIDENCE_CHANGED'' AND DATALENGTH([ReasonCode])=(32)))) THEN (1) ELSE (0) END=(1))|0|0|0|0|0|0'),
    (N'CHECK',N'DatasetSecurityDecision',N'CK_DatasetSecurityDecision_States',N'(CASE WHEN (([Kind]=N''SNAPSHOT'' AND (([PreviousState]=N''MISSING'' AND DATALENGTH([PreviousState])=(14)) OR ([PreviousState]=N''DESCRIBED'' AND DATALENGTH([PreviousState])=(18)) OR ([PreviousState]=N''SOURCE_BOUND'' AND DATALENGTH([PreviousState])=(24)) OR ([PreviousState]=N''INVALIDATED'' AND DATALENGTH([PreviousState])=(22)) OR ([PreviousState]=N''EXPIRED'' AND DATALENGTH([PreviousState])=(14))) AND (([NextState]=N''DESCRIBED'' AND DATALENGTH([NextState])=(18)) OR ([NextState]=N''SOURCE_BOUND'' AND DATALENGTH([NextState])=(24)) OR ([NextState]=N''INVALIDATED'' AND DATALENGTH([NextState])=(22)) OR ([NextState]=N''EXPIRED'' AND DATALENGTH([NextState])=(14)))) OR ([Kind]=N''SCOPE'' AND (([PreviousState]=N''MISSING'' AND DATALENGTH([PreviousState])=(14)) OR ([PreviousState]=N''ACTIVE'' AND DATALENGTH([PreviousState])=(12)) OR ([PreviousState]=N''REVOKED'' AND DATALENGTH([PreviousState])=(14))) AND (([NextState]=N''ACTIVE'' AND DATALENGTH([NextState])=(12)) OR ([NextState]=N''REVOKED'' AND DATALENGTH([NextState])=(14)))) OR ([Kind]=N''CONFIRMATION'' AND (([PreviousState]=N''MISSING'' AND DATALENGTH([PreviousState])=(14)) OR ([PreviousState]=N''PENDING'' AND DATALENGTH([PreviousState])=(14)) OR ([PreviousState]=N''ACTIVE'' AND DATALENGTH([PreviousState])=(12)) OR ([PreviousState]=N''REJECTED'' AND DATALENGTH([PreviousState])=(16)) OR ([PreviousState]=N''REVOKED'' AND DATALENGTH([PreviousState])=(14)) OR ([PreviousState]=N''INVALIDATED'' AND DATALENGTH([PreviousState])=(22))) AND (([NextState]=N''PENDING'' AND DATALENGTH([NextState])=(14)) OR ([NextState]=N''ACTIVE'' AND DATALENGTH([NextState])=(12)) OR ([NextState]=N''REJECTED'' AND DATALENGTH([NextState])=(16)) OR ([NextState]=N''REVOKED'' AND DATALENGTH([NextState])=(14)) OR ([NextState]=N''INVALIDATED'' AND DATALENGTH([NextState])=(22))))) THEN (1) ELSE (0) END=(1))|0|0|0|0|0|0'),
    (N'CHECK',N'DatasetSecurityDecision',N'CK_DatasetSecurityDecision_Versions',N'(CASE WHEN ((([PreviousState]=N''MISSING'' AND [PreviousStateVersion] IS NULL) OR ([PreviousState]<>N''MISSING'' AND [PreviousStateVersion] IS NOT NULL)) AND ([PreviousStateVersion] IS NULL OR ([PreviousStateVersion]<>0x0000000000000000)) AND ([NextStateVersion] IS NULL OR ([NextStateVersion]<>0x0000000000000000))) THEN (1) ELSE (0) END=(1))|0|0|0|0|0|0'),
    (N'CHECK',N'DatasetSecurityDecision',N'CK_DatasetSecurityDecision_Json',N'(CASE WHEN (ISJSON([AuthorizationEvidenceJson])=(1) AND DATALENGTH([AuthorizationEvidenceJson])<=(16384) AND ISJSON([DetailsJson])=(1) AND DATALENGTH([DetailsJson])<=(16384)) THEN (1) ELSE (0) END=(1))|0|0|0|0|0|0'),
    (N'FK',N'DatasetSecurityDecision',N'FK_DatasetSecurityDecision_Dataset',N'DatasetId|uqp.Dataset|Id|0|0|0|0|0|0'),
    (N'FK',N'DatasetSecurityDecision',N'FK_DatasetSecurityDecision_Snapshot',N'DatasetId,SnapshotId|uqp.DatasetFieldSnapshot|DatasetId,Id|0|0|0|0|0|0'),
    (N'FK',N'DatasetSecurityDecision',N'FK_DatasetSecurityDecision_Scope',N'DatasetId,SubjectUserId,ScopeKind|uqp.DatasetSecurityScope|DatasetId,UserId,ScopeKind|0|0|0|0|0|0'),
    (N'OBJECT',N'uqp',N'DatasetSecurityConfirmation',N'U|0'),
    (N'TABLE',N'DatasetSecurityConfirmation',N'DatasetSecurityConfirmation',N'0|0|0|0|0|0'),
    (N'ROWVERSION_COUNT',N'DatasetSecurityConfirmation',N'DatasetSecurityConfirmation',N'1'),
    (N'COLUMN',N'DatasetSecurityConfirmation',N'DatasetId',N'1|bigint|8|19|0|0|NULL|0|NULL|NULL|0|0|0|0|0|0|0|0'),
    (N'COLUMN',N'DatasetSecurityConfirmation',N'SnapshotId',N'2|bigint|8|19|0|0|NULL|0|NULL|NULL|0|0|0|0|0|0|0|0'),
    (N'COLUMN',N'DatasetSecurityConfirmation',N'State',N'3|nvarchar|32|0|0|0|Latin1_General_100_BIN2|0|NULL|NULL|0|0|0|0|0|0|0|0'),
    (N'DEFAULT',N'DatasetSecurityConfirmation',N'DF_DatasetSecurityConfirmation_State',N'State|(N''PENDING'')|0'),
    (N'COLUMN',N'DatasetSecurityConfirmation',N'StateRowVersion',N'4|timestamp|8|0|0|0|NULL|0|NULL|NULL|0|0|0|0|0|0|0|0'),
    (N'COLUMN',N'DatasetSecurityConfirmation',N'DecisionId',N'5|bigint|8|19|0|0|NULL|0|NULL|NULL|0|0|0|0|0|0|0|0'),
    (N'COLUMN',N'DatasetSecurityConfirmation',N'Classification',N'6|nvarchar|48|0|0|1|Latin1_General_100_BIN2|0|NULL|NULL|0|0|0|0|0|0|0|0'),
    (N'COLUMN',N'DatasetSecurityConfirmation',N'SensitivityVersion',N'7|bigint|8|19|0|1|NULL|0|NULL|NULL|0|0|0|0|0|0|0|0'),
    (N'COLUMN',N'DatasetSecurityConfirmation',N'PolicyDigest',N'8|binary|32|0|0|1|NULL|0|NULL|NULL|0|0|0|0|0|0|0|0'),
    (N'COLUMN',N'DatasetSecurityConfirmation',N'PatientConfigurationVersion',N'9|bigint|8|19|0|1|NULL|0|NULL|NULL|0|0|0|0|0|0|0|0'),
    (N'COLUMN',N'DatasetSecurityConfirmation',N'PatientKeyAlias',N'10|nvarchar|256|0|0|1|Latin1_General_100_BIN2|0|NULL|NULL|0|0|0|0|0|0|0|0'),
    (N'COLUMN',N'DatasetSecurityConfirmation',N'ReviewerId',N'11|bigint|8|19|0|1|NULL|0|NULL|NULL|0|0|0|0|0|0|0|0'),
    (N'COLUMN',N'DatasetSecurityConfirmation',N'OwnerUserId',N'12|bigint|8|19|0|1|NULL|0|NULL|NULL|0|0|0|0|0|0|0|0'),
    (N'COLUMN',N'DatasetSecurityConfirmation',N'ApproverScopeKind',N'13|nvarchar|16|0|0|1|Latin1_General_100_BIN2|0|NULL|NULL|0|0|0|0|0|0|0|0'),
    (N'COLUMN',N'DatasetSecurityConfirmation',N'ReviewerTokenVersion',N'14|bigint|8|19|0|1|NULL|0|NULL|NULL|0|0|0|0|0|0|0|0'),
    (N'COLUMN',N'DatasetSecurityConfirmation',N'OwnerTokenVersion',N'15|bigint|8|19|0|1|NULL|0|NULL|NULL|0|0|0|0|0|0|0|0'),
    (N'COLUMN',N'DatasetSecurityConfirmation',N'ActorScopeEpoch',N'16|binary|8|0|0|1|NULL|0|NULL|NULL|0|0|0|0|0|0|0|0'),
    (N'COLUMN',N'DatasetSecurityConfirmation',N'OwnerScopeEpoch',N'17|binary|8|0|0|1|NULL|0|NULL|NULL|0|0|0|0|0|0|0|0'),
    (N'COLUMN',N'DatasetSecurityConfirmation',N'AuthorizationModelVersion',N'18|nvarchar|64|0|0|0|Latin1_General_100_BIN2|0|NULL|NULL|0|0|0|0|0|0|0|0'),
    (N'COLUMN',N'DatasetSecurityConfirmation',N'PlatformIncarnation',N'19|uniqueidentifier|16|0|0|0|NULL|0|NULL|NULL|0|0|0|0|0|0|0|0'),
    (N'INDEX',N'DatasetSecurityConfirmation',N'PK_DatasetSecurityConfirmation',N'1|1|0|0|0|1|0|DatasetId:ASC||NULL|0|1|1|0'),
    (N'KEY',N'DatasetSecurityConfirmation',N'PK_DatasetSecurityConfirmation',N'PK|PK_DatasetSecurityConfirmation|0'),
    (N'INDEX',N'DatasetSecurityConfirmation',N'IX_SecurityConfirmation_Snapshot',N'2|0|0|0|0|0|0|SnapshotId:ASC,DatasetId:ASC||NULL|0|1|1|0'),
    (N'CHECK',N'DatasetSecurityConfirmation',N'CK_DatasetSecurityConfirmation_Ids',N'(CASE WHEN (([DatasetId] IS NULL OR ([DatasetId]>(0))) AND ([SnapshotId] IS NULL OR ([SnapshotId]>(0))) AND ([DecisionId] IS NULL OR ([DecisionId]>(0))) AND ([SensitivityVersion] IS NULL OR ([SensitivityVersion]>(0))) AND ([PatientConfigurationVersion] IS NULL OR ([PatientConfigurationVersion]>(0))) AND ([ReviewerId] IS NULL OR ([ReviewerId]>(0))) AND ([OwnerUserId] IS NULL OR ([OwnerUserId]>(0))) AND ([ReviewerTokenVersion] IS NULL OR ([ReviewerTokenVersion]>(0))) AND ([OwnerTokenVersion] IS NULL OR ([OwnerTokenVersion]>(0)))) THEN (1) ELSE (0) END=(1))|0|0|0|0|0|0'),
    (N'CHECK',N'DatasetSecurityConfirmation',N'CK_DatasetSecurityConfirmation_Epochs',N'(CASE WHEN (([ActorScopeEpoch] IS NULL OR ([ActorScopeEpoch]<>0x0000000000000000)) AND ([OwnerScopeEpoch] IS NULL OR ([OwnerScopeEpoch]<>0x0000000000000000))) THEN (1) ELSE (0) END=(1))|0|0|0|0|0|0'),
    (N'CHECK',N'DatasetSecurityConfirmation',N'CK_DatasetSecurityConfirmation_State',N'(CASE WHEN ((([State]=N''PENDING'' AND DATALENGTH([State])=(14)) OR ([State]=N''ACTIVE'' AND DATALENGTH([State])=(12)) OR ([State]=N''REJECTED'' AND DATALENGTH([State])=(16)) OR ([State]=N''REVOKED'' AND DATALENGTH([State])=(14)) OR ([State]=N''INVALIDATED'' AND DATALENGTH([State])=(22)))) THEN (1) ELSE (0) END=(1))|0|0|0|0|0|0'),
    (N'CHECK',N'DatasetSecurityConfirmation',N'CK_DatasetSecurityConfirmation_Classification',N'(CASE WHEN (([Classification] IS NULL OR ((([Classification]=N''NON_PATIENT_PUBLIC'' AND DATALENGTH([Classification])=(36)) OR ([Classification]=N''NON_PATIENT_SENSITIVE'' AND DATALENGTH([Classification])=(42)) OR ([Classification]=N''PATIENT'' AND DATALENGTH([Classification])=(14)))))) THEN (1) ELSE (0) END=(1))|0|0|0|0|0|0'),
    (N'CHECK',N'DatasetSecurityConfirmation',N'CK_DatasetSecurityConfirmation_ScopeKind',N'(CASE WHEN (([ApproverScopeKind] IS NULL OR ((([ApproverScopeKind]=N''OWNER'' AND DATALENGTH([ApproverScopeKind])=(10)) OR ([ApproverScopeKind]=N''REVIEWER'' AND DATALENGTH([ApproverScopeKind])=(16)))))) THEN (1) ELSE (0) END=(1))|0|0|0|0|0|0'),
    (N'CHECK',N'DatasetSecurityConfirmation',N'CK_DatasetSecurityConfirmation_AuthorizationModel',N'(CASE WHEN ((([AuthorizationModelVersion]=N''DATASET_SCOPE_AUTH_V1'' AND DATALENGTH([AuthorizationModelVersion])=(42)))) THEN (1) ELSE (0) END=(1))|0|0|0|0|0|0'),
    (N'CHECK',N'DatasetSecurityConfirmation',N'CK_DatasetSecurityConfirmation_Active',N'(CASE WHEN ([State]<>N''ACTIVE'' OR ([Classification] IS NOT NULL AND [SensitivityVersion] IS NOT NULL AND [PolicyDigest] IS NOT NULL AND [ReviewerId] IS NOT NULL AND [OwnerUserId] IS NOT NULL AND [ApproverScopeKind] IS NOT NULL AND [ReviewerTokenVersion] IS NOT NULL AND [OwnerTokenVersion] IS NOT NULL AND [ActorScopeEpoch] IS NOT NULL AND [OwnerScopeEpoch] IS NOT NULL AND (([ApproverScopeKind]=N''OWNER'' AND [ReviewerId]=[OwnerUserId] AND [ReviewerTokenVersion]=[OwnerTokenVersion] AND [ActorScopeEpoch]=[OwnerScopeEpoch]) OR ([ApproverScopeKind]=N''REVIEWER'' AND [ReviewerId]<>[OwnerUserId])) AND (([Classification]=N''PATIENT'' AND [PatientConfigurationVersion] IS NOT NULL AND [PatientKeyAlias] IS NOT NULL AND DATALENGTH([PatientKeyAlias])>(0)) OR ([Classification] IN (N''NON_PATIENT_PUBLIC'',N''NON_PATIENT_SENSITIVE'') AND [PatientConfigurationVersion] IS NULL AND [PatientKeyAlias] IS NULL)))) THEN (1) ELSE (0) END=(1))|0|0|0|0|0|0'),
    (N'FK',N'DatasetSecurityConfirmation',N'FK_DatasetSecurityConfirmation_Snapshot',N'DatasetId,SnapshotId|uqp.DatasetFieldSnapshot|DatasetId,Id|0|0|0|0|0|0')
  ) v(category,owner,name,signature)
), ConstraintOwners(name,table_name) AS (SELECT v.name,v.table_name FROM (VALUES
    (N'CK_DatasetFieldSnapshot_Ids',N'DatasetFieldSnapshot'),
    (N'CK_DatasetFieldSnapshot_Versions',N'DatasetFieldSnapshot'),
    (N'CK_DatasetFieldSnapshot_State',N'DatasetFieldSnapshot'),
    (N'CK_DatasetFieldSnapshot_ParameterMode',N'DatasetFieldSnapshot'),
    (N'CK_DatasetFieldSnapshot_Expiry',N'DatasetFieldSnapshot'),
    (N'CK_DatasetFieldSnapshot_Json',N'DatasetFieldSnapshot'),
    (N'CK_DatasetFieldSnapshot_SourceBound',N'DatasetFieldSnapshot'),
    (N'FK_DatasetFieldSnapshot_Dataset',N'DatasetFieldSnapshot'),
    (N'FK_DatasetFieldSnapshot_DataSource',N'DatasetFieldSnapshot'),
    (N'PK_DatasetFieldSnapshot',N'DatasetFieldSnapshot'),
    (N'UQ_DatasetFieldSnapshot_DatasetId_Id',N'DatasetFieldSnapshot'),
    (N'DF_DatasetFieldSnapshot_State',N'DatasetFieldSnapshot'),
    (N'CK_DatasetSecurityScope_Ids',N'DatasetSecurityScope'),
    (N'CK_DatasetSecurityScope_State',N'DatasetSecurityScope'),
    (N'CK_DatasetSecurityScope_Parent',N'DatasetSecurityScope'),
    (N'FK_DatasetSecurityScope_Dataset',N'DatasetSecurityScope'),
    (N'FK_DatasetSecurityScope_User',N'DatasetSecurityScope'),
    (N'FK_DatasetSecurityScope_DataSource',N'DatasetSecurityScope'),
    (N'FK_DatasetSecurityScope_ParentOwner',N'DatasetSecurityScope'),
    (N'PK_DatasetSecurityScope',N'DatasetSecurityScope'),
    (N'UQ_DatasetSecurityScope_LastRequestId',N'DatasetSecurityScope'),
    (N'DF_DatasetSecurityScope_State',N'DatasetSecurityScope'),
    (N'CK_DatasetSecurityDecision_Ids',N'DatasetSecurityDecision'),
    (N'CK_DatasetSecurityDecision_Shape',N'DatasetSecurityDecision'),
    (N'CK_DatasetSecurityDecision_Action',N'DatasetSecurityDecision'),
    (N'CK_DatasetSecurityDecision_Reason',N'DatasetSecurityDecision'),
    (N'CK_DatasetSecurityDecision_States',N'DatasetSecurityDecision'),
    (N'CK_DatasetSecurityDecision_Versions',N'DatasetSecurityDecision'),
    (N'CK_DatasetSecurityDecision_Json',N'DatasetSecurityDecision'),
    (N'FK_DatasetSecurityDecision_Dataset',N'DatasetSecurityDecision'),
    (N'FK_DatasetSecurityDecision_Snapshot',N'DatasetSecurityDecision'),
    (N'FK_DatasetSecurityDecision_Scope',N'DatasetSecurityDecision'),
    (N'PK_DatasetSecurityDecision',N'DatasetSecurityDecision'),
    (N'UQ_DatasetSecurityDecision_RequestId',N'DatasetSecurityDecision'),
    (N'DF_DatasetSecurityDecision_Id',N'DatasetSecurityDecision'),
    (N'CK_DatasetSecurityConfirmation_Ids',N'DatasetSecurityConfirmation'),
    (N'CK_DatasetSecurityConfirmation_Epochs',N'DatasetSecurityConfirmation'),
    (N'CK_DatasetSecurityConfirmation_State',N'DatasetSecurityConfirmation'),
    (N'CK_DatasetSecurityConfirmation_Classification',N'DatasetSecurityConfirmation'),
    (N'CK_DatasetSecurityConfirmation_ScopeKind',N'DatasetSecurityConfirmation'),
    (N'CK_DatasetSecurityConfirmation_AuthorizationModel',N'DatasetSecurityConfirmation'),
    (N'CK_DatasetSecurityConfirmation_Active',N'DatasetSecurityConfirmation'),
    (N'FK_DatasetSecurityConfirmation_Snapshot',N'DatasetSecurityConfirmation'),
    (N'PK_DatasetSecurityConfirmation',N'DatasetSecurityConfirmation'),
    (N'DF_DatasetSecurityConfirmation_State',N'DatasetSecurityConfirmation')
  ) v(name,table_name)), Targets AS (
  SELECT o.* FROM sys.objects o JOIN sys.schemas s ON s.schema_id=o.schema_id
  WHERE s.name=N'uqp' AND o.name IN (N'DatasetFieldSnapshot',N'DatasetSecurityScope',N'DatasetSecurityDecision',N'DatasetSecurityConfirmation',N'DatasetSecurityDecisionSeq')
), Tables AS (SELECT t.* FROM sys.tables t JOIN Targets o ON o.object_id=t.object_id),
ActualRaw(category,owner,name,signature) AS (
  SELECT N'OBJECT',OBJECT_SCHEMA_NAME(o.object_id),o.name,CONVERT(nvarchar(max),CONCAT(RTRIM(o.type),N'|',o.is_ms_shipped)) FROM Targets o
  UNION ALL
  SELECT N'TABLE',t.name,t.name,CONCAT(t.temporal_type,N'|',t.is_memory_optimized,N'|',t.is_filetable,N'|',t.is_tracked_by_cdc,N'|',t.is_replicated,N'|',1-t.uses_ansi_nulls) FROM Tables t
  UNION ALL
  SELECT N'COLUMN',t.name,c.name,CONCAT(c.column_id,N'|',ty.name,N'|',c.max_length,N'|',c.precision,N'|',c.scale,N'|',c.is_nullable,N'|',COALESCE(c.collation_name,N'NULL'),N'|',c.is_identity,N'|',COALESCE(CONVERT(varchar(40),ic.seed_value),N'NULL'),N'|',COALESCE(CONVERT(varchar(40),ic.increment_value),N'NULL'),N'|',COALESCE(ic.is_not_for_replication,0),N'|',c.is_computed,N'|',c.is_rowguidcol,N'|',c.is_sparse,N'|',c.is_column_set,N'|',c.generated_always_type,N'|',c.is_hidden,N'|',CASE WHEN c.user_type_id=c.system_type_id AND c.encryption_type IS NULL AND COALESCE(mc.is_masked,0)=0 AND c.rule_object_id=0 AND (c.default_object_id=0 OR EXISTS (SELECT 1 FROM sys.default_constraints dc WHERE dc.object_id=c.default_object_id)) THEN 0 ELSE 1 END)
  FROM Tables t JOIN sys.columns c ON c.object_id=t.object_id JOIN sys.types ty ON ty.user_type_id=c.user_type_id
  LEFT JOIN sys.masked_columns mc ON mc.object_id=c.object_id AND mc.column_id=c.column_id
  LEFT JOIN sys.identity_columns ic ON ic.object_id=c.object_id AND ic.column_id=c.column_id
  UNION ALL
  SELECT N'ROWVERSION_COUNT',t.name,t.name,CONVERT(nvarchar(max),(SELECT COUNT_BIG(*) FROM sys.columns c WHERE c.object_id=t.object_id AND c.system_type_id=189)) FROM Tables t
  UNION ALL
  SELECT N'DEFAULT',t.name,d.name,CONCAT(c.name,N'|',d.definition,N'|',d.is_system_named) FROM Tables t JOIN sys.default_constraints d ON d.parent_object_id=t.object_id JOIN sys.columns c ON c.object_id=t.object_id AND c.column_id=d.parent_column_id
  UNION ALL
  SELECT N'CHECK',t.name,c.name,CONCAT(c.definition,N'|',c.is_disabled,N'|',c.is_not_trusted,N'|',c.is_not_for_replication,N'|',c.parent_column_id,N'|',c.is_system_named,N'|',c.uses_database_collation) FROM Tables t JOIN sys.check_constraints c ON c.parent_object_id=t.object_id
  UNION ALL
  SELECT N'KEY',t.name,k.name,CONCAT(k.type,N'|',i.name,N'|',k.is_system_named) FROM Tables t JOIN sys.key_constraints k ON k.parent_object_id=t.object_id JOIN sys.indexes i ON i.object_id=t.object_id AND i.index_id=k.unique_index_id
  UNION ALL
  SELECT N'INDEX',t.name,i.name,CONCAT(i.type,N'|',i.is_unique,N'|',i.is_disabled,N'|',i.is_hypothetical,N'|',i.ignore_dup_key,N'|',i.is_primary_key,N'|',i.is_unique_constraint,N'|',
    (SELECT STRING_AGG(CONVERT(nvarchar(max),CONCAT(c.name,CASE WHEN ic.is_descending_key=1 THEN N':DESC' ELSE N':ASC' END)),N',') WITHIN GROUP (ORDER BY ic.key_ordinal) FROM sys.index_columns ic JOIN sys.columns c ON c.object_id=ic.object_id AND c.column_id=ic.column_id WHERE ic.object_id=i.object_id AND ic.index_id=i.index_id AND ic.key_ordinal>0),N'|',
    (SELECT STRING_AGG(CONVERT(nvarchar(max),c.name),N',') WITHIN GROUP (ORDER BY ic.index_column_id) FROM sys.index_columns ic JOIN sys.columns c ON c.object_id=ic.object_id AND c.column_id=ic.column_id WHERE ic.object_id=i.object_id AND ic.index_id=i.index_id AND ic.is_included_column=1),N'|',COALESCE(i.filter_definition,N'NULL'),N'|',i.fill_factor,N'|',i.allow_row_locks,N'|',i.allow_page_locks,N'|',i.is_padded)
  FROM Tables t JOIN sys.indexes i ON i.object_id=t.object_id
  UNION ALL
  SELECT N'FK',OBJECT_NAME(f.parent_object_id),f.name,CONCAT(
    (SELECT STRING_AGG(CONVERT(nvarchar(max),COL_NAME(fc.parent_object_id,fc.parent_column_id)),N',') WITHIN GROUP (ORDER BY fc.constraint_column_id) FROM sys.foreign_key_columns fc WHERE fc.constraint_object_id=f.object_id),N'|',OBJECT_SCHEMA_NAME(f.referenced_object_id),N'.',OBJECT_NAME(f.referenced_object_id),N'|',
    (SELECT STRING_AGG(CONVERT(nvarchar(max),COL_NAME(fc.referenced_object_id,fc.referenced_column_id)),N',') WITHIN GROUP (ORDER BY fc.constraint_column_id) FROM sys.foreign_key_columns fc WHERE fc.constraint_object_id=f.object_id),N'|',f.delete_referential_action,N'|',f.update_referential_action,N'|',f.is_disabled,N'|',f.is_not_trusted,N'|',f.is_not_for_replication,N'|',f.is_system_named)
  FROM sys.foreign_keys f WHERE f.parent_object_id IN (SELECT object_id FROM Tables) OR f.referenced_object_id IN (SELECT object_id FROM Tables)
  UNION ALL
  SELECT N'TRIGGER',t.name,tr.name,CONVERT(nvarchar(max),tr.type) FROM Tables t JOIN sys.triggers tr ON tr.parent_id=t.object_id
  UNION ALL
  SELECT N'NAME_COLLISION',OBJECT_SCHEMA_NAME(o.object_id),o.name,CONVERT(nvarchar(max),o.type)
  FROM sys.objects o JOIN sys.schemas s ON s.schema_id=o.schema_id JOIN ConstraintOwners e ON o.name=e.name
  WHERE s.name=N'uqp' AND (OBJECT_NAME(o.parent_object_id) COLLATE Latin1_General_100_BIN2<>e.table_name COLLATE Latin1_General_100_BIN2 OR o.parent_object_id=0)
  UNION ALL
  SELECT N'UNKNOWN_CHILD',o.name,ch.name,CONVERT(nvarchar(max),ch.type) FROM Targets o JOIN sys.objects ch ON ch.parent_object_id=o.object_id WHERE ch.type NOT IN (N'PK',N'UQ',N'F',N'C',N'D',N'TR',N'TA')
  UNION ALL
  SELECT N'SEQUENCE',N'uqp',s.name,CONCAT(ty.name,N'|',ty.max_length,N'|',s.precision,N'|',s.scale,N'|',CONVERT(varchar(40),s.start_value),N'|',CONVERT(varchar(40),s.increment),N'|',CONVERT(varchar(40),s.minimum_value),N'|',CONVERT(varchar(40),s.maximum_value),N'|',s.is_cycling,N'|',s.is_cached,N'|',COALESCE(CONVERT(varchar(40),s.cache_size),N'NULL'),N'|',CASE WHEN s.system_type_id=s.user_type_id THEN 0 ELSE 1 END)
  FROM sys.sequences s JOIN Targets o ON o.object_id=s.object_id JOIN sys.types ty ON ty.user_type_id=s.user_type_id
), Actual AS (
  SELECT CONVERT(nvarchar(32),category) COLLATE Latin1_General_100_BIN2 category, CONVERT(nvarchar(128),owner) COLLATE Latin1_General_100_BIN2 owner,
         CONVERT(nvarchar(128),name) COLLATE Latin1_General_100_BIN2 name, CONVERT(nvarchar(max),signature) COLLATE Latin1_General_100_BIN2 signature FROM ActualRaw
), ComparedExpected AS (SELECT *,DATALENGTH(category) l1,DATALENGTH(owner) l2,DATALENGTH(name) l3,DATALENGTH(signature) l4 FROM Expected),
ComparedActual AS (SELECT *,DATALENGTH(category) l1,DATALENGTH(owner) l2,DATALENGTH(name) l3,DATALENGTH(signature) l4 FROM Actual),
Missing AS (SELECT * FROM ComparedExpected EXCEPT SELECT * FROM ComparedActual),
Unexpected AS (SELECT * FROM ComparedActual EXCEPT SELECT * FROM ComparedExpected),
Visibility AS (
  SELECT CASE WHEN HAS_PERMS_BY_NAME(DB_NAME(),N'DATABASE',N'VIEW DEFINITION')=1
    AND USER_ID()=1 -- conservative full visibility, including potentially hidden inbound FKs/name collisions
    AND CONVERT(varchar(8),SERVERPROPERTY(N'ProductMajorVersion'))='15'
    AND (SELECT compatibility_level FROM sys.databases WHERE database_id=DB_ID())=150 THEN 1 ELSE 0 END ok
)
SELECT CASE WHEN v.ok<>1 THEN N'REJECTED_UNKNOWN'
  WHEN NOT EXISTS (SELECT 1 FROM Actual) THEN N'NOT_INSTALLED'
  WHEN EXISTS (SELECT 1 FROM Missing) OR EXISTS (SELECT 1 FROM Unexpected)
    OR EXISTS (SELECT 1 FROM Actual GROUP BY category,owner,name,signature HAVING COUNT_BIG(*)>1) THEN N'REJECTED_PARTIAL_OR_DIFFERENT'
  ELSE N'EXACT_MATCH' END CatalogStatus,
  (SELECT COUNT_BIG(*) FROM Missing) MissingDefinitionCount, (SELECT COUNT_BIG(*) FROM Unexpected) UnexpectedDefinitionCount,
  N'NONE' authority, CONVERT(bit,0) runtimeBindVerified, CONVERT(bit,0) deliveryAllowed,
  N'NOT_PROVEN' persistence, CONVERT(bit,0) productionSafetyProven
FROM Visibility v;
