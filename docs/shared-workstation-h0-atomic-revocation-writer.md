# H0 isolated atomic credential revocation writer

Runtime registration and feature flags remain OFF. Migration 926 remains a draft outside the migration runner. No existing database was contacted.

## Implemented transaction

`createIsolatedRevocationSqlDriver` owns one mssql SERIALIZABLE transaction. Its transaction-owned security gate sets XACT_ABORT and a bounded lock timeout. It validates workstation status, credential/version, exact device binding, the complete credential device set, operator ROWVERSION/generation/incarnation, and active legacy coverage before any DML.

The current logical acquisition sequence is Gate → active Legacy predicate/Operator/Device lineage check → Workstation → Credential → specific Device → complete credential Device set → Operator → linked Legacy set → all-active Legacy count. The initial legacy predicate is a conservative admission fence retained from the existing implementation. The common gate serializes cooperating adapters; optimizer, FK/range locks, legacy writers and other management writers can still have conflicting physical acquisition orders. This sequence is **not** a deadlock-freedom claim.

The writer then performs:

1. Credential/version/device-bound CAS; exactly one credential must change.
2. Credential-scoped device revocation; affected count must equal the locked set.
3. Only the currently linked Legacy Session revocation, before Operator CAS clears its link; returned IDs must exactly equal the locked set.
4. Operator ROWVERSION/generation/incarnation CAS; generation advances exactly once and incarnation rotates. The new ROWVERSION is read from OUTPUT, never predicted.
5. Independent remaining-device and **all-active workstation legacy** counts, both zero. The latter is a rejection fence, never permission for workstation-wide legacy mutation.
6. One Request reservation, exact string AuditLogId from SQL OUTPUT, and immutable Decision using the actual previous/next operator receipts.
7. Commit only after every receipt matches. Any preceding failure rolls back the owner transaction. A failed commit acknowledgment yields COMMIT_UNKNOWN, without retry or a rollback claim.

All values are bound parameters. BIGINT identities, generations and Audit IDs preserve exact decimal strings. Scope is copied from data descriptors before awaits; Proxy/accessor/unknown command fields are rejected. Single-use phase guards prevent reentry after failed mutation or append-only writes. Audit parameters contain fixed contract metadata and IDs/counts, no PIN, proof, SQL or patient values.

## Legacy boundary

Migration 902 has no CredentialId on SharedWorkstationSession. Migration 926's composite FK ties the current OperatorSessionId/workstation/user to the legacy row, and OperatorState's device binding ties it to a credential. This proves only the **current persisted active link**, not historical credential ownership.

Zero active legacy rows or exactly one fully linked active legacy row can enter the isolated writer. Any active legacy row outside that link is rejected **before all DML**, including expired-but-not-revoked rows. Already revoked historical rows are preserved. No backfill or guessed credential assignment is performed.

Legacy password/PIN/session, credential rotation, workstation administration, user disable, TokenVersion and role writers have not all adopted the cooperative gate. External SQL/DBA and mixed-version workers remain unproven. Consequently full legacy writer coverage is BLOCKED and no endpoint may register this writer. The isolated Audit/Decision uses a null system actor; authenticated management actor authorization/correlation is a further prerequisite for API integration.

926's UX_WorkstationDeviceSession_ActiveCredential currently permits only one active device per credential. The mock multiple-device case checks complete-set counting defensively; it does not assert those rows can coexist under the installed index.

## Acceptance boundaries

| Gate | Evidence / status |
| --- | --- |
| 1 Transaction / Rollback | Existing green CI 40339161069; regression retained |
| 2 Credential / Legacy scope | Implemented and mock-tested; historical/uncooperative writer coverage BLOCKED |
| 3 Actual SQL writer | Parameterized mssql adapter implemented, unregistered; SQL Server acceptance NOT_RUN |
| 4 Request / Audit / Decision / CAS | Same transaction code and fault tests implemented; durable SQL atomicity NOT_RUN |
| 5 Independent SQL Server 2019 | BLOCKED: approved independent environment unavailable |
| 6 Full regression / update package | Local/CI results reported with commit; no deployment/update package authorized |

Mock tests cover zero/one legacy, complete devices, unlinked/foreign scope rejection, CAS/version drift, exact BIGINT receipts, duplicate RequestId, SQL 1205/1222 injection, staged rollback, audit/decision faults, commit unknown, failed rollback, phase reentry, competing gate and unsafe input. They do not prove SQL Server rollback, absent unobserved DML, key-range protection or durability.

Local validation: Server full suite 1,948 passed / 0 failed; H0 workstation suite 190 passed / 0 failed (included in full suite); Client unit suite 12 passed / 0 failed; Server/Client typecheck and build passed. The initial sandboxed full run could not bind localhost (EPERM); the complete suite was rerun with local-network permission and passed without changing tests. Browser results are supplied by the commit's GitHub Client job. SQL Server integration remains NOT_RUN.

## Next isolated SQL acceptance

Use a new independent SQL Server 2019 instance/database, the complete compatible baseline plus reviewed 926 draft/catalog validation, synthetic fixtures and restricted runtime identity. Do not use the shared UniversalQueryPlatform database or C:\UQP.

Required two-connection barriers: renewal vs revoke, operator switch vs revoke, duplicate RequestId, credential rotation/version drift, concurrent legacy insertion and foreign workstation control rows. Prove final counts, unchanged foreign rows, exact Audit/Decision joins, >2^53 receipts, SQL 1205/1222 behavior, audit/decision failure rollback and commit-acknowledgment reconciliation. Capture de-identified engine/catalog/lock evidence. Resolve legacy writer gate coverage before production admission. All SQL tests are currently NOT_RUN; gates 2–4 are not marked COMPLETE.
