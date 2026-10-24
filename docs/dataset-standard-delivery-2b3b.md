# Dataset standard Query delivery (2B-3B)

This stage integrates the existing trusted Dataset policy repository and masking
engine with `/api/queries/:id/execute`, `/export/csv`, `/export/excel`, and the
ordinary Query detail ReportColumn metadata response. It adds no migration and
does not authorize deployment or running migration 920.

## Delivery contract

1. Reverify JWT signature/expiry, current TokenVersion, active user, VIEW_QUERY,
   EXECUTE_QUERY (execution/export), EXPORT_QUERY (export), actual Query ACL,
   publication and availability. DESIGN_QUERY never bypasses standard masking.
2. Read the confirmed Dataset snapshot using the existing serializable repository:
   DefinitionRowVersion, string sensitivity/configuration versions, CUSTOM/OMIT
   rules and patient audit-only identifier protection. Missing 920, old mask modes
   or an unconfirmed policy refuse delivery before SQL.
3. Execute the saved Dataset once. Raw rows remain local to this request. If
   patient auditing is enabled, require the existing confirmed metadata/keyring
   contract and persist disclosure using raw patient identifiers.
4. Revalidate after SQL and patient auditing, then apply the one Dataset policy.
   OMIT removes names, row values and ReportColumn metadata. Omitted grouping or
   aggregate references cause QUERY_REPORT_POLICY_CONFLICT. Export grouping and
   ordering operate only on policy-processed values and visible report columns.
5. Serialize JSON or build CSV/XLSX only from the processed result. Explicitly
   empty/hidden export columns never fall back to all result columns.
6. Revalidate after serialization and before/after mandatory success audit, then
   send the response with Cache-Control: no-store. Audit failure returns no file
   or result. Usage audit stores event identity/count/duration, not raw bind values.

The security fingerprint includes policy evidence, patient proof evidence,
current permissions, Query ACL revision, stable Query definition/access fields,
source identity and report settings. It excludes audit-derived LastUsedAtUtc and
favorites so successful auditing does not invalidate the request itself. No
general-purpose raw result cache or snapshot is introduced.

## Compatibility and rollout blockers

- Existing installations without 920 or converted/confirmed CUSTOM/OMIT policies
  intentionally lose standard Query delivery until a separately authorized and
  verified rollout. There is no raw compatibility fallback or automatic rule conversion.
- Lookup Dataset options in the ordinary Query router now return
  QUERY_LOOKUP_DELIVERY_NOT_READY. NONE/FIXED options still require the parent
  Query's trusted policy and current authorization. Lookup execution needs its own
  Dataset policy, raw-identity auditing and post-execution version checks before
  it can be enabled again.
- Dataset execute/design-preview routes and Dataset-side parameter lookups,
  Query design metadata/preview, and all Dashboard preview/playback/device exits
  retain their existing contracts. They are not covered by this integration and
  remain blockers before claiming unified policy coverage of all exits.
- Existing Number-based sensitivity writers and Dashboard policy consumers from
  2B-3A still need a separate precision migration in application contracts. This
  stage reads trusted string versions; it does not widen those writer contracts.
- Dataset ROWVERSION and monotonic sensitivity/patient configuration revisions
  detect A-to-B-to-A. The existing Query ACL revision is a content digest; this
  stage rechecks current effective ACL and digest but does not introduce a new
  monotonic Query ACL epoch. There is no result reuse across requests.
- SQL Server transaction/isolation, catalog permissions, migration installation,
  actual policy conversion and Windows Server behavior remain unverified here.
  Synthetic HTTP/CSV/XLSX tests and CI do not constitute hospital acceptance.
