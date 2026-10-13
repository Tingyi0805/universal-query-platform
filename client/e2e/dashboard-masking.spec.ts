import { test, expect, type Page } from "@playwright/test";
const rawName = "合成患者甲", rawMrn = "SYNTHETIC987654";
async function setup(page: Page) {
  const state = { authFail: false, fail: false, primaryFail: false, extraFail: false, saved: null as any };
  const dashboard = { id: 1, code: "SYNTHETIC", name: "合成保護看板", queryDefinitionId: 2, refreshSeconds: 30, displayMode: "TABLE", pageSize: 5, pageSeconds: 10,
    showClock: false, showPageNumber: false, showCountdown: false, isActive: true,
    parameters: { WARD: "OR01", LIST: [1, 2], LEGACY: { keep: true }, deviceColumnMasks: { NAME: "NAME", MRN: "FULL", ROOM: "NONE" }, deviceColumnTypes: { NAME: "NAME", MRN: "MRN", ROOM: "OTHER" }, snapshotKind: "OTHER", snapshotSeconds: 60 } };
  const result = { columns: [{ name: "NAME" }, { name: "MRN" }, { name: "ROOM" }], rows: [{ NAME: "○○○○", MRN: "*************54", ROOM: "OR01" }], rowCount: 1, elapsedMs: 1, truncated: false };
  await page.addInitScript(() => sessionStorage.setItem("uqp.auth", JSON.stringify({ accessToken: "synthetic-token", user: { id: 5, username: "synthetic", displayName: "測試", permissions: ["DESIGN_QUERY", "EXECUTE_QUERY"] } })));
  await page.route(url => url.pathname.startsWith("/api/"), async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/dashboards/1" && route.request().method() === "PUT") { state.saved = route.request().postDataJSON(); await route.fulfill({ json: { status: "OK" } }); return; }
    if (path.endsWith("/query-sources/v1/configuration") || path.endsWith("/query-mode/v1")) { await route.fulfill({ status: 503, json: { error: { code: "QUERY_SOURCE_MANAGEMENT_DISABLED" } } }); return; }
    if (path === "/api/dashboards") { await route.fulfill({ json: { dashboards: [dashboard], total: 1, totalPages: 1 } }); return; }
    if (path === "/api/query-definitions") { await route.fulfill({ json: { queryDefinitions: [{ id: 2, datasetId: 3, name: "合成 Query", code: "Q", isPublished: true, isActive: true, isArchived: false }] } }); return; }
    if (path === "/api/query-definitions/2") { await route.fulfill({ json: { queryDefinition: { id: 2, datasetId: 3 } } }); return; }
    if (path === "/api/query-definitions/2/report-columns") { await route.fulfill({ json: { columns: ["NAME", "MRN", "ROOM"].map(columnName => ({ columnName })) } }); return; }
    if (path === "/api/datasets/3/parameters") { await route.fulfill({ json: { parameters: [{ name: "WARD", label: "合成病區", dataType: "STRING", defaultValue: "OR01", isRequired: true }], preview: { detected: ["WARD"] } } }); return; }
    if (path === "/api/datasets/3/sensitive-columns") { await route.fulfill({ json: { version: 1, columns: [{ columnName: "NAME", sensitivityType: "NAME", deviceMaskMode: "FULL" }, { columnName: "MRN", sensitivityType: "MRN", deviceMaskMode: "CUSTOM", customMask: { prefix: 0, suffix: 2, symbol: "*" } }] } }); return; }
    if (path.endsWith("/data-sources")) { await route.fulfill({ json: { sources: [{ sourceKey: "WARD", isEnabled: true, refreshSeconds: 30 }] } }); return; }
    if (path.endsWith("/layout")) { await route.fulfill({ json: { profiles: [{ id: 1, dashboardId: 1, name: "合成版型", isDefault: true, sortOrder: 0, canvasWidth: 1920, canvasHeight: 1080, config: {}, widgets: [
      { id: 1, widgetType: "TABLE", title: null, x: 0, y: 0, width: 800, height: 500, fontSize: 20, alignment: "LEFT", config: { dataSourceKey: "PRIMARY" }, sortOrder: 0, sourceKey: null },
      { id: 2, widgetType: "TEXT", title: null, x: 0, y: 500, width: 800, height: 60, fontSize: 20, alignment: "LEFT", config: {}, sortOrder: 1, sourceKey: null, staticText: "固定合成標題" },
    ] }] } }); return; }
    if (path.endsWith("/preview")) {
      const extra = path.includes("/data-sources/");
      if (state.authFail) { await route.fulfill({ status: 403, json: { error: { code: "FORBIDDEN", message: "private Bind patient Token" } } }); return; }
      if (state.fail || (extra ? state.extraFail : state.primaryFail)) { await route.fulfill({ status: extra ? 403 : 503, json: { error: { code: extra ? "DASHBOARD_EXECUTE_FORBIDDEN" : "PATIENT_AUDIT_FAILED", message: "driver SQL Bind patient password Token" } } }); return; }
      const { parameters: _private, ...safeDashboard } = dashboard;
      const body = extra ? { sourceKey: "WARD", pageSize: 5, pageSeconds: 10, refreshSeconds: 30, result } : { dashboard: safeDashboard, reportColumns: [], result, disclosureId: 1 };
      expect(JSON.stringify(body)).not.toContain(rawName); expect(JSON.stringify(body)).not.toContain(rawMrn);
      await route.fulfill({ json: body }); return;
    }
    await route.fulfill({ json: { devices: [], profiles: [], columns: [], queries: [] } });
  });
  return state;
}
test("list preview shows masked values and refresh failure clears previous rows", async ({ page }) => {
  const state = await setup(page);
  await page.clock.install({ time: new Date("2026-10-13T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-10-13T00:00:01Z"));
  await page.goto("/designer/dashboards");
  await page.getByRole("button", { name: "預覽", exact: true }).click();
  const preview = page.locator(".dashboard-preview-card");
  await expect(preview.getByText("*************54", { exact: true })).toBeVisible();
  await expect(page.locator("body")).not.toContainText(rawName); await expect(page.locator("body")).not.toContainText(rawMrn);
  state.fail = true; await page.clock.runFor(31000);
  await expect(page.getByText(/來源 PRIMARY：PATIENT_AUDIT_FAILED/)).toBeVisible();
  await expect(preview.getByText("*************54", { exact: true })).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("driver SQL Bind");
});
test("data settings forms preserve legacy JSON and disallow weakening Dataset or saved policies", async ({ page }) => {
  const state = await setup(page); await page.goto("/designer/dashboards");
  await page.getByRole("button", { name: "編輯", exact: true }).first().click();
  await expect(page.getByText("NAME：全部遮蔽", { exact: true })).toBeVisible();
  await page.getByLabel("參數 WARD", { exact: true }).fill("OR02");
  await page.getByRole("combobox", { name: /^核准欄位/ }).selectOption("NAME");
  const modes = page.getByRole("combobox", { name: /^欄位遮蔽模式/ });
  await expect(modes.locator('option[value="NONE"]')).toHaveAttribute("disabled", ""); await expect(modes.locator('option[value="NAME"]')).toHaveAttribute("disabled", "");
  await modes.selectOption("FULL"); await page.getByRole("button", { name: "加入／更新 Dashboard 欄位規則", exact: true }).click();
  await page.getByRole("button", { name: "儲存修改", exact: true }).click();
  await expect.poll(() => state.saved).not.toBeNull();
  expect(state.saved.parameters).toMatchObject({ WARD: "OR02", LIST: [1, 2], LEGACY: { keep: true }, deviceColumnMasks: { NAME: "FULL", MRN: "FULL", ROOM: "NONE" }, deviceColumnTypes: { NAME: "NAME", MRN: "MRN", ROOM: "OTHER" }, snapshotKind: "OTHER", snapshotSeconds: 60 });
});
test("layout identifies failing PRIMARY and extra source without showing driver text or old values", async ({ page }) => {
  const state = await setup(page); state.primaryFail = true; state.extraFail = true;
  await page.goto("/designer/dashboards/1/layout");
  await expect(page.getByText(/來源 PRIMARY：PATIENT_AUDIT_FAILED/)).toBeVisible();
  await expect(page.getByText(/來源 WARD：DASHBOARD_EXECUTE_FORBIDDEN/)).toBeVisible();
  await expect(page.getByText("固定合成標題", { exact: true }).first()).toBeVisible();
  for (const value of [rawName, rawMrn, "driver SQL Bind", "*************54"]) await expect(page.locator("body")).not.toContainText(value);
});
test("Legacy designer playback never reuses previous values after PRIMARY failure", async ({ page }) => {
  const state = await setup(page);
  await page.clock.install({ time: new Date("2026-10-13T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-10-13T00:00:01Z"));
  await page.goto("/designer/dashboards/1/display");
  await expect(page.getByText("*************54", { exact: true }).first()).toBeVisible();
  for (const value of [rawName, rawMrn]) await expect(page.locator("body")).not.toContainText(value);
  state.primaryFail = true;
  await page.clock.runFor(31000);
  await expect(page.getByText("*************54", { exact: true })).toHaveCount(0);
});

test("a failed extra source preserves only the safe PRIMARY layout preview", async ({ page }) => {
  const state = await setup(page); state.extraFail = true;
  await page.goto("/designer/dashboards/1/layout");
  await expect(page.getByText(/來源 WARD：DASHBOARD_EXECUTE_FORBIDDEN/)).toBeVisible();
  await expect(page.getByText("*************54", { exact: true }).first()).toBeVisible();
  for (const value of [rawName, rawMrn, "driver SQL Bind"]) await expect(page.locator("body")).not.toContainText(value);
});

test("Legacy JWT preview stops the entire frame after global permission loss", async ({ page }) => {
  const state = await setup(page);
  await page.clock.install({ time: new Date("2026-10-13T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-10-13T00:00:01Z"));
  await page.goto("/designer/dashboards/1/display");
  await expect(page.getByText("*************54", { exact: true }).first()).toBeVisible();
  state.authFail = true; await page.clock.runFor(31000);
  await expect(page.getByText("*************54", { exact: true })).toHaveCount(0);
  await expect(page.getByText("固定合成標題", { exact: true })).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("private Bind patient");
});
