-- OFFLINE DRAFT ONLY: not an installed/registered Migration. No authority or delivery grants.

-- Requires separately approved owned transaction + XACT_ABORT, exact preflight, backup and permissions review.

-- Append-only is NOT established: future app principal must lack direct DML/ALTER and sequence-restart rights; only reviewed modules may write.

-- No role, permission seed, grant, scope assignment or trusted issuer is installed by this draft.

-- Do not run through db:migrate. Partial/existing schemas must be rejected by the validator; no repair/adopt.

CREATE SEQUENCE [uqp].[DatasetSecurityDecisionSeq] AS BIGINT START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 NO CYCLE NO CACHE;

CREATE TABLE [uqp].[DatasetFieldSnapshot] (
  [Id] BIGINT IDENTITY(1,1) NOT NULL,
  [DatasetId] BIGINT NOT NULL,
  [DataSourceId] BIGINT NOT NULL,
  [PlatformIncarnation] UNIQUEIDENTIFIER NOT NULL,
  [DefinitionVersion] BINARY(8) NOT NULL,
  [ConfigurationVersion] BINARY(8) NOT NULL,
  [BaseContractVersion] BINARY(8) NULL,
  [SqlDigest] BINARY(32) NOT NULL,
  [ParameterDigest] BINARY(32) NOT NULL,
  [NativeTypesDigest] BINARY(32) NOT NULL,
  [ColumnsDigest] BINARY(32) NOT NULL,
  [ColumnsJson] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [NativeBindingsJson] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [ParameterMode] NVARCHAR(16) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [CollectorVersion] NVARCHAR(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [CodecVersion] NVARCHAR(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [PlanVersion] NVARCHAR(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [DriverVersion] NVARCHAR(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [CollectedAt] DATETIME2(7) NOT NULL,
  [ExpiresAt] DATETIME2(7) NOT NULL,
  [State] NVARCHAR(16) COLLATE Latin1_General_100_BIN2 NOT NULL CONSTRAINT [DF_DatasetFieldSnapshot_State] DEFAULT (N'DESCRIBED'),
  [StateRowVersion] ROWVERSION NOT NULL,
  [SourceIdentity] UNIQUEIDENTIFIER NULL,
  [SourceIncarnation] UNIQUEIDENTIFIER NULL,
  [LeaseId] UNIQUEIDENTIFIER NULL,
  [SourceGeneration] BIGINT NULL,
  [LeaseVersion] BIGINT NULL,
  [SourceCollation] NVARCHAR(128) COLLATE Latin1_General_100_BIN2 NULL,
  [CollectorEvidenceDigest] BINARY(32) NULL,
  [SourceEvidenceJson] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL,
  CONSTRAINT [PK_DatasetFieldSnapshot] PRIMARY KEY CLUSTERED ([Id] ASC),
  CONSTRAINT [UQ_DatasetFieldSnapshot_DatasetId_Id] UNIQUE NONCLUSTERED ([DatasetId] ASC,[Id] ASC),
  CONSTRAINT [CK_DatasetFieldSnapshot_Ids] CHECK (CASE WHEN (([Id] IS NULL OR ([Id]>(0))) AND ([DatasetId] IS NULL OR ([DatasetId]>(0))) AND ([DataSourceId] IS NULL OR ([DataSourceId]>(0))) AND ([SourceGeneration] IS NULL OR ([SourceGeneration]>(0))) AND ([LeaseVersion] IS NULL OR ([LeaseVersion]>(0)))) THEN (1) ELSE (0) END=(1)),
  CONSTRAINT [CK_DatasetFieldSnapshot_Versions] CHECK (CASE WHEN (([DefinitionVersion] IS NULL OR ([DefinitionVersion]<>0x0000000000000000)) AND ([ConfigurationVersion] IS NULL OR ([ConfigurationVersion]<>0x0000000000000000)) AND ([BaseContractVersion] IS NULL OR ([BaseContractVersion]<>0x0000000000000000))) THEN (1) ELSE (0) END=(1)),
  CONSTRAINT [CK_DatasetFieldSnapshot_State] CHECK (CASE WHEN ((([State]=N'DESCRIBED' AND DATALENGTH([State])=(18)) OR ([State]=N'SOURCE_BOUND' AND DATALENGTH([State])=(24)) OR ([State]=N'INVALIDATED' AND DATALENGTH([State])=(22)) OR ([State]=N'EXPIRED' AND DATALENGTH([State])=(14)))) THEN (1) ELSE (0) END=(1)),
  CONSTRAINT [CK_DatasetFieldSnapshot_ParameterMode] CHECK (CASE WHEN ((([ParameterMode]=N'NO_PARAMETERS' AND DATALENGTH([ParameterMode])=(26)) OR ([ParameterMode]=N'UNPROVEN' AND DATALENGTH([ParameterMode])=(16)))) THEN (1) ELSE (0) END=(1)),
  CONSTRAINT [CK_DatasetFieldSnapshot_Expiry] CHECK (CASE WHEN ([ExpiresAt]>[CollectedAt]) THEN (1) ELSE (0) END=(1)),
  CONSTRAINT [CK_DatasetFieldSnapshot_Json] CHECK (CASE WHEN (ISJSON([ColumnsJson])=(1) AND DATALENGTH([ColumnsJson])<=(1048576) AND ISJSON([NativeBindingsJson])=(1) AND DATALENGTH([NativeBindingsJson])<=(1048576) AND ([SourceEvidenceJson] IS NULL OR (ISJSON([SourceEvidenceJson])=(1) AND DATALENGTH([SourceEvidenceJson])<=(65536)))) THEN (1) ELSE (0) END=(1)),
  CONSTRAINT [CK_DatasetFieldSnapshot_SourceBound] CHECK (CASE WHEN ([State]<>N'SOURCE_BOUND' OR ([ParameterMode]=N'NO_PARAMETERS' AND [SourceIdentity] IS NOT NULL AND [SourceIncarnation] IS NOT NULL AND [LeaseId] IS NOT NULL AND [SourceGeneration] IS NOT NULL AND [LeaseVersion] IS NOT NULL AND [SourceCollation] IS NOT NULL AND [CollectorEvidenceDigest] IS NOT NULL AND [SourceEvidenceJson] IS NOT NULL)) THEN (1) ELSE (0) END=(1)),
  CONSTRAINT [FK_DatasetFieldSnapshot_Dataset] FOREIGN KEY ([DatasetId]) REFERENCES [uqp].[Dataset] ([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT [FK_DatasetFieldSnapshot_DataSource] FOREIGN KEY ([DataSourceId]) REFERENCES [uqp].[DataSource] ([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION
);

CREATE NONCLUSTERED INDEX [IX_FieldSnapshot_DatasetState] ON [uqp].[DatasetFieldSnapshot] ([DatasetId] ASC,[State] ASC,[Id] ASC) INCLUDE ([DefinitionVersion],[ConfigurationVersion],[ExpiresAt]);

CREATE NONCLUSTERED INDEX [IX_FieldSnapshot_Source] ON [uqp].[DatasetFieldSnapshot] ([DataSourceId] ASC,[DatasetId] ASC,[Id] ASC);

CREATE TABLE [uqp].[DatasetSecurityScope] (
  [DatasetId] BIGINT NOT NULL,
  [UserId] BIGINT NOT NULL,
  [ScopeKind] NVARCHAR(8) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [BoundDataSourceId] BIGINT NOT NULL,
  [State] NVARCHAR(8) COLLATE Latin1_General_100_BIN2 NOT NULL CONSTRAINT [DF_DatasetSecurityScope_State] DEFAULT (N'REVOKED'),
  [ParentOwnerUserId] BIGINT NULL,
  [ParentOwnerKind] NVARCHAR(8) COLLATE Latin1_General_100_BIN2 NULL,
  [ChangedByUserId] BIGINT NOT NULL,
  [LastRequestId] UNIQUEIDENTIFIER NOT NULL,
  [LastReasonCode] NVARCHAR(32) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [GrantedAt] DATETIME2(7) NOT NULL,
  [ChangedAt] DATETIME2(7) NOT NULL,
  [ScopeRowVersion] ROWVERSION NOT NULL,
  CONSTRAINT [PK_DatasetSecurityScope] PRIMARY KEY CLUSTERED ([DatasetId] ASC,[UserId] ASC,[ScopeKind] ASC),
  CONSTRAINT [UQ_DatasetSecurityScope_LastRequestId] UNIQUE NONCLUSTERED ([LastRequestId] ASC),
  CONSTRAINT [CK_DatasetSecurityScope_Ids] CHECK (CASE WHEN (([DatasetId] IS NULL OR ([DatasetId]>(0))) AND ([UserId] IS NULL OR ([UserId]>(0))) AND ([BoundDataSourceId] IS NULL OR ([BoundDataSourceId]>(0))) AND ([ChangedByUserId] IS NULL OR ([ChangedByUserId]>(0))) AND ([ParentOwnerUserId] IS NULL OR ([ParentOwnerUserId]>(0)))) THEN (1) ELSE (0) END=(1)),
  CONSTRAINT [CK_DatasetSecurityScope_State] CHECK (CASE WHEN ((([State]=N'ACTIVE' AND DATALENGTH([State])=(12)) OR ([State]=N'REVOKED' AND DATALENGTH([State])=(14)))) THEN (1) ELSE (0) END=(1)),
  CONSTRAINT [CK_DatasetSecurityScope_Parent] CHECK (CASE WHEN ((([ScopeKind]=N'OWNER' AND [ParentOwnerUserId] IS NULL AND [ParentOwnerKind] IS NULL) OR ([ScopeKind]=N'REVIEWER' AND [ParentOwnerUserId] IS NOT NULL AND [ParentOwnerKind] IS NOT NULL AND [ParentOwnerKind]=N'OWNER' AND [UserId]<>[ParentOwnerUserId])) AND ((([ScopeKind]=N'OWNER' AND DATALENGTH([ScopeKind])=(10)) OR ([ScopeKind]=N'REVIEWER' AND DATALENGTH([ScopeKind])=(16))) AND ([ParentOwnerKind] IS NULL OR ((([ParentOwnerKind]=N'OWNER' AND DATALENGTH([ParentOwnerKind])=(10))))))) THEN (1) ELSE (0) END=(1)),
  CONSTRAINT [FK_DatasetSecurityScope_Dataset] FOREIGN KEY ([DatasetId]) REFERENCES [uqp].[Dataset] ([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT [FK_DatasetSecurityScope_User] FOREIGN KEY ([UserId]) REFERENCES [uqp].[AppUser] ([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT [FK_DatasetSecurityScope_DataSource] FOREIGN KEY ([BoundDataSourceId]) REFERENCES [uqp].[DataSource] ([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT [FK_DatasetSecurityScope_ParentOwner] FOREIGN KEY ([DatasetId],[ParentOwnerUserId],[ParentOwnerKind]) REFERENCES [uqp].[DatasetSecurityScope] ([DatasetId],[UserId],[ScopeKind]) ON DELETE NO ACTION ON UPDATE NO ACTION
);

CREATE NONCLUSTERED INDEX [IX_SecurityScope_User] ON [uqp].[DatasetSecurityScope] ([UserId] ASC,[State] ASC,[DatasetId] ASC,[ScopeKind] ASC) INCLUDE ([BoundDataSourceId],[ParentOwnerUserId]);

CREATE NONCLUSTERED INDEX [IX_SecurityScope_Parent] ON [uqp].[DatasetSecurityScope] ([DatasetId] ASC,[ParentOwnerUserId] ASC,[ParentOwnerKind] ASC,[State] ASC,[UserId] ASC);

CREATE NONCLUSTERED INDEX [IX_SecurityScope_Source] ON [uqp].[DatasetSecurityScope] ([BoundDataSourceId] ASC,[DatasetId] ASC,[UserId] ASC,[ScopeKind] ASC);

CREATE TABLE [uqp].[DatasetSecurityDecision] (
  [Id] BIGINT NOT NULL CONSTRAINT [DF_DatasetSecurityDecision_Id] DEFAULT (NEXT VALUE FOR [uqp].[DatasetSecurityDecisionSeq]),
  [DatasetId] BIGINT NOT NULL,
  [Kind] NVARCHAR(16) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [SnapshotId] BIGINT NULL,
  [SubjectUserId] BIGINT NULL,
  [ScopeKind] NVARCHAR(8) COLLATE Latin1_General_100_BIN2 NULL,
  [RequestId] UNIQUEIDENTIFIER NOT NULL,
  [CommandDigest] BINARY(32) NOT NULL,
  [ActorId] BIGINT NOT NULL,
  [ActorTokenVersion] BIGINT NOT NULL,
  [Action] NVARCHAR(32) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [ReasonCode] NVARCHAR(32) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [PreviousState] NVARCHAR(16) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [NextState] NVARCHAR(16) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [PreviousStateVersion] BINARY(8) NULL,
  [NextStateVersion] BINARY(8) NOT NULL,
  [SnapshotDigest] BINARY(32) NULL,
  [PolicyDigest] BINARY(32) NULL,
  [SourceOperationEvidenceDigest] BINARY(32) NULL,
  [AuthorizationEvidenceJson] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [DetailsJson] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [AuditLogId] BIGINT NOT NULL,
  [TransactionReference] UNIQUEIDENTIFIER NOT NULL,
  [PlatformIncarnation] UNIQUEIDENTIFIER NOT NULL,
  [DecidedAt] DATETIME2(7) NOT NULL,
  CONSTRAINT [PK_DatasetSecurityDecision] PRIMARY KEY CLUSTERED ([Id] ASC),
  CONSTRAINT [UQ_DatasetSecurityDecision_RequestId] UNIQUE NONCLUSTERED ([RequestId] ASC),
  CONSTRAINT [CK_DatasetSecurityDecision_Ids] CHECK (CASE WHEN (([Id] IS NULL OR ([Id]>(0))) AND ([DatasetId] IS NULL OR ([DatasetId]>(0))) AND ([SnapshotId] IS NULL OR ([SnapshotId]>(0))) AND ([SubjectUserId] IS NULL OR ([SubjectUserId]>(0))) AND ([ActorId] IS NULL OR ([ActorId]>(0))) AND ([ActorTokenVersion] IS NULL OR ([ActorTokenVersion]>(0))) AND ([AuditLogId] IS NULL OR ([AuditLogId]>(0)))) THEN (1) ELSE (0) END=(1)),
  CONSTRAINT [CK_DatasetSecurityDecision_Shape] CHECK (CASE WHEN ((([Kind]=N'SCOPE' AND [SubjectUserId] IS NOT NULL AND [ScopeKind] IS NOT NULL AND [ScopeKind] IN (N'OWNER',N'REVIEWER') AND [SnapshotId] IS NULL) OR ([Kind] IN (N'SNAPSHOT',N'CONFIRMATION') AND [SubjectUserId] IS NULL AND [ScopeKind] IS NULL AND [SnapshotId] IS NOT NULL)) AND ((([Kind]=N'SNAPSHOT' AND DATALENGTH([Kind])=(16)) OR ([Kind]=N'SCOPE' AND DATALENGTH([Kind])=(10)) OR ([Kind]=N'CONFIRMATION' AND DATALENGTH([Kind])=(24))) AND ([ScopeKind] IS NULL OR ((([ScopeKind]=N'OWNER' AND DATALENGTH([ScopeKind])=(10)) OR ([ScopeKind]=N'REVIEWER' AND DATALENGTH([ScopeKind])=(16))))))) THEN (1) ELSE (0) END=(1)),
  CONSTRAINT [CK_DatasetSecurityDecision_Action] CHECK (CASE WHEN ((([Kind]=N'SNAPSHOT' AND [Action] IN (N'COLLECT_METADATA',N'INVALIDATE')) OR ([Kind]=N'SCOPE' AND [Action] IN (N'GRANT_SCOPE',N'REVOKE_SCOPE')) OR ([Kind]=N'CONFIRMATION' AND [Action] IN (N'CONFIRM',N'REJECT',N'REVOKE',N'INVALIDATE'))) AND ((([Action]=N'COLLECT_METADATA' AND DATALENGTH([Action])=(32)) OR ([Action]=N'GRANT_SCOPE' AND DATALENGTH([Action])=(22)) OR ([Action]=N'REVOKE_SCOPE' AND DATALENGTH([Action])=(24)) OR ([Action]=N'CONFIRM' AND DATALENGTH([Action])=(14)) OR ([Action]=N'REJECT' AND DATALENGTH([Action])=(12)) OR ([Action]=N'REVOKE' AND DATALENGTH([Action])=(12)) OR ([Action]=N'INVALIDATE' AND DATALENGTH([Action])=(20))))) THEN (1) ELSE (0) END=(1)),
  CONSTRAINT [CK_DatasetSecurityDecision_Reason] CHECK (CASE WHEN ((([ReasonCode]=N'METADATA_COLLECTED' AND DATALENGTH([ReasonCode])=(36)) OR ([ReasonCode]=N'OWNER_APPOINTED' AND DATALENGTH([ReasonCode])=(30)) OR ([ReasonCode]=N'REVIEWER_APPOINTED' AND DATALENGTH([ReasonCode])=(36)) OR ([ReasonCode]=N'SCOPE_REBOUND' AND DATALENGTH([ReasonCode])=(26)) OR ([ReasonCode]=N'SCOPE_REVOKED' AND DATALENGTH([ReasonCode])=(26)) OR ([ReasonCode]=N'CLASSIFICATION_ACCEPTED' AND DATALENGTH([ReasonCode])=(46)) OR ([ReasonCode]=N'POLICY_REJECTED' AND DATALENGTH([ReasonCode])=(30)) OR ([ReasonCode]=N'AUTHORIZATION_REVOKED' AND DATALENGTH([ReasonCode])=(42)) OR ([ReasonCode]=N'EVIDENCE_CHANGED' AND DATALENGTH([ReasonCode])=(32)))) THEN (1) ELSE (0) END=(1)),
  CONSTRAINT [CK_DatasetSecurityDecision_States] CHECK (CASE WHEN (([Kind]=N'SNAPSHOT' AND (([PreviousState]=N'MISSING' AND DATALENGTH([PreviousState])=(14)) OR ([PreviousState]=N'DESCRIBED' AND DATALENGTH([PreviousState])=(18)) OR ([PreviousState]=N'SOURCE_BOUND' AND DATALENGTH([PreviousState])=(24)) OR ([PreviousState]=N'INVALIDATED' AND DATALENGTH([PreviousState])=(22)) OR ([PreviousState]=N'EXPIRED' AND DATALENGTH([PreviousState])=(14))) AND (([NextState]=N'DESCRIBED' AND DATALENGTH([NextState])=(18)) OR ([NextState]=N'SOURCE_BOUND' AND DATALENGTH([NextState])=(24)) OR ([NextState]=N'INVALIDATED' AND DATALENGTH([NextState])=(22)) OR ([NextState]=N'EXPIRED' AND DATALENGTH([NextState])=(14)))) OR ([Kind]=N'SCOPE' AND (([PreviousState]=N'MISSING' AND DATALENGTH([PreviousState])=(14)) OR ([PreviousState]=N'ACTIVE' AND DATALENGTH([PreviousState])=(12)) OR ([PreviousState]=N'REVOKED' AND DATALENGTH([PreviousState])=(14))) AND (([NextState]=N'ACTIVE' AND DATALENGTH([NextState])=(12)) OR ([NextState]=N'REVOKED' AND DATALENGTH([NextState])=(14)))) OR ([Kind]=N'CONFIRMATION' AND (([PreviousState]=N'MISSING' AND DATALENGTH([PreviousState])=(14)) OR ([PreviousState]=N'PENDING' AND DATALENGTH([PreviousState])=(14)) OR ([PreviousState]=N'ACTIVE' AND DATALENGTH([PreviousState])=(12)) OR ([PreviousState]=N'REJECTED' AND DATALENGTH([PreviousState])=(16)) OR ([PreviousState]=N'REVOKED' AND DATALENGTH([PreviousState])=(14)) OR ([PreviousState]=N'INVALIDATED' AND DATALENGTH([PreviousState])=(22))) AND (([NextState]=N'PENDING' AND DATALENGTH([NextState])=(14)) OR ([NextState]=N'ACTIVE' AND DATALENGTH([NextState])=(12)) OR ([NextState]=N'REJECTED' AND DATALENGTH([NextState])=(16)) OR ([NextState]=N'REVOKED' AND DATALENGTH([NextState])=(14)) OR ([NextState]=N'INVALIDATED' AND DATALENGTH([NextState])=(22))))) THEN (1) ELSE (0) END=(1)),
  CONSTRAINT [CK_DatasetSecurityDecision_Versions] CHECK (CASE WHEN ((([PreviousState]=N'MISSING' AND [PreviousStateVersion] IS NULL) OR ([PreviousState]<>N'MISSING' AND [PreviousStateVersion] IS NOT NULL)) AND ([PreviousStateVersion] IS NULL OR ([PreviousStateVersion]<>0x0000000000000000)) AND ([NextStateVersion] IS NULL OR ([NextStateVersion]<>0x0000000000000000))) THEN (1) ELSE (0) END=(1)),
  CONSTRAINT [CK_DatasetSecurityDecision_Json] CHECK (CASE WHEN (ISJSON([AuthorizationEvidenceJson])=(1) AND DATALENGTH([AuthorizationEvidenceJson])<=(16384) AND ISJSON([DetailsJson])=(1) AND DATALENGTH([DetailsJson])<=(16384)) THEN (1) ELSE (0) END=(1)),
  CONSTRAINT [FK_DatasetSecurityDecision_Dataset] FOREIGN KEY ([DatasetId]) REFERENCES [uqp].[Dataset] ([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT [FK_DatasetSecurityDecision_Snapshot] FOREIGN KEY ([DatasetId],[SnapshotId]) REFERENCES [uqp].[DatasetFieldSnapshot] ([DatasetId],[Id]) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT [FK_DatasetSecurityDecision_Scope] FOREIGN KEY ([DatasetId],[SubjectUserId],[ScopeKind]) REFERENCES [uqp].[DatasetSecurityScope] ([DatasetId],[UserId],[ScopeKind]) ON DELETE NO ACTION ON UPDATE NO ACTION
);

CREATE NONCLUSTERED INDEX [IX_SecurityDecision_Dataset] ON [uqp].[DatasetSecurityDecision] ([DatasetId] ASC,[Id] ASC);

CREATE NONCLUSTERED INDEX [IX_SecurityDecision_Snapshot] ON [uqp].[DatasetSecurityDecision] ([SnapshotId] ASC,[Id] ASC);

CREATE UNIQUE NONCLUSTERED INDEX [UX_SecurityDecision_CollectionSnapshot] ON [uqp].[DatasetSecurityDecision] ([SnapshotId] ASC) WHERE ([Kind]=N'SNAPSHOT' AND [Action]=N'COLLECT_METADATA');

CREATE TABLE [uqp].[DatasetSecurityConfirmation] (
  [DatasetId] BIGINT NOT NULL,
  [SnapshotId] BIGINT NOT NULL,
  [State] NVARCHAR(16) COLLATE Latin1_General_100_BIN2 NOT NULL CONSTRAINT [DF_DatasetSecurityConfirmation_State] DEFAULT (N'PENDING'),
  [StateRowVersion] ROWVERSION NOT NULL,
  [DecisionId] BIGINT NOT NULL,
  [Classification] NVARCHAR(24) COLLATE Latin1_General_100_BIN2 NULL,
  [SensitivityVersion] BIGINT NULL,
  [PolicyDigest] BINARY(32) NULL,
  [PatientConfigurationVersion] BIGINT NULL,
  [PatientKeyAlias] NVARCHAR(128) COLLATE Latin1_General_100_BIN2 NULL,
  [ReviewerId] BIGINT NULL,
  [OwnerUserId] BIGINT NULL,
  [ApproverScopeKind] NVARCHAR(8) COLLATE Latin1_General_100_BIN2 NULL,
  [ReviewerTokenVersion] BIGINT NULL,
  [OwnerTokenVersion] BIGINT NULL,
  [ActorScopeEpoch] BINARY(8) NULL,
  [OwnerScopeEpoch] BINARY(8) NULL,
  [AuthorizationModelVersion] NVARCHAR(32) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [PlatformIncarnation] UNIQUEIDENTIFIER NOT NULL,
  CONSTRAINT [PK_DatasetSecurityConfirmation] PRIMARY KEY CLUSTERED ([DatasetId] ASC),
  CONSTRAINT [CK_DatasetSecurityConfirmation_Ids] CHECK (CASE WHEN (([DatasetId] IS NULL OR ([DatasetId]>(0))) AND ([SnapshotId] IS NULL OR ([SnapshotId]>(0))) AND ([DecisionId] IS NULL OR ([DecisionId]>(0))) AND ([SensitivityVersion] IS NULL OR ([SensitivityVersion]>(0))) AND ([PatientConfigurationVersion] IS NULL OR ([PatientConfigurationVersion]>(0))) AND ([ReviewerId] IS NULL OR ([ReviewerId]>(0))) AND ([OwnerUserId] IS NULL OR ([OwnerUserId]>(0))) AND ([ReviewerTokenVersion] IS NULL OR ([ReviewerTokenVersion]>(0))) AND ([OwnerTokenVersion] IS NULL OR ([OwnerTokenVersion]>(0)))) THEN (1) ELSE (0) END=(1)),
  CONSTRAINT [CK_DatasetSecurityConfirmation_Epochs] CHECK (CASE WHEN (([ActorScopeEpoch] IS NULL OR ([ActorScopeEpoch]<>0x0000000000000000)) AND ([OwnerScopeEpoch] IS NULL OR ([OwnerScopeEpoch]<>0x0000000000000000))) THEN (1) ELSE (0) END=(1)),
  CONSTRAINT [CK_DatasetSecurityConfirmation_State] CHECK (CASE WHEN ((([State]=N'PENDING' AND DATALENGTH([State])=(14)) OR ([State]=N'ACTIVE' AND DATALENGTH([State])=(12)) OR ([State]=N'REJECTED' AND DATALENGTH([State])=(16)) OR ([State]=N'REVOKED' AND DATALENGTH([State])=(14)) OR ([State]=N'INVALIDATED' AND DATALENGTH([State])=(22)))) THEN (1) ELSE (0) END=(1)),
  CONSTRAINT [CK_DatasetSecurityConfirmation_Classification] CHECK (CASE WHEN (([Classification] IS NULL OR ((([Classification]=N'NON_PATIENT_PUBLIC' AND DATALENGTH([Classification])=(36)) OR ([Classification]=N'NON_PATIENT_SENSITIVE' AND DATALENGTH([Classification])=(42)) OR ([Classification]=N'PATIENT' AND DATALENGTH([Classification])=(14)))))) THEN (1) ELSE (0) END=(1)),
  CONSTRAINT [CK_DatasetSecurityConfirmation_ScopeKind] CHECK (CASE WHEN (([ApproverScopeKind] IS NULL OR ((([ApproverScopeKind]=N'OWNER' AND DATALENGTH([ApproverScopeKind])=(10)) OR ([ApproverScopeKind]=N'REVIEWER' AND DATALENGTH([ApproverScopeKind])=(16)))))) THEN (1) ELSE (0) END=(1)),
  CONSTRAINT [CK_DatasetSecurityConfirmation_AuthorizationModel] CHECK (CASE WHEN ((([AuthorizationModelVersion]=N'DATASET_SCOPE_AUTH_V1' AND DATALENGTH([AuthorizationModelVersion])=(42)))) THEN (1) ELSE (0) END=(1)),
  CONSTRAINT [CK_DatasetSecurityConfirmation_Active] CHECK (CASE WHEN ([State]<>N'ACTIVE' OR ([Classification] IS NOT NULL AND [SensitivityVersion] IS NOT NULL AND [PolicyDigest] IS NOT NULL AND [ReviewerId] IS NOT NULL AND [OwnerUserId] IS NOT NULL AND [ApproverScopeKind] IS NOT NULL AND [ReviewerTokenVersion] IS NOT NULL AND [OwnerTokenVersion] IS NOT NULL AND [ActorScopeEpoch] IS NOT NULL AND [OwnerScopeEpoch] IS NOT NULL AND (([ApproverScopeKind]=N'OWNER' AND [ReviewerId]=[OwnerUserId] AND [ReviewerTokenVersion]=[OwnerTokenVersion] AND [ActorScopeEpoch]=[OwnerScopeEpoch]) OR ([ApproverScopeKind]=N'REVIEWER' AND [ReviewerId]<>[OwnerUserId])) AND (([Classification]=N'PATIENT' AND [PatientConfigurationVersion] IS NOT NULL AND [PatientKeyAlias] IS NOT NULL AND DATALENGTH([PatientKeyAlias])>(0)) OR ([Classification] IN (N'NON_PATIENT_PUBLIC',N'NON_PATIENT_SENSITIVE') AND [PatientConfigurationVersion] IS NULL AND [PatientKeyAlias] IS NULL)))) THEN (1) ELSE (0) END=(1)),
  CONSTRAINT [FK_DatasetSecurityConfirmation_Snapshot] FOREIGN KEY ([DatasetId],[SnapshotId]) REFERENCES [uqp].[DatasetFieldSnapshot] ([DatasetId],[Id]) ON DELETE NO ACTION ON UPDATE NO ACTION
);

CREATE NONCLUSTERED INDEX [IX_SecurityConfirmation_Snapshot] ON [uqp].[DatasetSecurityConfirmation] ([SnapshotId] ASC,[DatasetId] ASC);
