# H0-5C-2A — credential revocation SQL admission checklist

Status: **BLOCKED / isolated design only**. This review is not SQL Server 2019 acceptance and does not enable any runtime path.

## Verified draft boundaries (source inspection)

- `workstationCredentialRevocationSql.ts` currently offers only credential row discovery, a scoped credential mutation, and active device-session invalidation.
- `operatorInvalidationImplemented`, `atomicAuditImplemented`, and `productionReady` are intentionally **false**.
- `workstationAtomicRevocationPort.ts` remains an unregistered interface; it cannot own a transaction or prove atomicity.
- Legacy PIN, password, role, workstation, credential, and grants writers in `workstationRevocationWriterInventory.ts` remain `GAP`; noncooperating legacy workers/DBA operations remain `UNKNOWN`.
- Consequently **no writer may call the draft SQL statements independently**, and no endpoint may treat them as a committed revocation.

## Required implementation order

1. One repository owns `SERIALIZABLE` + `XACT_ABORT` transaction and holds the canonical session-security application lock before reading or modifying any revocation scope.
2. Lock/recheck workstation, credential, device session and operator state in canonical order; use exact BIGINT text for keys and exact ROWVERSION CAS rather than JavaScript number conversions.
3. Change the credential row with an expected version and enforce the exact allowed affected-row count. For already-revoked or stale versions, return a deterministic rejected result without creating an unproved successful receipt.
4. Revoke **all** affected active device and legacy sessions and advance the operator generation/incarnation through reviewed CAS. Confirm no active session in scope remains while still holding locks.
5. Write exactly one immutable Request/Decision correlation plus the real `AuditLog.Id` inside the same transaction; any failure rolls back mutation and invalidation.
6. A commit exception yields `UNKNOWN`; do not blindly replay or label it successful. Reconciliation must distinguish committed, rolled back, and indeterminate outcomes.
7. Existing management writers and mixed-version workers must either adopt this same owner/gate or be blocked before enabling any route.

## Admission and negative tests

| Test | Required result |
| --- | --- |
| Credential/workstation mismatch | Reject without mutation or audit success |
| Stale credential version / concurrent rotation | CAS failure, no partial revocation |
| Multiple active legacy/device sessions | All invalidated in same transaction |
| Active operator on revoked device | Generation advanced; old response/credential unusable |
| Audit insert or Decision insert failure | Whole transaction rolled back |
| Deadlock 1205 / lock timeout 1222 | Fail closed; no blind retry |
| Commit acknowledgement lost | `UNKNOWN`, reconciliation required |
| Uncooperative old writer/worker | Gate admission blocked |
| BIGINT beyond `Number.MAX_SAFE_INTEGER` | Exact text round-trip; never precision loss |
| Concurrent renewal, PIN switch and revoke | Linearized outcome, no resurrection |

## Release gate

The mock tests and static-source checks do **not** establish atomic SQL semantics. Keep Migration 926 outside the migration runner; do not run it against the production or shared UQP database. SQL Server 2019 catalog validation, two-connection races, rollback durability, fault injection and mixed-version writer adoption are **NOT_RUN / BLOCKED**. PR #67 remains Draft and unmerged. No `C:\UQP` replacement or production database action is authorized.
