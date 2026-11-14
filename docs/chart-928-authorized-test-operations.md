# PR99 — Windows Server / Node24.22.1 CHART authorized test

Option A uses the **existing platform SQL Pool and middleware-verified JWT Actor**. No new Writer Login, Signer or Issuer.
The original four gates remain: accepted design, target/schema/source, actor/privacy/atomicity, controlled Windows test.
This document authorizes no production deployment. Nothing runs on extraction or overwrites C:\UQP automatically.

## What changes

Default production constants remain false. An explicitly operator-managed, expiring test file enables only named Dashboard IDs,
only with NODE_ENV=test, exact SQL server/database/original-login identity, the installed TEST extended property and all eight
pinned SQL module hashes. The packaged925 DDL is only the existing Catalog validator's comparison source; never execute it as part of928 installation. Missing file, expiry, wrong target, absent/tampered module or revoked actor fails closed.
Browser URL/query/config flags cannot enable the server. Browser capability booleans only permit attempting an authenticated API.
No JWT secret, password, Device Token or original SQL is returned by those capabilities.

Native create → Widget/Seal/Audit → readback uses the existing single Pool procedure and live JWT checks.
Existing Layout Designer exposes the selected sealed CHART's playback approval/revoke and public aggregate review actions.
A different active SYSTEM_ADMIN reviews public category/differencing risk (minimum cell size >=5); user/device still require
Dataset public display confirmation, Query ACL, current TokenVersion, grouped COUNT proof, versions, masking and disclosure Audit.
No column-name classification, raw-row client aggregation, or implicit public approval is added.
The privacy fingerprint now binds data/policy/source revisions independently of a particular viewer's actor ID; every viewer's
permissions and TokenVersion remain independently checked before/after delivery. A reviewer cannot approve their own requested review.

Cookie Kiosk extends its original HTTPS/same-origin/purpose-bound session checks only to the CHART capability GET and,
when test-enabled, exact CHART projection POST. The token stays in HttpOnly cookies/server memory, never becomes a JWT.
Direct Device Token playback continues to use its separate Token/IP/version path. Unapproved modes remain denied.

## Manual test preparation — preserve existing .env

1. Verify this exact Commit and CI, download the **Windows x64 Node24.22.1/ABI137** ZIP, verify ZIP SHA256 and the extracted
   manifest with `node verify-pr99-chart-test.mjs <extracted-folder>`. Linux node_modules are not a Windows delivery.
2. An authorized operator identifies the test SQL server/database/login and records a restorable full DB backup and change receipt.
   Reuse existing 925/926 observations; the dedicated preflight reconciles actual catalog/ledger and never invents missing history.
   Cleanly absent927 is acceptable. Existing partial928 or unsealed CHART is refused, not repaired. Never install disposable fixtures
   into the hospital DB or mark it UQP_CHART_TEST_DISPOSABLE. The new sources contain no fixture users, patient rows or Login grants.
3. Stop the **test** process/IIS app pool manually. Back up C:\UQP application files and separately safeguard the existing .env.
   Copy ZIP `payload` over the authorized test C:\UQP. The ZIP excludes .env; do not delete or replace it. Do not run generic db:migrate
   for928. No deployment/update utility is introduced. Do not overlay the live service simply because CI is green.
4. Outside the web root, create an ACL-restricted JSON file, for example C:\UQP-approvals\chart-test.json (service identity READ only;
   administrators maintain it). Replace placeholders deliberately; expiry is UTC and at most7 days from activation:

```json
{
 "version":1,"purpose":"UQP_AUTHORIZED_CHART_TEST_ONLY",
 "target":{"server":"EXACT @@SERVERNAME","database":"EXACT TEST DB_NAME()","login":"EXACT ORIGINAL_LOGIN()"},
 "dashboardIds":[7],"expiresAt":"REPLACE WITH ISO UTC EXPIRY",
 "changeReceipt":"APPROVED TEST CHANGE REFERENCE","backupReceipt":"VERIFIED RESTORABLE TEST BACKUP REFERENCE",
 "privacy":"EXISTING_REVIEW_AND_PATIENT_AUDIT_REQUIRED"
}
```

