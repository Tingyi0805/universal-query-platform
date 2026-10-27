import { test, expect, type Page } from "@playwright/test";
const original = { id: 10, datasetId: 2, name: "WARD", label: "測試病區設定", dataType: "STRING", controlType: "TEXT",
  isRequired: true, defaultValue: "TEST", dateOutputMode: "STRING", dateCalendar: "ROC", dateFormat: "yyyMMdd", displayOrder: 7,
  placeholder: "測試", helpText: "synthetic", optionMode: "NONE", fixedOptionsJson: null,
  lookupDatasetId: null, lookupValueField: null, lookupLabelField: null };
async function setup(page: Page, fail = false, sqlText = "SELECT {{WARD}}, {{NEW}}", dateParameter?: Partial<typeof original>) {
  const state = { fail, parameters: [{ ...original, ...dateParameter }], previews: [] as any[], mutations: [] as { method: string; body: any }[] };
  await page.addInitScript(() => sessionStorage.setItem("uqp.auth", JSON.stringify({ accessToken: "synthetic-token",
    user: { id: 5, username: "synthetic", displayName: "測試", permissions: ["DESIGN_QUERY"] } })));
  await page.route(url => url.pathname.startsWith("/api/"), async route => {
    const request = route.request(); const path = new URL(request.url()).pathname;
    if (path === "/api/datasets/date-parameter-preview") {
      state.previews.push(request.postDataJSON());
      await route.fulfill({ json: { inputValue: "2026-10-27T23:59:59", outputValue: "115/10/27 23:59:59" } }); return;
    }
    if (path === "/api/datasets/2/parameters/sync") {
      state.mutations.push({ method: request.method(), body: request.postDataJSON() });
      state.parameters.push({ ...original, id: 11, name: "NEW", label: "NEW", displayOrder: 8 });
      await route.fulfill({ json: { status: "OK" } }); return;
    }
    if (path === "/api/datasets/2/parameters") {
      if (request.method() === "PUT") {
        state.mutations.push({ method: request.method(), body: request.postDataJSON() });
        await route.fulfill({ json: { status: "OK" } }); return;
      }
      if (state.fail) { await route.fulfill({ status: 500, json: { error: { code: "INTERNAL_SERVER_ERROR", message: "讀取失敗", requestId: "synthetic-request" } } }); return; }
      const detected = sqlText.includes("{{") ? ["WARD", "NEW"] : [];
      await route.fulfill({ json: { parameters: state.parameters, preview: { previewToken: "a".repeat(64), detectionStatus: "OK", detected,
        added: detected.filter(n => !state.parameters.some(p => p.name === n)), retained: detected.filter(n => state.parameters.some(p => p.name === n)),
        unused: detected.length ? [] : ["WARD"] } } }); return;
    }
    if (path === "/api/datasets/datasource-options") { await route.fulfill({ json: { dataSources: [{ id: 4, name: "測試來源", type: "SQLSERVER" }] } }); return; }
    if (path === "/api/datasets") { await route.fulfill({ json: { datasets: [{ id: 2, code: "SYNTHETIC", name: "測試 Dataset", sqlText, dataSourceId: 4,
      dataSourceName: "測試來源", dataSourceType: "SQLSERVER", maxRows: 100, queryTimeoutSec: 10, isActive: true, isArchived: false }], total: 1, totalPages: 1 } }); return; }
    await route.fulfill({ json: { columns: [], version: 1, versions: [] } });
  });
  await page.goto("/designer/datasets");
  await page.getByRole("button", { name: /測試 Dataset/ }).click();
  return state;
}
test("parameter read failure shows Request ID and retry without empty state or save", async ({ page }) => {
  const state = await setup(page, true);
  const editor = page.locator(".parameter-designer");
  await expect(editor.getByRole("alert")).toContainText("synthetic-request");
  await expect(editor.locator(".empty-state")).toHaveCount(0);
  await expect(editor.getByRole("button", { name: "儲存參數設定" })).toHaveCount(0);
  expect(state.mutations).toEqual([]);
  state.fail = false;
  await editor.getByRole("button", { name: "重試讀取" }).click();
  await expect(editor.getByRole("heading", { name: "Parameter Designer" })).toBeVisible();
  await expect(editor.getByLabel("顯示名稱")).toHaveValue(original.label);
});
test("GET and reload only preview; explicit sync POST preserves existing settings and ordering", async ({ page }) => {
  const state = await setup(page); const editor = page.locator(".parameter-designer");
  await expect(editor.getByText("同步差異預覽")).toBeVisible();
  expect(state.mutations).toEqual([]);
  await editor.getByRole("button", { name: "重新載入差異" }).click();
  await expect(editor.getByRole("button", { name: "套用預覽同步" })).toBeEnabled();
  expect(state.mutations).toEqual([]);
  await editor.getByRole("button", { name: "套用預覽同步" }).click();
  await expect(editor.getByLabel("顯示名稱").first()).toHaveValue(original.label);
  expect(state.mutations).toEqual([{ method: "POST", body: { previewToken: "a".repeat(64), removeNames: [] } }]);
  await editor.getByRole("button", { name: "儲存參數設定" }).click();
  await expect.poll(() => state.mutations.length).toBe(2);
  expect(state.mutations[1]!.body.parameters[0]).toMatchObject({ label: original.label, displayOrder: 7, dateFormat: "yyyMMdd", dateCalendar: "ROC" });
});
test("zero detection retains settings and disables removal and synchronization", async ({ page }) => {
  const state = await setup(page, false, "SELECT 1"); const editor = page.locator(".parameter-designer");
  await expect(editor.getByText("未偵測到參數；禁止同步移除既有設定。")).toBeVisible();
  await expect(editor.getByLabel("明確移除 WARD")).toBeDisabled();
  await expect(editor.getByLabel("顯示名稱")).toHaveValue(original.label);
  await expect(editor.getByRole("button", { name: "套用預覽同步" })).toBeDisabled();
  expect(state.mutations).toEqual([]);
});

