IF COL_LENGTH('uqp.AppUser', 'TokenVersion') IS NULL
BEGIN
    ALTER TABLE uqp.AppUser
    ADD TokenVersion INT NOT NULL
        CONSTRAINT DF_AppUser_TokenVersion DEFAULT (1);
END
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.check_constraints
    WHERE name='CK_AppUser_TokenVersion_Positive'
      AND parent_object_id=OBJECT_ID('uqp.AppUser')
)
BEGIN
    ALTER TABLE uqp.AppUser
    ADD CONSTRAINT CK_AppUser_TokenVersion_Positive
        CHECK (TokenVersion >= 1);
END
GO
