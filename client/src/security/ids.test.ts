import assert from "node:assert/strict";
import test from "node:test";
import { normalizeIds } from "./ids.js";
test("JSON BIGINT strings and numbers normalize to unique numeric IDs", () => {
  assert.deepEqual(normalizeIds(["1", 1, "2", 2, 3]), [1, 2, 3]);
});
test("invalid/unsafe ID forms never silently become another user", () => {
  for (const value of [
    "01",
    "1.0",
    "",
    true,
    null,
    -1,
    0,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
  ])
    assert.throws(() => normalizeIds([value]));
});
