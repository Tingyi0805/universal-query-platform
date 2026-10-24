# SQL Server isolated typed parameter normalization (2B-3C-1D-A3)

Based on `5790f317faeb67d9a2b3388527b4be38c186f84d` and the A2 typed
bind plan. Only a normalizer, synthetic tests and this document are added.
Existing `coerceRuntimeParameters`, date helpers, query compiler, production
execution, API, frontend, Dashboard, exports, patient audit, Repository and
migrations remain unchanged. No SQL operation or migration is performed.

## Contract and authority

`normalizeSqlServerTypedParameters` takes an explicit backend projection of saved
definitions (name, generic/control type, required flag, scalar default, date mode,
calendar and format), SQL, A2 declarations, expected declaration version and raw
values. All eight definition fields are required, including nullable fields.
The projection rejects extra fields; pass a deliberate projection of saved records,
not a frontend payload. Plain own data properties and dense arrays are required;
getters, inherited fields, symbols and unknown declaration/cardinality/native
options are refused. SQL tokens, saved names and declaration names must match
uniquely and exactly. Unknown raw value keys are refused; omitted known scalar
keys are allowed only to apply the rules below. A2 validates original SQL before
any value conversion or list expansion. Types are never inferred from values.

Scope must be `ISOLATED_TEST_ONLY`. `expectedVersion` must match the declaration's
16-hex version; this detects inconsistency, **not provenance or freshness**.
Both versions and CONFIRMED/EXPLICIT_RUNTIME_BIND are untrusted preconditions until
a future authenticated backend repository supplies them. No API accepts this
contract, and no trusted evidence issuer is implemented. Frontend CONFIRMED or
VERIFIED assertions cannot establish authority. The normalizer never creates
VERIFIED, confirms a contract or grants delivery permission.

The result is an opaque in-memory handle with `deliveryAllowed: false`. It exposes
no SQL, values or evidence state in JSON/inspection. The backend-only reader returns
a detached compiler-input copy, preserving bigint and Date. Never return, log,
cache or persist this copy or prepared Requests. Serialized/forged handles fail.
Errors contain fixed codes without input values, SQL or causes.

## Rules

These rules describe the new isolated contract. They do not silently replace
legacy coercion. Unsupported legacy forms fail and require an explicit decision
before future integration.

| Input/definition | Isolated behavior |
| --- | --- |
| Missing scalar, undefined, null or exact empty string | Use non-null/nonempty saved default. Otherwise required fails; optional becomes typed null. Same blank/default precedence as legacy scalar coercion. |
| false, zero, whitespace text | Not blank. false/zero do not trigger defaults. Text whitespace is retained; numeric whitespace is refused. |
| Invalid default | Validate with the same native type rules as an explicit value when selected. Never try another value or infer a type. |
| STRING | Only actual text; no arbitrary object/number `String()` coercion. A2 validates Unicode, UTF-16 length and ASCII-only VARCHAR. Binary codec is unsupported here. |
| INT/BIGINT | Canonical signed integer text, bigint or safe integer Number, with native range checks. BIGINT becomes exact bigint without going through Number. Unsafe Numbers cannot be repaired. |
| DECIMAL(p,s) | Preserve canonical decimal text; exact bigint/safe integer inputs may become text. Reject fractional/unsafe Numbers, exponents, whitespace, extra scale and precision overflow. Validate decimal magnitude using BigInt only. |
| FLOAT | Finite Number under A2 rules; no numeric text/default parsing, subnormals or unsafe integer Numbers. |
| BOOLEAN/BIT | Boolean, numeric 0/1, or case-insensitive trimmed true/false/1/0/yes/no/y/n. Reject all other numbers, objects and generic truthiness. |
| DATE/DATETIME STRING | Retain already formatted ROC/custom strings under legacy pass-through rules. Strict canonical DATE and UTC DATETIME text can be formatted with existing ROC/calendar/custom helpers. Invalid calendar rollovers fail. DATETIME canonical text must exactly match `YYYY-MM-DDTHH:mm:ss.sssZ`; no timezone guessing. |
| Dynamic STRING date | Existing date helper and configured platform timezone; explicit caller-supplied `now` is mandatory, with no wall-clock read. It produces formatted text only, never a native UTC authority. |
| DATE/DATETIME NATIVE | Only an existing valid backend Date with years 1–9999. DATE requires UTC midnight. All date strings, no-zone UI values and string/dynamic saved defaults fail. A Date alone does not establish trusted type evidence. |
| MULTISELECT | Exact declared FIXED_LIST arity 1–128; dense array, uniform non-null input representation and common declared native type. Optional null elements retain typed null; required null elements fail. Empty/CSV/sparse/changed-length/mixed-representation lists and blank/undefined elements fail. No list default is synthesized from a saved scalar default; nonempty saved list defaults block this stage. |

DECIMAL normalization is deliberately independent of Tedious's Number encoding.
A valid exact 38-digit text may normalize successfully while A2 compilation
rejects it as `TYPED_BIND_PRECISION_UNSUPPORTED`. That rejection must block Request
preparation. Never fall back to Number, FLOAT, text binding or legacy coercion.

## Isolated composition and verification

Tests read the normalized handle, call `compileSqlServerTypedBindPlan`, and pass
the **same opaque plan** to description and runtime preparation. Local mssql
Requests have query/execute traps; Tedious declarations are compared with the
description's exact declaration, including null values and expanded fixed lists.
Native dates retain the A2 `useUTC === true` Request requirement.
No production code imports the normalizer. Tests use synthetic values only and
exercise precision loss, unknown declarations, type/name conflicts and version
mismatches. No database acceptance, live type confirmation or delivery is claimed.

Validation on Node 22.23.3 (CI's Node 22 line): targeted suite **77/77**, including
12 new normalization cases; complete Server suite **936/936**, no skips;
Server typecheck and build pass. Test runs used an external/database TCP guard
while allowing local Mock HTTP and loader IPC. No migration command was run.

## Minimal future changes and blockers

1. Keep the legacy coercer unchanged. Add a separately selected backend typed
   path **before** `coerceRuntimeParameters`; raw BIGINT/DECIMAL text must reach
   normalization intact. No change inside the coercer is necessary. Reusing its
   output cannot work: NUMBER conversion loses precision, STRING loses identity,
   BOOLEAN accepts arbitrary numeric truthiness, and lists split CSV/vary arity.
2. Establish audited native evidence bound to Dataset/source/parameter versions,
   exact saved definitions and SQL, then revalidate those versions and authority.
   Caller-provided matching version strings do not implement this. The existing
   UNCONFIRMED repository still blocks production qualification.
3. Decide and verify migration semantics for numeric FLOAT defaults, string/object
   coercion, explicit empty text, non-0/1 numeric BOOLEAN values, list defaults,
   required nullable list members and mixed representation lists. This stage
   rejects ambiguous forms; it cannot prove equivalence for those legacy inputs.
4. Define a trusted timezone/temporal codec before supporting NATIVE date strings
   or dynamic defaults. For STRING canonical no-zone/offset DATETIME forms outside
   the strict supported representation, stop rather than guess. Existing legacy
   requests and date helper behavior remain intact.
5. Prove real-driver/server precision, UTC/calendar, collation and arity behavior,
   then integrate the shared plan with description validation, actual structure
   comparison, ACL/policy/audit and final version revalidation. Arbitrary DECIMAL
   precision remains blocked by the driver. None of that integration or live
   acceptance is authorized or implemented in this stage.
