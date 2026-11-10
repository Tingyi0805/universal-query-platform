# Dashboard CHART / Migration 928 — read-only deployment readiness

**Status (2026-11-09): BLOCKED, NOT APPROVED.** This file and the accompanying SQL are assessment aids, not an installer, a 928 migration, an authorization to apply SQL, or a statement about the actual hospital database.

## Artifact

`database/acceptance/chart-928-adoption-preflight-readonly.sql` is a metadata-only, SQL Server 2019/2022 compatible **SELECT-only** report with no `GO`, DDL, SQL principal grants, data updates, Ledger mutation or direct access to clinical rows. It reports:

- Database name, engine version, observation time and the immutable **MayInstall928 = 0** security boundary;
- Minimum base objects, independent 925 three-table presence and relevant column names;
- 928 sidecar status **ABSENT_NOT_AUTHORIZED**, **BLOCKED_PARTIAL_OR_CONFLICT**, or **PRESENT_REQUIRES_EXACT_ATTESTATION**;
- The named 928 trigger/sidecar inventory, existing WidgetType CHECK constraint flags and catalog visibility;
- Mandatory independent gates that **cannot be marked PASS by this script**.

The SQL reports no patient row values. The database name is displayed for target confirmation; when saving an evidence report, store it in an approved location. To use it later, an authorized DBA may execute this read-only source explicitly in the *intended* DB and review the results. The existence of a `SchemaMigration` table or a 925 table is **not** evidence that its specific migration was applied correctly.

## What has already been tested in disposable CI

`server/src/scripts/chart928DraftSqlAcceptance.ts` invokes the *same unchanged* report in SQL Server 2019/2022 disposable `UQP_CH_*` databases:

1. **ABSENT**: no 928 sidecar tables; report still **blocks** adoption and never marks 925 as exact.
2. **PARTIAL**: test fixture creates just one sidecar placeholder table. Report says `BLOCKED_PARTIAL_OR_CONFLICT`, keeps the table untouched; test removes it before normal isolated 928 installation.
3. **PRESENT**: after isolated 928 draft installation, reports `PRESENT_REQUIRES_EXACT_ATTESTATION` but **MayInstall928 stays false**. The existing detailed catalog/trigger tests still validate SQL schema behavior.
4. Before/after read-only probes compare `sys.objects` counts to prove the report itself does not install/modify objects.

No CI fixture, isolated database, or synthetic approval can replace the user's existing production system acceptance and change management.

## Remaining non-negotiable approval evidence

| Gate | Required evidence | State |
|---|---|---|
| 925 exact baseline | Run or review the existing **exact** 925 Catalog Validator for all three 925 tables, verifying identity properties, types/lengths/nulls/collations, defaults, PK/UQ/FK/INDEX/CHECK and no unexpected triggers | **Pending**; table/count matches alone are insufficient |
| Migration 926/927 footprint | Compare actual target catalog, Ledger and source identities against the deployment inventory; preserve previous migrations and necessary data | **Target-specific proof pending** |
| Reviewed 928 SQL | Review the draft sidecar DDL, specific Widget CHECK and trigger SHA/procedural source, FKs, privacy lifecycle, transaction/rollback and independent Writer/Issuer/Grant schema | **Not a production migration** |
| Credentials and provenance | Independently provision signer process, key rotation, mTLS, trusted issuer/Writer SIDs, least-privilege SQL logins, permissions and incident revocation | **Not deployed or approved** |
| Patient-safe Query | Signed review of aggregate fields, small-cell and differencing policy, disclosure audit, Query ACL, device Token/IP restrictions | **Runtime release remains off** |
| Change-control/UAT | Verified backup and recovery, SQL 2019/2022 isolated rehearsals, explicit deployment authorization, Windows/IIS test acceptance | **Not granted** |

## Release mechanics

- `database/drafts/928_*.sql.draft` remain **non-scanned experimental SQL**. They must not be moved automatically to `database/migrations`, uploaded as an install script, or executed on shared/UQP production SQL based only on CI PASS.
- `database/acceptance/migration-inventory.json` and all existing migration file SHA values stay unchanged. No synthetic `SchemaMigration` entry for 928 is created.
- The real `CHART` HTTP, SQL writer and signer hard gates remain false; a reviewed future release must bind independently approved SQL source and authorizer with native Dashboard creation/persistence/authorized data delivery/playback.
- Test environment `C:\UQP` and existing Dashboard devices remain unchanged.

