-- Device credential foundation; DOES NOT enable PIN sign-in.
-- Each credential is random, stored as SHA-256 hash only, and can be revoked independently.
IF OBJECT_ID(N'uqp.SharedWorkstationCredential', N'U') IS NULL
BEGIN
  CREATE TABLE uqp.SharedWorkstationCredential (
    Id UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_SharedWorkstationCredential PRIMARY KEY,
    WorkstationId BIGINT NOT NULL,
    SecretHash VARBINARY(32) NOT NULL,
    CredentialVersion INT NOT NULL,
    IsRevoked BIT NOT NULL CONSTRAINT DF_SharedWorkstationCredential_Revoked DEFAULT (0),
    CreatedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_SharedWorkstationCredential_Created DEFAULT SYSUTCDATETIME(),
    RevokedAtUtc DATETIME2(3) NULL,
    CONSTRAINT FK_SharedWorkstationCredential_Workstation FOREIGN KEY (WorkstationId)
      REFERENCES uqp.SharedWorkstation(Id),
    CONSTRAINT CK_SharedWorkstationCredential_Revocation CHECK
      ((IsRevoked=0 AND RevokedAtUtc IS NULL) OR (IsRevoked=1 AND RevokedAtUtc IS NOT NULL))
  );
  CREATE INDEX IX_SharedWorkstationCredential_Workstation
    ON uqp.SharedWorkstationCredential (WorkstationId, IsRevoked);
END;
GO