The file is a test-operator authorization record, not a SQL identity/signature or proof that a backup actually exists. Validate the
backup by the established DBA process; do not add it or credentials to Git. A compromised UQP service/JWT key remains within Option A's
accepted application trust boundary; this implementation does not claim protection from a hostile sysadmin or a rewritten service.

## SQL order — manual, explicit and separate from ZIP copying

In an elevated **authorized test operator** PowerShell, with the original server .env still present:

```powershell
Set-Location C:\UQP\server
$env:NODE_ENV='test'
$env:UQP_CHART_AUTHORIZED_TEST_FILE='C:\UQP-approvals\chart-test.json'
node dist/scripts/installChart928AuthorizedTest.js preflight
# Read the outcome. Stop on target/catalog/visibility/ledger/partial mismatch.
node dist/scripts/installChart928AuthorizedTest.js apply
node dist/scripts/installChart928AuthorizedTest.js verify
```

`apply` requires absent928 and runs the three pinned **database/authorized-test/*.sql.txt** sources in order: frozen base,
playback approval, single-Pool Writer. One SERIALIZABLE transaction covers DDL, exact module verification, TEST marker and the explicit
`928_chart_authorized_test.sql` ledger receipt. It does not create accounts, grant privileges or repair925/926 ledger.
A repeated `apply` refuses installation; use `verify`. Missing rights require an authorized DBA to review the existing account's
minimum DDL/metadata/EXECUTE permissions; do not create an independent Writer login or routinely grant sa/db_owner.
Runtime needs existing UQP object rights plus EXECUTE on uqp.usp_DashboardChartCreate and required metadata visibility. No VIEW SERVER STATE
is requested by the new test path. SQL source has a mandatory exact-target parameter guard and is not a standalone SSMS migration.
The old production-review SQL guards remain unchanged.

Start only the authorized test Node/IIS service with those **process-level** variables; do not rewrite .env or JWT_SECRET.
IIS/service managers must explicitly supply the same environment. Ordinary startup without this file stays disabled.
Existing Dashboard Query-source/playback settings and permissions must already be configured; this feature does not silently change them.

## User test (small synthetic grouped-count Dataset only)

- Use an already authorized managed Query source and explicit Dataset field/public policy. SQL must satisfy the existing narrow GROUP BY/COUNT proof.
- Save the existing layout, create the native CHART with the dedicated button, then confirm readback. Do not save CHART through legacy whole-layout PUT.
- Select the sealed CHART. An active SYSTEM_ADMIN with MANAGE_USERS can approve/revoke its exact Seal revision/digest.
- For user/device public playback, request aggregate review; a **different** authorized administrator confirms category/differencing risk and threshold.
  Use an ordinary authorized Query user/device delegator for playback; the independent reviewer cannot substitute their own identity for viewers.
- Open ordinary user playback and direct-token or HTTPS Cookie Kiosk playback. Only audited server projections supply chart points.
- Revoke approval. Requests started after revocation must not deliver new points; late revocation during delivery is checked again before return.
  Existing displayed projections clear on the bounded revalidation interval; this is not a promise to retract bytes already delivered.
- TokenVersion/ACL/Seal/source/policy changes, small groups, stale privacy review or Audit failure must stop delivery. No raw rows or patient identifiers
  should appear in chart payloads/errors. Do not bypass a denial by weakening Dataset policy.

## Recovery and remaining acceptance

Before commit, installer failure rolls back; an unknown commit/rollback acknowledgment stops with a reconciliation error and MUST NOT be auto-retried.
After installation, immediately disable test delivery by removing the process test-file variable (or letting it expire) and restart the test process.
Restore the previous application backup while retaining .env. Preserve Chart/Audit history; do not DROP trust tables to erase decisions.
If DB rollback is required, the authorized DBA restores the previously verified **test-target** backup under the existing change procedure.
No automated restore/drop script is shipped. Existing production switches, historical925/926/927 migrations and general updater behavior are unchanged.

Existing accepted Stage18 and JWT/SQL2019/2022 creation evidence are reused. New exact test-install sources are exercised only by the existing disposable
SQL2019/2022 CI jobs (transactionally rolled back); Windows packaging/native ABI and changed browser flows use the existing CI jobs.
CI is not actual Windows/IIS/hospital-target UAT. Gate4 manual test and explicit actual-target authorization remain the operator's responsibility.
