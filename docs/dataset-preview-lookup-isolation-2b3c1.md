# Dataset preview and lookup isolation (2B-3C-1)

## API purposes

All data-bearing Dataset management routes require a current JWT/TokenVersion,
DESIGN_QUERY and EXECUTE_QUERY, including their post-execution checks. Dataset
management has global designer authorization; it has no separate Dataset ACL.
This authority is not inferred or granted from an ordinary Query ACL.

| API | Fixed server purpose |
| --- | --- |
| GET `/api/datasets/:id/design-preview/context` | Read trusted definition/policy/patient configuration versions, no rows |
| POST `/api/datasets/:id/design-preview` | Saved-definition raw design preview; requires `expectedDefinitionVersion` |
| POST `/api/datasets/preview/run` | Same controlled raw purpose only when Dataset ID, exact saved SQL, source ID and definition version all match |
| POST `/api/datasets/:id/execute` | Standard delivery; applies Dataset CUSTOM/OMIT even to designers |
| GET `/api/datasets/:id/parameters/:name/options` | Designer-authorized fixed options or policy-processed actual source Dataset lookup |

Raw preview requires the existing trusted policy reader (including 920), enabled
patient audit configuration and confirmed metadata/keyring proof. It uses the
saved executor, performs mandatory operation audit and raw-identity patient
disclosure audit, and rechecks versions/permissions before returning rows.
An absent/disabled/unconfirmed patient contract refuses raw preview. Standard
delivery retains the explicit optional-patient-audit contract from 2B-3B.
`raw`, `purpose`, and similar body flags cannot select raw execution on standard
Dataset execution. Raw payloads are request-local; no cache, snapshot, persistent
browser storage, URL payload or diagnostic logging is added. Responses are no-store.

## Candidates and metadata

There is no trustworthy metadata-only adapter operation in the current contract.
Unsaved or changed candidate SQL therefore never executes through these routes.
It cannot sync DatasetColumn, record patient proof, or change a trusted policy
version. Saved raw preview also performs no implicit metadata writes. Existing
rules and SQL sensitivity-change blockers remain intact.

The existing frontend preview request lacks the new definition-version handshake
and is intentionally refused until separately integrated. No frontend or
Dashboard files are changed. The inspected DatasetDesignerPage only retains
preview rows in component state; no raw preview persistence or URL transfer was
found there. Missing initial column/patient proof setup needs a separately
reviewed metadata-only/bootstrap contract; this stage does not weaken proof
requirements to break that cycle.

## Lookup source

Parent parameters are resolved from the saved, versioned Dataset. For DATASET
options, the coordinator opens the real LookupDatasetId with its own trusted
definition/policy/patient evidence and active source checks. It executes and
audits the source, applies its policy, and revalidates both parent and source.
Configured value/label fields with ANY CUSTOM or OMIT rule are refused before
SQL. Missing/ambiguous aliases and non-scalar values are refused rather than
falling back to another field. Only the two policy-processed fields become
value/label options. The unauthenticated low-level option resolver can handle
NONE/FIXED only and never follows a Dataset binding.

Ordinary Query DATASET lookup remains QUERY_LOOKUP_DELIVERY_NOT_READY: its
source-specific authorization contract for non-designers is not implemented.

## Final operation audit transaction

Dataset delivery and standard Query JSON/CSV/XLSX now use one finalizer. SUCCESS
is updated in a SERIALIZABLE transaction, then version/permission/patient evidence
is revalidated in that same transaction before commit. Relevant repository reads
accept the outer transaction, keep their security locks through commit, and never
commit or roll it back themselves. Usage-derived AuditLog statistics are excluded
from final validation to avoid waiting on uncommitted delivery audit rows.

On validation/audit failure the staged SUCCESS rolls back. A later best-effort
FAILED update may itself fail, leaving STARTED for investigation; it cannot leave
the rejected staged SUCCESS committed. No async security operation follows a
successful finalization before handing the serialized payload to Express.
Patient disclosure attempts may remain conservatively audited even if delivery
is later rejected. A successful server handoff cannot prove client receipt.

## Remaining acceptance blockers

- Candidate metadata-only execution and initial patient-proof/column bootstrap.
- Frontend explicit saved-version preview integration and browser acceptance.
- Ordinary Query lookup source authorization; Query design preview consumers of
  the old candidate contract must also adopt the new version handshake.
- Dashboard preview/playback/device unified-policy exits remain unchanged.
- Existing legacy numeric sensitivity writers and content-based ACL revision
  limitations from earlier stages remain outside this change.
- No migration, SQL Server/Oracle connection or Windows deployment was performed.
  Actual SQL Server lock ordering/deadlocks, permission/catalog visibility,
  rollback, ROWVERSION and commit-acknowledgement failure behavior require isolated
  SQL Server acceptance. Mock/CI success is not hospital acceptance.
