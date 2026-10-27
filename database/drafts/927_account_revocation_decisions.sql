-- OFFLINE REVIEW DRAFT ONLY. Never scanned by db:migrate. No user DB approval.
-- 926 remains unchanged. Account evidence is independent of device ownership.
SET XACT_ABORT ON;
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
BEGIN TRY
 BEGIN TRANSACTION;
 IF OBJECT_ID(N'uqp.SharedWorkstationSessionDecision',N'U') IS NULL
  OR OBJECT_ID(N'uqp.AppUser',N'U') IS NULL OR OBJECT_ID(N'uqp.AuditLog',N'U') IS NULL
  THROW 52927,'927_REVIEWED_926_BASELINE_REQUIRED',1;
 IF OBJECT_ID(N'uqp.AccountRevocationRequest') IS NOT NULL OR OBJECT_ID(N'uqp.AccountRevocationDecision') IS NOT NULL
  THROW 52927,'927_ALREADY_OR_PARTIALLY_INSTALLED_VALIDATE_EXACTLY',1;
 CREATE TABLE uqp.AccountRevocationRequest (
  RequestId UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_AccountRevocationRequest PRIMARY KEY,
  ActorUserId BIGINT NOT NULL, TargetUserId BIGINT NOT NULL,
  OperationCode NVARCHAR(32) COLLATE Latin1_General_100_BIN2 NOT NULL,
  RequestDigest BINARY(32) NOT NULL,
  CreatedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_AccountRevocationRequest_Created DEFAULT SYSUTCDATETIME(),
  CONSTRAINT UQ_AccountRevocationRequest_Binding UNIQUE(RequestId,ActorUserId,TargetUserId,OperationCode),
  CONSTRAINT CK_AccountRevocationRequest_Ids CHECK (ActorUserId>0 AND TargetUserId>0
   AND RequestId<>CONVERT(UNIQUEIDENTIFIER,'00000000-0000-0000-0000-000000000000')),
  CONSTRAINT CK_AccountRevocationRequest_Operation CHECK
   (OperationCode+N'#' IN (N'REVOKE_AUTHORIZATION#',N'DISABLE#',N'CHANGE_PASSWORD#',N'REPLACE_ROLES#'))
 );
 CREATE TABLE uqp.AccountRevocationDecision (
  DecisionId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_AccountRevocationDecision PRIMARY KEY,
  RequestId UNIQUEIDENTIFIER NOT NULL CONSTRAINT UQ_AccountRevocationDecision_Request UNIQUE,
  ActorUserId BIGINT NOT NULL, TargetUserId BIGINT NOT NULL,
  OperationCode NVARCHAR(32) COLLATE Latin1_General_100_BIN2 NOT NULL,
  PreviousTokenVersion INT NOT NULL, NextTokenVersion INT NOT NULL,
  AuditLogId BIGINT NOT NULL CONSTRAINT UQ_AccountRevocationDecision_Audit UNIQUE,
  TransactionCorrelationId UNIQUEIDENTIFIER NOT NULL CONSTRAINT UQ_AccountRevocationDecision_Correlation UNIQUE,
  CreatedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_AccountRevocationDecision_Created DEFAULT SYSUTCDATETIME(),
  CONSTRAINT FK_AccountRevocationDecision_Request FOREIGN KEY(RequestId,ActorUserId,TargetUserId,OperationCode)
   REFERENCES uqp.AccountRevocationRequest(RequestId,ActorUserId,TargetUserId,OperationCode) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT CK_AccountRevocationDecision_Ids CHECK (ActorUserId>0 AND TargetUserId>0 AND AuditLogId>0
   AND TransactionCorrelationId<>CONVERT(UNIQUEIDENTIFIER,'00000000-0000-0000-0000-000000000000')),
  CONSTRAINT CK_AccountRevocationDecision_Operation CHECK
   (OperationCode+N'#' IN (N'REVOKE_AUTHORIZATION#',N'DISABLE#',N'CHANGE_PASSWORD#',N'REPLACE_ROLES#')),
  CONSTRAINT CK_AccountRevocationDecision_Versions CHECK
   (PreviousTokenVersion>0 AND PreviousTokenVersion<2147483647 AND CONVERT(BIGINT,NextTokenVersion)=CONVERT(BIGINT,PreviousTokenVersion)+1)
 );
 CREATE INDEX IX_AccountRevocationDecision_Target ON uqp.AccountRevocationDecision(TargetUserId,CreatedAtUtc,DecisionId)
  INCLUDE(OperationCode,PreviousTokenVersion,NextTokenVersion,AuditLogId);
 -- IDs are historical evidence: no target/actor FK and no live AuditLog FK.
 -- A future deletion writer must independently preserve required history; this draft does not enable deletion.
 EXEC(N'CREATE TRIGGER uqp.TR_AccountRevocationRequest_AppendOnly ON uqp.AccountRevocationRequest
  INSTEAD OF UPDATE,DELETE AS BEGIN SET NOCOUNT ON; THROW 52927,''ACCOUNT_REQUEST_APPEND_ONLY'',1; END');
 EXEC(N'CREATE TRIGGER uqp.TR_AccountRevocationDecision_AppendOnly ON uqp.AccountRevocationDecision
  INSTEAD OF UPDATE,DELETE AS BEGIN SET NOCOUNT ON; THROW 52927,''ACCOUNT_DECISION_APPEND_ONLY'',1; END');
 -- Dedicated deployment still requires exact Catalog pre/post-validation and restricted writer permissions.
 -- No grants, identity rows, Scope, Runtime activation or SchemaMigration writes.
 COMMIT;
END TRY
BEGIN CATCH
 IF XACT_STATE()<>0 ROLLBACK;
 THROW;
END CATCH;
