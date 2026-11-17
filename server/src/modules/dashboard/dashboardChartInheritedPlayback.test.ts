import test from "node:test";
import assert from "node:assert/strict";
import {validateDashboardChartPlaybackControl} from "./dashboardChartInheritedPlayback.js";
const good={dashboardId:7,approved:true,revision:"d".repeat(64)};
test("Dashboard playback control cannot accept self-asserted or malformed approvals",()=>{
 assert.equal(validateDashboardChartPlaybackControl(good,7),true);
 for(const bad of [
  null,{}, {...good,approved:false},{...good,dashboardId:8},
  {...good,revision:"invalid"},{...good,actor:"admin"},
 ])assert.equal(validateDashboardChartPlaybackControl(bad,7),false);
 assert.equal(validateDashboardChartPlaybackControl(good,8),false);
});
