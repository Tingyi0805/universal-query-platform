-- Shared workstation and PIN foundation. Schema only: no PIN login enabled by this migration.
-- Apply after existing migrations; no changes to existing JWT or dashboard-device tokens.
IF OBJECT_ID('uqp.SharedWorkstation','U') IS NULL
BEGIN
 CREATE TABLE uqp.SharedWorkstation (
  Id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
  WorkstationCode NVARCHAR(100) NOT NULL UNIQUE,
  DisplayName NVARCHAR(200) NOT NULL,
  IsActive BIT NOT NULL CONSTRAINT DF_SharedWorkstation_Active DEFAULT 0,
  PinLoginEnabled BIT NOT NULL CONSTRAINT DF_SharedWorkstation_PinEnabled DEFAULT 0,
  CredentialVersion INT NOT NULL CONSTRAINT DF_SharedWorkstation_Version DEFAULT 1,
  CreatedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_SharedWorkstation_Created DEFAULT SYSUTCDATETIME(),
  UpdatedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_SharedWorkstation_Updated DEFAULT SYSUTCDATETIME()
 );
END;
GO
IF OBJECT_ID('uqp.SharedWorkstationUser','U') IS NULL
BEGIN
 CREATE TABLE uqp.SharedWorkstationUser (
  WorkstationId BIGINT NOT NULL,
  UserId BIGINT NOT NULL,
  IsAllowed BIT NOT NULL CONSTRAINT DF_SharedWorkstationUser_Allowed DEFAULT 1,
  CreatedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_SharedWorkstationUser_Created DEFAULT SYSUTCDATETIME(),
  CONSTRAINT PK_SharedWorkstationUser PRIMARY KEY (WorkstationId, UserId),
  CONSTRAINT FK_SharedWorkstationUser_Workstation FOREIGN KEY (WorkstationId) REFERENCES uqp.SharedWorkstation(Id)
 );
END;
GO
IF OBJECT_ID('uqp.UserQuickPin','U') IS NULL
BEGIN
 CREATE TABLE uqp.UserQuickPin (
  UserId BIGINT NOT NULL PRIMARY KEY,
  PinHash NVARCHAR(512) NOT NULL,
  PinVersion INT NOT NULL CONSTRAINT DF_UserQuickPin_Version DEFAULT 1,
  IsEnabled BIT NOT NULL CONSTRAINT DF_UserQuickPin_Enabled DEFAULT 0,
  FailedAttempts INT NOT NULL CONSTRAINT DF_UserQuickPin_Failed DEFAULT 0,
  LockedUntilUtc DATETIME2(3) NULL,
  CreatedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_UserQuickPin_Created DEFAULT SYSUTCDATETIME(),
  UpdatedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_UserQuickPin_Updated DEFAULT SYSUTCDATETIME(),
  CONSTRAINT CK_UserQuickPin_Failed CHECK (FailedAttempts >= 0)
 );
END;
GO
IF OBJECT_ID('uqp.SharedWorkstationSession','U') IS NULL
BEGIN
 CREATE TABLE uqp.SharedWorkstationSession (
  Id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
  WorkstationId BIGINT NOT NULL,
  UserId BIGINT NOT NULL,
  SessionSecretHash VARBINARY(32) NOT NULL,
  AuthMethod NVARCHAR(20) NOT NULL,
  AuthenticatedAtUtc DATETIME2(3) NOT NULL,
  LastActivityAtUtc DATETIME2(3) NOT NULL,
  ExpiresAtUtc DATETIME2(3) NOT NULL,
  RevokedAtUtc DATETIME2(3) NULL,
  TokenVersion INT NOT NULL,
  PinVersion INT NULL,
  CONSTRAINT FK_SharedWorkstationSession_Workstation FOREIGN KEY (WorkstationId) REFERENCES uqp.SharedWorkstation(Id),
  CONSTRAINT CK_SharedWorkstationSession_Method CHECK (AuthMethod IN ('PASSWORD','PIN','STEP_UP')),
  CONSTRAINT CK_SharedWorkstationSession_Expiry CHECK (ExpiresAtUtc > AuthenticatedAtUtc)
 );
 CREATE INDEX IX_SharedWorkstationSession_Workstation ON uqp.SharedWorkstationSession(WorkstationId, RevokedAtUtc, ExpiresAtUtc);
 CREATE INDEX IX_SharedWorkstationSession_User ON uqp.SharedWorkstationSession(UserId, RevokedAtUtc);
 CREATE UNIQUE INDEX UX_SharedWorkstationSession_OneActive ON uqp.SharedWorkstationSession(WorkstationId) WHERE RevokedAtUtc IS NULL;
END;
GO
IF OBJECT_ID('uqp.DashboardAuthenticationPolicy','U') IS NULL
BEGIN
 CREATE TABLE uqp.DashboardAuthenticationPolicy (
  DashboardId BIGINT NOT NULL PRIMARY KEY,
  PolicyCode NVARCHAR(30) NOT NULL CONSTRAINT DF_DashboardAuthenticationPolicy_Code DEFAULT 'STAFF_SECURE',
  IdleLockSeconds INT NOT NULL CONSTRAINT DF_DashboardAuthenticationPolicy_Idle DEFAULT 180,
  UpdatedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_DashboardAuthenticationPolicy_Updated DEFAULT SYSUTCDATETIME(),
  CONSTRAINT CK_DashboardAuthenticationPolicy_Code CHECK (PolicyCode IN ('PUBLIC','STAFF_FAST','STAFF_SECURE','SENSITIVE')),
  CONSTRAINT CK_DashboardAuthenticationPolicy_Idle CHECK (IdleLockSeconds BETWEEN 30 AND 3600)
 );
END;
GO