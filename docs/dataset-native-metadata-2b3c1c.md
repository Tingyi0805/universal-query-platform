# Dataset native metadata candidates (2B-3C-1C)

This stage adds adapter capability only. No Dataset API, runtime delivery route,
policy, stored definition, metadata table or frontend uses it. No Migration is
needed or executed. Existing execution methods are unchanged.

## Contract and trust boundary

`DataSourceAdapter.describeQuery` is an optional capability: absence means
unsupported, never permission to use `executeQuery`. It accepts SQL supplied by a
future server-side saved-definition caller, explicit native parameter types and
a timeout of 1–30 seconds. There is no HTTP endpoint or raw-SQL frontend input.

`CandidateQueryDescription` contains only projected name/type/1-based ordinal
columns, an evidence type, `UNBOUND_CANDIDATE` trust and
`requiresExecutionComparison: true`. No rows, values or SQL are returned. Native
errors and cleanup failures become code-only errors without driver causes.
Empty, incomplete, hidden/indeterminate, noncontiguous and case-insensitively
duplicate column descriptions are rejected. No name-based sensitivity inference
occurs. Comments/ambiguous quoting/unmanaged native binds are conservatively
unsupported in the new compiler; the existing runtime compiler is unchanged.

## SQL Server

Uses the RPC `sys.sp_describe_first_result_set` (SQL Server 2012+); `tsql`,
`params` and `browse_information_mode=0` are typed RPC inputs. SQL is never
concatenated into a command. Parameter declarations use validated uppercase names,
fixed native type constants and bounded numeric length/precision/scale only.
No parameter values are accepted or bound for describing. Repeated `{{PARAM}}`
tokens share a declaration; missing/extra/duplicate/unknown declarations fail.
Generic Dataset STRING/NUMBER/DATE metadata does not establish the native binding
type used by the current implicit runtime binder. Future callers must establish
exact parameter type/version evidence before describing parameterized SQL; do not
guess it from generic types or sample values. Variable-length lists are unsupported.

Native connection/request timeouts are bounded by the requested timeout; the
private pool is closed on success/failure. No result-producing query method is
called. Server permissions, describe-procedure availability, unsupported result
types and timeout/cancellation/cleanup behavior require real-environment validation.

## Oracle

Uses `connection.getStatementInfo(sql)` only. The reviewed node-oracledb 6.10
Thin implementation uses parse-only protocol; Thick uses
`DPI_MODE_EXEC_DESCRIBE_ONLY` for SELECT. Both are native metadata operations,
not a rows query. The capability conservatively accepts node-oracledb 6.8–6.x,
Oracle Database 12.1+ and Thin/Thick modes; Thick additionally needs Oracle Client
18.1+ for `callTimeout`. Missing/unknown capabilities and versions are refused.
These are capability gates, not claims of real-database acceptance testing.

**Parameterized Oracle description is blocked in this stage.**
`getStatementInfo` accepts SQL only and cannot determine or receive bind types.
Neither inferred types, CAST rewriting, fabricated values nor execute fallback
are used. Only parameter-free SELECT with native SELECT statement type and an
empty native bind-name list can produce a candidate.

Connection acquisition has a deadline (a late connection is closed without use).
`callTimeout` and a wall-clock deadline bound describing; expiry requests `break`
and closes the connection. Native close must finish before a candidate is returned.
Acquisition cannot be cancelled through this driver API; an underlying pending
connect can outlive the response deadline and is closed if it later succeeds.

Reviewed driver references:

- [getStatementInfo documentation, 6.10](https://github.com/oracle/node-oracledb/blob/v6.10.0/doc/src/api_manual/connection.rst)
- [Thin parse-only implementation](https://github.com/oracle/node-oracledb/blob/v6.10.0/lib/thin/connection.js)
- [Thick describe-only implementation](https://github.com/oracle/node-oracledb/blob/v6.10.0/src/njsConnection.c)

## Blockers before initialization or delivery integration

1. Repository must bind candidate evidence to Dataset ID, DefinitionRowVersion,
   source identity/configuration version and exact parameter definition/version,
   then revalidate within the platform transaction. A candidate is never a
   confirmed empty policy or permission to overwrite DatasetColumn/patient config.
2. Establish exact runtime native bind types and list arity; resolve Oracle's
   typed-bind limitation without executing query rows or changing SQL semantics.
3. Compare actual execution column names, order and native type evidence with
   described evidence **before** persistence, audit/delivery. View and `SELECT *`
   drift must fail even when the saved Dataset version is unchanged. Add tests
   for added/removed/reordered/renamed/retyped columns and stale source/parameter
   evidence at that integration boundary.
4. Preserve SQL review, JWT/TokenVersion/RBAC, Dataset policy/RowVersion checks,
   raw-data audit ordering and fail-closed behavior. Metadata-only does not prove
   a query is side-effect-free under every database extension or permission;
   restricted source credentials and real SQL Server/Oracle validation remain
   required. No real database was contacted by these mock tests.
