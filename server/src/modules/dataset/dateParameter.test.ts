import { env } from "../../config/env.js";
import { resolveDynamicDateExpression } from "./dateParameter.js";
import assert from "node:assert/strict";
import test from "node:test";
import { parseCanonicalDate, previewDateParameter, resolveDateForRuntimeInput } from "./dateParameter.js";

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

test("canonical DATE rejects rollover and accepts leap day", () => {
  assert.throws(() => parseCanonicalDate("2026-02-29", false), /PARAMETER_DATE_INVALID/);
  assert.throws(() => parseCanonicalDate("2026-02-30", false), /PARAMETER_DATE_INVALID/);
  assert.throws(() => parseCanonicalDate("2026-13-01", false), /PARAMETER_DATE_INVALID/);
  assert.equal(parseCanonicalDate("2024-02-29", false).toISOString().slice(0, 10), "2024-02-29");
});

test("timezone-less DATETIME is independent of server local timezone", () => {
  assert.equal(parseCanonicalDate("2026-10-27T11:26:47", true).toISOString(), "2026-10-27T11:26:47.000Z");
  assert.equal(parseCanonicalDate("2026-10-27T11:26", true).toISOString(), "2026-10-27T11:26:00.000Z");
  assert.throws(() => parseCanonicalDate("2026-02-30T11:26", true), /PARAMETER_DATETIME_INVALID/);
  assert.throws(() => parseCanonicalDate("2026-10-27T24:00", true), /PARAMETER_DATETIME_INVALID/);
});

test("dynamic range defaults use platform midnight across UTC day boundaries", t => {
  const previous = env.PLATFORM_TIME_ZONE;
  env.PLATFORM_TIME_ZONE = "Asia/Taipei";
  t.after(() => { env.PLATFORM_TIME_ZONE = previous; });
  const now = new Date("2026-10-26T16:26:47.789Z");
  const expected = {
    "$NOW": "2026-10-27T00:26:47.789Z",
    "$TODAY": "2026-10-27T00:00:00.000Z",
    "$TODAY-7": "2026-10-20T00:00:00.000Z",
    "$TODAY+1": "2026-10-28T00:00:00.000Z",
    "$TODAY_START": "2026-10-27T00:00:00.000Z",
    "$TODAY_END": "2026-10-27T23:59:59.999Z",
  };
  for (const [expression, value] of Object.entries(expected))
    assert.equal(resolveDynamicDateExpression(expression, now).toISOString(), value);
});
