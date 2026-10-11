# Shared workstation and interactive query expansion plan

Status: **Foundation schema only. PIN login and interactive pages are NOT enabled.**

## Scope
- Shared Windows account; individual application identities; staff lookup by employee ID/name; per-workstation allowlist.
- One-time enrollment with recent full-password authentication, PIN reset/revocation, approved-workstation PIN sign-in, per-workstation single active user.
- Dashboard policy PUBLIC / STAFF_FAST / STAFF_SECURE / SENSITIVE, enforced on server and never weaker than Query/data classification.
- Interactive pages: patient list -> selected patient details; visit list in left pane -> selected visit details in right pane; nested parameterized links; per-pane pagination, refresh, filters and last-success behavior.
- Field masking: explicit server-side column policy, e.g. display-name masking; avoid treating UI-only masking as access control.

## Security requirements before enabling PIN
1. Enrollment requires a **recent** full authentication and explicit user confirmation. Never allow an admin to read a PIN.
2. PIN is a single factor. Cross-reboot PIN-only sign-in must be disabled by default until hospital security/privacy approval; do not use it for sensitive medical records, bulk export, administrative actions or password/PIN changes.
3. PIN verifier: memory-hard password hash (Argon2id preferred), per-record salt, server-side pepper kept outside database; no PIN in logs or browser storage. Minimum length and blocklist; online attempt limits by account AND workstation AND network, progressive delay, alerting and lockout.
4. Workstation identity: administrator enrollment with a high-entropy per-device secret, stored as hash server-side; secure HttpOnly/Secure/SameSite cookie or comparable protected binding; IP address alone is not a device credential. Revoke and rotate independently. Require HTTPS except explicit local development.
5. Session: cryptographically random opaque session token; store only token hash, secure HttpOnly cookie, CSRF defense for cookie-authenticated state changes, short idle/absolute expiry, server-side revocation, no localStorage credentials. Session contains workstation, user, auth method/assurance, TokenVersion and PIN version. A new user sign-in atomically revokes prior workstation session and clears prior UI state. Never silently promote PIN assurance to password assurance.
6. Every protected request rechecks session, current user active state, TokenVersion, workstation enabled/allowlist, effective permission and minimum query classification. Reject session after PIN/workstation revocation. Re-authenticate for step-up operations.
7. Generic login errors; audit success/failure, switch, PIN enrollment/revocation, policy changes, query and export, without PINs, raw credentials or unnecessary patient data.
8. Staff directory must only expose allowed users on authenticated/approved workstation. Do not allow enumeration from a public dashboard token.
9. Database constraints and indexes are defense in depth; use a transaction and row locking when replacing workstation sessions. Expired sessions must be explicitly revoked/cleaned before a new active row is inserted.
10. Device playback token remains separate and cannot authenticate staff.

## Proposed APIs (NOT YET IMPLEMENTED)
- POST /api/auth/quick-pin/enroll (recent password auth; PIN)
- DELETE /api/auth/quick-pin (full reauthentication)
- POST /api/workstations/enroll (admin-approved device pairing)
- GET /api/workstations/current/allowed-users?search= (approved device; rate limited)
- POST /api/workstations/current/login (username, PIN; device binding; returns secure session)
- POST /api/workstations/current/switch (revokes current session before new verification)
- POST /api/workstations/current/lock
- POST /api/workstations/current/logout
- GET /api/workstations/current/session
- GET/PUT /api/admin/workstations/:id/users (MANAGE_USERS)
- GET/PUT /api/dashboards/:id/auth-policy (DESIGN_QUERY plus policy administration restriction)

## Suggested implementation order
1. Migration review and compatibility with existing User/Dashboard tables. **This PR only.**
2. Device enrollment and user allowlist, safe directory search and audit.
3. PIN enrollment/revocation, lockout and verification with tests.
4. Opaque session middleware, single-user switching, frontend UI, CSRF protection, expiry/revocation tests.
5. Dashboard and Query minimum-assurance policy enforcement, no public patient data.
6. Interactive page schema/API, parameterized master-detail panes, server pagination, field masking and regression tests.

## Acceptance tests
- After restart, PIN-only login only if explicitly approved for the workstation and low-sensitivity policy.
- A->B switch revokes A server-side, including any still-running API request.
- Expired, disabled, revoked, wrong-workstation and rate-limited PIN attempts cannot log in.
- Dashboard Device Token cannot access employee directory or patient queries.
- STAFF_FAST session cannot access SENSITIVE page or export; a client-side policy change cannot bypass server check.
- Query links accept only declared bind parameters, enforce dataset permissions and prevent SQL injection.
- Independent panes preserve authorized filters/pagination without retaining another user's patient data.
- Migration idempotent; existing dashboard display, JWT and RBAC behavior unchanged.
