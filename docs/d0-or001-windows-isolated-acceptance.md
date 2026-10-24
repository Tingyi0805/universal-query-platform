# UQP D0 — OR_001 and Windows/SQL Server acceptance checklist

This checklist is for an **isolated Windows 11 + SQL Server 2019 restored clone**.
It is NOT authorization to run 925 or change the shared production DB.

## 1. Immutable baseline and backup
- Record PR #66 HEAD SHA, source artifact name and SHA256SUMS.
- Preserve deployed C:\UQP files, Server/Client configuration, service task definitions, encryption/HMAC keys and Oracle client settings in approved secure backup storage. Never upload secrets to CI.
- DBA must validate separate SQL Server identity: @@SERVERNAME, DB_NAME(), ORIGINAL_LOGIN(), effective dbo for installer identity, SQL Server major version 15 / compatibility 150.
- Confirm isolated restore really has no production application writers or live device tokens. Reject any connection pointing to shared production DB.
- Capture the existing 923/924/925 catalog state through read-only DBA inspection before attempting a dedicated preflight.
- Only after DBA approval use tools/install-uqp-925.ps1 -Mode Preflight on the clone. Preflight is read-only.
- Installing 925 on the isolated clone requires a separate explicit approval. Do NOT execute Apply against production.

## 2. OR_001 Oracle 11g Thick acceptance (real environment required)
- Confirm Instant Client 64/32-bit compatibility with Node.js process, correct library search path, and read-only HIS login.
- Confirm published Query OR_001 and its Dataset and PRIMARY source binding refer to the intended Dataset.
- Confirm EXAM_DATE parameter type and expected calendar/format from the Dataset definition. Do not assume ISO date or ROC date.
- In Dataset designer preview, enter a synthetic/approved test date and verify parameter binding, Chinese column aliases, expected row count and timeouts.
- In Dashboard designer, confirm PRIMARY source persists EXAM_DATE JSON without requiring legacy Dashboard writer; verify user-visible errors do not show SQL, credentials or patient identifiers.
- Confirm preview enforces Dataset masking: 姓名, 病歷號, phone as configured; OMIT columns are not transmitted, even in source fields or network response.
- For datasets without enabled patient-list audit, absence of a patient key must not falsely block a legitimate preview.
- For patient-audit-enabled datasets, trusted keyring and audit ID must be valid; fail closed if missing. Do not change the SQL to expose patient key in the UI.
- On a restored, isolated system, configure explicit Dataset public-display approvals and verify that PUBLIC device output contains only approved masked columns. A designer preview is NOT evidence that a public device can reveal the data.
- Revoke permission/approval during an active snapshot: cached data must be invalidated; no raw value leak in browser or API.

## 3. Template acceptance
- Create/update/disable an alias template; record auditable actor and version.
- Applying a suggested template must require explicit Dataset editor confirmation and save.
- Published Dataset and linked Dashboards must NOT change automatically when the global template changes.
- Policy revisions must invalidate stale public display confirmations.

## 4. Windows release / rollback
- Build server and client using Node.js 22 in a staging directory. Do not overwrite in-use node_modules or .env.
- Preserve existing settings and keys outside the release bundle. Use health/login/Query/audit smoke checks before approval.
- Disable public playback and new management features until catalog, runtime minimum privileges, Dataset approvals and device permissions are verified.
- On failure, stop playback, restore prior application binaries/configuration safely without deleting 925 tables, patient disclosures or audit history.
- Log results as PASS/FAIL/BLOCKED with redacted request IDs, never real patient identifiers.

## 5. Final gate
A successful GitHub CI is necessary but not sufficient. Keep production deployment BLOCKED until the restored clone, OR_001 Thick Client, 925 permissions and approved rollback procedure are validated and signed off.
