import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Offline verification of a manual-only SQL witness: never open a DB connection.
const root = fileURLToPath(new URL("../../../../", import.meta.url));
const witnessPath = path.join(root, "tools/sqlserver-acceptance/drafts/923/923_f1a_environment_readonly.sql");

test("F1A preflight witness is not in the automatic migration directory", async () => {
  const migrations = await readdir(path.join(root, "database/migrations"));
  assert.ok(!migrations.some(name => /^923_/u.test(name)), "923 must not be auto-installed");
  const preflight = await readFile(witnessPath, "utf8");
  assert.match(preflight, /F1A_READONLY_923_V1/u);
  assert.match(preflight, /MANUAL use only/u);
  assert.match(preflight, /UNVERIFIED_REQUIRES_OUT_OF_BAND_ISOLATION_REVIEW/u);
});

test("F1A witness is a nonmutating standalone SELECT, with no connection or authority changes", async () => {
  const preflight = await readFile(witnessPath, "utf8");
  const clean = preflight.replace(/^\s*--.*$/gmu, "");
  assert.match(clean, /SELECT[\s\S]+SERVERPROPERTY/u);
  assert.match(clean, /sys\.databases/u);
  assert.match(clean, /OBJECT_ID\(N'uqp\.DatasetFieldSnapshot'/u);
  assert.match(clean, /OBJECT_ID\(N'uqp\.DatasetSecurityDecisionSeq'/u);
  assert.doesNotMatch(clean, /\b(?:CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|TRUNCATE|MERGE|GRANT|DENY|REVOKE|EXEC|EXECUTE|OPENROWSET|OPENDATASOURCE|BACKUP|RESTORE|DBCC|USE|INTO|xp_cmdshell|sp_configure)\b/iu);
  assert.doesNotMatch(clean, /\b(?:CONNECT|PASSWORD|JWT_SECRET|ENCRYPTEDPASSWORD)\s*=/iu);
  assert.doesNotMatch(clean, /\b(?:BEGIN|COMMIT|ROLLBACK)\s+TRAN(?:SACTION)?\b/iu);
});

test("F1A always requires separate instance evidence; never claims schema readiness", async () => {
  const clean = (await readFile(witnessPath, "utf8")).replace(/^\s*--.*$/gmu, "");
  assert.match(clean, /EngineMajor/u);
  assert.match(clean, /CompatibilityLevel/u);
  assert.match(clean, /REJECT_ENGINE/u);
  assert.match(clean, /REJECT_COMPATIBILITY/u);
  assert.match(clean, /REJECT_PROTECTED_DATABASE_NAME/u);
  assert.match(clean, /UniversalQueryPlatform_Old/u);
  assert.match(clean, /ORIGINAL_LOGIN\(\)/u);
  assert.match(clean, /@@SPID/u);
  assert.doesNotMatch(clean, /\b(?:READY_FOR_PRODUCTION|SQL_LOCK_VERIFIED|SOURCE_BOUND|deliveryAllowed\s*=\s*true)\b/iu);
});
