# H0 gate 5 — disposable SQL Server 2019 acceptance

Current result: **SQL_ACCEPTANCE=NOT_RUN**. No SQL Server was contacted. Existing-environment Docker access is not authorized and will not be used. This package is executable test code plus preparation, not a SQL acceptance certificate.

PR #67 must stay Draft. Runtime flags and hard gates stay OFF. Do not run against UniversalQueryPlatform, the shared Windows 11/Windows Server instance, HIS, Oracle or C:\UQP. Do not copy these files over an existing installation.

## Independent environment and repeatable command

Use a new x86-64 Linux VM with Docker Engine, Node 22, Bash and the Server npm dependencies. Recommended: 4 CPUs, 8 GB VM memory, 15 GB free disposable storage; the container is limited to 4 GB. Docker socket access is privileged and must be approved by the VM administrator.

Follow the complete [Ubuntu 24.04 new-VM manual](UBUNTU-24.04.md). Prepare the VM first; run the following only after that separate environment is approved for actual SQL acceptance.

```bash
npm --prefix server install --package-lock=false
UQP926_APPROVE=CREATE_DISPOSABLE_SYNTHETIC_926_ONLY UQP926_VM_APPROVE=NEW_UBUNTU_2404_VM_ONLY bash tools/sqlserver-acceptance/h0-926/run-isolated.sh
```

The launcher:

- Uses only the local Docker socket, creates a fresh internal network and SQL Server 2019 container, with no host mounts or persistent volumes.
- Generates new random administrator credentials in process memory; never echoes them or passes them in command-line arguments.
- Publishes only 127.0.0.1:14336. An existing listener makes launch fail; it is never replaced.
- Gives the container fixed hostname uqp-h0-926-isolated. The Node harness requires Engine 15, matching server/machine, master, sa, and **zero pre-existing user databases** before creating anything.
- Creates a nonce-named UQP926_* database. It never reads PLATFORM_DB_*, .env, JWT configuration, saved UQP connection settings or user database names.
- Removes only the container whose generated ID and ownership label match this invocation. Network removal separately requires its ID, matching run label and zero attached containers. It never disconnects others or runs volume/network/system prune.
- Creates a fresh 21-case NOT_RUN report before daemon setup. Records the run/Commit/image IDs, per-case times and database/container/network cleanup outcomes. Cleanup refusal/failure is reported and makes a successful run exit nonzero.

No approval, no new-VM confirmation, wrong instance, existing user database or insufficient environment evidence means NOT_RUN. Confirmation strings are administrator declarations, not independent proof of VM isolation. Do not weaken the checks. Docker's image tag is 2019-latest; the report records its immutable image ID and available registry digest for replay review. This is an encrypted loopback test connection using a disposable self-signed server certificate; it does not validate production TLS certificates.

## Schema dependencies and fixture

The harness runs the **48 real migration sources 001–921**, in sorted order and per-file transactions, with SHA-256 source manifest in the report. It does not call db:migrate or its application/bootstrap code.

| Source | Required relationships |
| --- | --- |
| 001 / 019 | AppUser/roles/permissions and TokenVersion |
| 002–006 / 016 / later audit migrations | Dataset/Query parents, AuditLog and Archive dependencies |
| 902 | SharedWorkstation, SharedWorkstationUser, UserQuickPin, legacy SharedWorkstationSession; one active legacy row/workstation |
| 903 / 904 / 905 | QuickPinPolicy, credential/version/secret hash, platform metadata |
| 909–915 | PatientListDisclosure and DashboardDisplayDevice prerequisites for 916 |
| 916 | RetiredAtUtc, PurposeCode, audiences, Dashboard device linkage |
| 920 / 921 | Kept in full baseline; 926 does not depend on Native Type confirmation |
| 926 draft | Six sidecar tables, policy revision/ROWVERSION, composite FK/index prerequisites and immutable Request/Decision |

923/924/925 and an invented 922 are unnecessary for 926's declared dependencies and are not installed. This harness does not imply their acceptance. 926 remains in database/drafts; it never enters the normal runner or writes a 926 SchemaMigration ledger entry.

