-- ONLY the disposable 926 harness may execute this parameterized synthetic fixture.
-- No real account, PIN, credential proof or patient data.
SET XACT_ABORT ON;
BEGIN TRANSACTION;
DECLARE @fixtureNow DATETIME2(3)=SYSUTCDATETIME();
SET IDENTITY_INSERT uqp.SharedWorkstation ON;
INSERT uqp.SharedWorkstation(Id,WorkstationCode,DisplayName,IsActive,PinLoginEnabled,CredentialVersion)
VALUES(CONVERT(BIGINT,@workstationId),@code,N'SYNTHETIC_926',1,0,2);
SET IDENTITY_INSERT uqp.SharedWorkstation OFF;
INSERT uqp.SharedWorkstationCredential(Id,WorkstationId,SecretHash,CredentialVersion)
VALUES(@credentialId,CONVERT(BIGINT,@workstationId),HASHBYTES('SHA2_256',CONVERT(VARBINARY(16),NEWID())),2);
INSERT uqp.SharedWorkstationDeviceSession
(Id,WorkstationId,CredentialId,BoundCredentialVersion,SessionProofHash,CreatedAtUtc,LastActivityAtUtc,IdleExpiresAtUtc,AbsoluteExpiresAtUtc,RenewalCounter)
VALUES(@deviceId,CONVERT(BIGINT,@workstationId),@credentialId,2,
 HASHBYTES('SHA2_256',CONVERT(VARBINARY(16),NEWID())),@fixtureNow,@fixtureNow,DATEADD(MINUTE,10,@fixtureNow),DATEADD(HOUR,1,@fixtureNow),CONVERT(BIGINT,'9007199254740993'));
IF @legacyMode<>0
  INSERT uqp.SharedWorkstationSession(Id,WorkstationId,UserId,SessionSecretHash,AuthMethod,
    AuthenticatedAtUtc,LastActivityAtUtc,ExpiresAtUtc,TokenVersion)
  VALUES(@legacyId,CONVERT(BIGINT,@workstationId),CONVERT(BIGINT,@userId),
    HASHBYTES('SHA2_256',CONVERT(VARBINARY(16),NEWID())),N'PASSWORD',
    SYSUTCDATETIME(),SYSUTCDATETIME(),DATEADD(MINUTE,10,SYSUTCDATETIME()),1);
INSERT uqp.SharedWorkstationOperatorState(WorkstationId,DeviceSessionId,StateCode,Generation,Incarnation,
  OperatorSessionId,OperatorUserId,TokenVersion,AuthMethod)
VALUES(CONVERT(BIGINT,@workstationId),@deviceId,
  CASE WHEN @legacyMode=1 THEN N'OPERATOR_ACTIVE' ELSE N'OPERATOR_LOCKED' END,
  CONVERT(BIGINT,'9007199254740993'),@incarnation,
  CASE WHEN @legacyMode=1 THEN @legacyId END,
  CASE WHEN @legacyMode=1 THEN CONVERT(BIGINT,@userId) END,
  CASE WHEN @legacyMode=1 THEN 1 END,CASE WHEN @legacyMode=1 THEN N'PASSWORD' END);
COMMIT;
