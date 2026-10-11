-- Version the HMAC used for each disclosed patient reference.
-- Never store HMAC key material in the database.
IF COL_LENGTH('uqp.PatientListDisclosureSubject', 'KeyVersion') IS NULL
BEGIN
  ALTER TABLE uqp.PatientListDisclosureSubject
    ADD KeyVersion INT NOT NULL CONSTRAINT DF_PatientListDisclosureSubject_KeyVersion DEFAULT (1);
END;
GO
IF EXISTS (SELECT 1 FROM sys.key_constraints WHERE name='PK_PatientListDisclosureSubject'
  AND parent_object_id=OBJECT_ID(N'uqp.PatientListDisclosureSubject'))
BEGIN
  ALTER TABLE uqp.PatientListDisclosureSubject DROP CONSTRAINT PK_PatientListDisclosureSubject;
END;
GO
IF NOT EXISTS (SELECT 1 FROM sys.key_constraints WHERE name='PK_PatientListDisclosureSubject'
  AND parent_object_id=OBJECT_ID(N'uqp.PatientListDisclosureSubject'))
BEGIN
  ALTER TABLE uqp.PatientListDisclosureSubject ADD CONSTRAINT PK_PatientListDisclosureSubject
    PRIMARY KEY (DisclosureId, KeyVersion, PatientKeyHash);
END;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_PatientListDisclosureSubject_PatientVersion'
  AND object_id=OBJECT_ID(N'uqp.PatientListDisclosureSubject'))
BEGIN
  CREATE INDEX IX_PatientListDisclosureSubject_PatientVersion
    ON uqp.PatientListDisclosureSubject(KeyVersion, PatientKeyHash, DisclosureId);
END;
GO
