import { test, expect, type Page } from "@playwright/test";
async function setup(page: Page) {
  const state = { mode: "QUERY_ONLY", revision: "a", metaStatus: 0, pageStatus: 0, failSource: "PRIMARY", errorCode: "QUERY_SOURCE_QUERY_FORBIDDEN",
    authExpiresAt: Date.parse("2026-10-20T01:00:00Z"), holdFresh: false, releaseFresh: (() => {}) as () => void, generation: 0, expiries: new Map<string, number>(), legacy: 0, designer: 0, device: 0, requests: [] as { key: string; snapshot?: string; page: number; jwt: boolean }[], pending: false };
  await page.clock.install({ time: new Date("2026-10-20T00:00:00Z") }); await page.clock.pauseAt(new Date("2026-10-20T00:00:01Z"));
  await page.addInitScript(() => sessionStorage.setItem("uqp.auth", JSON.stringify({ accessToken: "synthetic-user-session", user: { id: 1, username: "synthetic", displayName: "合成使用者", permissions: ["VIEW_QUERY", "EXECUTE_QUERY"] } })));
  const dashboard = { id: 1, code: "SYNTHETIC", name: "合成安全看板", description: "合成測試", queryName: "合成 Query", isActive: true,
    displayTitle: "合成安全看板", displayMode: "BIG_SCREEN", refreshSeconds: 30, pageSeconds: 5, pageSize: 1, parameters: {} };
  const widgets = ["PRIMARY", "WARD"].map((key, index) => ({ id: index + 1, widgetType: "TABLE", x: index * 500, y: 0, width: 480, height: 400, fontSize: 20, alignment: "LEFT", config: { dataSourceKey: key }, sourceKey: null, sortOrder: index }));
  const profiles = [{ id: 1, isDefault: true, canvasWidth: 1280, canvasHeight: 720, config: {}, widgets }];
  await page.context().route(url => url.pathname.startsWith("/api/"), async route => {
    const req = route.request(), path = new URL(req.url()).pathname;
    if (path === "/api/dashboards/available") { await route.fulfill({ json: { dashboards: [dashboard] } }); return; }
    if (path === "/api/dashboards/1/playback/v1") {
      if (state.metaStatus) { await route.fulfill({ status: state.metaStatus, json: { error: { code: state.errorCode, message: "PRIVATE DRIVER DETAIL" } } }); return; }
      await route.fulfill({ json: state.mode === "LEGACY" ? { mode: "LEGACY" } : { mode: state.mode, securityVersion: state.revision.repeat(64), authorizationExpiresAt: state.authExpiresAt, dashboard, profiles } }); return;
    }
    if (path.includes("/playback/v1/") && path.endsWith("/page")) {
      const key = path.includes("/WARD/") ? "WARD" : "PRIMARY", body = req.postDataJSON();
      state.requests.push({ key, snapshot: body.snapshotId, page: body.page, jwt: req.headers().authorization === "Bearer synthetic-user-session" });
      if (state.pageStatus && key === state.failSource) { await route.fulfill({ status: state.pageStatus, json: { error: { code: state.errorCode, message: "PRIVATE DRIVER DETAIL" } } }); return; }
      if (state.holdFresh && !body.snapshotId) await new Promise<void>(resolve => { const prior = state.releaseFresh; state.releaseFresh = () => { prior(); resolve(); }; });
      const snapshotId = body.snapshotId ?? `${key}-${state.revision}-${++state.generation}`;
      if (!state.expiries.has(snapshotId)) state.expiries.set(snapshotId, await page.evaluate(() => Date.now()) + 30000);
      await route.fulfill({ json: { sourceKey: key, modeVersion: "QUERY_ONLY_USER_V1:1", page: body.page, totalPages: 2, totalRows: 2,
        snapshotId, snapshotExpiresAt: state.expiries.get(snapshotId), refreshSeconds: 30, pageSeconds: 5, pageSize: 1,
        ...(key === "PRIMARY" ? { dashboard, reportColumns: [] } : {}), result: { columns: [{ name: `${key}_NAME` }], rows: [{ [`${key}_NAME`]: `${key}○頁${body.page}` }] } } }); return;
    }
    if (path.includes("/query-sources/v1")) state.designer++;
    if (path.includes("/device/")) state.device++;
    if (path.endsWith("/preview") || path.endsWith("/layout")) {
      state.legacy++;
      await route.fulfill({ json: path.endsWith("/layout") ? { profiles } : { dashboard, reportColumns: [], sourceKey: "WARD", refreshSeconds: 30, pageSeconds: 5, pageSize: 1, result: { columns: [{ name: "NAME" }], rows: [{ NAME: "Legacy合成" }] } } }); return;
    }
    if (path.endsWith("/branding")) { await route.fulfill({ json: { organizationName: "Synthetic", platformName: "UQP", platformTitle: "UQP", platformSubtitle: "Synthetic" } }); return; }
    await route.fulfill({ json: {} });
  });
  await page.goto("/dashboards"); await page.getByRole("button", { name: "播放", exact: true }).click();
  return state;
}
async function shown(page: Page) { await expect(page.getByText("PRIMARY○頁1", { exact: true })).toBeVisible(); await expect(page.getByText("WARD○頁1", { exact: true })).toBeVisible(); }
async function empty(page: Page) { await expect(page.getByText(/^(PRIMARY|WARD)○頁/)).toHaveCount(0); }
test("Portal user without DESIGN_QUERY plays masked Query-only pages in same tab, with isolated source snapshots", async ({ page }) => {
  const state = await setup(page); await shown(page); await expect(page).toHaveURL(/\/dashboards\/1\/display$/); expect(page.context().pages()).toHaveLength(1);
  await page.clock.runFor(5000); await expect(page.getByText("PRIMARY○頁2", { exact: true })).toBeVisible(); await expect(page.getByText("WARD○頁2", { exact: true })).toBeVisible();
  expect(state.requests.every(r => r.jwt)).toBe(true); expect(state.requests.some(r => r.key === "PRIMARY" && r.snapshot?.startsWith("PRIMARY-a-"))).toBe(true);
  expect(state.requests.some(r => r.key === "WARD" && r.snapshot?.startsWith("WARD-a-"))).toBe(true); expect([state.legacy, state.designer, state.device]).toEqual([0, 0, 0]);
  expect(page.url()).not.toContain("synthetic-user-session"); expect(await page.locator("body").innerHTML()).not.toContain("synthetic-user-session");
  expect(await page.evaluate(() => Object.values(localStorage).join(" "))).not.toContain("synthetic-user-session");
});
for (const code of ["QUERY_SOURCE_MODE_NOT_ACTIVATED", "QUERY_SOURCE_PENDING_CONVERSION", "QUERY_SOURCE_EXECUTION_DISABLED", "QUERY_SOURCE_APPROVAL_REQUIRED"]) test(`initial rejection ${code} never calls Legacy or runs page`, async ({ page }) => {
  const state = await setup(page); await shown(page); state.metaStatus = code === "QUERY_SOURCE_EXECUTION_DISABLED" ? 404 : 403; state.errorCode = code;
  await page.reload(); await expect(page.getByRole("heading", { name: "Dashboard 播放已停止" })).toBeVisible(); await empty(page);
  expect([state.legacy, state.designer, state.device]).toEqual([0, 0, 0]);
});
for (const key of ["PRIMARY", "WARD"]) for (const code of ["QUERY_SOURCE_QUERY_FORBIDDEN", "PATIENT_AUDIT_FAILED", "DASHBOARD_SNAPSHOT_EXPIRED"]) test(`${key} ${code} clears all sources and stops without fallback`, async ({ page }) => {
  const state = await setup(page); await shown(page); state.failSource = key; state.pageStatus = code === "QUERY_SOURCE_QUERY_FORBIDDEN" ? 403 : code === "PATIENT_AUDIT_FAILED" ? 503 : 409; state.errorCode = code;
  await page.clock.runFor(5000); await expect(page.getByRole("heading", { name: "Dashboard 播放已停止" })).toBeVisible(); await empty(page);
  await expect(page.locator("body")).not.toContainText("PRIVATE DRIVER DETAIL"); expect([state.legacy, state.designer, state.device]).toEqual([0, 0, 0]);
});
test("JWT/TokenVersion revocation clears all data and returns to authentication", async ({ page }) => {
  const state = await setup(page); await shown(page); state.metaStatus = 401; state.errorCode = "TOKEN_REVOKED";
  await page.clock.runFor(5000); await empty(page); expect(state.legacy).toBe(0);
  await expect(page).toHaveURL(/login/);
});
test("mode change to Legacy cannot downgrade an existing Query-only playback", async ({ page }) => {
  const state = await setup(page); await shown(page); state.mode = "LEGACY";
  await page.clock.runFor(5000); await expect(page.getByRole("heading", { name: "Dashboard 播放已停止" })).toBeVisible(); await empty(page); expect(state.legacy).toBe(0);
});
test("security revision change clears old source snapshots before fresh pages", async ({ page }) => {
  const state = await setup(page); await shown(page); const before = state.requests.length; state.revision = "b";
  await page.clock.runFor(5000); await expect.poll(() => state.requests.slice(before).filter(r => !r.snapshot).length).toBeGreaterThanOrEqual(2);
  await shown(page); expect(state.legacy).toBe(0);
});
test("offline clears all sources; explicit initial Legacy response retains old entry", async ({ page }) => {
  const state = await setup(page); await shown(page); await page.evaluate(() => window.dispatchEvent(new Event("offline"))); await empty(page);
  state.mode = "LEGACY"; await page.reload(); await expect.poll(() => state.legacy).toBeGreaterThan(0); expect(state.designer).toBe(0);
  state.mode = "QUERY_ONLY"; await page.clock.runFor(5000); await expect(page.getByRole("heading", { name: "Dashboard 播放已停止" })).toBeVisible(); await empty(page);
});

test("server-proven JWT expiry clears data without waiting for a page request", async ({page}) => {
  const state=await setup(page);await shown(page);state.authExpiresAt=Date.parse("2026-10-20T00:00:08Z");
  await page.clock.runFor(7000);await empty(page);await expect(page.getByRole("heading",{name:"Dashboard 播放已停止"})).toBeVisible();expect(state.legacy).toBe(0);
});
test("snapshot deadlines clear primary and supplemental data while replacement SQL response is pending",async({page})=>{
  const state=await setup(page);await shown(page);state.holdFresh=true;
  try {await page.clock.runFor(30000);await empty(page);expect(state.legacy).toBe(0);}
  finally{state.holdFresh=false;state.releaseFresh();}
});

test("background transition clears all patient data before browser timers can freeze",async({page})=>{
  const state=await setup(page);await shown(page);
  await page.evaluate(()=>{Object.defineProperty(document,"visibilityState",{configurable:true,get:()=>"hidden"});document.dispatchEvent(new Event("visibilitychange"));});
  await empty(page);await expect(page.getByRole("heading",{name:"Dashboard 播放已停止"})).toBeVisible();expect(state.legacy).toBe(0);
});
