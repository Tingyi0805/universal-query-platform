-- Independent playback placement configuration; does not change device tokens.
IF OBJECT_ID('uqp.DashboardDevicePlaybackSettings','U') IS NULL
BEGIN
 CREATE TABLE uqp.DashboardDevicePlaybackSettings (
  DashboardId BIGINT NOT NULL,
  DeviceId BIGINT NOT NULL PRIMARY KEY,
  Browser NVARCHAR(10) NOT NULL DEFAULT 'edge',
  ScreenNumber INT NOT NULL DEFAULT 2,
  Fullscreen BIT NOT NULL DEFAULT 1,
  WindowX INT NOT NULL DEFAULT 1920,
  WindowY INT NOT NULL DEFAULT 0,
  WindowWidth INT NOT NULL DEFAULT 1920,
  WindowHeight INT NOT NULL DEFAULT 1080,
  UpdatedAtUtc DATETIME2(0) NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT FK_DashboardDevicePlaybackSettings_Device FOREIGN KEY (DeviceId) REFERENCES uqp.DashboardDisplayDevice(Id),
  CONSTRAINT CK_DashboardDevicePlaybackSettings_Browser CHECK (Browser IN ('chrome','edge')),
  CONSTRAINT CK_DashboardDevicePlaybackSettings_Screen CHECK (ScreenNumber BETWEEN 1 AND 16),
  CONSTRAINT CK_DashboardDevicePlaybackSettings_Size CHECK (WindowWidth>=200 AND WindowHeight>=200)
 );
END;
GO
