# Shared workstation H0-2 session lifecycle contract

## Existing schema and behavior

Migration 902 creates `SharedWorkstationSession` as an operator session. Its
stored fields are `Id`, `WorkstationId`, `UserId`, `SessionSecretHash`,
`AuthMethod`, `AuthenticatedAtUtc`, `LastActivityAtUtc`, `ExpiresAtUtc`,
`RevokedAtUtc`, `TokenVersion`, and nullable `PinVersion`. It has one expiry but
does not distinguish idle and absolute expiry, has no credential binding,
renewal counter, incarnation, or ROWVERSION, and permits one unrevoked operator
session per workstation. Migration 904 separately stores device credentials and
their version/revocation state. Migration 916 adds workstation purpose,
retirement, and management metadata; it does not extend either session schema.

The current credential verifier checks the credential hash, credential
revocation, workstation active/retired state, and equality between issued and
current `CredentialVersion`. Credential rotation, workstation/grant changes,
PIN changes, and administrative revocation already revoke operator sessions in
several existing writers. JWT middleware separately re-reads `AppUser.IsActive`,
`TokenVersion`, and current permissions. PIN enrollment/revocation exists, but
PIN sign-in and workstation session issuance are intentionally absent.

The legacy credential issue/revoke routes write management audit after the
credential transaction through `tryWriteAuditEvent`; that audit is best-effort
and is not atomic with the credential change. The general audit repository also
maps `AuditLog.Id` through JavaScript `Number`. Neither behavior satisfies the
H0-2 mandatory exact-receipt contract, so a future lifecycle adapter cannot
reuse those paths as durable renewal evidence without a reviewed writer/reader.

## H0-2 isolated contract

`workstationSessionLifecycle.ts` models a separate device-entry session. It has
no user identity and cannot authorize Query, export, Dashboard data, or patient
data. Renewal requires a current repository snapshot, current device credential
proof, matching workstation/credential versions, active and unretired state,
unexpired idle and absolute deadlines, ROWVERSION-style CAS, and a one-use
BIGINT renewal counter. Absolute expiry is never extended. The default adapter
does not exist in H0-2, so every result remains `productionReady=false` and
`productionPersistence=NOT_PROVEN`.

The repository port requires an owned SERIALIZABLE transaction with XACT_ABORT,
a fixed session → workstation → credential lock order, CAS, mandatory exact-ID
audit, and atomic commit or rollback. A concurrent tab, another server node, or
a restarted server must re-read the persisted counter and revision; process
memory is not authoritative. Commit-unknown, rollback failure, database failure,
invalid audit receipt, credential failure, expiry, revocation, and version drift
all fail closed. Audit events contain identifiers, outcome, and counter only;
the raw credential proof is never included. Structurally invalid, unbound input
is rejected before repository access; a future HTTP boundary must record only a
server request ID and safe reason for those attempts because their claimed IDs
are not trusted.

## Production schema gap

Formal device renewal requires a new reviewed migration before runtime wiring.
The minimum additive object is a separate device-session table, rather than
repurposing the operator-session table. It needs a UUID session ID, exact BIGINT
workstation FK, credential UUID FK, credential version binding, device-session
secret hash or equivalent proof binding, issued/last-activity/idle-expiry/
absolute-expiry/revoked timestamps, revocation reason, BIGINT renewal counter,
server-incarnation evidence where required, and ROWVERSION. Constraints and
indexes must support one current session policy, atomic replay prevention, and
the documented lock order. The migration must also update every credential,
workstation, retirement, and rotation writer to revoke device sessions in the
same transaction. Credential administration must move mandatory security audit
into those owned transactions and obtain `OUTPUT INSERTED.Id` as a canonical
SQL BIGINT string.

No migration number or DDL is approved by H0-2. Before activation, SQL Server
2019 tests must prove CAS races, lock order, rollback, commit-unknown handling,
credential rotation, multi-node replay protection, exact audit persistence, and
least-privilege runtime access.

## Deferred integration

- A route that accepts and verifies a device proof without logging it.
- A production repository and mandatory audit writer using the reviewed schema.
- Operator/PIN exchange and individual authorization (H0-3).
- Browser request cancellation, generation fencing, and data purge on switch or
  lock.
- Patient-query audit linking operator, workstation, device session, and request.
- Revalidation at every Query/Export/Dashboard delivery boundary.

Until those items pass isolated SQL Server and browser acceptance, device entry
must not be treated as personal identity or patient-data authority.
