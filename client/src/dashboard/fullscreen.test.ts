import assert from "node:assert/strict";
import test from "node:test";
import {dashboardFullscreenActive,dashboardFullscreenSupported,requestDashboardFullscreen} from "./fullscreen";
test("standard fullscreen requests preserve receiver and report active state",async()=>{
  let called=false;const root={async requestFullscreen(){assert.equal(this,root);called=true;}};
  const doc={documentElement:root,fullscreenElement:root} as unknown as Document;
  assert.equal(dashboardFullscreenSupported(doc),true);assert.equal(await requestDashboardFullscreen(doc),true);
  assert.equal(called,true);assert.equal(dashboardFullscreenActive(doc),true);
});
test("WebKit fullscreen support uses the existing browser gesture API",async()=>{
  let called=false;const root={webkitRequestFullscreen(){called=true;}};
  const doc={documentElement:root,webkitFullscreenElement:root} as unknown as Document;
  assert.equal(dashboardFullscreenSupported(doc),true);assert.equal(await requestDashboardFullscreen(doc),true);
  assert.equal(called,true);assert.equal(dashboardFullscreenActive(doc),true);
});
test("unsupported or denied fullscreen safely returns false without raw errors",async()=>{
  const doc={documentElement:{}} as Document;assert.equal(dashboardFullscreenSupported(doc),false);assert.equal(await requestDashboardFullscreen(doc),false);
  const denied={documentElement:{requestFullscreen:async()=>{throw new Error("SYNTHETIC_SECRET");}}} as unknown as Document;
  assert.equal(await requestDashboardFullscreen(denied),false);
});
