import test from "node:test";
import assert from "node:assert/strict";
import { formatDashboardValue } from "./displayFormat";
test("explicit formatting supports numbers and UTC dates, defaults preserve text",()=>{
  assert.equal(formatDashboardValue("1234.5","NUMBER"),"1,234.5");
  assert.equal(formatDashboardValue("2026-10-13","DATE"),"2026/10/13");
  assert.equal(formatDashboardValue("2026-10-13T08:09:10Z","DATETIME"),"2026/10/13 08:09:10 UTC");
  assert.equal(formatDashboardValue("001234","TEXT"),"001234");
});
test("masked text is never reconstructed or coerced",()=>{
  for(const text of ["12○○","●●●","王○明","", "not-a-date"])
    for(const format of ["NUMBER","DATE","DATETIME"]) assert.equal(formatDashboardValue(text,format),text);
});
