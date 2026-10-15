import assert from "node:assert/strict";
import test from "node:test";
import { prepareAcceptance } from "./securityAcceptanceManifest.js";
import { validateEvidence } from "./securityAcceptanceEvidence.js";

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
