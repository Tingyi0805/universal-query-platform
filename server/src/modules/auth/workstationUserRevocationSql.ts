/** Isolated 926 single-user writer statements. Values are always bound; never run standalone. */
export const workstationUserRevocationSql = Object.freeze({
  schema: `
IF COALESCE(HAS_PERMS_BY_NAME(N'uqp',N'SCHEMA',N'VIEW DEFINITION'),0)<>1
 THROW 52926,'USER_REVOCATION_SCHEMA_UNPROVEN',1;
IF (SELECT COUNT(*) FROM sys.tables WHERE schema_id=SCHEMA_ID(N'uqp') AND name IN
 (N'SharedWorkstationDeviceSession',N'SharedWorkstationOperatorState',N'UserQuickPinSecurityBinding',
 N'SharedWorkstationPinAttemptState',N'SharedWorkstationSessionRequest',N'SharedWorkstationSessionDecision'))<>6
 OR COL_LENGTH(N'uqp.QuickPinPolicy',N'PolicyRevision')<>8
 OR COL_LENGTH(N'uqp.QuickPinPolicy',N'PolicyRevision') IS NULL
 OR COL_LENGTH(N'uqp.QuickPinPolicy',N'PolicyRowVersion')<>8
 OR COL_LENGTH(N'uqp.QuickPinPolicy',N'PolicyRowVersion') IS NULL
 THROW 52926,'USER_REVOCATION_SCHEMA_UNPROVEN',1;
IF EXISTS (
 SELECT 1 FROM (VALUES
 (N'FK_WorkstationDeviceSession_Workstation',N'SharedWorkstationDeviceSession',N'SharedWorkstation',N'WorkstationId',N'Id'),
 (N'FK_WorkstationDeviceSession_Credential',N'SharedWorkstationDeviceSession',N'SharedWorkstationCredential',N'CredentialId,WorkstationId',N'Id,WorkstationId'),
 (N'FK_UserQuickPinSecurityBinding_Pin',N'UserQuickPinSecurityBinding',N'UserQuickPin',N'UserId',N'UserId'),
 (N'FK_UserQuickPinSecurityBinding_User',N'UserQuickPinSecurityBinding',N'AppUser',N'UserId',N'Id'),
 (N'FK_WorkstationPinAttempt_User',N'SharedWorkstationPinAttemptState',N'AppUser',N'UserId',N'Id'),
 (N'FK_WorkstationPinAttempt_Workstation',N'SharedWorkstationPinAttemptState',N'SharedWorkstation',N'LastWorkstationId',N'Id'),
 (N'FK_WorkstationOperatorState_Workstation',N'SharedWorkstationOperatorState',N'SharedWorkstation',N'WorkstationId',N'Id'),
 (N'FK_WorkstationOperatorState_DeviceSession',N'SharedWorkstationOperatorState',N'SharedWorkstationDeviceSession',N'DeviceSessionId,WorkstationId',N'Id,WorkstationId'),
 (N'FK_WorkstationOperatorState_OperatorSession',N'SharedWorkstationOperatorState',N'SharedWorkstationSession',N'OperatorSessionId,WorkstationId,OperatorUserId',N'Id,WorkstationId,UserId'),
 (N'FK_WorkstationOperatorState_User',N'SharedWorkstationOperatorState',N'AppUser',N'OperatorUserId',N'Id'),
 (N'FK_WorkstationSessionRequest_Workstation',N'SharedWorkstationSessionRequest',N'SharedWorkstation',N'WorkstationId',N'Id'),
 (N'FK_WorkstationSessionRequest_DeviceSession',N'SharedWorkstationSessionRequest',N'SharedWorkstationDeviceSession',N'DeviceSessionId,WorkstationId',N'Id,WorkstationId'),
 (N'FK_WorkstationSessionDecision_Request',N'SharedWorkstationSessionDecision',N'SharedWorkstationSessionRequest',N'RequestId',N'RequestId'),
 (N'FK_WorkstationSessionDecision_Workstation',N'SharedWorkstationSessionDecision',N'SharedWorkstation',N'WorkstationId',N'Id'),
 (N'FK_WorkstationSessionDecision_DeviceSession',N'SharedWorkstationSessionDecision',N'SharedWorkstationDeviceSession',N'DeviceSessionId,WorkstationId',N'Id,WorkstationId')
 ) expected(Name,ParentTable,ReferencedTable,ParentColumns,ReferencedColumns)
 LEFT JOIN sys.foreign_keys f ON f.object_id=OBJECT_ID(N'uqp.'+expected.Name,N'F')
 OUTER APPLY (SELECT STRING_AGG(CONVERT(NVARCHAR(MAX),COL_NAME(fc.parent_object_id,fc.parent_column_id)),N',')
   WITHIN GROUP (ORDER BY fc.constraint_column_id) AS ParentColumns,
   STRING_AGG(CONVERT(NVARCHAR(MAX),COL_NAME(fc.referenced_object_id,fc.referenced_column_id)),N',')
   WITHIN GROUP (ORDER BY fc.constraint_column_id) AS ReferencedColumns
   FROM sys.foreign_key_columns fc WHERE fc.constraint_object_id=f.object_id) cols
 WHERE f.object_id IS NULL OR f.parent_object_id<>OBJECT_ID(N'uqp.'+expected.ParentTable,N'U')
 OR f.referenced_object_id<>OBJECT_ID(N'uqp.'+expected.ReferencedTable,N'U')
 OR f.is_disabled=1 OR f.is_not_trusted=1 OR f.delete_referential_action<>0 OR f.update_referential_action<>0
 OR COALESCE(cols.ParentColumns,N'')<>expected.ParentColumns OR COALESCE(cols.ReferencedColumns,N'')<>expected.ReferencedColumns
) THROW 52926,'USER_REVOCATION_SCHEMA_UNPROVEN',1;
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE parent_object_id IN
 (OBJECT_ID(N'uqp.SharedWorkstationDeviceSession'),OBJECT_ID(N'uqp.SharedWorkstationOperatorState'),
 OBJECT_ID(N'uqp.UserQuickPinSecurityBinding'),OBJECT_ID(N'uqp.SharedWorkstationPinAttemptState'),
 OBJECT_ID(N'uqp.SharedWorkstationSessionRequest'),OBJECT_ID(N'uqp.SharedWorkstationSessionDecision'))
 AND (is_disabled=1 OR is_not_trusted=1)) THROW 52926,'USER_REVOCATION_SCHEMA_UNPROVEN',1;
IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE parent_object_id IN
 (OBJECT_ID(N'uqp.SharedWorkstationOperatorState'),OBJECT_ID(N'uqp.SharedWorkstationSessionRequest'),
 OBJECT_ID(N'uqp.SharedWorkstationSessionDecision')) AND (is_disabled=1 OR is_not_trusted=1))
 THROW 52926,'USER_REVOCATION_SCHEMA_UNPROVEN',1;
IF (SELECT COUNT(*) FROM sys.triggers WHERE name IN
 (N'TR_WorkstationSessionRequest_AppendOnly',N'TR_WorkstationSessionDecision_AppendOnly')
 AND is_disabled=0 AND is_instead_of_trigger=1
 AND parent_id=CASE name WHEN N'TR_WorkstationSessionRequest_AppendOnly' THEN OBJECT_ID(N'uqp.SharedWorkstationSessionRequest')
 ELSE OBJECT_ID(N'uqp.SharedWorkstationSessionDecision') END)<>2
 THROW 52926,'USER_REVOCATION_SCHEMA_UNPROVEN',1;
IF EXISTS (SELECT 1 FROM (VALUES
 (N'PK_SharedWorkstationDeviceSession',N'SharedWorkstationDeviceSession',N'PK'),
 (N'DF_WorkstationDeviceSession_Created',N'SharedWorkstationDeviceSession',N'D'),
 (N'DF_WorkstationDeviceSession_Renewal',N'SharedWorkstationDeviceSession',N'D'),
 (N'FK_WorkstationDeviceSession_Workstation',N'SharedWorkstationDeviceSession',N'F'),
 (N'FK_WorkstationDeviceSession_Credential',N'SharedWorkstationDeviceSession',N'F'),
 (N'CK_WorkstationDeviceSession_Proof',N'SharedWorkstationDeviceSession',N'C'),
 (N'CK_WorkstationDeviceSession_Ids',N'SharedWorkstationDeviceSession',N'C'),
 (N'CK_WorkstationDeviceSession_Version',N'SharedWorkstationDeviceSession',N'C'),
 (N'CK_WorkstationDeviceSession_Time',N'SharedWorkstationDeviceSession',N'C'),
 (N'CK_WorkstationDeviceSession_Revocation',N'SharedWorkstationDeviceSession',N'C'),
 (N'PK_UserQuickPinSecurityBinding',N'UserQuickPinSecurityBinding',N'PK'),
 (N'DF_UserQuickPinSecurityBinding_Bound',N'UserQuickPinSecurityBinding',N'D'),
 (N'FK_UserQuickPinSecurityBinding_Pin',N'UserQuickPinSecurityBinding',N'F'),
 (N'FK_UserQuickPinSecurityBinding_User',N'UserQuickPinSecurityBinding',N'F'),
 (N'CK_UserQuickPinSecurityBinding_Versions',N'UserQuickPinSecurityBinding',N'C'),
 (N'PK_SharedWorkstationPinAttemptState',N'SharedWorkstationPinAttemptState',N'PK'),
 (N'FK_WorkstationPinAttempt_User',N'SharedWorkstationPinAttemptState',N'F'),
 (N'FK_WorkstationPinAttempt_Workstation',N'SharedWorkstationPinAttemptState',N'F'),
 (N'CK_WorkstationPinAttempt_Versions',N'SharedWorkstationPinAttemptState',N'C'),
 (N'CK_WorkstationPinAttempt_State',N'SharedWorkstationPinAttemptState',N'C'),
 (N'PK_SharedWorkstationOperatorState',N'SharedWorkstationOperatorState',N'PK'),
 (N'DF_WorkstationOperatorState_Mutated',N'SharedWorkstationOperatorState',N'D'),
 (N'FK_WorkstationOperatorState_Workstation',N'SharedWorkstationOperatorState',N'F'),
 (N'FK_WorkstationOperatorState_DeviceSession',N'SharedWorkstationOperatorState',N'F'),
 (N'FK_WorkstationOperatorState_OperatorSession',N'SharedWorkstationOperatorState',N'F'),
 (N'FK_WorkstationOperatorState_User',N'SharedWorkstationOperatorState',N'F'),
 (N'CK_WorkstationOperatorState_Generation',N'SharedWorkstationOperatorState',N'C'),
 (N'CK_WorkstationOperatorState_Ids',N'SharedWorkstationOperatorState',N'C'),
 (N'CK_WorkstationOperatorState_State',N'SharedWorkstationOperatorState',N'C'),
 (N'CK_WorkstationOperatorState_Active',N'SharedWorkstationOperatorState',N'C'),
 (N'PK_SharedWorkstationSessionRequest',N'SharedWorkstationSessionRequest',N'PK'),
 (N'DF_WorkstationSessionRequest_Created',N'SharedWorkstationSessionRequest',N'D'),
 (N'FK_WorkstationSessionRequest_Workstation',N'SharedWorkstationSessionRequest',N'F'),
 (N'FK_WorkstationSessionRequest_DeviceSession',N'SharedWorkstationSessionRequest',N'F'),
 (N'CK_WorkstationSessionRequest_Operation',N'SharedWorkstationSessionRequest',N'C'),
 (N'CK_WorkstationSessionRequest_Ids',N'SharedWorkstationSessionRequest',N'C'),
 (N'CK_WorkstationSessionRequest_Digest',N'SharedWorkstationSessionRequest',N'C'),
 (N'CK_WorkstationSessionRequest_Expiry',N'SharedWorkstationSessionRequest',N'C'),
 (N'PK_SharedWorkstationSessionDecision',N'SharedWorkstationSessionDecision',N'PK'),
 (N'DF_WorkstationSessionDecision_Created',N'SharedWorkstationSessionDecision',N'D'),
 (N'UQ_WorkstationSessionDecision_Request',N'SharedWorkstationSessionDecision',N'UQ'),
 (N'UQ_WorkstationSessionDecision_Audit',N'SharedWorkstationSessionDecision',N'UQ'),
 (N'UQ_WorkstationSessionDecision_Correlation',N'SharedWorkstationSessionDecision',N'UQ'),
 (N'FK_WorkstationSessionDecision_Request',N'SharedWorkstationSessionDecision',N'F'),
 (N'FK_WorkstationSessionDecision_Workstation',N'SharedWorkstationSessionDecision',N'F'),
 (N'FK_WorkstationSessionDecision_DeviceSession',N'SharedWorkstationSessionDecision',N'F'),
 (N'CK_WorkstationSessionDecision_Ids',N'SharedWorkstationSessionDecision',N'C'),
 (N'CK_WorkstationSessionDecision_Operation',N'SharedWorkstationSessionDecision',N'C'),
 (N'CK_WorkstationSessionDecision_Status',N'SharedWorkstationSessionDecision',N'C'),
 (N'CK_WorkstationSessionDecision_Domain',N'SharedWorkstationSessionDecision',N'C'),
 (N'CK_WorkstationSessionDecision_Audit',N'SharedWorkstationSessionDecision',N'C'),
 (N'CK_WorkstationSessionDecision_Revision',N'SharedWorkstationSessionDecision',N'C'),
 (N'CK_WorkstationSessionDecision_Generation',N'SharedWorkstationSessionDecision',N'C'),
 (N'CK_WorkstationSessionDecision_Reason',N'SharedWorkstationSessionDecision',N'C')
 ) expected(Name,TableName,ObjectType)
 LEFT JOIN sys.objects o ON o.object_id=OBJECT_ID(N'uqp.'+expected.Name)
 WHERE o.object_id IS NULL OR o.type<>expected.ObjectType
 OR o.parent_object_id<>OBJECT_ID(N'uqp.'+expected.TableName,N'U'))
 THROW 52926,'USER_REVOCATION_SCHEMA_UNPROVEN',1;
IF EXISTS (SELECT 1 FROM sys.indexes WHERE index_id>0 AND object_id IN
 (OBJECT_ID(N'uqp.SharedWorkstationDeviceSession'),OBJECT_ID(N'uqp.SharedWorkstationOperatorState'),
 OBJECT_ID(N'uqp.UserQuickPinSecurityBinding'),OBJECT_ID(N'uqp.SharedWorkstationPinAttemptState'),
 OBJECT_ID(N'uqp.SharedWorkstationSessionRequest'),OBJECT_ID(N'uqp.SharedWorkstationSessionDecision'))
 AND (is_disabled=1 OR is_hypothetical=1)) THROW 52926,'USER_REVOCATION_SCHEMA_UNPROVEN',1;
SELECT 1 AS SchemaReady;`,
  accountSchema: `
IF OBJECT_ID(N'uqp.AccountRevocationRequest',N'U') IS NULL OR OBJECT_ID(N'uqp.AccountRevocationDecision',N'U') IS NULL
 OR COL_LENGTH(N'uqp.AccountRevocationDecision',N'PreviousTokenVersion') IS NULL
 OR COL_LENGTH(N'uqp.AccountRevocationDecision',N'NextTokenVersion') IS NULL
 OR COL_LENGTH(N'uqp.AccountRevocationDecision',N'AuditLogId') IS NULL
 OR COL_LENGTH(N'uqp.AccountRevocationDecision',N'PreviousTokenVersion')<>4
 OR COL_LENGTH(N'uqp.AccountRevocationDecision',N'NextTokenVersion')<>4
 OR COL_LENGTH(N'uqp.AccountRevocationDecision',N'AuditLogId')<>8
 THROW 52927,'ACCOUNT_SCHEMA_UNPROVEN',1;
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE object_id=OBJECT_ID(N'uqp.FK_AccountRevocationDecision_Request')
 AND parent_object_id=OBJECT_ID(N'uqp.AccountRevocationDecision') AND referenced_object_id=OBJECT_ID(N'uqp.AccountRevocationRequest')
 AND is_disabled=0 AND is_not_trusted=0 AND delete_referential_action=0 AND update_referential_action=0)
 THROW 52927,'ACCOUNT_SCHEMA_UNPROVEN',1;
IF (SELECT COUNT(*) FROM sys.triggers WHERE name IN (N'TR_AccountRevocationRequest_AppendOnly',N'TR_AccountRevocationDecision_AppendOnly')
 AND is_disabled=0 AND is_instead_of_trigger=1)<>2 THROW 52927,'ACCOUNT_SCHEMA_UNPROVEN',1;
SELECT 1 AS AccountSchemaReady;`,
  readAccountRequest: `SELECT CONVERT(VARCHAR(36),RequestId) AS RequestId
FROM uqp.AccountRevocationRequest WITH (UPDLOCK,HOLDLOCK) WHERE RequestId=@requestId;`,
  reserveAccount: `INSERT uqp.AccountRevocationRequest(RequestId,ActorUserId,TargetUserId,OperationCode,RequestDigest)
OUTPUT CONVERT(VARCHAR(36),INSERTED.RequestId) AS RequestId
VALUES(@requestId,CONVERT(BIGINT,@actorUserId),CONVERT(BIGINT,@targetUserId),@operation,CONVERT(BINARY(32),@digest,2));`,
  accountAudit: `INSERT uqp.AuditLog(EventType,UserId,Status,ParametersJson,CreatedAtUtc,CompletedAtUtc)
OUTPUT CONVERT(VARCHAR(20),INSERTED.Id) AS AuditLogId
VALUES(N'ACCOUNT_AUTHORIZATION_REVOKED',CONVERT(BIGINT,@actorUserId),N'SUCCESS',@parameters,SYSUTCDATETIME(),SYSUTCDATETIME());`,
  accountDecision: `INSERT uqp.AccountRevocationDecision
(RequestId,ActorUserId,TargetUserId,OperationCode,PreviousTokenVersion,NextTokenVersion,AuditLogId,TransactionCorrelationId)
OUTPUT CONVERT(VARCHAR(20),INSERTED.DecisionId) AS DecisionId,CONVERT(VARCHAR(20),INSERTED.AuditLogId) AS AuditLogId,
 CONVERT(VARCHAR(36),INSERTED.RequestId) AS RequestId
VALUES(@requestId,CONVERT(BIGINT,@actorUserId),CONVERT(BIGINT,@targetUserId),@operation,@expectedTokenVersion,
 @expectedTokenVersion+1,CONVERT(BIGINT,@auditLogId),@correlationId);`,
  user: `
SELECT CONVERT(VARCHAR(20),Id) AS UserId,TokenVersion,IsActive,AuthProvider
FROM uqp.AppUser WITH (UPDLOCK,HOLDLOCK) WHERE Id=CONVERT(BIGINT,@userId);`,
  admin: `
SELECT CASE WHEN EXISTS (
 SELECT 1 FROM uqp.UserRole ur WITH (UPDLOCK,HOLDLOCK)
 JOIN uqp.Role r WITH (UPDLOCK,HOLDLOCK) ON r.Id=ur.RoleId AND r.IsActive=1
 JOIN uqp.RolePermission rp WITH (UPDLOCK,HOLDLOCK) ON rp.RoleId=r.Id
 JOIN uqp.Permission p WITH (UPDLOCK,HOLDLOCK) ON p.Id=rp.PermissionId
 WHERE ur.UserId=CONVERT(BIGINT,@userId) AND r.Code=N'SYSTEM_ADMIN' AND p.Code=N'MANAGE_USERS'
) THEN 1 ELSE 0 END AS Allowed;`,
  targetAdmin: `
SELECT CASE WHEN EXISTS (SELECT 1 FROM uqp.UserRole ur WITH (UPDLOCK,HOLDLOCK)
 JOIN uqp.Role r WITH (UPDLOCK,HOLDLOCK) ON r.Id=ur.RoleId
 WHERE ur.UserId=CONVERT(BIGINT,@userId) AND r.Code=N'SYSTEM_ADMIN')
 THEN 1 ELSE 0 END AS IsAdmin;`,
  // UserId is authoritative in migration 902. No Credential ownership is inferred.
  legacy: `
SELECT CONVERT(VARCHAR(36),Id) AS SessionId,CONVERT(VARCHAR(20),WorkstationId) AS WorkstationId
FROM uqp.SharedWorkstationSession WITH (UPDLOCK,HOLDLOCK)
WHERE UserId=CONVERT(BIGINT,@targetUserId) AND RevokedAtUtc IS NULL ORDER BY WorkstationId,Id;`,
  operators: `
SELECT CONVERT(VARCHAR(20),WorkstationId) AS WorkstationId,
 CONVERT(VARCHAR(36),DeviceSessionId) AS DeviceSessionId,
 CONVERT(VARCHAR(36),OperatorSessionId) AS OperatorSessionId,
 CONVERT(VARCHAR(20),Generation) AS Generation,CONVERT(VARCHAR(36),Incarnation) AS Incarnation,
 LOWER(CONVERT(VARCHAR(16),RowVersion,2)) AS Revision,StateCode
FROM uqp.SharedWorkstationOperatorState WITH (UPDLOCK,HOLDLOCK)
WHERE OperatorUserId=CONVERT(BIGINT,@targetUserId) ORDER BY WorkstationId;`,
  binding: `
SELECT CONVERT(VARCHAR(20),ds.WorkstationId) AS WorkstationId,CONVERT(VARCHAR(36),ds.Id) AS DeviceSessionId
FROM uqp.SharedWorkstation w WITH (UPDLOCK,HOLDLOCK)
JOIN uqp.SharedWorkstationCredential c WITH (UPDLOCK,HOLDLOCK) ON c.WorkstationId=w.Id
JOIN uqp.SharedWorkstationDeviceSession ds WITH (UPDLOCK,HOLDLOCK)
 ON ds.CredentialId=c.Id AND ds.WorkstationId=w.Id
WHERE w.Id=CONVERT(BIGINT,@workstationId) AND ds.Id=@deviceSessionId;`,
  readRequest: `SELECT CONVERT(VARCHAR(36),RequestId) AS RequestId
FROM uqp.SharedWorkstationSessionRequest WITH (UPDLOCK,HOLDLOCK) WHERE RequestId=@requestId;`,
  role: `SELECT CONVERT(VARCHAR(20),Id) AS RoleId FROM uqp.Role WITH (UPDLOCK,HOLDLOCK)
WHERE Id=CONVERT(BIGINT,@roleId) AND IsActive=1 AND Code<>N'SYSTEM_ADMIN';`,
  userCas: `
UPDATE uqp.AppUser SET TokenVersion=TokenVersion+1,
 IsActive=CASE WHEN @operation=N'DISABLE' THEN 0 ELSE IsActive END,
 PasswordHash=CASE WHEN @operation=N'CHANGE_PASSWORD' THEN @passwordHash ELSE PasswordHash END,
 UpdatedAtUtc=SYSUTCDATETIME()
OUTPUT INSERTED.TokenVersion AS NextTokenVersion
WHERE Id=CONVERT(BIGINT,@targetUserId) AND TokenVersion=@expectedTokenVersion
 AND TokenVersion<2147483647;`,
  deleteRoles: `DELETE FROM uqp.UserRole WHERE UserId=CONVERT(BIGINT,@targetUserId);`,
  insertRole: `INSERT uqp.UserRole(UserId,RoleId)
OUTPUT CONVERT(VARCHAR(20),INSERTED.RoleId) AS RoleId
VALUES(CONVERT(BIGINT,@targetUserId),CONVERT(BIGINT,@roleId));`,
  revokeLegacy: `
UPDATE uqp.SharedWorkstationSession SET RevokedAtUtc=SYSUTCDATETIME()
OUTPUT CONVERT(VARCHAR(36),INSERTED.Id) AS SessionId
WHERE UserId=CONVERT(BIGINT,@targetUserId) AND RevokedAtUtc IS NULL;`,
  operatorCas: `
UPDATE uqp.SharedWorkstationOperatorState
SET StateCode=N'OPERATOR_LOCKED',Generation=Generation+CONVERT(BIGINT,1),Incarnation=@nextIncarnation,
 OperatorSessionId=NULL,OperatorUserId=NULL,TokenVersion=NULL,PinVersion=NULL,AuthMethod=NULL,
 LastMutationAtUtc=SYSUTCDATETIME()
OUTPUT LOWER(CONVERT(VARCHAR(16),INSERTED.RowVersion,2)) AS Revision,
 CONVERT(VARCHAR(20),INSERTED.Generation) AS Generation,CONVERT(VARCHAR(36),INSERTED.Incarnation) AS Incarnation
WHERE WorkstationId=CONVERT(BIGINT,@workstationId) AND DeviceSessionId=@deviceSessionId
 AND OperatorUserId=CONVERT(BIGINT,@targetUserId) AND StateCode=N'OPERATOR_ACTIVE'
 AND RowVersion=CONVERT(BINARY(8),@revision,2) AND Generation=CONVERT(BIGINT,@generation)
 AND Incarnation=@incarnation AND Generation<9223372036854775807;`,
  reserve: `
INSERT uqp.SharedWorkstationSessionRequest
(RequestId,WorkstationId,DeviceSessionId,OperationCode,RequestDigest,TargetUserId,ReplayExpiresAtUtc)
OUTPUT CONVERT(VARCHAR(36),INSERTED.RequestId) AS RequestId
VALUES(@requestId,CONVERT(BIGINT,@workstationId),@deviceSessionId,N'AUTHORIZATION_REVOKE',
 CONVERT(BINARY(32),@digest,2),CONVERT(BIGINT,@targetUserId),DATEADD(DAY,1,SYSUTCDATETIME()));`,
  audit: `
INSERT uqp.AuditLog(EventType,UserId,Status,ParametersJson,CreatedAtUtc,CompletedAtUtc)
OUTPUT CONVERT(VARCHAR(20),INSERTED.Id) AS AuditLogId
VALUES(N'WORKSTATION_USER_REVOKED',CONVERT(BIGINT,@actorUserId),N'SUCCESS',@parameters,
 SYSUTCDATETIME(),SYSUTCDATETIME());`,
  decision: `
INSERT uqp.SharedWorkstationSessionDecision
(RequestId,WorkstationId,DeviceSessionId,OperationCode,DecisionStatus,ActorUserId,TargetUserId,
 RevisionDomain,PreviousRevision,NextRevision,PreviousGeneration,NextGeneration,
 PreviousIncarnation,NextIncarnation,AuditLogId,AuditEventType,TransactionCorrelationId)
OUTPUT CONVERT(VARCHAR(36),INSERTED.RequestId) AS RequestId,CONVERT(VARCHAR(20),INSERTED.DecisionId) AS DecisionId,
 CONVERT(VARCHAR(20),INSERTED.AuditLogId) AS AuditLogId
VALUES(@requestId,CONVERT(BIGINT,@workstationId),@deviceSessionId,N'AUTHORIZATION_REVOKE',N'SUCCESS',
 CONVERT(BIGINT,@actorUserId),CONVERT(BIGINT,@targetUserId),N'OPERATOR_STATE',
 CONVERT(BINARY(8),@revision,2),CONVERT(BINARY(8),@nextRevision,2),
 CONVERT(BIGINT,@generation),CONVERT(BIGINT,@nextGeneration),@incarnation,@nextIncarnation,
 CONVERT(BIGINT,@auditLogId),N'WORKSTATION_USER_REVOKED',@correlationId);`,
  remaining: `
SELECT (SELECT COUNT_BIG(*) FROM uqp.SharedWorkstationSession WITH (UPDLOCK,HOLDLOCK)
 WHERE UserId=CONVERT(BIGINT,@targetUserId) AND RevokedAtUtc IS NULL) AS LegacyRemaining,
 (SELECT COUNT_BIG(*) FROM uqp.SharedWorkstationOperatorState WITH (UPDLOCK,HOLDLOCK)
 WHERE OperatorUserId=CONVERT(BIGINT,@targetUserId)) AS OperatorRemaining;`,
});
