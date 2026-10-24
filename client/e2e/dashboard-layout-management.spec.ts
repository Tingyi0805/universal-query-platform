import { test, expect, type Page } from "@playwright/test";
async function setup(page: Page) {
  const widget = { id: 1, widgetType: "TEXT", title: "合成標題", sourceKey: null, staticText: "固定合成文字", x: 10, y: 20, width: 300, height: 60, fontSize: 24, alignment: "LEFT", config: { color: "#112233", preservedStyle: { marker: "synthetic" } }, sortOrder: 0 };
  const state = { revision: 1, conflict: false, disabled: false, race: false, pending: false, sourceEnabled: true, missingVersion: false, writes: [] as any[], legacy: [] as string[],
    profiles: [
      { id: 1, name: "橫向合成版型", isDefault: true, sortOrder: 0, canvasWidth: 1920, canvasHeight: 1080, config: { backgroundColor: "#abcdef", retained: true }, widgets: [widget,
        { ...widget, id: 2, widgetType: "FIELD", staticText: null, sourceKey: "NAME", y: 100, config: { dataSourceKey: "WARD", color: "#223344" } },
        { ...widget, id: 3, widgetType: "TABLE", staticText: null, sourceKey: null, y: 200, width: 900, height: 300, config: { dataSourceKey: "PRIMARY", columns: ["NAME"], retainedTable: true } }] },
      { id: 2, name: "直向合成版型", isDefault: false, sortOrder: 1, canvasWidth: 1080, canvasHeight: 1920, config: { retainedPortrait: true }, widgets: [{ ...widget, id: 4, staticText: "直向固定合成文字" }] },
    ] };
  const version = () => state.revision.toString(16).padStart(64, "0");
  const primary = { sourceKey: "PRIMARY", queryDefinitionId: 20, parameters: {}, refreshSeconds: 30, pageSize: 5, pageSeconds: 10, maxRows: 100, requiresConversion: false };
  const config = () => ({ version: state.missingVersion ? undefined : version(), editable: true, isActive: false, dashboardMode: "QUERY_ONLY_DISABLED", overCapacity: false, primary, sources: [{ ...primary, id: 10, sourceKey: "WARD", queryDefinitionId: state.pending ? null : 21, isEnabled: state.sourceEnabled }] });
  await page.addInitScript(() => sessionStorage.setItem("uqp.auth", JSON.stringify({ accessToken: "synthetic", user: { id: 1, username: "synthetic", displayName: "合成", permissions: ["DESIGN_QUERY", "VIEW_QUERY", "EXECUTE_QUERY"] } })));
  await page.route(url => url.pathname.startsWith("/api/"), async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path.endsWith("/configuration")) { await route.fulfill(state.disabled ? { status: 404, json: { error: { code: "QUERY_SOURCE_MANAGEMENT_DISABLED", message: "SQL private synthetic" } } } : { json: config() }); return; }
    if (path === "/api/dashboards/1/layout" && request.method() === "GET") {
      const profiles = structuredClone(state.profiles);
      if (state.race) { state.revision++; state.race = false; }
      await route.fulfill({ json: { profiles } }); return;
    }
    if (path.endsWith("/query-sources/v1/layout") && request.method() === "PUT") {
      const body = request.postDataJSON(); state.writes.push(body);
      if (state.conflict || body.expectedVersion !== version()) { await route.fulfill({ status: 409, json: { error: { code: "QUERY_SOURCE_VERSION_CONFLICT", message: "private SQL" } } }); return; }
      state.profiles = body.profiles; state.revision++; await route.fulfill({ json: { version: version() } }); return;
    }
    if (/query-sources\/v1\/[^/]+\/page$/.test(path)) {
      await route.fulfill({ json: { page: 1, totalPages: 1, snapshotId: "11111111-1111-4111-8111-111111111111", result: { columns: [{ name: "NAME" }], rows: [{ NAME: "合○測試" }] } } }); return;
    }
    if (/\/preview$|\/data-sources/.test(path) || (path.endsWith("/layout") && request.method() === "PUT")) { state.legacy.push(path); await route.fulfill({ status: 500, json: { error: { code: "LEGACY_FORBIDDEN" } } }); return; }
    await route.fulfill({ json: { organizationName: "Synthetic", platformName: "UQP", columns: [], profiles: [] } });
  });
  return state;
}
const save = (page: Page) => page.getByRole("button", { name: "儲存版面", exact: true });

