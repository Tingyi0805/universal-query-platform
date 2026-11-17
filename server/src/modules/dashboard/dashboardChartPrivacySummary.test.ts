import test from "node:test";
import assert from "node:assert/strict";
import {distinctChartPrivacyScopes} from "./dashboardChartPrivacySummary.js";
test("multiple CHART widgets sharing a published source require only one privacy review",()=>{
 const a={widgetId:88,sourceKey:"PRIMARY",categoryColumn:"ROOM",valueColumn:"TOTAL"};
 const b={widgetId:89,sourceKey:"primary",categoryColumn:"room",valueColumn:"total"};
 const c={widgetId:90,sourceKey:"WARD",categoryColumn:"ROOM",valueColumn:"TOTAL"};
 assert.deepEqual(distinctChartPrivacyScopes([a,b,c]),[a,c]);
});
