import { test, expect, type Page } from "@playwright/test";

async function setup(page: Page, single = false) {
  const state = { failA: false, failAStatus: 503, failPrimary: false, failPrimaryStatus: 503, revoked: false,
    sql: { PRIMARY: 0, A: 0, B: 0 }, pages: { PRIMARY: [] as number[], A: [] as number[], B: [] as number[] } };
  await page.clock.install({ time: new Date("2026-10-12T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-10-12T00:00:01Z"));
  await page.addInitScript(() => localStorage.setItem("uqp.dashboard.device.1", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"));
  const widget = (id: number, source: string, x: number) => ({ id, widgetType: "TABLE", x, y: 100, width: 350, height: 300,
    fontSize: 20, alignment: "LEFT", config: { dataSourceKey: source }, sortOrder: id, sourceKey: null });
  await page.context().route("**/api/dashboards/device/1/**", async route => {
    const url = new URL(route.request().url());
    if (state.revoked) { await route.fulfill({ status: 401, json: { error: { code: "DASHBOARD_DEVICE_UNAUTHORIZED" } } }); return; }
    if (url.pathname.endsWith("/layout")) {
      await route.fulfill({ json: { profiles: [{ id: 1, isDefault: true, canvasWidth: 1280, canvasHeight: 720, config: {},
        widgets: [{ id: 4, widgetType: "TEXT", staticText: "固定測試標題", x: 0, y: 0, width: 500, height: 60,
          fontSize: 24, alignment: "LEFT", config: {}, sortOrder: 0 }, widget(1, "PRIMARY", 0),
          ...(single ? [] : [widget(2, "A", 400), widget(3, "B", 800)])] }] } }); return;
    }
    const key = (url.pathname.includes("/data-sources/A/") ? "A" : url.pathname.includes("/data-sources/B/") ? "B" : "PRIMARY") as keyof typeof state.sql;
    if ((key === "A" && state.failA) || (key === "PRIMARY" && state.failPrimary)) {
      await route.fulfill({ status: key === "A" ? state.failAStatus : state.failPrimaryStatus, json: { error: { code: "DASHBOARD_DELIVERY_FAILED" } } }); return;
    }
    const body = route.request().postDataJSON() as { page: number; snapshotId?: string };
    if (!body.snapshotId) state.sql[key]++;
    state.pages[key].push(body.page);
    const result = { columns: [{ name: `${key}_NAME` }], rows: [{ [`${key}_NAME`]: `${key}○頁${body.page}` }] };
    if (key === "PRIMARY") {
      await route.fulfill({ json: { page: body.page, totalPages: 2, snapshotId: body.snapshotId ?? `PRIMARY-${state.sql.PRIMARY}`,
        dashboard: { id: 1, name: "Synthetic", refreshSeconds: 30, pageSeconds: 5, pageSize: 1, parameters: {} }, reportColumns: [], result } });
    } else {
      await route.fulfill({ json: { page: body.page, totalPages: 2, snapshotId: body.snapshotId ?? `${key}-${state.sql[key]}`,
        sourceKey: key, refreshSeconds: key === "A" ? 5 : 30, pageSeconds: key === "A" ? 15 : 5, pageSize: 1, result } });
    }
  });
  await page.goto("/display/dashboards/1");
  await expect(page.getByText("PRIMARY○頁1", { exact: true })).toBeVisible();
  if (!single) { await expect(page.getByText("A○頁1", { exact: true })).toBeVisible(); await expect(page.getByText("B○頁1", { exact: true })).toBeVisible(); }
  return state;
}

test("multiple sources: refresh independent of paging, stable headers and isolated SQL failure", async ({ page }) => {
  const state = await setup(page);
  const initialPrimaryQueries = state.sql.PRIMARY;
  await page.clock.runFor(5000);
  await expect.poll(() => state.sql.A).toBe(2);
  await expect(page.getByText("B○頁2", { exact: true })).toBeVisible();
  expect(state.sql.B).toBe(1); expect(state.sql.PRIMARY).toBe(initialPrimaryQueries);
  await expect(page.getByText("固定測試標題", { exact: true })).toBeVisible();
  state.failA = true;
  await page.clock.runFor(5000);
  await expect(page.getByText("A○頁1", { exact: true })).toHaveCount(0);
  await expect(page.locator("th").filter({ hasText: /^A_NAME$/ })).toBeVisible();
  await expect(page.getByText("B○頁1", { exact: true })).toBeVisible();
  state.failPrimary = true;
  await page.clock.runFor(5000);
  await expect(page.getByText("PRIMARY○頁1", { exact: true })).toHaveCount(0);
  await expect(page.getByText("B○頁2", { exact: true })).toBeVisible();
});
for (const status of [403, 400, 503]) test(`source ${status} shows a local error while PRIMARY and B continue`, async ({ page }) => {
  const state = await setup(page);
  state.failA = true; state.failAStatus = status;
  await page.clock.runFor(5000);
  await expect(page.getByText("A○頁1", { exact: true })).toHaveCount(0);
  await expect(page.getByText(status === 403 ? "此來源沒有查詢權限" : status === 400 ? "此來源的查詢參數不完整或格式不正確" : "此來源暫時無法提供資料", { exact: true })).toBeVisible();
  await expect(page.getByText("PRIMARY○頁2", { exact: true })).toBeVisible();
  await expect(page.getByText("B○頁2", { exact: true })).toBeVisible();
  await page.clock.runFor(5000);
  await expect(page.getByText("PRIMARY○頁1", { exact: true })).toBeVisible();
  await expect(page.getByText("B○頁1", { exact: true })).toBeVisible();
});
for (const status of [403, 400, 503]) test(`PRIMARY ${status} does not revoke healthy supplemental sources`, async ({ page }) => {
  const state = await setup(page);
  state.failPrimary = true; state.failPrimaryStatus = status;
  await page.clock.runFor(5000);
  await expect(page.getByText("PRIMARY○頁1", { exact: true })).toHaveCount(0);
  await expect(page.getByText("B○頁2", { exact: true })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "A_NAME" })).toBeVisible();
  await page.clock.runFor(5000);
  await expect(page.getByText("B○頁1", { exact: true })).toBeVisible();
});
test("offline clears every patient cell; reconnection reloads; revocation clears token and all sources", async ({ page }) => {
  const state = await setup(page);
  await page.context().setOffline(true);
  await expect(page.locator("td")).toHaveCount(0);
  await page.context().setOffline(false);
  await expect(page.getByText("B○頁1", { exact: true })).toBeVisible();
  state.revoked = true;
  await page.clock.runFor(5000);
  await expect(page.getByRole("heading", { name: "啟用 Dashboard 播放裝置" })).toBeVisible();
  await expect(page.locator("td")).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("uqp.dashboard.device.1"))).toBeNull();
});
test("single-query compatibility: cycle wrap reuses SQL snapshot", async ({ page }) => {
  const state = await setup(page, true);
  const initialQueries = state.sql.PRIMARY;
  await page.clock.runFor(5000); await expect(page.getByText("PRIMARY○頁2", { exact: true })).toBeVisible();
  await page.clock.runFor(5000); await expect(page.getByText("PRIMARY○頁1", { exact: true })).toBeVisible();
  expect(state.sql.PRIMARY).toBe(initialQueries); expect(state.pages.PRIMARY.slice(-2)).toEqual([2, 1]);
});

test("playback token is memory-only; trusted popup handoff works and refresh requires activation",async({page})=>{
  await setup(page,true);
  expect(await page.evaluate(()=>localStorage.getItem("uqp.dashboard.device.1"))).toBeNull();
  expect(await page.evaluate(()=>sessionStorage.getItem("uqp.dashboard.device.1"))).toBeNull();
  const [popup]=await Promise.all([page.waitForEvent("popup"),page.evaluate(async()=>{
    const modulePath="/src/security/dashboardToken.ts";
    const {prepareDashboardTokenHandoff}=await import(modulePath);
    const child=window.open("/display/dashboards/1","_blank");
    if(!child)throw new Error("synthetic popup blocked");
    prepareDashboardTokenHandoff(child,1,"A".repeat(43));
  })]);
  await expect(popup.getByText("PRIMARY○頁1",{exact:true})).toBeVisible();
  expect(await popup.evaluate(()=>localStorage.getItem("uqp.dashboard.device.1"))).toBeNull();
  await popup.reload();
  await expect(popup.getByRole("heading",{name:"啟用 Dashboard 播放裝置"})).toBeVisible();
  await popup.close();
});
