-- Optional inventory metadata only; platform declaration is NOT device identity proof.
-- Apply after 902-904. Existing records remain UNKNOWN until reviewed.
IF COL_LENGTH('uqp.SharedWorkstation', 'PlatformCode') IS NULL
  ALTER TABLE uqp.SharedWorkstation ADD PlatformCode NVARCHAR(20) NOT NULL
    CONSTRAINT DF_SharedWorkstation_Platform DEFAULT ('UNKNOWN');
GO
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name='CK_SharedWorkstation_Platform')
  ALTER TABLE uqp.SharedWorkstation ADD CONSTRAINT CK_SharedWorkstation_Platform
    CHECK (PlatformCode IN ('WINDOWS','ANDROID','IOS','UNKNOWN'));
GO