fixture.sql is parameterized and uses only synthetic rows. Every case gets a new workstation/credential/device/RequestId; no append-only history is deleted between cases. IDs/generations/audit receipts exceed 2^53 and remain decimal strings. CreatedAt/LastActivity share one fixture timestamp. There is no real PIN, credential secret or patient data.

Mode 0 has no legacy row; mode 1 explicitly builds a synthetic current Operator→Device→Credential link satisfying composite FKs; mode 2 deliberately creates an **unlinked** active legacy row. Mode 2 must refuse before DML. No historical ownership is backfilled or inferred.

## Implemented real SQL cases — all currently NOT_RUN

| Cases | Required evidence / expected result |
| --- | --- |
| catalog-roundtrip | Existing R0–R7 witness executes; all required columns/objects match, four ROWVERSION tables, six sidecars, trusted enabled NO ACTION FKs. This witness is **not an exact installer validator** for all extra/altered constraints. |
| no-legacy / linked-legacy | Actual Adapter commits; credential/device/legacy counts, changed operator receipt and Request/Audit/Decision joins agree; exact BIGINT Audit ID survives. |
| unknown-history-before-dml | All rows and audit counts unchanged; @@DBTS unchanged, proving no ROWVERSION-changing UPDATE attempt in this serial isolated case. |
| credential-version-conflict / operator-cas-conflict | Wrong version/guarded CAS returns rejection; all preceding writes roll back. Operator predicate conflict is injected in the test transport, not production SQL. |
| request-replay-rollback | Reuse an existing immutable RequestId on another target; rollback all target changes, no extra audit/decision. |
| audit-trigger-rollback / decision-trigger-rollback | Enabled synthetic trigger forces INSERT/OUTPUT failure; prior credential/session/operator writes and reservation disappear. Driver-confirmed failure may conservatively return ROLLBACK_UNKNOWN after automatic XACT_ABORT rollback. |
| commit-unknown-committed / commit-unknown-rolled-back | Test transport discards acknowledgment after real commit or real rollback; caller returns COMMIT_UNKNOWN in both. A separate observer distinguishes the actual persisted outcome. This is controlled acknowledgment-loss simulation, not a network fault test. |
| rollback-ack-unknown | Real rollback occurs, transport then throws; caller retains ROLLBACK_UNKNOWN and observer proves no partial state. Does not prove recovery from a genuinely failed SQL rollback. |
| concurrent-revoke | Two independently reserved SQL connections, barrier after complete scope lock; one commits, the contender rejects, exactly one decision. |
| concurrent-renewal-revoke | Actual renewal CAS SQL probe under common gate, then credential Writer; counter advances before revoke and no valid device remains. This probes the statement/race, not the complete H0-2 renewal service or its audit. |
| legacy-insert-predicate-block | Connection A holds validated empty legacy predicate; independent B INSERT without gate gets real 1222; A can finish. Does not prevent an uncooperative INSERT **after** A commits. |
| gate-timeout | A holds transaction-owned application gate; Writer B times out/refuses without mutation. Application-lock timeout is not mislabeled SQL error 1222. |
| deadlock-1205 | Deliberately reversed two-workstation row dependencies, LOW/HIGH deadlock priorities; require actual SQL 1205 and no victim mutation/audit. This is fault injection, not a claim of deadlock freedom. |
| legacy-writer-denial | New/partial 926 is rejected by transitional guard before legacy DML. |
| immutable-decision-request | Restricted account cannot delete Request or Decision. |
| foreign-workstation-unchanged | An unrelated linked workstation's state/ROWVERSION/history remain unchanged. |
| multiple-active-device-constraint | Real 926 filtered UNIQUE index rejects a second active device for one credential; the harness does not drop that index to manufacture a multi-device success. |

## Identities and evidence

