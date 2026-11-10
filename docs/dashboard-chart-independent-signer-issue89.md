# UQP CHART independent signer (Issue #89) — release-disabled implementation

Status: **SOURCE & ISOLATED TESTS ONLY**. No operational signer, database migration, credentials, deployed service, feature activation or authorization to change production. The PR is intentionally Draft, stacked on PR #96. Do **not** import signer modules into the UQP main Express runtime or deploy this service to an IIS-hosted Dashboard endpoint.

## Components and boundaries

- `server/src/chartSigner/independentChartSigner.ts`: isolated signing core. Verifies the original UQP HS256 JWT cryptographically, enforces expiry past the entire 8-second signing window, looks up the *current* account and TokenVersion through a separate read-only SQL connection, requires live `DESIGN_QUERY` and `EXECUTE_QUERY`, and independently checks scoped Dashboard/Profile/approved published Query access. Builds a canonical ChartConfig and links one random 128-bit nonce, user, TokenVersion, Dashboard/Profile, RequestId, config SHA-256, source and geometry to both receipts. Never accepts client ActorId, approval, key material or SQL text. No database writes.
- `server/src/chartSigner/independentSignerSqlReaders.ts`: SQL-read-only authorization queries for active user roles, Query ACL view+execute, active QUERY_ONLY Dashboard, exact profile, enabled bound Query/DataSource/Dataset, and archived lookup rejection. A separate least-privilege SQL **reader** login is a required external deployment dependency; no connection string or fallback to UQP's platform DB pool is provided.
- `server/src/chartSigner/independentChartSignerMtls.ts`: standalone HTTPS server factory, requiring a trusted client CA, pinned client X.509 certificate SHA-256 fingerprint, original Bearer JWT, and JSON body limits. Rejects requests without mTLS before application parsing. It never registers with existing Dashboard/IIS routes, does not listen automatically, and hardcodes `CHART_SIGNER_SERVICE_RELEASE_APPROVED=false`.
- Signing operations are *injected* by the independently provisioned service owner: Ed25519 private signer (64 bytes), and SQL Issuer HMAC provider (32 bytes). The UQP Server receives only the short-lived `{Attestation, SqlMac}` receipt from that independently authenticated service; SQL Issuer checks the MAC, and SQL Writer independently revalidates Actor/TokenVersion/RBAC and approved Issuer SID in a SERIALIZABLE transaction.
- `dashboardChartIndependentIssuerProof.ts` and the dormant handoff from PR #96 validate receipt consistency; the SQL 2019/2022 disposable tests verify receipt -> SQL Grant -> atomic Widget/Seal/Audit/Ledger -> replay denial.

## Privilege and secret separation

No keys/certificates are committed to GitHub, and none are loaded from request JSON, headers, `SESSION_CONTEXT`, JWT claims or the ordinary UQP app. A future independent host must retrieve keys and TLS credentials securely with ACLs protecting against the UQP service account. The SQL reader login must have only the minimum SELECT privileges; the signer **must not** own the Issuer/Writer SQL logins, DML rights, or migration privileges. Signing key versions, rotation/revocation, mTLS certificate enrollment and incident procedures need security approval. The current HS256 login requires a verifier secret at the signer; an asymmetric JWT issuer or independently trusted auth introspection service is preferable before release, to avoid another service sharing the application's signing secret.

## Required external production acceptance (NOT implemented or approved)

1. Provision the independent process/service account, external mTLS client/server certificate authorities, cert pin list, key custody and rotation with independently reviewable audit events; no IIS public route.
2. Provision and attest a dedicated SQL read-only login for signer scope checks, plus the independently approved SQL Issuer and Writer; verify privileges as negative tests. Confirm actor/revocation behavior across hosts.
3. Review and adopt the forward-only Migration 928 against the actual 925/926/927 catalog, schema/constraint compatibility and rollback plan. Every draft under `database/drafts/` is intentionally **not** executable in production.
4. Independently review public chart privacy, category differencing and small-cell count policy; attach this to the actual authorized Query Delivery and device Token/IP/audit flows.
5. Wire the signer transport into an approved UQP internal caller after a security design review. Enable no feature gate merely from a passing synthetic CI run. Only then integrate native CHART edit/save/read/fullscreen playback and request separate IIS test-host acceptance.

These files are a *working, separately testable core and mTLS transport*, not proof of a running independently secured signer or a production CHART release.

## 2026-11-10 signer post-HSM revocation fence

The independent signer now repeats its read-only **live AppUser/TokenVersion/role-permission and exact Dashboard/Profile/Query ACL checks after both Ed25519 and SQL HMAC signing calls**, before returning the proof to the mTLS caller. Revoke the hard release flag while signing and no proof is released; a blocked or expired post-sign check also returns null. This closes the signer-local time-of-check/time-of-use interval when an external HSM delays signing. Unit tests simulate account disable, TokenVersion rotation, role removal, Query access withdrawal, gate shutdown, an unavailable SQL reader and expiry during the final authorization read. This is **additional fail-closed defense**, not a durable SQL one-time grant or replacement for the SQL Issuer/Writer's independently reviewed same-transaction actor recheck. All production gates remain OFF.
