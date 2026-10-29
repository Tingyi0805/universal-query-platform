# Issue 73: HTTP manual playback and expiry management

> HTTP browser playback instructions below are superseded by [Windows Managed Kiosk Agent](windows-managed-kiosk-agent-77.md). Use the enrolled native Agent and its protected channel; ordinary HTTP pages no longer accept Device Tokens. Expiry management and HTTPS Kiosk remain supported.

Based on PR #72 `e9d495a9421605d730bfc520517d1ba09fcac592`. Independent Draft; no production action, schema change, Migration or update package.

## HTTP now, HTTPS later

Set the existing `DASHBOARD_PUBLIC_CLIENT_ORIGIN` to an explicit canonical `http://your-intranet-host[:port]` or `https://your-managed-host[:port]`, without a trailing slash/path, credentials, query or fragment. Public origin is never guessed from Host, forwarded headers or development ports. Device settings show/copy/open this URL and download a secret-free Windows BAT using saved browser/monitor/position/size/fullscreen settings.

HTTP URLs/BAT provide **manual playback only**. Every new page/reload/browser/Windows restart requires manual Device Token entry or the existing optional one-shot handoff. The Token stays in that page's memory; no localStorage/sessionStorage, URL, BAT or task arguments store it. No Secure cookie attribute or CSRF restriction has been weakened. Persistent-cookie APIs reject HTTP, even on loopback that browsers otherwise treat as a secure context. The UI and BAT explicitly identify this limitation; the BAT cannot restore authority after restart.

HTTP does **not** encrypt the bearer Token or patient-data transport. Use only a trusted controlled intranet as explicitly authorized; HTTPS is the transport protection. **Unattended HTTP resume is BLOCKED.** If mandatory, commission a separately reviewed managed Windows agent with DPAPI *and authenticated encrypted transport*. DPAPI protects storage at rest and does not prevent HTTP wire capture; no agent is implemented or claimed here.

Changing the configured origin to HTTPS generates HTTPS links/BAT. It does not turn a previous HTTP memory credential into a persistent grant: explicitly enroll in the HTTPS browser/profile once. PR #72's dedicated stable `DASHBOARD_KIOSK_COOKIE_KEY`, host-only HttpOnly/Secure/SameSite=Strict cookies, CSRF/Host/origin/proxy checks and short-session limits continue unchanged. BAT profiles are isolated by origin and device ID. First enrollment must occur in the BAT-launched profile.

## Administrator expiry management

The device panel calls the existing `/dashboards/device-alerts?days=30` query and scopes reminders to the current dashboard/device list. It shows expiry UTC/date, remaining days, 30-day and 7-day bands, expired status, and `未設定到期日`. Missing reminder data is shown as unavailable, never silently as zero. Existing Query-only device rows use the same display thresholds. Status is informational; it does not authorize playback.

“續期” requires an explicit administrator confirmation and current expected version through `POST /dashboards/:id/device-management/v1/:deviceId/renew`. It reuses `renewDashboardDisplayDevice`, now accepting the current transaction request. The existing SERIALIZABLE parent/device locks, live DESIGN_QUERY/EXECUTE_QUERY/session authorization, query/delegator/workstation checks and approval/version evidence apply.

- Only an active, unrevoked, unarchived, **unexpired** device with an existing expiry can renew. No-expiry devices require explicit metadata setup first; existing metadata edits still invalidate credentials. Expired/revoked reactivation is a separate flow and is not implemented here.
- Add an integer 1–365 days to the current expiry, with the resulting expiry at most **365 days from server now**. UI defaults to 30 days; a near-365-day expiry cannot receive another full year. SQL rechecks activity/expiry and the lifetime bound while locked; expiry during the operation rolls back.
- Query-only renewal rejects disabled mode and mismatching mode/delegator grants. Renewal does not reissue a Token, change IP/masks/public policy, reactivate a device or repair a revoked delegation. Playback continues to enforce all runtime checks.
- Expiry, parent version and mandatory `DASHBOARD_DEVICE_RENEWED` Audit commit together, including days and old/new expiry but no credential. Audit failure, stale version, permission loss or concurrent renewals roll back. Legacy unversioned renewal is refused so it cannot bypass these checks. No automatic renewal/reissue or retry occurs.
- HTTPS enrollment retains its original cookie/enrollment deadline even after administrator renewal. Enroll explicitly again when that enrollment ends; renewal does not silently extend persistent authority beyond its original grant.

## Public playback

Authenticated layout responses expose only safe expiry/server-time metadata in addition to the existing layout. A quiet generic warning is shown at 7 days or less; it contains no patient information, Token, device IP/name or administrator controls. It does not interrupt a valid stream. Server checks remain authoritative. A local expiry deadline clears displayed data, while the independent 15-second validation updates expiry after an observed renewal and still stops on revoke/IP/mode/delegation/policy failure. Existing masking, per-page patient disclosure audit, offline clearing and bfcache revalidation remain in place.

## Isolated Windows acceptance (user confirmation required)

1. Configure the explicit HTTP origin in an isolated installation with existing Query/Dataset/device flags and policies. Save placement and obtain the manual URL/BAT. Inspect the decoded BAT: public URL/device ID and placement only. Do not modify production SQL Server or existing `C:\UQP` for automated tests.
2. Launch Edge/Chrome BAT, paste an authorized Token and verify masked/audited playback. Check 30/7/0-day and no-expiry administrator states; 7-day public warning must not interrupt playback. Renew before expiry with confirmation, verify Audit and the new date, then test a stale concurrent submission and rejected excessive lifetime.
3. Revoke/reissue, expire, change IP/delegator/Query-only mode/policy or fail disclosure Audit: no unauthorized rows may be delivered. Reload/restart on HTTP must request a Token, never auto-resume. No raw Token may appear in storage, URL, BAT, tasks, logs or Audit.
4. Configure HTTPS and a dedicated stable key; use the new HTTPS BAT/profile, explicitly enroll, then confirm the PR #72 reload/browser-restart recovery. Verify HTTP still cannot enroll and cookies remain Secure/HttpOnly/host-only/SameSite=Strict.
5. Physical Windows Edge/Chrome cold boot, screen order/negative coordinates/DPI/fullscreen, and Android/iOS are **BLOCKED pending actual device acceptance**. CI verifies PowerShell 5.1 parsing and mock-launch arguments for HTTP/HTTPS with Edge/Chrome, not a physical monitor/reboot. Real database acceptance is not claimed.

Suitable for isolated Windows source acceptance after CI passes, with the HTTP transport limitation understood. Production overwrite/deployment is not approved by automated tests.
