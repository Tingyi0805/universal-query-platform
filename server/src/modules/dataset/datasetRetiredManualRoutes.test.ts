import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("retired per-field manual configuration routes are not mounted into UQP", async () => {
  const app = await readFile(new URL("../../app.ts", import.meta.url), "utf8");
  const dataset = await readFile(new URL("./dataset.routes.ts", import.meta.url), "utf8");
  // Keep the manager's single usage approval plus runtime data delivery.
  assert.match(dataset, /createDatasetManagementApprovalRouter/);
  assert.match(app, /app.use\("\/api\/datasets", datasetRouter\)/);
  for (const retired of ["/api/dataset-mask-templates", "/api/dataset-field-initialization",
    "/api/dataset-security"]) assert.ok(!app.includes(retired));
  assert.ok(!dataset.includes('"/:id/sensitive-columns"'));
  assert.ok(!dataset.includes("createPatientAuditConfigRouter"));
  // This test intentionally does NOT remove stored security rules, patient
  // disclosure audit or dashboard public-playback Gate.
});
