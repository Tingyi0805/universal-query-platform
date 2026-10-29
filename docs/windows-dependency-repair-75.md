# Issue 75: Node 24 dependency repair and Windows acceptance

Baseline: PR #74 `d6ba5aac16d415a7aff5bc8bac4bbea34b400626`. This Draft changes source/dependency management only. It does not update existing `C:\UQP`, run a Migration, alter a production database, or produce an update package.

## Observed audit and dependency decisions

Reproduced the repository baseline on Node **24.15.0** with npm **12.2.1** (also initially checked with npm 11.9.0). Server full and `--omit=dev` audit both reported **5 advisories: 3 high, 2 moderate**. The user's force-mutated Windows directory was not accessed; its ExcelJS 3.4.0/fast-csv 3.7.0/tmp 0.1.0 state is the supplied report, not this repository's installed baseline.

| Path | Repository baseline | Repaired lock |
| --- | --- | --- |
| Zod | 3.25.76 | 4.6.7 |
| ExcelJS | 4.4.0 | 4.4.0 |
| ExcelJS → uuid | 8.3.2 | 11.1.1 |
| ExcelJS → tmp / fast-csv | 0.2.7 / 4.3.6 | 0.2.7 / 4.3.6 |
| mssql / @types/mssql | 11.0.2 / 9.1.11 | 12.7.13 / 12.3.0 |
| Tedious runtime / types tree | 18.6.2 / 20.3.8 | 20.3.8 shared |
| Tedious → Azure Identity → MSAL Node | 4.14.0 → 6.0.1 | 4.14.0 → 7.1.2 |

`npm audit fix --force` suggested an ExcelJS downgrade to 3.4.0, which is rejected. ExcelJS 4.4.0 remains the current upstream release. Its **scoped** uuid override uses 11.1.1, which retains Node CommonJS `v4()`; uuid 12+ ESM-only is not substituted. Actual XLSX conditional-format UUID generation, Excel export/readback, CSV quoting, streaming XLSX and patched tmp creation/cleanup are exercised. tmp already resolves to patched 0.2.7 inside ExcelJS's declared range; no unnecessary tmp override is added.

Azure Identity 4.14.0 still declares MSAL `^6.0.0`; no patched upstream Identity release was available. The override applies **only to `@azure/identity@4.14.0` → `@azure/msal-node@7.1.2`**. It is checked through the actual Azure Identity and patched MSAL implementations with a synthetic HTTP transport: client secret/rejection, certificate PS256 assertion signature, username/password, authorization code, OBO, DefaultAzureCredential environment chain, device code, and token-cache API. No real Azure credential/token is used or logged. Interactive browser/broker, real tenant, MFA/conditional-access and live Azure SQL acceptance remain separate. An upstream upgrade requires rechecking this contract; the override is not a blanket MSAL major replacement.

mssql and its type package are upgraded together through upstream dependencies so both resolve Tedious 20.3.8. Some old offline tests accidentally resolved the driver brought by the type package; those tests now resolve from **mssql itself**. No production connection options or query/bind logic are weakened. CI includes a disposable SQL Server 2022, running only SELECT through the production adapter to check connection/TLS, Unicode, BIGINT precision, end-of-day DATETIME2 and Excel readback. This is not production SQL Server/Azure tenant acceptance.

Zod 4's two-argument `record(key,value)` is applied to dynamic parameter/config/mask records. Column names remain keys and mask enums remain values. Strict payload rejection, defaults, malformed authentication input, invalid JWTs and the existing regression suite remain checked. Exhaustive enum-record validation remains enabled; one generated test fixture now supplies its complete typed key set.

The report [dependency-audit-75.json](dependency-audit-75.json) records exact audit counts/paths. Current server full/runtime and client full audit are zero. Deprecation warnings in inherited ExcelJS tooling remain maintenance concerns; they are not suppressed or represented as newly fixed advisories. Audit is a dated advisory snapshot, not proof of no undisclosed defect.

## Deterministic installation

Both `server/package-lock.json` and `client/package-lock.json` are committed with integrity hashes and Windows/Linux optional platform packages. Use **npm ci**, not `npm install`, to deploy this reviewed tree. CI uses Node 24.15.0/npm 12.2.1, audits full/runtime scopes, and fails on any reported advisory.

npm 12 blocks dependency install scripts by default. The sole persisted approval is **`odbc@2.6.0`**, the unchanged native build hook already present at the baseline and needed by application startup. Its pinned package script installs the versioned N-API binary or builds against the local ODBC SDK. No wildcard/global approval is used; esbuild/oracledb/other hooks remain under npm 12's default block. Tests explicitly load ODBC, so a missing native artifact cannot look like a passing install. Re-review the hook if that exact version changes. Do not use `approve --all` or disable the script policy globally to resolve an install warning.

