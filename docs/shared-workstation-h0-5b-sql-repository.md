# H0-5B SQL Repository and transactional audit

Status: **isolated adapter implemented; Runtime wiring and SQL Server 2019 acceptance remain blocked**.

## Implemented boundary

`workstationSessionSql.repository.ts` adapts the H0-2 device-session ports to
parameterized SQL Server statements. It is not imported by an auth route,
Query, Dashboard, Export, or PIN endpoint. Its returned authority is always
`NONE`/device-entry-only and it cannot authorize operator or patient-data use.

Implemented operations are:

- locked device-session snapshot read and constant-time proof comparison;
- `ROWVERSION + RenewalCounter` renewal CAS using exact decimal BIGINT text;
- repository-generated one-time renewal RequestId and explicit revocation
  RequestId reservation;
- exact `AuditLog.Id` retrieval through `OUTPUT CONVERT(VARCHAR(20), ...)`;
- append-only Request/Decision correlation in the same transaction as a
  successful mutation;
- device revocation plus session invalidation boundaries for credential or
  workstation revocation coordination;
- fixed fail-closed results for audit failure, rollback failure and uncertain
  commit. Deadlock 1205 and lock timeout 1222 are not automatically retried.

H0-3 operator switching, persistent PIN-attempt mutation and operator JWT
issuance remain disconnected. The H0-3 policy revision contract now uses the
canonical BIGINT text required by the 926 draft instead of treating it as a
ROWVERSION.

## Transaction and lock order

The adapter creates and owns a `SERIALIZABLE` transaction. It enables
`XACT_ABORT`, applies a five-second lock timeout, and acquires the cooperative
transaction-owned application gate before reading mutation scope. The device
path then uses this order:

1. cooperative session-security gate;
2. untrusted device identity discovery;
3. `SharedWorkstation` with `UPDLOCK, HOLDLOCK`;
4. `SharedWorkstationCredential` with `UPDLOCK, HOLDLOCK`;
5. `SharedWorkstationDeviceSession` with `UPDLOCK, HOLDLOCK`;
6. RequestId reservation with `UPDLOCK, HOLDLOCK`;
7. CAS mutation;
8. exact Audit insert;
9. immutable Decision insert;
10. commit.

Discovery is revalidated against all three locked rows. A mutation cannot
commit unless the CAS, Audit and Decision each affect exactly one row and the
Audit receipt is a canonical positive SQL BIGINT string. Commit errors are
classified as `COMMIT_UNKNOWN`; the adapter never retries them.

The gate is cooperative. Existing administration writers, old workers, DBA
SQL and any process that does not take the same gate can bypass it. Credential
or workstation invalidation SQL therefore provides a coordination boundary;
formal management writers still must update the credential/workstation state
and invalidate sessions in this same owned transaction before enablement.

## Validation scope

Mock tests verify binding, lock/query order, renewal CAS, RequestId replay,
Audit IDs above `2^53`, Decision correlation, proof rejection, credential-scope
session invalidation, rollback, rollback failure, deadlock/timeout no-retry and
commit-unknown handling. They do not prove SQL Server optimizer locks,
`sp_getapplock`, FK/trigger behavior, rollback durability, cross-node races or
actual catalog compatibility.

No isolated SQL Server 2019 instance is available in this workspace. Migration
926 installation, Catalog validation, two-connection races, 1205/1222 fault
injection and commit-unknown reconciliation are **NOT_RUN**. The existing
Windows/shared `UniversalQueryPlatform` database was not contacted or changed.

## Remaining release blockers

- install and validate draft 926 only in a new isolated SQL Server 2019 DB;
- run two-connection renewal/revocation/CAS and rollback durability tests;
- modify every credential/workstation/user revocation writer to share the gate,
  owner transaction and lock order, including old-worker/mixed-version policy;
- implement the H0-3 PIN-attempt/operator-state repository with exact user IDs;
- decide how existing numeric H0-3 user IDs migrate to exact BIGINT strings;
- add reconciliation for commit-unknown without blind replay;
- wire authorization revalidation, transactional audit and operator session
  issuance in H0-5C; then connect front-end response fences in H0-5D.

Until these pass, Migration 926 remains outside the migration runner, the
adapter is not production-deployable, and PIN/renewal/Query Runtime stay off.
