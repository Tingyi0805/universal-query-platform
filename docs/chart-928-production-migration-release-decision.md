# UQP CHART 928 — production migration release decision (PR #99)

**Status: BLOCKED / NOT AN INSTALLER.** This record freezes the existing four delivery gates, and adds no phase. It does not approve hospital SQL access, schema changes, chart release, PR merge, or `C:\UQP` deployment.

## Accepted isolated evidence (not hospital-target attestation)

- PR #99 retains Stage 18 accepted manual designer UAT. Do not repeat it for SQL-only changes.
- The disposable 928 schema draft at `database/drafts/928_dashboard_chart_trust_schema.sql.draft` exercises outer transaction rollback, first installation, idempotent rerun, trigger-definition drift, trusted CHECK constraints and audit/review immutability, on isolated SQL Server 2019/2022.
- The existing read-only `db:chart:preflight` uses the reviewed 925 exact catalog validator and independent 926/927 observations. It **never** approves 928 or repairs ledger records.
- 927 (shared-workstation PIN) is **not** a CHART 928 prerequisite when cleanly absent. Previously reported 926 catalog / missing-ledger disagreement is historical evidence to reconcile by approval, **never** by manufacturing a ledger row.
- A successful CI job is not a signed migration, actual hospital target verification, or release approval.

## Gate 2 — requirements before any production 928 migration

1. **Reviewed, versioned migration source:** independent DBA/security review of exact columns, constraints, triggers, existing `DashboardWidget` behavior, compatibility with actual approved 925/926 schema, and audit retention. Record reviewer, source SHA-256, and change authorization. The `.sql.draft` must not be renamed or registered by default.
2. **Exact target verification:** verify expected SQL server, database and login; exact 925 catalog; 926 catalog and any ledger disagreement; 928 absent (or separately reviewed exact state). Do not infer exact match from object counts.
3. **Transactional installation and version ledger:** integrate only after approval with the established migration runner's transaction, exclusive lock, failure rollback and ledger semantics. A migration may not mark success on partial DDL or a failed attestation.
4. **Recovery plan:** confirmed target-specific backup/restore availability, maintenance window, rollback/forward-fix decision, and evidence of post-change integrity. Dropping CHART trust tables indiscriminately after live writes is **not** an acceptable rollback.
5. **Separation of responsibilities:** independent authorization of SQL execution, credentials and change ownership. Do not access hospital SQL during source review.

**Gate 2 decision: NOT APPROVED.** No checked-in approved 928 production SQL, installer manifest entry, or target-specific migration approval exists here.

## Gate 3 — Signer / Issuer / Writer and privacy decisions

- `CHART_WRITER_APPROVED_PROCEDURE_SHA256` is intentionally `null`; the required DB-owned, non-forgeable actor binding and independently approved procedure are not provided by a disposable SQL prototype.
- Signer key custody, independent TLS identity and SQL grants must be reviewed and operated separately from ordinary UQP.
- Public/device chart projection requires its own Token/IP/revocation and grouped-query small-cell/differencing/disclosure policy; authenticated designer preview is not kiosk authorization.
- Hardcoded create/projection/public-playback release gates remain OFF.

**Gate 3 decision: NOT APPROVED.** Never enable an HTTP/SQL release constant on the basis of CI alone.

## Gate 4 — Windows / IIS controlled test acceptance

Only after Gates 2 and 3 are independently approved: stage an authorized ZIP outside the live `C:\UQP` overwrite path, preserve deployment-specific `.env`, validate Node 24 / ABI 137, IIS ARR `/api/status`, relevant SQL procedure identities, read-only/live authorization proof, and synthetic end-to-end CHART create/reload/display with revocation and no patient disclosure. Obtain an explicit operator change decision before replacing live files.

**Gate 4 decision: NOT STARTED.**

## Release decision

- **Merge PR #99:** blocked.
- **Install 928 in hospital SQL / ledger entry:** blocked.
- **Enable CHART runtime flags or deploy independent signer/writer:** blocked.
- **Overwrite `C:\UQP`:** blocked.
- **User action now:** none. Existing Stage 18 acceptance and previously observed 925/926 evidence are preserved; no repeat manual inventory is requested merely to document these gates.