The temporary sa identity is used only for instance witness, bootstrap, fixture and fault injection. The Writer runs through a separate SQL login with object SELECT, UPDATE on credential/device/legacy/operator, INSERT on Request/Decision/Audit, and explicit Request/Decision UPDATE/DELETE denial. It must have sysadmin=0, db_owner=0, CONTROL DATABASE=0 and VIEW SERVER STATE=0. This is an acceptance account, not an approved production grant recipe.

last-report.json is generated locally and gitignored: per-case PASS/FAIL/NOT_RUN and times, summary counts, safe stage code, numeric SQL errors, source hashes, actual engine Build/Edition and observed database Compatibility Level, catalog/privilege witness, run/Commit/image identity and cleanup results. Missing engine evidence stays absent; no version is invented. A successful isolated report requires all 21 timed PASS results and observed Engine 15/Build 15.x/Compatibility 150. No SQL text, raw exception, PIN, connection string or credential is serialized. A failure aborts subsequent cases, leaving them NOT_RUN. Preserve this de-identified report outside the disposable container.

The CLI was exercised **without approval** and returned SQL_ACCEPTANCE=NOT_RUN / FAILURE_STAGE=APPROVAL. Only this refusal and offline/unit/static checks have actually run here.

Local VM-hardening regression: Server 1,966 passed / 0 failed; Client unit 12 passed / 0 failed; both Typecheck/Build passed. The 15 focused launcher/isolation/report checks are included in that Server total. GitHub CI results are reported against the pushed commit. Launcher tests use a fake Docker executable and block the SQL harness; no daemon is accessed. None of these checks substitutes for the 21 NOT_RUN SQL cases.

## Writer coverage and remaining blockers

Named function inventory is in workstationRevocationWriterInventory.ts. The following now take the canonical session gate before old locks and **deny** if any 926 sidecar/policy extension/ledger is detected:

- issueDeviceCredential / revokeDeviceCredential.
- Workstation management metadata, retire, removal, grants/copy, audience changes and device binding (session gate precedes existing config gate).
- updateSharedWorkstation fallback / setWorkstationUsers.
- Quick PIN enroll/revoke and policy changes.

These are guard conversions, not 926 atomic sidecar invalidation implementations. Installing 926 would intentionally block those legacy management operations; do not deploy it to the shared database. Pre-926 business semantics remain only when metadata visibility is sufficient. The guard requires VIEW DEFINITION on schema uqp (or covering owner rights); missing visibility and bounded gate contention are additional rejection conditions. No permissions are automatically granted. The guard emits no GateResult rowset, preserving existing inline batches' final result semantics.

Still GAP: password reset/change, user disable/TokenVersion, roles/permissions, session revocation and user deletion; their existing JWT checks do not prove atomic 926 sidecar invalidation. They are inventoried, not silently modified. The older isolated device repository's revokeDependents still uses workstation-wide legacy revocation without the new credential-lineage/incarnation proof and remains forbidden for production integration. Operator and renewal adapters remain isolated. No production route was enabled.

External DBA/direct SQL, old workers, metadata visibility, mixed deployments and backup/restore incarnation remain unproven. Cooperative gates cannot stop an authorized direct DML writer after commit. Runtime admission must stay blocked even if all listed disposable tests later pass.

## Cleanup, interruption and next gate

Normal/error exit closes pools and removes only the generated database/login; shell EXIT removes the invocation's labelled container and empty labelled network. INT/TERM use the same cleanup. SIGKILL/host crash can prevent cleanup. Ownership mismatch, another attached container or daemon failure makes cleanup refuse/fail visibly. The administrator must inspect the recorded nonce label, then remove **only** those disposable resources; do not use broad stop/remove/prune commands. Never run cleanup against a user database. Preserve safe evidence first; do not retain the generated secrets.

Next step: complete the new Ubuntu 24.04 VM preparation in the manual, then obtain approval to run actual SQL acceptance there. Existing-environment Docker access remains forbidden. SQL text compilation/catalog persistence/actual races are not established by TypeScript or mocks. Broader SQL_LOCK_VERIFIED, production revocation coverage, runtime authorization, PIN API and patient delivery remain BLOCKED even if all 21 SQL cases later pass.
