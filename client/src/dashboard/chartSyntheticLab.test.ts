import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {chartDraftPersistenceEnabled,chartDraftErrors,newChartDraft} from "./chartDraft.js";

test("Stage 18 UI-only sandbox uses synthetic chart projections and has no persistence integration",async()=>{
 const lab=await readFile(new URL("../pages/DashboardChartSyntheticLabPage.tsx",import.meta.url),"utf8");
 const entry=await readFile(new URL("../chartLabMain.tsx",import.meta.url),"utf8");
 const app=await readFile(new URL("../App.tsx",import.meta.url),"utf8");
 const server=await readFile(new URL("../../chart-lab-preview-server.mjs",import.meta.url),"utf8");
 assert.match(lab,/SCENARIOS/);
 assert.match(lab,/DashboardChartProjection/);
 assert.match(lab,/synthetic|合成/);
 assert.match(lab,/chartDraftErrors/);
 assert.match(lab,/requestFullscreen/);
 assert.doesNotMatch(lab,/\b(?:apiRequest|fetch|XMLHttpRequest|WebSocket|localStorage|sessionStorage)\b/);
 assert.doesNotMatch(entry,/\b(?:App|AuthProvider|apiRequest|fetch)\b/);
 assert.match(app,/path="\/designer\/dashboards\/chart-lab" element={<PermissionRoute permission="DESIGN_QUERY">/);
 assert.match(server,/server\.listen\(port,"127\.0\.0\.1"/);
 assert.match(server,/startsWith\("\/api\/"\)/);
 assert.equal(chartDraftPersistenceEnabled,false);
 assert.deepEqual(chartDraftErrors(newChartDraft(),1920,1080,["PRIMARY","WARD","OR"]),[]);
});
