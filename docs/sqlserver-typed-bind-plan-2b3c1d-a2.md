# SQL Server isolated typed bind plan (2B-3C-1D-A2)

Only new compiler, Request-preparation helpers and tests are added. The current
Query/Dataset/Dashboard/JSON/Excel/CSV/Oracle paths, executeQuery, native descriptor,
Repository and migrations are unchanged. No database is contacted by this module
or its tests. No new confirmation endpoint, contract write or VERIFIED state exists.

## Boundary

`compileSqlServerTypedBindPlan` is a pure in-memory compiler. It requires exact
saved-parameter definitions, values and external native declarations. CONFIRMED,
EXPLICIT_RUNTIME_BIND and an opaque 16-character hex version are **input
preconditions**, not evidence issued or authenticated by this compiler. The
current MISSING/UNCONFIRMED Repository cannot provide that precondition. Tests
use explicit synthetic declarations only. Never construct this input from a
frontend checkbox or treat a caller's state string as platform confirmation.

The compiler never infers native types, calls existing coercion, supplies defaults
or executes SQL. SQL tokens, Dataset definition names, native declarations and
value keys must agree exactly. Original SQL is validated by compileDescription
before list expansion, and the final expanded SQL/declarations are compiled by
that same validator. Unknown types/options, missing/extra/duplicate names, quoted
tokens, unmanaged binds and unsupported SQL fail closed. Values are never inserted
into SQL. Repeated tokens refer to the same named bind.

The returned handle has `deliveryAllowed: false` and contains no SQL or values
in JSON/inspection. Each handle's private payload holds immutable copies of bindings;
each preparation receives fresh Date/Buffer copies. Serialized/forged handles
are rejected. Backend-only read/preparation results contain SQL and Request
parameters: never return, log, cache or persist those objects. Discard requests
after any preparation failure. Errors contain fixed codes only, without causes.

## Supported values

| Native type | Accepted contract | Refused |
| --- | --- | --- |
| INT | Signed 32-bit integer; exact bigint, safe integer Number or canonical decimal integer text | Fraction, overflow, exponent/whitespace text, unsafe Number |
| BIGINT | Signed 64-bit range; exact bigint, canonical decimal text or safe integer Number | Overflow or previously rounded unsafe Number |
| BIT | Boolean | Truthy strings, numeric flags and objects |
| FLOAT | Finite double Number; no subnormals or unsafe integer Numbers | NaN, Infinity, numeric strings, ambiguous unsafe integers |
| DECIMAL(p,s) | p=1–38, s=0–p; canonical decimal text or exact integer input; no excess fractional digits; magnitude fits p | Fractional Number input, rounding, scale/precision overflow, unsafe scaled magnitudes |
| DATE | Native Date representing UTC midnight, years 1–9999 | Text parsing, time truncation, invalid/out-of-range dates |
| DATETIME2 | Native Date instant, UTC components, fixed scale 7 | Text parsing, unknown scale or out-of-range dates |
| NVARCHAR(n/MAX) | Well-formed Unicode; n counts UTF-16 code units | Invalid surrogate sequences, oversize values |
| VARCHAR(n/MAX) | ASCII text, including explicit empty string | Non-ASCII without authoritative code-page/collation evidence |
| VARBINARY(n/MAX) | Backend Buffer, copied without string coercion | String/base64 guessing, oversized or descriptor objects |

Nullable values remain null with their explicit type. Required scalars reject
null; required text rejects empty text. Dataset generic types are checked for
compatibility but do not select the native type. STRING+VARBINARY is a future
explicit backend binary codec, not permission to reinterpret existing STRING
requests. Date STRING mode must declare NVARCHAR/VARCHAR and preserves its already
formatted string; NATIVE mode requires DATE/DATETIME2. No date conversion between
those modes occurs. Native temporal requests require their parent pool's explicit
`config.options.useUTC === true`; default/unknown/local mode is refused, even for
null. Existing pools/runtime semantics are deliberately not changed.

DECIMAL remains constrained by Tedious's Number-based scaling. The compiler checks
the intended scaled integer with BigInt, enforces precision/scale, then permits a
Number only when the driver's rounded scaled magnitude is safe and exactly equal.
This supports a subset of DECIMAL values, not arbitrary 38-digit arithmetic.
Offline driver serialization tests verify the actual encoded scaled integer and
BIGINT bytes; they do not prove SQL Server acceptance for all versions.

## Lists and shared preparation

MULTISELECT requires an explicitly confirmed FIXED_LIST arity of 1–128 and an
array of exactly that length. Empty, sparse, CSV-text, dynamic or changed-length
lists fail; no NULL expansion fallback exists. Expanded `NAME__index` binds share
the declared type; generated collisions/oversized names and more than 2000 total
binds are refused. Changing arity requires a new authoritative contract/plan and
descriptor validation, never modifying a previously prepared plan.

Both Request helpers consume the same opaque plan. Description preparation binds
`tsql`, `params` and browse mode as typed RPC inputs for
`sys.sp_describe_first_result_set`. Runtime preparation always calls
`input(name, explicitMssqlType, value)` and returns compiled SQL for a future
controlled executor. Neither helper connects or calls execute/query.
DATETIME2 declaration's SQL default scale 7 matches explicit `sql.DateTime2(7)`,
including null; FLOAT's SQL default precision 53 matches Float's 8-byte encoding.

## Minimal future integration (blocked in this stage)

1. Establish native type provenance and mandatory audited confirmation tied to
   Dataset/source/parameter ROWVERSIONs. Recheck those versions, ACL and authority
   before consuming a plan. This compiler does not satisfy that Repository gate.
2. Add a narrowly scoped typed coercion branch before parameter.service's lossy
   NUMBER conversion. Preserve BIGINT/DECIMAL text; never recover digits from a
   rounded Number. Specify default/null/empty/Boolean rules separately. Existing
   STRING coercion destroys Buffer identity, and current MULTISELECT splits CSV,
   varies arity and expands empty arrays to NULL; none can silently feed this plan.
3. Keep dateParameter/STRING formatting behavior for legacy requests. Define the
   new typed temporal boundary explicitly (including no-zone/dynamic input
   handling) and configure/verify UTC for the new executor. Do not change Oracle.
4. Use the same plan for native description and typed execution, compare actual
   result structure, and preserve SQL review, authorization, policy, audit and
   final revalidation before delivery. Do not enable contract confirmation until
   these paths have been proven. Oracle parameterized metadata remains refused.
5. Validate supported mssql/Tedious versions against real SQL Server: decimal and
   BIGINT round-trip, date boundaries/scale/UTC, Unicode/MAX/code-page behavior,
   fixed-list arity and actual result drift. No such live acceptance occurred here.
