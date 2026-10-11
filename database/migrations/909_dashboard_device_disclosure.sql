-- Dashboard display device attribution for patient disclosure records.
IF COL_LENGTH('uqp.PatientListDisclosure', 'DashboardDeviceId') IS NULL
    ALTER TABLE uqp.PatientListDisclosure ADD DashboardDeviceId BIGINT NULL;
