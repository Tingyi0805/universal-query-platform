import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { prepareAcceptance } from "./securityAcceptanceManifest.js";
import { reviewEvidence, validateEvidence } from "./securityAcceptanceEvidence.js";

test("all cases start NOT_RUN and evidence does not certify a live SQL test", async () => {
  const manifest = await prepareAcceptance(["--profile", "legacy"]);
  const sample = {
    phase: "4B-2", profile: "legacy", repoSha: "a".repeat(40),
    inventoryFingerprint: manifest.pinnedInventoryFingerprint, runId: "012345abcdef",
    environment: { sqlMajor: 15, compatibilityLevel: 150, instanceId: "isolated123", isolationAttested: false, restoreVerified: false },
    cases: manifest.cases.map(c => ({ id: c.id, status: "NOT_RUN" })),
  };
  const result = validateEvidence(sample, manifest);
  assert.equal(result.verifiedByDatabase, false);
  assert.equal(result.eligibleForSignoff, false);
  assert.equal(result.counts.notRun, 27);
  for (const corrupt of [
    { ...sample, profile: "coexistence" },
    { ...sample, inventoryFingerprint: "0".repeat(64) },
    { ...sample, cases: sample.cases.slice(1) },
    { ...sample, cases: sample.cases.map((c, i) => i === 0 ? { ...c, status: "PASS" } : c) },
    { ...sample, cases: sample.cases.map((c, i) => i === 0 ? { ...c, status: "PASS", evidenceRef: "../secret" } : c) },
    { ...sample, environment: { ...sample.environment, sqlMajor: 16 } },
  ]) assert.throws(() => validateEvidence(corrupt, manifest));
});

test("an asserted PASS is never accepted as proof of DB verification", async () => {
  const manifest = await prepareAcceptance(["--profile", "coexistence"]);
  const sample = {
    phase: "4B-2", profile: "coexistence", repoSha: "a".repeat(40),
    inventoryFingerprint: manifest.pinnedInventoryFingerprint, runId: "012345abcdef",
    environment: { sqlMajor: 15, compatibilityLevel: 150, instanceId: "isolated123", isolationAttested: true, restoreVerified: true },
    cases: manifest.cases.map(c => ({ id: c.id, status: "PASS", evidenceRef: "evidence/case-" + c.id + ".json" })),
  };
  const result = validateEvidence(sample, manifest);
  assert.equal(result.verifiedByDatabase, false);
});

test("offline evidence reader rejects symlinks and oversized files before parsing", async () => {
  const directory = "/tmp/uqp-acceptance";
  const id = randomUUID().replaceAll("-", "");
  const actual = directory + "/" + id + "-actual.json";
  const alias = directory + "/" + id + "-alias.json";
  const large = directory + "/" + id + "-large.json";
  await mkdir(directory, { recursive: true });
  try {
    await writeFile(actual, "{}");
    await symlink(actual, alias);
    await assert.rejects(reviewEvidence(["--profile", "legacy", alias]), /OFFLINE_EVIDENCE_REGULAR_FILE_REQUIRED/);
    await writeFile(large, " ".repeat(1024 * 1024 + 1));
    await assert.rejects(reviewEvidence(["--profile", "legacy", large]), /OFFLINE_EVIDENCE_TOO_LARGE/);
  } finally {
    await Promise.all([rm(alias, { force: true }), rm(actual, { force: true }), rm(large, { force: true })]);
  }
});
