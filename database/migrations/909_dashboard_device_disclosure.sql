-- Distinguish DashboardDisplayDevice from PIN workstations in patient disclosure audit.
IF OBJECT_ID(N'uqp.PatientListDisclosure', N'U') IS NULL
    THROW 51009, 'PATIENT_DISCLOSURE_MIGRATION_REQUIRED', 1;
IF OBJECT_ID(N'uqp.DashboardDisplayDevice', N'U') IS NULL
    THROW 51010, 'DASHBOARD_DEVICE_MIGRATION_REQUIRED', 1;
IF COL_LENGTH('uqp.PatientListDisclosure', 'DashboardDeviceId') IS NULL
    ALTER TABLE uqp.PatientListDisclosure ADD DashboardDeviceId BIGINT NULL;
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_PatientListDisclosure_DashboardDevice' AND parent_object_id = OBJECT_ID(N'uqp.PatientListDisclosure'))
    ALTER TABLE uqp.PatientListDisclosure WITH CHECK ADD CONSTRAINT FK_PatientListDisclosure_DashboardDevice FOREIGN KEY (DashboardDeviceId) REFERENCES uqp.DashboardDisplayDevice(Id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_PatientListDisclosure_DashboardDeviceId' AND object_id = OBJECT_ID(N'uqp.PatientListDisclosure'))
    CREATE INDEX IX_PatientListDisclosure_DashboardDeviceId ON uqp.PatientListDisclosure(DashboardDeviceId) WHERE DashboardDeviceId IS NOT NULL;