test("existing multi-screen layouts round-trip fixed text fields tables geometry styles and SourceKeys without initialization writes", async ({ page }) => {
  const state = await setup(page), original = structuredClone(state.profiles);
  await page.goto("/designer/dashboards/1/layout"); await expect(page.getByText("固定合成文字", { exact: true })).toBeVisible(); expect(state.writes).toHaveLength(0);
  await save(page).click(); await expect(page.getByText("Dashboard 版面已儲存。", { exact: true })).toBeVisible();
  expect(state.writes[0].profiles).toEqual(original); expect(state.legacy).toEqual([]);
  page.once("dialog", d => void d.accept()); await page.getByRole("button", { name: "重新載入版型與版本", exact: true }).click();
  await expect(page.getByText("固定合成文字", { exact: true })).toBeVisible(); await expect(page.getByLabel("畫布寬度", { exact: true })).toHaveValue("1920"); expect(state.profiles).toEqual(original);
  await page.locator(".layout-sidebar > select").selectOption({ label: "直向合成版型 (1080×1920)" });
  await expect(page.getByText("直向固定合成文字", { exact: true })).toBeVisible(); await expect(page.getByLabel("畫布高度", { exact: true })).toHaveValue("1920");
});

test("layout conflict preserves local draft locks saving and only explicit reload takes another administrator's layout", async ({ page }) => {
  const state = await setup(page); await page.goto("/designer/dashboards/1/layout");
  await page.getByLabel("畫布寬度", { exact: true }).fill("2000"); state.conflict = true; await save(page).click();
  await expect(page.getByText(/QUERY_SOURCE_VERSION_CONFLICT/)).toBeVisible(); await expect(page.getByLabel("畫布寬度", { exact: true })).toHaveValue("2000"); await expect(save(page)).toBeDisabled();
  state.profiles[0]!.canvasWidth = 2048; state.revision++; state.conflict = false;
  expect(state.writes).toHaveLength(1); page.once("dialog", d => void d.accept()); await page.getByRole("button", { name: "重新載入版型與版本", exact: true }).click();
  await expect(page.getByLabel("畫布寬度", { exact: true })).toHaveValue("2048"); expect(state.writes).toHaveLength(1); expect(state.legacy).toEqual([]);
});

test("version changes while reading layout cannot pair old geometry with newer write authority", async ({ page }) => {
  const state = await setup(page); state.race = true;
  await page.goto("/designer/dashboards/1/layout"); await expect(page.getByText("固定合成文字", { exact: true })).toBeVisible();
  await expect(page.getByText(/QUERY_SOURCE_VERSION_CONFLICT/)).toBeVisible(); await expect(save(page)).toBeDisabled(); expect(state.writes).toEqual([]);
});

for (const pending of [false, true]) test(`${pending ? "pending" : "disabled"} source keeps Widget identity and blocks unsafe save`, async ({ page }) => {
  const state = await setup(page); state.pending = pending; state.sourceEnabled = pending;
  await page.goto("/designer/dashboards/1/layout"); await expect(page.getByText(/Widget 引用來源不可用：WARD/)).toBeVisible();
  await expect(save(page)).toBeDisabled(); expect(state.profiles[0]!.widgets[1]).toMatchObject({ sourceKey: "NAME", config: { dataSourceKey: "WARD" } }); expect(state.writes).toHaveLength(0); expect(state.legacy).toHaveLength(0);
});

test("management flag off or missing trusted version permits only saved-layout viewing with no Legacy writer", async ({ page }) => {
  const state = await setup(page); state.disabled = true; await page.goto("/designer/dashboards/1/layout");
  await expect(page.getByText("固定合成文字", { exact: true })).toBeVisible(); await expect(page.getByText(/新版資料來源管理功能旗標關閉/)).toBeVisible(); await expect(save(page)).toBeDisabled();
  state.disabled = false; state.missingVersion = true; page.once("dialog", d => void d.accept()); await page.getByRole("button", { name: "重新載入版型與版本", exact: true }).click();
  await expect(page.getByText("固定合成文字", { exact: true })).toBeVisible(); await expect(save(page)).toBeDisabled(); expect(state.writes).toEqual([]); expect(state.legacy).toEqual([]);
});
