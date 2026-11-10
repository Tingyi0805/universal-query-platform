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
that the exact 925 catalog and the minimum 926/927 footprints plus their
Ledger entries are coherent enough for further independent review;
it does NOT attest the exact 926/927 definitions, identify approved Signer
or Writer principals, or grant permission to proceed with 928.

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

The reviewed original 926 trigger and CHECK definition verifier, original
927 exact catalog verifier, database migration provenance, and human release
approval are separate prerequisites. The presence report does not execute
either migration, certify target SQL, authorize the Signer/Writer, enable
public playback or weaken the existing CHART hard-off gates.

Disposable SQL Server 2019/2022 acceptance verifies the footprint query
against created 926 and 927 structures. The full historical SQL Server
2019 925 test verifies both footprints absent and unrecorded in its
intentional pre-926/927 database. Neither case is a hospital-target
attestation.

