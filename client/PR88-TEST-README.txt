UQP PR #88 — Client-only acceptance artifact (TEST ONLY)
=========================================================
This GitHub Actions artifact contains the compiled client/dist of the
PR #88 branch plus this notice. It is NOT a complete UQP deployment
or an approved release ZIP. It contains NO server, migrations, secrets,
or production database settings.

Branch: fix/dashboard-editor-typography-input-20261106
Pull request: https://github.com/Tingyi0805/universal-query-platform/pull/88

Use cases:
- Isolated browser/UI verification against a COMPATIBLE test Server from
  the same development baseline (the PR #83 head used by PR #88).
- Dashboard global typography: family, size, weight and color.
- Existing widget individual typography overrides and new widget defaults.
- TABLE header/row independent font sizes in editor and playback.
- Chart synthetic draft font preview and numeric/checkbox layout fixes.

Not included:
- Production CHART storage, live Chart query APIs, or Chart playback.
- Backend application, database schema changes or a server installer.
- Verification that an existing C:\UQP installation has a compatible backend.

Acceptance guard:
1. Verify artifact source commit equals the desired PR #88 HEAD,
   and all CI jobs are green.
2. Test in an isolated and compatible environment first.
3. Do NOT overwrite an in-use C:\UQP or change its .env, SQL schema,
   authentication/device settings, or deployment ledger using this ZIP.
4. Preserve current deployment files and rollback evidence before
   an authorized, separately prepared full release.
5. CHART remains synthetic-only. Never interpret this artifact as
   authorization to enable live patient-data Charts.

No sensitive real patient data are used in the synthetic chart lab.
