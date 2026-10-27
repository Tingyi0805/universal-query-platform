# Shared workstation H0-3 PIN and operator-switch contract

## Existing behavior reviewed

`QuickPinPolicy` stores one administrator-controlled PIN length from 4 through
12. `UserQuickPin` stores a bcrypt hash, PIN version, enabled state, failed
attempt count, and temporary lock deadline. Enrollment verifies the current
password and live user/TokenVersion under a SERIALIZABLE transaction, rejects
weak PINs, hashes the PIN, advances `PinVersion`, and revokes operator sessions.
Revocation and policy-length changes disable existing PINs. No PIN sign-in or
operator-switch route exists.

The existing rows do not persist a policy revision, the TokenVersion to which a
PIN was enrolled, an attempt-window start, or ROWVERSION. The operator session
does not bind a device session, generation, incarnation, unique switch request,
or immutable switch decision. Existing management audit uses JavaScript Number
IDs or best-effort writes in several paths. These are production blockers; H0-3
does not silently infer them from timestamps or process memory.

## Isolated switch contract

The caller explicitly identifies the target user and presents that user's PIN;
PIN value alone is never used to discover an identity. The repository port must
read and lock the current device session, workstation authorization, locked
operator state, live target user/permissions/TokenVersion, current PIN row, and
PIN policy inside one owned SERIALIZABLE/XACT_ABORT transaction. The PIN verifier
is scoped to that exact user and must use constant-time bcrypt comparison. Raw
PINs are excluded from request digests, audits, decisions, results, and errors.

Operator selection begins in `OPERATOR_LOCKED`. H0-1 now has an explicit
`OPERATOR_SELECTION_STARTED` transition for the first user; an A-to-B switch
uses the existing lock transition. A direct switch attempt while an operator is
active is rejected before PIN comparison. H0-4 must synchronously lock, purge,
and cancel A's work before it exposes the PIN UI; failed switching then leaves
the screen locked and never restores A's data.

Successful comparison replaces the sole operator candidate with a new
generation and UUID incarnation. Current B permissions and TokenVersion are
captured from the repository snapshot; A permissions are never copied. The
result remains `runtimeAuthority=NONE`, `jwtIssued=false`,
`queryExecutionAllowed=false`, `patientDataAllowed=false`, and
`productionPersistence=NOT_PROVEN`. The incarnation plus H0-1 request fence
invalidates responses across refresh, switch, generation reuse, and another
server process, once backed by persistent storage.

Each valid attempt claims a unique RequestId bound to a digest that excludes the
PIN. Wrong PIN attempts persist a bounded cross-node attempt window and lockout.
PIN failure, lock, rejected switch, and successful switch have mandatory,
same-transaction exact-ID audits. CAS, request replay, conflicting RequestId,
audit failure, DB failure, rollback failure, and commit-unknown all fail closed.
Structurally invalid input is rejected before storage; a future HTTP boundary
must audit only its server request ID and a safe reason.

## Production wiring blockers

A reviewed additive migration is required before enabling H0-3. At minimum it
must add or introduce:

- PIN policy revision/ROWVERSION and PIN bindings to policy revision and current
  TokenVersion.
- Persistent attempt-window start and PIN ROWVERSION for multi-node throttling.
- Device-session binding, generation, UUID incarnation, revision, idle and
  absolute expiry on the operator authorization record.
- Unique switch RequestId/digest and immutable decision/audit relationship.
- Exact SQL BIGINT audit receipts without JavaScript Number conversion.
- Transactional revocation coverage for user disable, TokenVersion changes,
  workstation grants, PIN/policy change, credential rotation, and device-session
  revocation.

The production repository must prove lock order, one active operator, CAS races,
rollback, deadlock/timeout behavior, and commit-unknown handling on isolated SQL
Server 2019. H0-4 must add browser purge/AbortController behavior and enforce the
incarnation/generation fence at every Query, Export, Dashboard, and patient-data
delivery boundary. Until those pass, no PIN route, cookie, JWT, or patient-data
authority may be enabled.
