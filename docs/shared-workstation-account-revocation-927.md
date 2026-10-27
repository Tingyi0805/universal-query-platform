# Account-level revocation — 927 offline extension

PR #67; baseline 0ef1932. Implementation and tests only: Runtime/Feature Flag OFF, authority NONE,
SQL_ACCEPTANCE=NOT_RUN. No user SQL Server, Docker daemon, C:\UQP, update package or deployment operation.

## Why a separate draft

902 Legacy Session has UserId, not CredentialId. 904 Credential and 916 Workstation management remain device-level.
926 Request/Decision requires a real DeviceSession and OPERATOR_STATE revision; it cannot express an account with no operator.
927 is the next unused number found in the repository, a review candidate under `database/drafts/`, outside `db:migrate`.
It adds AccountRevocationRequest and immutable AccountRevocationDecision only. It never changes 926 or seeds an account/device.
No SchemaMigration ledger, grants, Runtime activation or identity-data rewrite is included.

Request: UUID PK, exact BIGINT actor/target IDs, fixed operation, SHA-256 integrity digest, UTC timestamp.
Decision: BIGINT IDENTITY, unique RequestId/AuditLogId/correlation, actor/target, operation, INT before/after TokenVersion,
UTC timestamp. Composite FK binds RequestId+actor+target+operation to the immutable Request. TokenVersion +1 is an INT
security mutation rule, **not** an assertion that SQL ROWVERSION increases by one. Append-only triggers prevent UPDATE/DELETE;
non-owner Runtime must also have no such permissions. sysadmin/DBA can defeat this: production remains BLOCKED.
Actor/target IDs intentionally have no live-user FK, and AuditLogId has no online-Audit FK, to preserve meaning across future
user deletion/archive; this design does not authorize deletion or prove permanent audit retention.

## Implemented atomic path

The existing isolated Writer accepts optional `account:{requestId,correlationId}`. With it, scopes=[] is legal only when the
locked DB query proves zero target operators. Missing 927, partial schema, account replay or receipt error fail closed.
Without it, the original 926-only admission behavior remains compatible. No dummy device/rowversion/audit receipt is accepted.

One SERIALIZABLE/XACT_ABORT owner holds the existing transaction-owned Security Gate. Live actor active/TokenVersion,
SYSTEM_ADMIN+MANAGE_USERS, target TokenVersion CAS, complete operator/Legacy scope, original per-device reservations,
all device decisions, new account reservation, business mutation, exact Audit INSERT/OUTPUT, account decision, final
versions and zero remaining target operator/Legacy sessions must succeed together. Reservation precedes business DML.
No password/PIN/hash is placed in request digest, error, log or audit. Commit unknown never retries; rollback acknowledgment
loss is reported separately. Account receipts are returned only after commit acknowledgment, never as proof of SQL acceptance.

Supported isolated operations: disable, authorization TokenVersion revoke, admin LOCAL password reset and single-user
UserRole replacement (SYSTEM_ADMIN targets/grants retain conservative refusal). UserId alone proves the human scope of
Legacy rows, so unlinked historical rows can be revoked for that user; this never relaxes Credential Writer lineage checks.
Credential/device proof/renewal and unrelated operators/users are preserved. BoundTokenVersion mismatch invalidates old
PIN bindings without resetting attempts or inventing new PIN credentials.

## Deliberately still blocked

- Shared RolePermission modification: one role affects all UserRole members; looping this per-user Writer would not make
  membership discovery, role mutation and every user's invalidation atomic. Needs a batch owner and exact member/CAS set.
- User deletion: 001 identity FKs, Audit/Archive, disclosure and version histories, plus 926 binding/attempt/operator references
  require an explicit retention/tombstone decision and complete FK coverage. Never cascade-delete audit to make DELETE pass.
- Self-service password: existing auth.service verifies current password outside the repository transaction; the new adapter
  requires a live admin and is not a replacement. A self-service variant must bind current-password verification to the locked
  stored hash and preserve min10/max200/new-password-differs policy. A caller boolean or old password verification is insufficient.
- Legacy availability after926: old routes still reject unsupported 926-sidecar writes. No new blanket deny is introduced on
  the existing uninstalled baseline. Do not install926/927 on the working UQP DB, remove the fence or wire this unaccepted adapter
  as an automatic fallback. Fully installed DB is not a supported production upgrade yet.
- DBA/direct SQL, old Worker/mixed versions, restore incarnation, actual lock order/phantoms, durable commit/audit and front-end
  old-response purge are not solved by a cooperative Gate or Mock tests.

## Acceptance package

`h0-926` keeps all original21 cases and adds14 named cases, now35. Only its witnessed empty SQL Server2019 instance and new
nonce database receive the reviewed 926 then927 drafts; restricted non-dbo writer rights are acceptance-only. The launcher,
network ownership and exact cleanup rules are unchanged. Every original and new SQL case is NOT_RUN until approved VM execution.
New source functions open no pool: the existing witness-guarded harness injects the two pools/transactions. The report includes
actual15.x Build/compatibility150 and 927 source hash only after observation, with per-case PASS/FAIL/NOT_RUN and cleanup status.
A successful35-case report still cannot remove production/legacy blockers.

| New real-SQL case | Required observation / expected result | Current |
|---|---|---|
| account-no-device | real account Request/Audit/Decision, no fabricated device | NOT_RUN |
| user-disable/token/local-password/role-assignment | token CAS + business mutation + target Legacy/Operator invalidation | NOT_RUN |
| user-shared-workstation-preserved | B current operator/device/credential unchanged despite A historical row on same workstation | NOT_RUN |
| user-pin-binding-invalidated | old BoundTokenVersion cannot match new account token | NOT_RUN |
| account-request-replay | old RequestId rejected, no second mutation/decision | NOT_RUN |
| user-rowversion/generation-conflict | no partial business success | NOT_RUN |
| account-audit/decision-rollback | injected SQL trigger failure; independent snapshots unchanged | NOT_RUN |
| account-commit-unknown | actual commit then lost acknowledgment stays unknown, no automatic retry | NOT_RUN |
| concurrent-user-revoke | two connections/barrier, one success, stale second CAS rejected | NOT_RUN |

Next: review927 constraints/catalog/permissions before any installer work; run the expanded suite only in the approved new VM.
Then add a bounded self-service password writer and a batch RolePermission owner, keeping Runtime OFF until physical SQL and
legacy coverage are accepted. This branch is not suitable for a production source-overwrite upgrade with926 installed.

Local offline verification: user Writer96/96, complete Server2127/2127, Client unit59/59, Browser141/141;
Server/Client typecheck and build pass. These are test-local drivers/browser fixtures, not SQL acceptance.
