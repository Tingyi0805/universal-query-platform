# UQP CHART 928 — production migration release decision (PR #99)

**Status: BLOCKED / NOT AN INSTALLER.** This record freezes the existing four delivery gates, and adds no phase. It does not approve hospital SQL access, schema changes, chart release, PR merge, or `C:\UQP` deployment.

## Project owner scope decisions — 2026-11-13 (direction only, NOT formal release approval)

The project owner has explicitly made **three implementation-scope decisions** for the existing four gates:

| Decision | Agreed direction | What is **not** approved |
| --- | --- | --- |
| Gate 2 / installation target | **Request an authorized installation in the actual hospital production SQL database** after DBA review, exact target attestation, verified backup/recovery and approved change window; do not make a separate isolated test installation the sole release target. | No permission to connect to/write to hospital SQL, execute migration 928, fix/adopt ledger, or bypass approved production SQL source hashes. |
| Gate 3 / architecture | **Accept Option A in principle**: current UQP LOCAL JWT as HTTP identity authority plus a distinct least-privilege SQL Writer, subject to security review and production SQL rights/source/SID attestation. | Not final risk sign-off, Writer privilege provisioning, SQL release enablement or independent authorization to impersonate a user. |
| Initial data exposure | **Restrict initial CHART acceptance to authenticated administrators in a controlled test**. Keep public-screen, kiosk, device-token and general user CHART playback **OFF**. | No approval for any public-device projection, clinical/patient data disclosure, small-cell/differencing policy or production exposure merely from a designer test. |

**Interpretation:** The selected database installation destination is the existing hospital production target, **but installation remains BLOCKED** pending separate DBA/security and hospital change-management authorization. Read-only, explicitly authorized target preflight and approved backup/restore evidence must precede any DDL. A separate safer test can support technical acceptance but must not silently substitute for the selected target or authorize production execution.

**Exact next gate decisions** (no new phase):
1. Gate 2: authorized DBA/change owner records the precise target SQL server/database/original login, 925 exact catalog, disposition of the prior 926 catalog-versus-ledger divergence, optional clean absence of 927, 928 absent/exact state, reviewed executable frozen-base and permit-Writer SQL SHA-256/trigger module identities, transaction/rollback/backup evidence and signed change window.
2. Gate 3: authorized security/DBA reviewer approves separate platform/Writer SQL SID pins, reviewed `uqp.usp_DashboardChartCreate` SHA, EXECUTE-only/no-direct-DML SQL grants, JWT-derived immutable actor and same-transaction revocation/replay checks, and records the accepted Option A residual risk. Initial access must be administrator-only; data owner authorization is required for any real clinical/patient-related data. Public/device projection remains out of scope and OFF.
3. Gate 4: only after Gates 2/3 formal approvals, perform one controlled Windows/IIS integration UAT and obtain explicit operator authorization before any `C:\UQP` ZIP overlay.

**Record status:** Owner direction **RECORDED**; DBA approval **PENDING**, security/SQL Writer approval **PENDING**, clinical-data scope approval **PENDING where applicable**, actual hospital target evidence **NOT RECORDED**, production deployment **BLOCKED**. This does not change compile-time release gates, PR Draft status, or the historical Stage 18 acceptance.

## Project owner update — 2026-11-14: reuse existing SQL login (no new account)

The project owner explicitly declines provisioning a separate SQL Writer login. Reuse the existing UQP SQL Server connection/login for initial administrator-only CHART testing, while continuing to use existing `uqp.AuditLog`; AuditLog is an audit table, **not** a SQL login or an authorization boundary.

This supersedes the earlier *dedicated-login* part of Option A, but does **not** authorize production DDL or disabling safety checks. The existing Writer procedure currently pins a dedicated original-login SID and the release installer is compiled OFF. These are **not yet compatible** with the revised shared-login decision. Do not change SID pins to NULL, remove login checks, or enable the release gate as a shortcut.

Gate 3 must review and document the actual existing UQP SQL principal, its effective database permissions, and whether direct DML/DDL on CHART tables can be denied without breaking existing UQP features. If the shared principal retains broad direct-write or schema privileges, document the reduced isolation and require explicit acceptance of that residual risk; do not claim EXECUTE-only protection. Retain JWT-derived actor authorization, procedure transaction/replay/revocation checks, AuditLog, protective triggers, and administrator-only initial scope. Public/device CHART playback remains OFF.

The four existing gates are unchanged. Gate 2 SQL source review and Gate 3 shared-principal compatibility remain pending; no new account, test phase, deployment, or repeat of prior 926/Stage 18 acceptance is requested.

