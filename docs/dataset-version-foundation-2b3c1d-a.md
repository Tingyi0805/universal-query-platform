# Dataset version foundation (2B-3C-1D-A)

No API, frontend, Dataset SQL, runtime bind, policy or patient audit behavior is
changed. Migration 921 is supplied as text only; 920/921 were not executed and no
real source or platform database was contacted. The new readers are not wired
into delivery routes.

## Schema 921

- Add `DataSource.ConfigurationRowVersion ROWVERSION NOT NULL` in place.
  SQL Server generates a new value for every insert/update, including credential
  updates and same-value updates. Deletion makes the version unreadable; old
  evidence cannot authorize a replacement source. No stored configuration is
  assigned or decrypted by the migration.
- Create an **empty** `DatasetNativeParameterContract` table keyed by DatasetId,
  with Dataset and DataSource FKs (NO ACTION), captured binary(8) Dataset and source
  revisions, nullable NativeTypesJson/EvidenceSource, State and independent
  ContractRowVersion. The only legal state is `UNCONFIRMED`; no VERIFIED state,
  delivery permission, metadata evidence or review record exists.
- JSON/source are either both absent or both present. Present JSON must be valid;
  source must explicitly identify DATABASE_DECLARATION or EXPLICIT_RUNTIME_BIND.
  These labels are unverified claims, not proof. Future code must strictly
  validate native parameter names, types, lengths, precision/scale and provenance.
- One transaction, XACT_ABORT and rollback. Refuse object/column/type/constraint
  conflicts, unexpected version columns, partial installation, triggers on the
  new table and untrusted/disabled constraints. Re-execution accepts the exact
  supported shape only. Requires migration 920 and the listed source prerequisites.
- Existing 001–920 files/hashes are unchanged. Inventory appends 921. Historical
  acceptance profiles remain pinned through 919; adding 921 does not authorize
  applying it or silently include it in those plans. No migration command was run.
  The existing executable migration runner is unchanged: default apply discovers
  all files, while the 916–919 scoped runner requires its exact directory/ledger
  baseline (already affected by 920). Use its reviewed historical checkout or a
  separately reviewed runner plan for that upgrade; do not relax its baseline
  checks or run default apply to compensate. Offline profile compatibility is
  not execution approval or a claim that this HEAD can perform that old upgrade.

## Read contracts

`readDataSourceVersion` uses an owned SERIALIZABLE transaction, or joins an active
caller transaction using HOLDLOCK. It checks the actual ROWVERSION schema,
identity, enabled state, source type and connection-information readiness. For
SQL Server/MySQL/PostgreSQL this includes an explicit database name; Oracle needs
an explicit service/SID. ODBC readiness requires its configured DSN or encrypted
connection-string presence. This is a configuration check, not a connection test.

Only string ID, lowercase 16-character opaque hex version, source type and
`isActive: true` leave the reader. No password, ciphertext, username or connection
string is selected into evidence. IDs accept canonical positive SQL BIGINT
strings/bigint, rejecting Number. Version bytes are never converted to Number.
The existing playback hash remains unchanged and is **not** used by this contract.

`readNativeParameterVersion` checks 920/921, Dataset identity/archive state,
definition/source/captured-contract versions and expected independent contract
version in one transaction. Missing rows return an explicitly non-deliverable
MISSING state; existing valid rows return UNCONFIRMED. Stale/unknown rows reject.
Inactive Dataset definitions may be inspected for future initialization; this
does not authorize preview or delivery. Oracle with saved parameters rejects.
Even a zero-parameter Dataset is not automatically confirmed.

`requireVerifiedNativeParameterContract` always rejects MISSING/UNCONFIRMED;
there is no supported route to a verified value. No type write/confirmation
function is supplied. Read/commit failure returns code-only errors; an owned
transaction rolls back. A caller owns completion/rollback of its external
transaction. There are no application-table writes or audit-success claims.

Existing parameter save/sync advance DefinitionRowVersion inside their transaction;
historical restore updates Dataset before replacing parameters. New native type
contracts must be rebound explicitly after either changes. Direct out-of-contract
DB edits, external View changes and actual driver binding remain acceptance and
integration boundaries, not facts proven by a content digest.

## Blockers before verification and later initialization

1. Establish authoritative native type provenance. Generic STRING/NUMBER,
   current values and test values are insufficient. Persist exact declarations
   only through a future authorized, version-checked and mandatorily audited
   transaction. Do not backfill existing Datasets as confirmed.
2. SQL Server currently calls `request.input(name, value)` and infers types.
   A later scoped change must validate one binding plan against saved tokens and
   parameter definitions and pass explicit `mssql` types for both describing and
   execution, including null, date, decimal and list arity behavior. Until tested,
   refuse verification; this stage intentionally leaves runtime semantics intact.
3. Oracle getStatementInfo cannot accept typed binds; parameterized descriptions
   remain unsupported. No query execution or SQL rewrite fallback is permitted.
4. Later bind candidate metadata to these versions, add independent review/audit
   state and compare actual execution structure against described columns before
   enabling initialization or delivery. Existing CUSTOM/OMIT, sensitive SQL
   change blocking, policy validation and patient audit checks remain mandatory.
5. Real SQL Server acceptance must check DDL rollback/repetition, sys-catalog
   representations, FK/NO ACTION, locking/deadlock order, password-update and
   A→B→A ROWVERSION behavior. Mock/static tests cannot certify those behaviors.
