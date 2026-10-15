/*
UQP R0: read-only migration ledger export (Windows Server / SSMS).
Only run after choosing the existing UQP production database in SSMS.
No DDL/DML, no stored procedure, no database configuration changes.
Run with a read-only DBA-authorized account. Do not execute db:migrate:status.
*/
SET NOCOUNT ON;
SELECT DB_NAME() AS SelectedDatabase, CASE WHEN OBJECT_ID(N'uqp.SchemaMigration', N'U') IS NULL THEN 0 ELSE 1 END AS LedgerExists;
IF OBJECT_ID(N'uqp.SchemaMigration', N'U') IS NOT NULL
BEGIN
    -- Dynamic SQL defers table name binding if the migration ledger is absent.
    EXEC sys.sp_executesql N'SELECT FileName, AppliedAtUtc FROM uqp.SchemaMigration ORDER BY FileName;';
END;
-- Copy only the two result grids; do not export patient/business data or connection secrets.
