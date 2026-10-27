import assert from "node:assert/strict";
import test from "node:test";
import { previewDateParameter, resolveDateForRuntimeInput } from "./dateParameter.js";

test("DATETIME dynamic NOW preserves seconds in runtime and preview", () => {
  const runtime = resolveDateForRuntimeInput("$NOW", "DATETIME");
  assert.match(runtime ?? "", /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
  const preview = previewDateParameter("2026-10-27T11:26:47", "DATETIME", "STRING", "GREGORIAN", "yyyy-MM-dd HH:mm:ss");
  assert.equal(preview.inputValue, "2026-10-27T11:26:47");
  assert.equal(preview.outputValue, "2026-10-27 11:26:47");
});

test("DATE preview remains date-only and canonical", () => {
  const preview = previewDateParameter("2026-10-27", "DATE", "STRING", "GREGORIAN", "yyyyMMdd");
  assert.equal(preview.inputValue, "2026-10-27");
  assert.equal(preview.outputValue, "20261027");
});
