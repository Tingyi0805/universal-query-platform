# H0 gate 5 — offline writer integration

SQL_ACCEPTANCE=NOT_RUN; all 21 isolated SQL cases remain unexecuted. Runtime feature flags/hard gates remain OFF. This stage changes source/tests only: no ZIP, update tool, release flow or installer is produced. Existing UQP updates remain GitHub source download/extract/overwrite; no deployment to C:\UQP is performed.

## Implemented owner and denial boundary

withLegacyWorkstationTransaction owns SERIALIZABLE begin → canonical transaction-owned security gate → metadata/926 admission fence → existing business checks/DML → commit. Existing identity callbacks do not begin/commit separately; source regression checks enforce their current structure. The public API accepts no external transaction token. This is a code contract, not a TypeScript proof of SQL isolation. Before business work, the existing fence requires schema metadata visibility and denies any 926 sidecar, policy extension or ledger entry.

Commit exceptions yield LEGACY_COMMIT_UNKNOWN without rollback/retry claims. Precommit failures roll back once; rollback acknowledgment failure yields LEGACY_ROLLBACK_UNKNOWN. Infrastructure errors expose fixed codes only. Existing domain codes for last-admin/history/role/bootstrap remain, and duplicate username/role HTTP 409 handling retains only SQL 2601/2627 numbers without driver SQL/value details.

No 926 identity invalidation or fabricated Audit/Decision is emitted. Pre-926 identity APIs retain existing TokenVersion/role/history behavior; their existing route-level best-effort audit is **not** promoted to atomic 926 auditing. Installing 926 would deliberately block these legacy identity operations, including account disabling and password/session revocation. Do not deploy/enable 926 until the proper atomic replacement can safely perform those security operations.

## Writer coverage

| Object / source | Named path | Current behavior |
| --- | --- | --- |
| AppUser/UserRole — admin.repository.ts | createInitialAdmin, createUser | Common owned transaction; gate before bootstrap/natural-key/membership access; deny 926 |
| AppUser/UserRole | updateUser | Common owner; existing last-admin checks, TokenVersion change and membership rewrite retained; deny 926 |
| AppUser | resetUserPassword, revokeUserSessions | Former autocommit paths now use common owner; deny 926 |
| AppUser/UserRole/UserQueryAccess | deleteUser | Common owner before existing user/history/ACL checks and deletes; deny 926 |
| Role/RolePermission/AppUser | createRole, updateRole | Common SERIALIZABLE owner; existing SYSTEM_ADMIN protection and member TokenVersion update retained; deny 926 |
| auth.repository.ts | updateOwnLocalPassword | Former autocommit path uses common owner; existing LOCAL/active checks retained; deny 926 |
| sharedWorkstation.repository.ts | createSharedWorkstation | Creation now uses common owner; other status/user-grant paths retain prior common-gate denial |
| workstationCredential.repository.ts | issueDeviceCredential, revokeDeviceCredential | Existing gate before credential/workstation locks; deny 926 |
| workstationManagement.repository.ts | create, metadata, retire, removeUnused, saveGrants/copy, saveAudience, bindDevice | Existing session gate before config gate; deny 926 |
| Quick PIN / policy | enroll/revoke, policy change | Existing common gate and 926 denial |
| old workstationSessionSql.repository.ts | revokeDevice, every cause including ADMIN_REVOKED | Retired: REVOCATION_SCOPE_BLOCKED before pool/transaction/Request/Audit/DML |
| old Session SQL exports | revokeDevice/revokeDependents/credential/workstation broad revocation | Removed; no workstation-wide legacy mutation shortcut remains in this repository |
| renewal / operator adapters | compareAndSwapRenewal, recordPinFailure, compareAndSwapSwitch | Owned gate/CAS/Audit/Decision contracts retained; isolated, not Runtime-enabled |
| reviewed atomic credential adapter | revokeCredentialAndSessions | Existing complete credential-bound scope/CAS/count/Request/Audit/Decision flow retained, explicit isolated pool only; SQL NOT_RUN |
| partial credential SQL draft | isolatedCredentialRevocationSql | Raw incomplete statements only, no executor/route; cannot establish complete revocation |

The old Device command lacks the reviewed credential lineage and operator incarnation evidence. It is not silently translated into the broader credential command. Callers must migrate to a reviewed operation with the required scope and semantics; matching RequestId or replay digest cannot reactivate the retired entry.

Session renewal and Operator/PIN SQL adapters now also default to no pool, matching the reviewed credential adapter's explicit-isolated-pool boundary. They cannot accidentally obtain the shared platform pool when called without dependencies. Only explicitly injected test/acceptance pools can execute their contracts; this does not approve real Runtime integration.