test("Designer fixed DATETIME accepts seconds and saves the exact canonical default", async ({ page }) => {
  const state = await setup(page, false, "SELECT {{WARD}}", { dataType: "DATETIME", controlType: "DATETIME",
    defaultValue: "2026-10-27T11:26:47", dateFormat: "yyy/MM/dd HH:mm:ss" });
  const editor = page.locator(".parameter-designer"), fixed = editor.getByLabel("固定值", { exact: true });
  await expect(fixed).toHaveValue("2026-10-27T11:26:47");
  await expect(fixed).toHaveAttribute("step", "1");
  expect(await fixed.evaluate(input => (input as HTMLInputElement).checkValidity())).toBe(true);
  await fixed.fill("2026-10-28T12:34:56");
  expect(await fixed.evaluate(input => (input as HTMLInputElement).checkValidity())).toBe(true);
  await editor.getByRole("button", { name: "儲存參數設定" }).click();
  await expect.poll(() => state.mutations.length).toBe(1);
  expect(state.mutations[0]!.body.parameters[0]).toMatchObject({ defaultValue: "2026-10-28T12:34:56",
    dataType: "DATETIME", dateCalendar: "ROC", dateFormat: "yyy/MM/dd HH:mm:ss" });
});

test.describe("Designer server date preview", () => {
  test.use({ timezoneId: "America/Los_Angeles" });
  test("dynamic ROC DATETIME displays the server preview and persists the expression", async ({ page }) => {
    const state = await setup(page, false, "SELECT {{WARD}}", { dataType: "DATETIME", controlType: "DATETIME",
      defaultValue: "$NOW", dateFormat: "yyy/MM/dd HH:mm:ss" });
    const editor = page.locator(".parameter-designer");
    await expect(editor.getByText("115/10/27 23:59:59", { exact: true })).toBeVisible();
    expect(state.previews.at(-1)).toMatchObject({ value: "$NOW", dataType: "DATETIME", dateCalendar: "ROC" });
    await editor.getByRole("button", { name: "儲存參數設定" }).click();
    await expect.poll(() => state.mutations.length).toBe(1);
    expect(state.mutations[0]!.body.parameters[0].defaultValue).toBe("$NOW");
  });
});