Windows prerequisites: Node x64 24.15.0 (or a separately accepted compatible Node 24), npm 12.2.1, existing ODBC drivers, and MSVC Build Tools/Python if native fallback compilation is required. OpenSSL is needed for **synthetic test certificates only** (Git for Windows/CI supplies it); it is not needed for ordinary service startup. Do not lower SQL TLS/encryption/trust policy merely to make a new driver connect.

## Windows update procedure — staging first

1. **Stop changing the force-mutated installation.** Do not run further `audit fix --force`. Record Node/npm/service executable versions and the actual service configuration without printing credentials or `.env` contents. Keep a timestamped restricted backup of the current tree for diagnosis, explicitly marked **force-mutated/untrusted**. A rollback source must be a separate verified, known-good snapshot from before that command, including `package.json`, any lockfile, `node_modules`, built output and matching Node version. If none exists, recovery is BLOCKED until a known-good source is obtained; do not start the downgraded tree as a recovery shortcut.
2. Leave `C:\UQP` in place. Obtain the reviewed Draft commit into a new folder, such as `D:\UQP-Acceptance\Issue75`. Verify the SHA against the PR/CI. Never copy `node_modules` from the force-mutated tree into the candidate.
3. In the candidate only, verify `node --version` and `npm --version`. If upgrading npm, pin 12.2.1 using your managed tool installation process; CI's npm upgrade does not update the user's computer. Keep existing secrets/configuration and encryption keys in a restricted configuration location; do not put them in Git, audit logs or public backups.

```powershell
# Run only in the NEW candidate source, never in the existing C:\UQP.
$uqp75Candidate = 'D:\UQP-Acceptance\Issue75'
Set-Location (Join-Path $uqp75Candidate 'server')
node --version
npm --version
npm ci
if ($LASTEXITCODE -ne 0) { throw 'INSTALL_BLOCKED' }
npm audit --omit=dev --audit-level=low
if ($LASTEXITCODE -ne 0) { throw 'RUNTIME_AUDIT_BLOCKED' }
npm audit --audit-level=low
if ($LASTEXITCODE -ne 0) { throw 'FULL_AUDIT_BLOCKED' }
npm run typecheck
if ($LASTEXITCODE -ne 0) { throw 'TYPECHECK_BLOCKED' }
npm test
if ($LASTEXITCODE -ne 0) { throw 'REGRESSION_BLOCKED' }
npm run build
if ($LASTEXITCODE -ne 0) { throw 'BUILD_BLOCKED' }
Set-Location (Join-Path $uqp75Candidate 'client')
npm ci
if ($LASTEXITCODE -ne 0) { throw 'CLIENT_INSTALL_BLOCKED' }
npm audit --audit-level=low
if ($LASTEXITCODE -ne 0) { throw 'CLIENT_AUDIT_BLOCKED' }
npm run typecheck
if ($LASTEXITCODE -ne 0) { throw 'CLIENT_TYPECHECK_BLOCKED' }
npm test
if ($LASTEXITCODE -ne 0) { throw 'CLIENT_REGRESSION_BLOCKED' }
npm run build
if ($LASTEXITCODE -ne 0) { throw 'CLIENT_BUILD_BLOCKED' }
```

4. Run Browser regression after installing the project's Chromium test dependency. Test the actual Windows service account, SQL Server version and existing TLS settings using a staging/read-only account: connect/test query, numeric/BIGINT/DATE/DATETIME parameters, approved masked Excel/CSV export and workbook reopen, authorization failures, Dashboard modes, Token/cookie protections and audit receipts. If Azure authentication is actually used, separately validate the real tenant/credential/conditional-access flow. Do not run any `db:migrate`, installer apply or DDL command.
5. Only after those checks and operator approval, use the existing controlled service-change process to switch to the accepted candidate and matching Node runtime. Keep the known-good tree and service path available until acceptance completes. This PR does not perform that cutover or approve a production overwrite.

## Rollback

If install/audit/build/staging checks fail, stop the candidate and retain its logs without secrets; the existing installation has not been overwritten. If failure occurs after an operator's service cutover, stop that candidate service, restore the **verified pre-change** service executable/path and its complete matching application/runtime snapshot, preserve the same `.env`/encryption keys and database, then repeat health/authorization/read-only connection/export checks. No database rollback or Migration is required by this dependency-only change. Do not mix a new lockfile with old modules, use the force-mutated files as “known good,” or return a known high-risk dependency set to production without a separate risk decision. If there is no verified rollback snapshot, keep rollout BLOCKED.
