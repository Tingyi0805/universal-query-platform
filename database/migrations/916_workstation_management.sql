-- Schema only. DO NOT execute against the shared production/test database.
-- Additive upgrade after 915; org audiences restrict workstation use, never grant RBAC permissions.
IF OBJECT_ID('uqp.SharedWorkstation','U') IS NULL OR OBJECT_ID('uqp.AppUser','U') IS NULL
 OR OBJECT_ID('uqp.SharedWorkstationSession','U') IS NULL
 OR OBJECT_ID('uqp.SharedWorkstationCredential','U') IS NULL
 OR OBJECT_ID('uqp.PatientListDisclosure','U') IS NULL
 OR OBJECT_ID('uqp.DashboardDisplayDevice','U') IS NULL OR OBJECT_ID('uqp.AuditLog','U') IS NULL
 THROW 50001, 'WORKSTATION_PREREQUISITES_MISSING', 1;
GO
IF COL_LENGTH('uqp.SharedWorkstation','PurposeCode') IS NULL
 ALTER TABLE uqp.SharedWorkstation ADD PurposeCode NVARCHAR(30) NOT NULL CONSTRAINT DF_Workstation_Purpose DEFAULT 'SHARED_QUERY';
IF COL_LENGTH('uqp.SharedWorkstation','SortOrder') IS NULL
 ALTER TABLE uqp.SharedWorkstation ADD SortOrder INT NOT NULL CONSTRAINT DF_Workstation_Sort DEFAULT 0;
IF COL_LENGTH('uqp.SharedWorkstation','RetiredAtUtc') IS NULL
 ALTER TABLE uqp.SharedWorkstation ADD RetiredAtUtc DATETIME2(3) NULL;
IF COL_LENGTH('uqp.SharedWorkstation','LastUsedAtUtc') IS NULL
 ALTER TABLE uqp.SharedWorkstation ADD LastUsedAtUtc DATETIME2(3) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID('uqp.SharedWorkstation') AND name='CK_Workstation_Purpose')
 ALTER TABLE uqp.SharedWorkstation ADD CONSTRAINT CK_Workstation_Purpose CHECK (PurposeCode IN ('SHARED_QUERY','DASHBOARD'));
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID('uqp.SharedWorkstation') AND name='CK_Workstation_Sort')
 ALTER TABLE uqp.SharedWorkstation ADD CONSTRAINT CK_Workstation_Sort CHECK (SortOrder BETWEEN 0 AND 10000);
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID('uqp.SharedWorkstation') AND name='CK_Workstation_Retired')
 ALTER TABLE uqp.SharedWorkstation ADD CONSTRAINT CK_Workstation_Retired CHECK (RetiredAtUtc IS NULL OR (IsActive=0 AND PinLoginEnabled=0));
GO
IF OBJECT_ID('uqp.WorkstationAudience','U') IS NULL
 CREATE TABLE uqp.WorkstationAudience (
  Id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY, Kind NVARCHAR(20) NOT NULL,
  Code NVARCHAR(100) NOT NULL UNIQUE, DisplayName NVARCHAR(200) NOT NULL,
  IsActive BIT NOT NULL DEFAULT 1, Revision INT NOT NULL DEFAULT 1,
  CONSTRAINT CK_WorkstationAudience_Kind CHECK (Kind IN ('DEPARTMENT','GROUP'))
 );
IF OBJECT_ID('uqp.WorkstationAudienceMember','U') IS NULL
 CREATE TABLE uqp.WorkstationAudienceMember (
  AudienceId BIGINT NOT NULL REFERENCES uqp.WorkstationAudience(Id),
  UserId BIGINT NOT NULL REFERENCES uqp.AppUser(Id),
  CONSTRAINT PK_WorkstationAudienceMember PRIMARY KEY (AudienceId,UserId)
 );
IF OBJECT_ID('uqp.SharedWorkstationAudience','U') IS NULL
 CREATE TABLE uqp.SharedWorkstationAudience (
  WorkstationId BIGINT NOT NULL REFERENCES uqp.SharedWorkstation(Id),
  AudienceId BIGINT NOT NULL REFERENCES uqp.WorkstationAudience(Id),
  CONSTRAINT PK_SharedWorkstationAudience PRIMARY KEY (WorkstationId,AudienceId)
 );
GO
IF COL_LENGTH('uqp.DashboardDisplayDevice','SharedWorkstationId') IS NULL
 ALTER TABLE uqp.DashboardDisplayDevice ADD SharedWorkstationId BIGINT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE parent_object_id=OBJECT_ID('uqp.DashboardDisplayDevice') AND name='FK_DisplayDevice_Workstation')
 ALTER TABLE uqp.DashboardDisplayDevice ADD CONSTRAINT FK_DisplayDevice_Workstation
 FOREIGN KEY (SharedWorkstationId) REFERENCES uqp.SharedWorkstation(Id);
GO
