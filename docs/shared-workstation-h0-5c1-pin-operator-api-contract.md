# H0-5C-1 PIN/operator SQL adapter and disabled API contract

Status: **isolated adapter implemented; API and Runtime authority remain disabled**.

## Implemented boundary

`workstationOperatorSql.repository.ts` adapts the H0-3 ports to fixed,
parameterized SQL Server statements. It owns a `SERIALIZABLE` transaction,
acquires the existing cooperative application gate, re-reads the current
workstation, credential, device session, user, permissions, PIN policy, PIN
binding, persistent attempt state and operator state, and then performs a
ROWVERSION CAS. A successful switch resets the PIN attempt state and advances
the operator generation/incarnation in the same SQL batch.

The adapter reserves a one-time RequestId without storing the PIN. A committed
PIN failure advances the cross-node attempt state and writes a rejected
Decision. A successful switch writes its Audit and immutable Decision before
commit. `AuditLog.Id` is read with
`OUTPUT CONVERT(VARCHAR(20), INSERTED.Id)` and is never converted through a
JavaScript `Number`. Audit, Decision, CAS, rollback or uncertain commit failure
is fail-closed and is not retried.

The result remains an isolated authorization candidate:

- `runtimeEnabled=false`, `runtimeAuthority=NONE` and `jwtIssued=false`;
- no auth route imports the adapter or the API contract;
- no Query, Export, Dashboard or patient-data permission is issued;
- no raw PIN, device proof or credential secret is written to SQL or Audit.

H0-3 still represents AppUser identifiers as safe JavaScript numbers. The
adapter rejects identifiers outside that range rather than repairing them.
Changing the H0-3 port to canonical SQL BIGINT text is required before formal
enablement.

## Transaction and lock order

The common order is:

1. owned transaction with `SERIALIZABLE`, `XACT_ABORT ON` and bounded lock timeout;
2. transaction-owned cooperative session-security application gate;
3. untrusted device identity discovery;
4. Quick PIN policy;
5. target AppUser, then current Role/Permission membership;
6. SharedWorkstation and workstation user/audience access predicates;
7. SharedWorkstationCredential and SharedWorkstationDeviceSession;
8. UserQuickPin, UserQuickPinSecurityBinding and PIN attempt state;
9. legacy active operator-session range and SharedWorkstationOperatorState;
10. RequestId reservation, CAS mutation, exact Audit and immutable Decision;
11. commit.

Every cooperative mutation is serialized by the first gate. SQL Server 2019
optimizer, range-lock, deadlock, rollback and cross-node behavior has not been
proved because no approved isolated instance is available. The draft adapter
does not automatically retry 1205, 1222 or commit-unknown outcomes.

## Draft 926 correction

The draft now permits a PIN-verified `OPERATOR_ACTIVE` candidate with no legacy
`OperatorSessionId`; this stage deliberately does not issue an operator session
or JWT. H0-5C-2 must either atomically bind a real operator session before any
Runtime authority is enabled or replace this candidate state with a separately
reviewed schema state.

The immutable Decision check also permits a rejected `OPERATOR_SWITCH` to carry
the changed PIN-attempt ROWVERSION. This records a committed failure-counter or
lockout mutation without treating it as a successful operator switch. The
draft remains outside the migration runner and was not executed.

## Disabled API and browser credential contract

`workstationSessionApiContract.ts` documents future issue, renew, lock and PIN
switch routes only. `WORKSTATION_SESSION_API_ENABLED` defaults to false and a
separate hard-coded runtime-wiring gate remains false, so configuration alone
cannot expose the endpoints.

The future device proof is limited to a Secure, HttpOnly, host-only session
cookie using `SameSite=Strict`; no device proof, operator credential or PIN may
be placed in localStorage or sessionStorage. State-changing calls require HTTPS,
same-origin validation and a device-bound, memory-only CSRF header that rotates
after renewal and operator switch. Previous proofs cannot be reused, commit
unknown cannot be blindly replayed, and device identity cannot authorize Query.

## Revocation writer coverage

The cooperative gate is not a database-enforced fence. Current writers below
can change evidence without acquiring it and therefore block enablement.

| Writer path | Relevant mutation | Coverage | Required H0-5C-2 change |
|---|---|---|---|
| `auth/quickPin.service.ts` | enroll/revoke PIN and legacy sessions | GAP | same owner/gate; update PIN binding and attempt state; revoke operator candidate |
| `admin/quickPinPolicy.repository.ts` | PIN length, all PINs and legacy sessions | GAP | advance 926 PolicyRevision and invalidate binding/attempt/operator rows atomically |
| `auth/auth.repository.ts` | password reset and TokenVersion | GAP | gate and invalidate operator authorization for that user |
| `admin/admin.repository.ts` | user disable/delete, TokenVersion, roles and permissions | GAP | gate, lock affected workstation scope and invalidate all active candidates |
| `admin/workstationCredential.repository.ts` | credential issue/revoke | GAP | gate and revoke matching device/operator state in the same transaction |
| `admin/sharedWorkstation.repository.ts` | workstation state and credential version | GAP | gate and revoke device/operator state in the same transaction |
| `admin/workstationManagement.repository.ts` | disable/retire, grants and audience membership | GAP | gate and invalidate affected device/operator authorizations atomically |
| migrations, legacy workers, direct SQL and DBA operations | any equivalent mutation | UNKNOWN | deployment fence or explicit operational exclusion plus acceptance evidence |

Database FK/CHECK constraints prevent some malformed rows; they do not make
these writers participate in the gate or immediately revoke every dependent
session. Mixed-version deployment is therefore blocked.

## Verification and remaining gates

Unit tests cover live TokenVersion/PinVersion/policy checks, account and
workstation disablement, persistent PIN failures, replay/conflict, synthetic
cross-node CAS, rollback, audit failure, exact BIGINT receipts and commit
unknown. They also prove that the future route paths are unregistered and the
feature flag cannot grant authority.

Real Migration 926 installation, exact catalog validation, two-connection CAS,
1205/1222 injection, rollback durability, HTTPS/proxy/cookie validation and
legacy-writer coordination are **NOT_RUN / BLOCKED**. H0-5C-2 may begin only as
an isolated wiring stage after those writers have a common invalidation plan;
formal API enablement additionally requires an approved isolated SQL Server
2019 acceptance environment, exact 926 catalog match and an atomic operator
session issuance design. Existing JWT, AuthContext and all data-delivery paths
remain unchanged.