The next material completion is an **independently reviewed production 928 migration plus approved signer/Writer trust boundary**, not another disposable-only feature or invented stage.


## Independent DBA / security review handoff (2026-11-11; evidence, not approval)

This section is a review handoff under the **existing Gates 2 and 3**, not an additional delivery phase. Source baseline is Draft PR #99 commit \`a74ca5aa4ab7d73057212e037b6975603376c6d4\`, with isolated CI #1482 SUCCESS. It is not evidence of production schema attestation or of a signed release decision. Keep all decisions below **PENDING** unless recorded by independent authorized reviewers.

| Decision owner | Minimum acceptance evidence | Current review decision |
| --- | --- | --- |
| DBA — 928 source | Independently reviewed, versioned **production** SQL; exact columns (including order/types/length/nullability), defaults, keys, FK targets, CHECKs, filtered-index expressions, trigger definitions/events and preexisting DashboardWidget behavior; approved exact source SHA-256 | **PENDING**; \`database/drafts/928_dashboard_chart_trust_schema.sql.draft\` is disposable-only, not an installer |
| DBA — target and recovery | Target server/database/login identity; exact 925 match, coherent 926 catalog/ledger reconciliation, 927 absence/presence classified without treating it as a mandatory CHART prerequisite; 928 absence/state; approved backup/restore test, outage/change window, transaction/lock/ledger integration and failure recovery | **PENDING**; isolated CI cannot attest the hospital target |
| Security — Signer / Issuer / Writer | Independently operated signer identity and key custody, mTLS/cert rotation, separate SQL principals and grants, approved DB-owned actor binding, scoped one-time authorization/replay protection, exact approved writer procedure digest and auditable receipt matching | **PENDING**; \`CHART_WRITER_APPROVED_PROCEDURE_SHA256\` remains \`null\` |
| Privacy / clinical data owner | Approved grouped-query source and disclosure scope, small-cell and differencing controls, audit retention, independent user versus device Token/IP/revocation and public-screen release decision | **PENDING**; designer preview is not public-display approval |
| Deployment/change owner | Gate 2 and 3 approvals recorded first; isolated Windows/IIS end-to-end evidence; preserve deployment \`.env\`; rollback owner and explicit operator deployment authorization | **PENDING**; no \`C:\UQP\` overlay permitted |

### Review-specific technical observations (not signatures)

- The disposable 928 draft now includes an explicit 32-column bidirectional metadata comparison (including column ID and digest collation) and exact-body SHA-256 comparison for its seven installed triggers. These checks are **prototype validation**, not a substitute for independent production source review.
- Existing metadata observations/count checks do not by themselves prove every default, key, CHECK, index or FK *definition*. Independent review must confirm actual catalog semantics and the approved migration runner's write/rollback behavior; neither CI nor this handoff marks them accepted.
- The draft's \`TR_DashboardWidget_ChartFreeze\` intentionally rejects CHART DML. It must not be removed or bypassed merely to make playback work; an approved release must establish the separate authorized Writer transaction and actor-binding contract.
- The repository's generic migration runner has a protective 928 inventory gate. A future reviewed 928 installer requires an independently approved release-path change; do not put a \`928_*.sql\` file in the scanned migrations directory as a shortcut.

### Independent approval record (complete outside this draft PR)

- Approved production 928 source path / SHA-256 / reviewer / date / change authorization: **NOT RECORDED**
- Verified hospital target identity / 925–928 evidence / backup and recovery owner: **NOT RECORDED**
- Approved Writer procedure identity / SHA-256 / SQL principal / signer cert custody: **NOT RECORDED**
- Privacy + device/public playback reviewer / scope / expiry: **NOT RECORDED**
- Release decision and authorized Windows/IIS change record: **NOT RECORDED**

**Current decision remains BLOCKED.** Do not merge, install 928, create a schema ledger entry, change CHART hard release switches, use clinical patient data or overwrite \`C:\UQP\` based on this handoff.
