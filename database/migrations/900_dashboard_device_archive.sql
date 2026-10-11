-- Device archive is non-destructive. Revoked tokens remain invalid and historical records remain queryable.
IF COL_LENGTH('uqp.DashboardDisplayDevice', 'ArchivedAtUtc') IS NULL
  ALTER TABLE uqp.DashboardDisplayDevice ADD ArchivedAtUtc DATETIME2(0) NULL;
GO
IF OBJECT_ID('uqp.DashboardDeviceArchivePolicy', 'U') IS NULL
BEGIN
  CREATE TABLE uqp.DashboardDeviceArchivePolicy (
    DashboardId BIGINT NOT NULL PRIMARY KEY REFERENCES uqp.Dashboard(Id) ON DELETE CASCADE,
    AutoArchiveEnabled BIT NOT NULL DEFAULT 1,
    RetentionDays INT NOT NULL DEFAULT 90,
    UpdatedByUserId BIGINT NULL,
    UpdatedAtUtc DATETIME2(0) NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT CK_DashboardDeviceArchivePolicy_Days CHECK (RetentionDays BETWEEN 1 AND 3650)
  );
END;
GO
IF OBJECT_ID('uqp.DashboardDeviceArchiveHistory', 'U') IS NULL
BEGIN
  CREATE TABLE uqp.DashboardDeviceArchiveHistory (
    Id BIGINT IDENTITY(1,1) PRIMARY KEY,
    DashboardId BIGINT NOT NULL,
    DeviceId BIGINT NOT NULL,
    ArchiveMode NVARCHAR(10) NOT NULL,
    ArchivedByUserId BIGINT NULL,
    ArchivedAtUtc DATETIME2(0) NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT CK_DashboardDeviceArchiveHistory_Mode CHECK (ArchiveMode IN ('MANUAL','AUTO'))
  );
  CREATE INDEX IX_DashboardDeviceArchiveHistory_Dashboard ON uqp.DashboardDeviceArchiveHistory(DashboardId, ArchivedAtUtc DESC);
END;
GO
CREATE INDEX IX_DashboardDisplayDevice_ArchiveSweep
  ON uqp.DashboardDisplayDevice (DashboardId, IsActive, ArchivedAtUtc, RevokedAtUtc)
  WHERE IsActive=0 AND ArchivedAtUtc IS NULL;
GO
