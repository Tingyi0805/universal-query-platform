import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { prepareAcceptance } from "./securityAcceptanceManifest.js";

test("4B-2 manifest is dry-run and marks every acceptance case NOT_RUN", async () => {
  for (const [profile, count] of [["legacy", 43], ["coexistence", 46]] as const) {
    const result = await prepareAcceptance(["--profile", profile]);
    assert.equal(result.executable, false);
    assert.equal(result.connectsToDatabase, false);
    assert.equal(result.migrationWritesEnabled, false);
    assert.equal(result.independentIsolationAttested, false);
    assert.equal(result.target, null);
    assert.equal(result.migrationIds.length, count);
    assert.equal(result.migrationIds.at(-1), 919);
    assert.equal(result.cases.length, 27);
    assert.ok(result.cases.every(value => value.status === "NOT_RUN" && value.profile === profile));
    assert.match(result.pinnedInventoryFingerprint, /^[a-f0-9]{64}$/);
  }
});

test("legacy whitelist excludes later optional migrations without altering 919", async () => {
  const legacy = await prepareAcceptance(["--profile", "legacy"]);
  const coexisting = await prepareAcceptance(["--profile", "coexistence"]);
  assert.deepEqual(coexisting.migrationIds.filter(id => !legacy.migrationIds.includes(id)), [916, 917, 918]);
});

test("invalid and write-capable arguments fail closed; target never authorizes writes", async () => {
  for (const args of [["--execute"], ["--apply", "true"], ["--run", "true"], ["--password", "secret"], ["--profile", "unsupported"], ["--host", "shared-host", "--port", "15433", "--database", "UQP_ACCEPT_012345abcdef"]]) {
    await assert.rejects(prepareAcceptance(args));
  }
  const result = await prepareAcceptance(["--profile", "legacy", "--host", "127.0.0.1", "--port", "15433", "--database", "UQP_ACCEPT_012345abcdef"]);
  assert.equal(result.target?.database, "UQP_ACCEPT_012345abcdef");
  assert.equal(result.executable, false);
});

test("manifest module has no DB driver, dotenv or child process imports", async () => {
  const src = await readFile(new URL("./securityAcceptanceManifest.ts", import.meta.url), "utf8");
  const imports = src.match(/from\s+["'][^"']+["']/g) ?? [];
  assert.ok(imports.every(entry => /["'](?:node:crypto|\.\/securityAcceptancePlan\.js)["']/.test(entry)));
  assert.doesNotMatch(src, /\b(?:mssql|dotenv|child_process|execSync|spawn|fetch)\b/);
});
