/*
UQP R0: read-only migration ledger verification (Windows Server / SSMS).
Select the existing UQP production database explicitly in SSMS before running.
Only metadata / migration filename rows. No DDL, DML, EXEC, or configuration changes.
*/
SET NOCOUNT ON;
SELECT DB_NAME() AS SelectedDatabase,
       CASE WHEN OBJECT_ID(N'uqp.SchemaMigration', N'U') IS NULL THEN 0 ELSE 1 END AS LedgerExists;

/*
If LedgerExists = 1, and the DBA grants SELECT on uqp.SchemaMigration,
run this SECOND query separately in SSMS (highlight only its SELECT statement):

SELECT FileName, AppliedAtUtc
FROM uqp.SchemaMigration
ORDER BY FileName;

If LedgerExists = 0, STOP and report this result. Never create a ledger or
run db:migrate:status; that command can write to the database.
Share only these result grids after reviewing internal server identifiers.
*/
