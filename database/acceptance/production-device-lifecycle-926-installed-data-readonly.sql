/* UQP D5-C-5B OPTIONAL INSTALLED-STATE DATA CHECK. SELECT ONLY.
Run manually in SSMS ONLY AFTER the main preflight shows both 926 columns have exact types.
If both markers are absent, do NOT run this file: their new NULL values make the new two checks true on upgrade.
If one marker is absent/wrong, main preflight is BLOCKED. No dynamic SQL or automatic schema repair is used.
Context must be EINOV-VPN / existing UniversalQueryPlatform. No names, hashes, tokens or row JSON are returned.
This is an aggregate current-state CHECK audit, not historical transition/Enrollment-proof verification.
*/
;WITH D AS (
 SELECT
 CASE WHEN RevokedAtUtc IS NOT NULL AND IsActive<>0 THEN 0 WHEN ArchivedAtUtc IS NOT NULL AND IsActive<>0 THEN 0 ELSE 1 END AS TerminalPass,
 CASE WHEN SuspendedAtUtc IS NULL THEN 1 WHEN IsActive=0 AND RevokedAtUtc IS NULL AND ArchivedAtUtc IS NULL AND ReenrollmentRequired=1 AND QueryModeGrantVersion IS NULL AND DelegatorTokenVersion IS NULL THEN 1 ELSE 0 END AS SuspendedPass,
 CASE WHEN ReenrollmentRequired IS NULL THEN 1 WHEN RevokedAtUtc IS NOT NULL THEN 0 WHEN ArchivedAtUtc IS NOT NULL THEN 0 WHEN SuspendedAtUtc IS NOT NULL THEN 1 WHEN IsActive=1 THEN 1 ELSE 0 END AS EnrollmentPass
 FROM uqp.DashboardDisplayDevice WHERE DB_NAME()=N'UniversalQueryPlatform'
), A AS (
 SELECT COUNT_BIG(*) AS DeviceCount,
 COALESCE(SUM(CONVERT(bigint,1-TerminalPass)),0) AS TerminalViolations,
 COALESCE(SUM(CONVERT(bigint,1-SuspendedPass)),0) AS SuspendedViolations,
 COALESCE(SUM(CONVERT(bigint,1-EnrollmentPass)),0) AS EnrollmentViolations FROM D
)
SELECT N'15_INSTALLED_926_DATA' AS Section,SYSUTCDATETIME() AS CapturedAtUtc,A.*,
 CASE WHEN DB_NAME()<>N'UniversalQueryPlatform' THEN N'BLOCKED_WRONG_DATABASE'
 WHEN COALESCE(HAS_PERMS_BY_NAME(DB_NAME(),N'DATABASE',N'VIEW DEFINITION'),0)<>1 THEN N'BLOCKED_VISIBILITY'
 WHEN TerminalViolations<>0 OR SuspendedViolations<>0 OR EnrollmentViolations<>0 THEN N'BLOCKED_EXISTING_926_DATA'
 ELSE N'PASS_CURRENT_CHECK_DATA_NOT_HISTORICAL_TRANSITIONS' END AS Assessment FROM A;
