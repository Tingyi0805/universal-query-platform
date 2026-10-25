# Shared workstation H0-5A schema and atomic-audit contract

## Existing schema and version decision

Migrations 902/903/904 create the current operator session, Quick PIN policy and
device credential; 916 adds workstation administration fields and foreign keys.
`SharedWorkstationSession` is an operator session and remains unchanged. Its
expiry, TokenVersion and optional PinVersion cannot also represent the longer
lived device session without changing its established meaning.

The normal runner scans only `database/migrations` and currently ends at 921.
Numbers 922 through 925 are already reserved by reviewed PR #66 work, including
923/924 artifacts kept outside that runner. The next non-conflicting candidate
is 926. Its SQL stays under `database/drafts`; `db:migrate` cannot discover it,
and this stage does not write `SchemaMigration`. A later dedicated installer
must perform preflight, controlled apply and exact post-install validation.

## Additive candidate

The candidate adds the following structures:

| Object | Purpose |
| --- | --- |
| `SharedWorkstationDeviceSession` | Device-only proof binding, credential version, idle/absolute expiry, revocation, renewal counter and ROWVERSION |
| `SharedWorkstationOperatorState` | One current workstation state with persistent generation, incarnation and live operator-version bindings |
| `UserQuickPinSecurityBinding` | PIN version binding to TokenVersion and PIN policy revision |
| `SharedWorkstationPinAttemptState` | Cross-node attempt window and temporary lock state; it does not reuse the enrollment-password failure counter |
| `SharedWorkstationSessionRequest` | Immutable UUID/digest claim for replay prevention |
| `SharedWorkstationSessionDecision` | Immutable, de-identified mutation decision linked to the exact audit receipt |

`QuickPinPolicy` gains a positive BIGINT `PolicyRevision` and ROWVERSION. Two
unique composite indexes are added to existing credential/operator-session
tables solely to support exact parent bindings. No account, PIN, workstation,
session, role, permission or authorization row is seeded. No device session can
grant Query, Dashboard, Export or patient-data authority.

All IDs that originate from SQL BIGINT cross the repository boundary as
canonical decimal strings. A future audit insert must read
`OUTPUT CONVERT(VARCHAR(20), INSERTED.Id)` in the owned transaction. Converting
a JavaScript Number back to text is forbidden. `SessionDecision.AuditLogId` has
no FK to online `AuditLog`, because the existing archive flow moves rows to
`AuditLogArchive`; the decision retains the exact correlation independently.
Immutable Request/Decision actor and target IDs likewise have no AppUser FK, so
retained security history does not silently change or make the existing hard
delete path fail after online audit archival. The transaction must validate
those users while locked, and the positive-ID CHECK preserves shape.

## Writer transaction contract

Every renewal, PIN failure/lock, operator switch/lock/sign-out, device revoke
and authorization revoke must own its complete SQL transaction, set
`XACT_ABORT ON`, use SERIALIZABLE isolation, and acquire resources in this
common logical order:

1. session security gate;
2. Quick PIN policy;
3. AppUser;
4. workstation;
5. credential and device session;
6. UserQuickPin, PIN binding and attempt state;
7. legacy operator session and current operator state;
8. RequestId reservation;
9. AuditLog;
10. immutable decision.

The repository must lock all affected rows/ranges, re-read active/revoked state,
credential/TokenVersion/PIN/policy versions and expiry, claim exactly one
RequestId, perform one ROWVERSION CAS, write exactly one audit and decision,
then commit. Any conflict, timeout, deadlock, audit/decision error, rollback
failure or unknown commit result returns no authority. Helpers cannot own or
commit a separate transaction. The TypeScript validator proves only that a
synthetic observation follows this contract; it always returns `authority=NONE`
and `sqlTransactionVerified=false`.

Credential rotation/revocation, workstation disable/retire, user disable,
TokenVersion changes, PIN revoke/version changes and PIN policy changes must
either revoke affected session rows in the same transaction or make every
subsequent read reject their stale version binding. Existing writers do not yet
implement that complete coverage. They must not be enabled against 926 merely
because the tables exist.

## Validation and deployment boundary

`tools/sqlserver-acceptance/drafts/926/926_catalog_readonly.sql` reads only SQL
Server catalog metadata. It witnesses engine/database settings, object and
column shape, collations, identity/ROWVERSION, key/index order and filters,
trusted NO ACTION foreign keys, CHECK/default/trigger definitions and the
migration ledger. Missing visibility, partial installation, disabled or
untrusted constraints, unexpected objects, or any textual/semantic mismatch
must fail closed. A ledger row never substitutes for the catalog comparison.

H0-5A performs static and synthetic checks only. SQL Server 2019 installation,
constraint execution, actual rollback, lock/range behavior, deadlock handling,
audit durability and catalog round trip are **NOT_RUN**. H0-5B requires a fresh
isolated SQL Server 2019 database containing the complete 001-921 baseline,
separate migrator/validator/runtime identities, at least two connections and no
HIS or patient data. It must test clean install, partial/same-name rejection,
failed-DDL rollback, exact repeat validation, BIGINT OUTPUT, CAS/replay races,
all revocation writers, 1205/1222, rollback and commit-unknown behavior.

## Remaining blockers

- There is no approved 926 installer or production repository implementation.
- The exact Catalog comparison manifest and SQL Server 2019 round trip remain
  to be executed in H0-5B; this read-only witness is not installation proof.
- Existing credential, workstation, AppUser, role, PIN and policy writers do
  not yet share this transaction owner/lock order or revoke all dependent rows.
- Durable RequestId retention prevents replay but needs an approved capacity,
  archive and restore policy before production use.
- Audit archive consistency, multi-node races, backup/restore incarnation,
  external SQL writers, deployment skew and real lock escalation are unproven.
- H0-2/H0-3 services and H0-4 browser controls remain isolated. No route,
  cookie/JWT, AuthContext, Query, Dashboard, Export or patient path is wired.

The schema contract is ready for H0-5B isolated validation, conditional on the
dedicated environment and exact validator/installer work above. Production
Session/PIN enablement remains **BLOCKED**.

## H0-5B correction (isolated, no SQL execution)

A rejected PIN verification may durably advance the PIN failure/lockout row.
The immutable Decision record therefore permits a non-null next revision for
`REJECTED + PIN_FAILURE + PIN_ATTEMPT` only when a previous revision exists
and differs from the next revision. Other rejected decisions must not claim a
new revision. This avoids treating a committed lockout counter update as a
failed transaction, while preserving a single audit/decision transaction
requirement. This is a draft DDL constraint change, **not** SQL Server evidence.

H0-2 device renewal has no caller-supplied RequestId. A future SQL adapter must
generate a cryptographically random, unique internal RequestId **inside its owned
transaction**, bind it to the attempt digest and immutable Decision/Audit
correlation, and never interpret it as a client-provided idempotency key.
Renewal replay prevention remains on ROWVERSION and BIGINT renewal counter
CAS, not on the internally generated RequestId alone. Any caller-visible
response must not claim operator authorization. Adapter, live SQL transaction,
fault injection and cross-node checks remain **NOT_RUN / BLOCKED**.