**Consequence:** This PR closes the *catalog inventory/read-only preflight* gap, not the migration acceptance or availability of a production CHART feature. The original 925 exact-schema mismatch history makes a distinct validator and explicit approval mandatory.

## Unified exact-925 + 928 metadata-only target inspection (Issue #89)

A new **explicit, read-only** operator command reuses the existing reviewed
`validateDisplayCatalog` exact 925 comparison and the unchanged
`database/acceptance/chart-928-adoption-preflight-readonly.sql` report:

```text
cd server
npm run db:chart:preflight
```

Before an authorized operator can use it, the existing platform DB connection
must be configured, together with all three explicit target identity variables:
`UQP_CHART_PREFLIGHT_EXPECTED_SERVER`,
`UQP_CHART_PREFLIGHT_EXPECTED_DATABASE` and
`UQP_CHART_PREFLIGHT_EXPECTED_LOGIN`. The values must match **@@SERVERNAME,
DB_NAME(), ORIGINAL_LOGIN()** exactly. SQL Server 2019/2022 are recognized.
No default target, inferred identity, apply flag, DDL, DML, 928 installation,
login provisioning or migration-ledger write is supported.

The result independently distinguishes `catalog925.status=EXACT_MATCH`,
`ABSENT` or `BLOCKED_MISMATCH` with a controlled diagnostic, plus the
928 sidecar state. `mayInstall928=false`,
`chartCanBeEnabled=false`, and
`assessment=BLOCKED_INDEPENDENT_APPROVAL_REQUIRED` are **immutable**
regardless of 925 status or observed 928 objects. Missing catalog visibility
blocks exact attestation. A non-exact 925, missing/partial/invisible
926 or 927 footprint, contradictory Ledger, or unrecorded 926/927 exits with
status 2. Target/SQL/report errors exit with status 1. Exit 0 means **only**
that the exact 925 and existing reviewed 926/927 catalog validators match,
their observed Ledger entries are coherent, and 928 is absent;
it does NOT attest independent migration-source provenance, identify
approved Signer or Writer principals, or grant permission to proceed with 928.

CI invokes this same inspection against disposable, correctly installed 925
catalogs and verifies the `sys.objects` count is unchanged before/after.
No output from CI or from the standalone checker substitutes for required
human review of 925/926/927 evidence, 928 transaction source, signer and
separate SQL identities, privacy review or authorized deployment.

## Native Dashboard CHART CREATE UX (Issue #89, draft)

The original Layout Designer now asks the authenticated server route
`GET /api/dashboards/:id/charts/v1/capabilities` whether the dedicated CHART
CREATE capability is available. Its release flag remains **hard OFF**:
`canCreate=false` is an informational response, not an approval or SQL
preflight, and the same server independently enforces the POST release gate.

The existing chart draft editor uses only synthetic preview points. If the
future independently approved server explicitly returns `canCreate=true`,
a signed-in designer may submit only `profileId`, a fresh
`requestId`, validated CHART config and geometry through
`POST /api/dashboards/:id/charts/v1`. The browser never supplies ActorId,
grants, private signing keys, SQL text, raw Query rows or privacy approval.

Creation is denied in the UI unless the original layout is unchanged, the
profile ID was reloaded from the server, the source/version remains valid,
and both DESIGN_QUERY and EXECUTE_QUERY are present. A legacy layout PUT
recreates profile identities; after that write, the CHART create button
remains disabled until an explicit reload.

A successful HTTP 201 alone does not end the operation: the designer checks
the strict WidgetId/SealRevision/AuditLogId receipt, reads the server layout
again, verifies the created CHART ID/profile/placement and only then reloads.
Uncertain or failed responses are not automatically retried to avoid duplicate
SQL-owned seals. The legacy delete-and-recreate layout API continues blocking
a Dashboard containing saved CHART. No CHART field update/delete/move, public
device playback, SQL 928 installation or release approval is implied.

