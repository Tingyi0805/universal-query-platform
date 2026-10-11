-- Audit the set of patient identifiers disclosed by each paginated list response.
-- This is a delivery record, NOT proof that each row was read by a human.
IF OBJECT_ID(N'uqp.PatientListDisclosure', N'U') IS NULL
BEGIN
  CREATE TABLE uqp.PatientListDisclosure (
    Id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    AuditLogId BIGINT NULL,
    UserId BIGINT NULL,
    WorkstationId BIGINT NULL,
    SessionId UNIQUEIDENTIFIER NULL,
    QueryDefinitionId BIGINT NULL,
    DatasetId BIGINT NULL,
    DeliveryType NVARCHAR(20) NOT NULL,
    RowCount INT NOT NULL,
    PageNumber INT NULL,
    Masked BIT NOT NULL CONSTRAINT DF_PatientListDisclosure_Masked DEFAULT (0),
    DisclosedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_PatientListDisclosure_Time DEFAULT SYSUTCDATETIME(),
    CONSTRAINT CK_PatientListDisclosure_Type CHECK (DeliveryType IN ('MANUAL','PAGE','AUTO_REFRESH','DASHBOARD')),
    CONSTRAINT CK_PatientListDisclosure_Rows CHECK (RowCount BETWEEN 0 AND 10000)
  );
  CREATE INDEX IX_PatientListDisclosure_UserTime ON uqp.PatientListDisclosure(UserId, DisclosedAtUtc DESC);
END;
GO
IF OBJECT_ID(N'uqp.PatientListDisclosureSubject', N'U') IS NULL
BEGIN
  CREATE TABLE uqp.PatientListDisclosureSubject (
    DisclosureId BIGINT NOT NULL,
    PatientKeyHash VARBINARY(32) NOT NULL,
    CONSTRAINT PK_PatientListDisclosureSubject PRIMARY KEY (DisclosureId, PatientKeyHash),
    CONSTRAINT FK_PatientListDisclosureSubject_Disclosure FOREIGN KEY (DisclosureId)
      REFERENCES uqp.PatientListDisclosure(Id)
  );
  CREATE INDEX IX_PatientListDisclosureSubject_Patient ON uqp.PatientListDisclosureSubject(PatientKeyHash, DisclosureId);
END;
GO