The coarse inventory remains GAP/UNKNOWN for full 926 invalidation, even where the common gate/denial is implemented. Caller-provided booleans cannot clear those known source gaps or certify SQL acceptance.

## Mechanical coverage and offline tests

workstationNamedWriterCoverage records function paths. workstationProtectedSqlSources lists the 10 current module files containing protected SQL statements. A regression source scan rejects newly unclassified direct table DML and recognized TokenVersion alias writes. TypeScript AST checks require all identity DML literals in admin/auth repositories to sit inside the common-owner callback. These checks are source guardrails, not a complete SQL parser, dynamic-SQL proof, privilege enforcement or catalog verification.

Tests call the actual identity repository functions with test-local mssql constructors; no SQL connection is opened. Cases cover normal pre-926 flow; full/partial 926, unavailable metadata and gate denial before all DML; last-admin/history/system-role/bootstrap protection; mid-write 1205/1222/permission faults; rollback; commit unknown; duplicate-key error compatibility. A synthetic shared queue checks callback ordering across owners, not SQL Server locks/deadlocks.

The existing reviewed atomic writer, exact BIGINT Audit receipt, immutable Decision, legacy lineage rejection and H0 renewal/operator tests are retained. The retired Device tests now require explicit rejection and zero SQL rather than accepting a dangerous broad revocation. Request reservation/replay and durable receipt behavior continue to be exercised on the reviewed atomic writer path.

Local verification: 82 focused identity/Session/Operator/coverage tests passed; Server full suite 2,030 passed / 0 failed; Client unit 12 passed / 0 failed; Server/Client Typecheck and Build passed. Focused tests overlap the full suite. These are offline/mock/regression results, not real SQL Server 2019 acceptance.

## Remaining blockers

- **Real SQL:** no current-environment Docker/SQL access. SERIALIZABLE/key-range/FK behavior, rollback durability, multi-node races and commit reconciliation remain NOT_RUN. Follow the existing new Ubuntu 24.04 VM manual; do not repeat completed preparation or touch the shared database.
- **Full 926 identity revocation:** compute/revalidate the complete affected user/workstation/device/operator/legacy scope, advance generation/incarnation through CAS and write exact mandatory Audit/Decision in one transaction. Role changes can affect many users/workstations. None is established merely by obtaining the gate.
- **Legacy evidence:** unlinked active legacy rows remain a before-DML blocker. No credential backfill, mass workstation revoke or join-after-cleared-OperatorSessionId shortcut is allowed.
- **Authorization:** existing legacy identity IDs remain their existing Number-based API contract; they are not trusted exact BIGINT 926 evidence. Formal sidecar integration needs precise readers/bindings, immediate authorization/TokenVersion and final version revalidation; serializing existing legacy callbacks alone does not prove these.
- **Deployment prerequisites:** VIEW DEFINITION on schema uqp (or covering rights) is required by the existing denial fence. Missing visibility refuses writes; no grant is automatically applied. Older schemas lacking required metadata/ledger cannot be assumed safe. This is not an approved production rollout.
- **Bypasses:** old binaries/workers, bootstrap/migration/direct SQL scripts, external schedulers, DBA/sysadmin, triggers and restore/incarnation changes are outside the common application's gate. A database principal permitted direct DML can bypass cooperative locking. Runtime cannot be enabled until deployment fencing, required permissions, writer adoption and independently verified evidence are established. The application cannot stop sysadmin.
- **Mixed lock families:** the session gate orders adopted Session/identity writers in the same database. It does not prove a common physical order with all Query ACL/Dataset/Dashboard writers, optimizer/FK locks or another database. Existing Dashboard guards are unchanged; real concurrency regression remains required.

Even 21 isolated SQL PASS results would not automatically clear any bypass/production blocker. No SOURCE_BOUND, SQL_LOCK_VERIFIED, PIN/JWT API or patient data delivery is enabled.

## Next smallest step

Verify this commit's Server/Client CI, then execute the existing acceptance suite only on an approved new independent SQL Server 2019 VM. Use those observed scope/rollback/lock results to implement one narrowly scoped user-revocation replacement with exact affected-device receipts and final authorization checks. Keep the denial fence until its replacement passes; do not remove the fence merely to restore management availability.

後續單一使用者撤權的隔離 Writer、可保留的 Device/Credential 與完整926安裝後的可用性阻擋，見 [單人撤權契約](shared-workstation-single-user-revocation.md)。它不會解除此文件的正式覆蓋缺口，也不是 legacy Writer 的已啟用 fallback。
