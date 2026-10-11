-- Quick PIN policy: a single platform-wide length, default 6 digits.
-- PIN sign-in remains disabled until workstation and session protections are implemented.
IF OBJECT_ID(N'uqp.QuickPinPolicy', N'U') IS NULL
BEGIN
  CREATE TABLE uqp.QuickPinPolicy (
    Id INT NOT NULL CONSTRAINT PK_QuickPinPolicy PRIMARY KEY
      CONSTRAINT CK_QuickPinPolicy_Singleton CHECK (Id=1),
    PinLength INT NOT NULL CONSTRAINT DF_QuickPinPolicy_PinLength DEFAULT (6)
      CONSTRAINT CK_QuickPinPolicy_PinLength CHECK (PinLength BETWEEN 4 AND 12),
    UpdatedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_QuickPinPolicy_UpdatedAt DEFAULT SYSUTCDATETIME()
  );
END;
IF NOT EXISTS (SELECT 1 FROM uqp.QuickPinPolicy WHERE Id=1)
  INSERT INTO uqp.QuickPinPolicy (Id, PinLength) VALUES (1, 6);