## Selected architecture (2026-11-13, Option A — supersedes prior Signer/Issuer requirement)

The project owner has selected **Option A: existing UQP LOCAL JWT + a dedicated least-privilege SQL Writer**. This *architecture choice* is accepted, but Gates 2/3 production readiness is still PENDING. There is no requirement to deploy an independent IdP, mTLS Signer, SQL Issuer or HMAC service for Option A. Historic Signer/Issuer references **below are preserved as evidence of discarded prototypes, not current release prerequisites**. The accepted trust assumption is that UQP is the original authenticated HTTP authority; a compromised UQP process/JWT secret is outside the independent-identity protection scope of Option A. Browser actor spoofing is blocked by verified JWT/session-derived server plans. See [Gate 3 Option A binding decision](chart-928-gate3-actor-binding-review-decision.md).

Implementation: `dashboardChartLocalJwtSqlCreate.ts` is wired through the existing Dashboard CREATE route and will call only a verified, SHA/SID-pinned `uqp.usp_DashboardChartCreate` via a dedicated SQL login, **after Gate 2/3 formal approval**. Its production gates are OFF; SQL source for that approved procedure and frozen-to-permit conversion is NOT YET INSTALLED or SIGNED. Existing public/device projection remains independently OFF.

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

## Gate 3 — selected LOCAL JWT / dedicated SQL Writer / privacy decisions

- The existing verified JWT + live SQL session is the accepted **application** ActorId authority (not an independent identity provider); the dedicated SQL Writer must re-check current permissions and TokenVersion **within its own SERIALIZABLE Widget/Seal/Audit transaction**. A fully compromised UQP app server remains an explicitly accepted design risk, not something SQL attestation can solve.
- `CHART_WRITER_APPROVED_PROCEDURE_SHA256=null` and all platform/Writer original SID pins remain unapproved. Signer/Issuer signed grants are **not** Option A dependencies; the synthetic old source remains dormant.
- Dedicated least-privilege SQL Writer `EXECUTE` only, target identity and exact procedure/trigger source pins, transactional anti-replay and precise current Query ACL are mandatory; no direct table writes or shared credentials.
- Public/device chart projection requires separate Token/IP/revocation and grouped-query small-cell/differencing/disclosure authorization; authenticated designer preview is not kiosk approval.
- Hardcoded create/Writer/projection/public-playback release gates remain OFF.

**Gate 3 decision: NOT APPROVED.** Never enable an HTTP/SQL release constant on the basis of CI alone.

## Gate 4 — Windows / IIS controlled test acceptance

Only after Gates 2 and 3 have their required authorized technical approval recorded: stage an authorized ZIP outside the live `C:\UQP` overwrite path, preserve deployment-specific `.env`, validate Node 24 / ABI 137, IIS ARR `/api/status`, relevant SQL procedure identities, read-only/live authorization proof, and synthetic end-to-end CHART create/reload/display with revocation and no patient disclosure. Obtain an explicit operator change decision before replacing live files.

**Gate 4 decision: NOT STARTED.**

## Release decision

- **Merge PR #99:** blocked.
- **Install 928 in hospital SQL / ledger entry:** blocked.
- **Enable CHART runtime flags or activate the dedicated SQL Writer:** blocked.
- **Overwrite `C:\UQP`:** blocked.
- **User action now:** none. Existing Stage 18 acceptance and previously observed 925/926 evidence are preserved; no repeat manual inventory is requested merely to document these gates.

The next material completion is a **reviewed production 928 migration plus the Option A dedicated Writer's approved SQL procedure/Trigger transition**, not another Signer/Issuer prototype or invented stage.


## Freeze-to-Writer compatibility decision (source review; NOT APPROVED)

The source currently contains **two different trigger contracts**, and this difference must be resolved in the reviewed, versioned release plan. They are **not** interchangeable, nor is the disposable Writer a production-ready upgrade:

1. **928 base / frozen contract** — \`database/drafts/928_dashboard_chart_trust_schema.sql.draft\` installs \`uqp.TR_DashboardWidget_ChartFreeze\` to reject all CHART inserts, updates and deletes. Its exact-body attestation is intentionally pinned to that definition. A green test of this state proves freeze safety, **not** CHART create capability.
2. **Synthetic atomic-create contract** — \`database/drafts/928_chart_atomic_create_prototype.sql.draft\` creates \`uqp.DashboardChartCreatePermit\` and **alters the same trigger** to admit only one new CHART row when the SessionId, SQL TransactionId, ProfileId, SourceKey and ConfigJson match the short-lived permit. The isolated Writer procedure creates and deletes the permit inside its own transaction, with Widget, Seal, Request Ledger and Audit. This trigger differs from the frozen 928 digest. The prototype may not be applied to UQP production or promoted as-is.
3. **Synthetic issuer / delegation contract** — \`database/drafts/928_chart_actor_delegation_disposable.sql.draft\`, \`928_chart_signed_issuer_atomic_disposable.sql.draft\` and \`928_chart_atomic_create_with_delegation.sql.draft\` exercise scoped grant issuance/consumption in disposable databases only. A passed test with \`EXECUTE AS USER\`, an owner context or an isolated signing key does **not** prove the request's \`ActorId\` is the authenticated HTTP caller in a hospital deployment.

**Required Gate 2/3 decision:** designated hospital technical approver(s) must record approval of one explicit **versioned** schema transition from frozen-only to permit-protected Writer (including the permit table, final trigger definition/hash, DML permissions and module execution context). Base-frozen attestation and authorized-Writer attestation must have **separate, exact expected definitions**; neither should silently accept the other's trigger. The production upgrade must be transactional, preserve existing layouts and audit history, and fail closed if any expected source/catalog/ledger state differs. No implied automatic migration or trigger disablement.

**Option A actor trust boundary:** the original actor is derived *only* from the current UQP request's verified LOCAL JWT and live session, never browser `ActorId` or mutable request headers. SQL Writer receives this server-derived ActorId and **must re-check** TokenVersion, both Query permissions, source/version and RequestId replay with transaction locks. A compromised UQP app can still impersonate an actor under this chosen trust model; do not claim DB-owned independent HTTP identity verification. Protect separate SQL credentials, exact procedure and SID pins, immutable receipts, grouping/small-cell privacy and public-device projection authorization. Test that two fully authorized users A/B cannot exchange identities through the normal HTTP request body.

**Acceptance evidence required before authorizing real create:** isolated SQL Server 2019/2022 and HTTP tests must explicitly show (a) frozen state denies CHART DML, (b) altered/disabled/mis-matched trigger or permit schema is rejected, (c) ordinary and dedicated SQL logins cannot directly insert Permit, Widget or Seal, (d) an unauthorized actor/HTTP body forgery, RequestId replay, expired/deleted/revoked token, wrong source/revision, concurrent create and late audit/seal failure all reject with no partial committed effects, and (e) only the approved two-login LOCAL-JWT-bound SQL Writer can create, reload and return the audited chart receipt. Existing synthetic CI is supporting evidence, not production authorization.

**Resolution state: PENDING hospital DBA/security technical acceptance and approved SQL source.** The source constants `CHART_WRITER_APPROVED_PROCEDURE_SHA256=null`, `CHART_LOCAL_JWT_WRITER_RELEASE_APPROVED=false` and historical `CHART_WRITER_DB_ACTOR_BINDING_APPROVED=false` remain unchanged; do not promote the disposable ALTER TRIGGER, enable release switches, create a 928 migration ledger entry, merge PR #99 or overwrite \`C:\UQP\`.

## Independent DBA / security review handoff (2026-11-11; evidence, not approval)

This section is a review handoff under the **existing Gates 2 and 3**, not an additional delivery phase. Source baseline is Draft PR #99 commit \`a74ca5aa4ab7d73057212e037b6975603376c6d4\`, with isolated CI #1482 SUCCESS. It is not evidence of production schema attestation or of a signed release decision. Keep all decisions below **PENDING** unless recorded by independent authorized reviewers.

| Decision owner | Minimum acceptance evidence | Current review decision |
| --- | --- | --- |
| DBA — 928 source | Independently reviewed, versioned **production** SQL; exact columns (including order/types/length/nullability), defaults, keys, FK targets, CHECKs, filtered-index expressions, trigger definitions/events and preexisting DashboardWidget behavior; approved exact source SHA-256 | **PENDING**; \`database/drafts/928_dashboard_chart_trust_schema.sql.draft\` is disposable-only, not an installer |
| DBA — target and recovery | Target server/database/login identity; exact 925 match, coherent 926 catalog/ledger reconciliation, 927 absence/presence classified without treating it as a mandatory CHART prerequisite; 928 absence/state; approved backup/restore test, outage/change window, transaction/lock/ledger integration and failure recovery | **PENDING**; isolated CI cannot attest the hospital target |
| Security — Option A LOCAL JWT / SQL Writer | Record the accepted UQP-as-identity-authority risk, immutable verified JWT actor, two distinct platform/Writer SQL principals/SIDs, exact vetted Writer procedure SHA, no direct Widget/Permit/Seal DML, same-transaction revocation/replay checks and auditable receipt | **PENDING production acceptance**; Option A architecture is selected but Writer SHA/SID remain `null` |
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
