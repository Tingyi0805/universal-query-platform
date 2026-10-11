-- Explicit per-dataset patient identity mapping for disclosure audit.
-- No automatic patient-field guessing and no patient identifiers stored in this table.
IF OBJECT_ID(N'uqp.DatasetPatientAuditConfig', N'U') IS NULL
BEGIN
  CREATE TABLE uqp.DatasetPatientAuditConfig (
    DatasetId BIGINT NOT NULL PRIMARY KEY,
    IsEnabled BIT NOT NULL CONSTRAINT DF_DatasetPatientAuditConfig_Enabled DEFAULT (0),
    PatientKeyColumn NVARCHAR(128) NOT NULL,
    UpdatedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_DatasetPatientAuditConfig_Updated DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_DatasetPatientAuditConfig_Dataset FOREIGN KEY (DatasetId)
      REFERENCES uqp.Dataset(Id) ON DELETE CASCADE,
    CONSTRAINT CK_DatasetPatientAuditConfig_Key CHECK (LEN(LTRIM(RTRIM(PatientKeyColumn))) > 0)
  );
END;
GO
