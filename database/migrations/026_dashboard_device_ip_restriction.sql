IF COL_LENGTH('uqp.DashboardDisplayDevice', 'EnforceIpRestriction') IS NULL
BEGIN
    ALTER TABLE uqp.DashboardDisplayDevice
    ADD EnforceIpRestriction BIT NOT NULL
        CONSTRAINT DF_DashboardDisplayDevice_EnforceIpRestriction DEFAULT (0);
END
GO

IF COL_LENGTH('uqp.DashboardDisplayDevice', 'AllowedIp') IS NULL
BEGIN
    ALTER TABLE uqp.DashboardDisplayDevice
    ADD AllowedIp NVARCHAR(64) NULL;
END
GO

IF COL_LENGTH('uqp.DashboardDisplayDevice', 'AllowedCidr') IS NULL
BEGIN
    ALTER TABLE uqp.DashboardDisplayDevice
    ADD AllowedCidr NVARCHAR(64) NULL;
END
GO