Unit tests and browser HTTP-mocked tests prove the *native* UI's fail-closed,
create-and-readback contract. They are not evidence that a hospital SQL Writer,
Signer or authorized clinical Query was exercised.

## 926/927 footprint + Ledger (read-only; **not** exact adoption)

The unified `db:chart:preflight` report additionally reads **only
system-catalog metadata and the two known migration filenames** from
`uqp.SchemaMigration`:

- **926**: DashboardDisplayDevice baseline, SuspendedAtUtc /
  ReenrollmentRequired columns, three lifecycle CHECK names and the
  lifecycle trigger's presence.
- **927**: SharedWorkstation baseline, SwitchVersion column,
  WorkstationPinAttemptBucket table and primary-key presence.
- **Ledger**: independently indicates whether the exact 926 and 927
  migration filenames were recorded. It does not inspect device token
  hashes, PIN attempts, patient data, Workstation credentials or audit rows.

Statuses are `ABSENT`, `PARTIAL_OR_CONFLICT`,
`PRESENT_REQUIRES_EXACT_ATTESTATION`, or
`BLOCKED_BASELINE_MISSING_OR_INVISIBLE`. A "present" 926 footprint now
requires the three named CHECK constraints to be enabled/trusted and the
lifecycle trigger to be enabled with the expected UPDATE event. A "present"
927 footprint requires a live primary-key index. Viewing baseline object
definitions requires `VIEW DEFINITION`; invisible metadata cannot masquerade
as an absent/healthy installation.

Each result has `exactAttested=false` **even when** the ledger says
`RECORDED_NOT_ATTESTED`. The additional `consistency` distinguishes
`COHERENT_NOT_ATTESTED`, `BLOCKED_LEDGER_CATALOG_CONFLICT` (for
example, ledger recorded but table absent, or table present without ledger)
and `BLOCKED_PARTIAL_OR_INVISIBLE`. Missing/unreadable Ledger,
malformed metadata or failed target identity checks block the entire
command. Catalog/ledger conflicts or incomplete footprints make the CLI
exit with status 2 even if the 925 exact validator itself succeeds.

The same unified preflight now **also invokes the existing reviewed 926
and 927 catalog validators** when the corresponding footprint is present.
The `historicalExactCatalog.schema926/schema927` values are
`EXACT_REVIEWED_CATALOG_MATCH`,
`NOT_RUN_FOOTPRINT_INCOMPLETE`, or
`BLOCKED_CATALOG_MISMATCH_OR_INVISIBLE`. The 926 validator inspects the
actual CHECK definitions, enabled/trusted flags and lifecycle trigger
definition hash; the 927 validator checks detailed column/index/default/
constraint metadata. The latter uses temporary in-session T-SQL table
variables for expected metadata, with no application-table DML, persistent
writes, credential access, or migration-ledger changes.

A pre-adoption exit code 0 now requires **exact 925, reviewed 926 and
927 catalog matches, coherent recorded Ledger, and ABSENT 928 sidecars**.
All other valid but incomplete combinations return 2; database/identity/
report errors return 1. Even exit 0 only establishes checked-in catalog
compatibility, **not** independent target migration-source provenance,
Signer/Writer identity approval, patient privacy review, backup signoff,
928 installation authority or permission to enable CHART. The existing
`exactAttested=false` on the two footprint records continues to mean
that filename+presence alone never prove full migration provenance.
Public playback and every CHART release hard gate remain OFF.

Disposable SQL Server 2019/2022 acceptance verifies the footprint query
against created 926 and 927 structures. The full historical SQL Server
2019 925 test verifies both footprints absent and unrecorded in its
intentional pre-926/927 database. Neither case is a hospital-target
attestation.



## 2026-11-10 — 925 CHECK/DEFAULT discrepancy visibility, no automatic repair

