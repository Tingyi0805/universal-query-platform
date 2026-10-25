# Shared workstation H0-4 browser isolation

## Sensitive browser data inventory

| Surface | Sensitive state retained in the browser | Required purge integration |
| --- | --- | --- |
| Query runtime | parameter values, option values, result rows, filters, sort, grouping, pagination, hidden/selected columns, errors, export Blob | register every state setter, pass the request signal, fence success/error, revoke Blob URLs |
| Interactive dashboard | primary preview, supplemental pages, snapshot IDs, visible columns, paging, timers and warnings | retain its existing generation/expiry cleanup and add the workstation fence only on authenticated interactive routes |
| Dataset designer | candidate parameters, preview rows, field metadata, security-policy editing state | purge previews and values if this administrative surface is later allowed on a shared workstation |
| Patient audit/security editors | patient-key selections, disclosure configuration and field policy state | purge unsaved values and close dialogs on lock or identity change |
| Browser windows/caches | selected patient detail, opened patient window, in-memory cache and pending export | close/clear through registered purge targets; never persist operator data |

`QueryRuntimePage` currently has no operator request fence and its execute/export
calls do not share a cancellation owner. `apiRequest` already accepts an
`AbortSignal`; `apiDownload` and the result/error setters need wiring in H0-5.
Authenticated Dashboard playback already clears its snapshots on authorization,
visibility, expiry and network failures, but its counters are not the H0
generation/incarnation contract. Public device playback is a separate Device
Token mode and must remain outside the operator guard.

## Isolated H0-4 contract

`sharedWorkstationSession.ts` is opt-in and is not mounted by `AuthContext`, the
router, Query runtime or Dashboard runtime. A controller starts locked and
stores no operator state in local/session storage. It accepts only a narrowly
shaped future server observation. This method is a browser model boundary, not
proof that its caller is authoritative; production wiring must source it from a
fresh authenticated backend response.

An active model records workstation, device session, user, generation,
incarnation and absolute expiry. A sensitive request gets a controller-owned
`AbortController` and both generation/incarnation fence values. Lock, switch,
signout, idle expiry, authorization failure, device revocation, network loss or
page hiding aborts all handles and invokes every registered purge target. A late
success or error is deliverable only while its original handle remains owned
and every fence field still matches. Within one controller, generations cannot
move backward and a locked generation cannot be reused. Refresh creates a new
locked controller and requires a fresh server revalidation; it never restores
the previous result or operator state from browser persistence.

The React boundary removes its children from the rendered tree while locked;
it does not leave sensitive DOM hidden beneath an overlay. It contains no test
unlock control and issues no JWT, PIN request or authority. Every state reports
`runtimeAuthority=NONE` and `productionReady=false`.

## Multi-tab and failure behavior

BroadcastChannel carries only restrictive `LOCK` and `DEVICE_REVOKED` events.
It carries no user, generation, incarnation, credential or activation event,
and events for another workstation are ignored. A message can reduce local
availability but can never authorize a tab. If BroadcastChannel is unavailable,
the controller remains `SYNC_UNAVAILABLE` and refuses active observations.

Reload creates a new locked controller. Offline immediately locks; online does
not restore an operator. Device revocation is terminal for that controller.
Public Dashboard playback is unaffected because the module performs no global
fetch/storage interception and is not mounted on public routes.

## Production wiring blockers

- H0-2/H0-3 still lack a production device/operator repository, PIN endpoint,
  cookie/JWT exchange and persistent incarnation/generation.
- Query, interactive Dashboard, export, patient lists/details and auxiliary
  windows must register their concrete purge functions and fence both success
  and error delivery.
- `apiDownload` needs an AbortSignal before export integration; downloaded Blob
  URLs and native download completion need browser-specific acceptance tests.
- Every backend delivery endpoint must independently revalidate the operator;
  AbortController and BroadcastChannel are not revocation or authorization.
- Cross-node races, revocation writers and SQL rollback remain unverified until
  the additive schema/repository work and isolated SQL Server tests are complete.

H0-4 proves the isolated browser state, cancellation and restrictive multi-tab
model plus real-browser BroadcastChannel behavior. It does not prove a formal
shared-workstation session or patient-data delivery path.