The existing `npm run db:chart:preflight` now reports a separate
`catalog925ConstraintInventory` diagnostic alongside the unchanged
`catalog925.status` **exact-schema** validation. It parses the checked-in
reviewed `925_dataset_display_policy.sql` source, not a hand-entered count,
and compares only the names of SQL Server `CHECK` and `DEFAULT`
constraints in the same three 925 tables. The reviewed source currently
specifies **16 CHECK/DEFAULT constraints**. The report returns the expected
and observed counts plus bounded `missing` / `unexpected` metadata names
(up to 64 each). It never exposes clinical data, constraint values, stored
procedure definitions, a SQL password, or editable SQL statements.

This specifically makes prior `34/0/2/13` versus `34/16/2/13`
catalog-count disagreements inspectable without rerunning an installer:
the historical `0` count must **not** be reused as the expected current
CHECK/DEFAULT count. We have NOT inspected the actual hospital database
with this new diagnostic. If names appear equal, the status
`NAMES_MATCH_NOT_EXACT_ATTESTED` explicitly does **not** mean that CHECK
expressions, defaults, types, PK/FK/indexes, visibility, migrations or
source provenance match. Only the existing independent
`validateDisplayCatalog` and reviewed 926/927 validators decide the
catalog baseline, and even an exact metadata match does **not** approve
928, CHART activation or a production ZIP overwrite.

Run only when an authorized DBA supplies the intended server/database/
original login identities on an approved assessment workstation. Do not
execute the 925 installer, `db:migrate`, an `adopt` command, any draft
928 SQL, or manual drops/recreates in response to this diagnostic.


## 2026-11-10 — Standalone SSMS one-pass target evidence (no UQP ZIP update)

For an authorized DBA who can use SQL Server Management Studio but **cannot
replace the existing live/test C:\UQP application**, the new standalone
`database/acceptance/chart-925-927-928-ssms-readonly-evidence.sql`
collects a **narrow, metadata-only** set of target evidence. It is not the
existing Node CLI, not a substitute for its **exact** 925/926/927 review,
and has no dependency on npm, the SQL Writer or a CHART gate.

1. In SSMS, first connect with the intended **read-only catalog/ledger**
   account, choose the target UQP DB explicitly in the query dropdown, and
   independently obtain `SELECT @@SERVERNAME AS ServerName, DB_NAME() AS
   DatabaseName, ORIGINAL_LOGIN() AS OriginalLogin;` (identity only).
2. Open the checked-in SQL script and replace **all three** placeholders
   `__FILL_SERVER__`, `__FILL_DATABASE__`,
   `__FILL_ORIGINAL_LOGIN__` with those exact values. Do not paste
   passwords, tokens, connection strings or patient data into SQL or chat.
3. Execute the single script in that same selected database/account.
   It verifies pinned server/database/original login, SQL 2019/2022,
   `uqp.SchemaMigration` existence and database metadata visibility
   **before** returning any inventory. A mismatch stops with an error;
   never modify the migration or create missing objects to make it pass.
4. Review only its seven small result sets:
   `00_PINNED_IDENTITY`,
   `01_925_CONSTRAINT_NAMES`,
   `02_925_CATALOG_COUNTS_NOT_ATTESTATION`,
   `03_926_FOOTPRINT_NOT_EXACT`,
   `04_927_FOOTPRINT_NOT_EXACT`,
   `05_928_SIDECARS_NOT_APPROVED`,
   and `06_FINAL_RELEASE`.
   The name list explicitly distinguishes `MISSING`, `UNEXPECTED`,
   `BLOCKED_FLAGS` from `NAME_PRESENT_NOT_EXACT_ATTESTED`.
   Share statuses/counts first; redact server, original login and internal
   infrastructure identifiers in any externally shared report.
5. Use the existing, independently reviewed exact validators to confirm
   925/926/927 only **after** the metadata triage. An 925 name count of 16
   alone is never enough to claim `EXACT_MATCH`. All 928
   `MayInstall928` and `ChartCanBeEnabled` fields are statically FALSE;
   no migration, credential grant, live CHART playback or production rollout
   is authorized by running the script.

The checked-in static regression test independently checks that all **16**
925-source 925 CHECK/DEFAULT expectation names stay aligned with the
reviewed 925 DDL and that the operator's SQL contains no persistent DDL/DML
or dynamic execution. Disposable CI does **not** assert results from the
actual hospital database; the DBA's selected target is authoritative.
