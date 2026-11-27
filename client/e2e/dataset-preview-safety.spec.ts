import { test, expect, type Page } from "@playwright/test";
const version = "0000000000000001";
async function setup(page: Page, saved = true, execute = true) {
  const state = { saved, policyVersion: 0, runError: "", runs: [] as any[], contexts: 0, saves: 0, policyWrites: 0, columns: [] as string[], rules: [] as any[] };
  await page.addInitScript(canExecute => sessionStorage.setItem("uqp.auth", JSON.stringify({ accessToken: "synthetic", user: { id: 5, username: "synthetic", displayName: "測試", permissions: canExecute ? ["DESIGN_QUERY", "EXECUTE_QUERY"] : ["DESIGN_QUERY"] } })), execute);
  await page.route(url => url.pathname.startsWith("/api/"), async route => {
    const req = route.request(), path = new URL(req.url()).pathname;
    if (path === "/api/datasets" && req.method() === "POST") { state.saved = true; state.saves++; await route.fulfill({ json: { id: 2, parameterNames: [] } }); return; }
    if (path === "/api/datasets") { await route.fulfill({ json: { datasets: state.saved ? [{ id: 2, code: "TEST", name: "合成預覽", sqlText: "SELECT 1 AS VALUE", dataSourceId: 4, maxRows: 100, queryTimeoutSec: null, isActive: true, isArchived: false }] : [], total: state.saved ? 1 : 0, totalPages: 1 } }); return; }
    if (path.endsWith("/datasource-options")) { await route.fulfill({ json: { dataSources: [{ id: 4, name: "合成來源", type: "SQLSERVER" }] } }); return; }
    if (path.endsWith("/parameters")) { await route.fulfill({ json: { parameters: [], preview: { detected: [], added: [], retained: [], unused: [], detectionStatus: "OK", previewToken: "a".repeat(64) } } }); return; }
    if (path.endsWith("/sensitive-columns")) {
      if (req.method() === "PUT") { expect(req.postDataJSON().expectedVersion).toBe(0); state.rules = req.postDataJSON().columns; state.policyWrites++; state.policyVersion = 1; }
      await route.fulfill({ json: { columns: state.rules, version: state.policyVersion, availableColumns: state.columns.map(name => ({ name })) } }); return;
    }
    if (path.endsWith("/columns/sync")) {
      state.columns = ["VALUE"];
      await route.fulfill({ json: { columns: [{ name: "VALUE", dataType: "int", ordinal: 1 }], trust: "UNBOUND_CANDIDATE", purpose: "DISPLAY_COLUMN_OPTIONS_ONLY", deliveryAllowed: false } }); return;
    }
    if (path.endsWith("/patient-audit-config")) { await route.fulfill({ json: { config: null, version: "0", status: "NOT_CONFIGURED", metadataStatus: "METADATA_UNCONFIRMED", columns: [] } }); return; }
    if (path.endsWith("/column-candidates")) {
      await route.fulfill({ json: { trust: "UNBOUND_CANDIDATE", metadataState: "NOT_INITIALIZED",
        deliveryAllowed: false, requiresExecutionComparison: true, evidenceType: "SQLSERVER_DESCRIBE_FIRST_RESULT_SET",
        columns: [{ name: "VALUE", dataType: "int", ordinal: 1 }] } }); return;
    }
    if (path.endsWith("/design-preview/context")) {
      state.contexts++;
      if (!state.policyVersion) { await route.fulfill({ status: 409, json: { error: { code: "DATASET_DELIVERY_POLICY_UNCONFIRMED", message: "此 Dataset 尚無已確認的欄位保護政策，預覽已停止資料交付。管理者核准「使用」不能取代資料安全分類；需完成安全初始化與欄位審查後才能預覽。", requestId: "synthetic-request" } } }); return; }
      await route.fulfill({ json: { datasetId: 2, definitionVersion: version } }); return;
    }
    if (path === "/api/datasets/preview/run") {
      const body = req.postDataJSON(); state.runs.push(body); expect(body.expectedDefinitionVersion).toBe(version);
      if (state.runError) { await route.fulfill({ status: 409, json: { error: { code: state.runError, message: state.runError === "DATASET_PREVIEW_INITIALIZATION_REQUIRED" ? "Dataset 安全初始化尚未完成，請管理者安排可信 metadata。" : state.runError === "PATIENT_AUDIT_NOT_CONFIRMED" ? "患者稽核尚未確認，請檢查可信欄位與金鑰。" : "Dataset 定義、來源或安全設定已變更，請重新載入並確認後再預覽。", requestId: "synthetic-request" } } }); return; }
      await route.fulfill({ json: { result: { columns: [{ name: "VALUE" }], rows: [{ VALUE: 1 }], rowCount: 1, elapsedMs: 1, truncated: false }, parameterNames: [] } }); return;
    }
    await route.fulfill({ json: { versions: [] } });
  });
  await page.goto("/designer/datasets"); if (saved) await page.getByRole("button", { name: /合成預覽/ }).click(); return state;
}
const empty = (page: Page) => page.getByRole("checkbox", { name: /明確確認空政策/ });
const preview = (page: Page) => page.getByRole("button", { name: "執行預覽", exact: true });
test("new Dataset saves inactive and cannot deliver unconfirmed data", async ({ page }) => {
  const state = await setup(page, false);
  await preview(page).click();
  await expect(page.getByText(/請先儲存 Dataset；/)).toBeVisible();
  expect(state.contexts).toBe(0);
  await page.getByLabel("代碼", { exact: true }).fill("TEST");
  await page.getByLabel("名稱", { exact: true }).fill("合成預覽");
  await page.getByRole("combobox", { name: "資料來源", exact: true }).selectOption("4");
  await page.locator("textarea").first().fill("SELECT 1 AS VALUE");
  await page.getByRole("button", { name: "儲存 Dataset", exact: true }).click();
  await expect(page.getByRole("region", { name: "Dataset 使用核准" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Dataset 患者揭露稽核設定" })).toHaveCount(0);
  expect(state.saves).toBe(1);
  expect(state.policyWrites).toBe(0);
  await preview(page).click();
  await expect(page.getByText(/安全初始化與欄位審查/)).toBeVisible();
  expect(state.runs).toEqual([]);
});
test("saved unconfirmed policy displays actionable error and retains SQL", async ({ page }) => {
  const state = await setup(page); await preview(page).click(); await expect(page.getByText(/安全初始化與欄位審查/)).toBeVisible();
  await expect(page.getByText(/synthetic-request/)).toBeVisible(); expect(state.runs).toEqual([]); await expect(page.locator("textarea").first()).toHaveValue("SELECT 1 AS VALUE");
});
for (const code of ["DATASET_DELIVERY_VERSION_CONFLICT", "PATIENT_AUDIT_NOT_CONFIRMED"]) test(`saved preview preserves ${code} and version`, async ({ page }) => {
  const state = await setup(page); state.policyVersion = 1; state.runError = code; await preview(page).click();
  await expect(page.getByText(code === "PATIENT_AUDIT_NOT_CONFIRMED" ? /患者稽核尚未確認，/ : /Dataset 定義、來源或安全設定已變更，/)).toBeVisible(); expect(state.runs).toHaveLength(1); expect(state.runs[0].nonPatientConfirmed).toBeUndefined();
  await expect(page.getByRole("heading", { name: "預覽結果", exact: true })).toHaveCount(0);
});
for (const change of ["sql", "source"] as const) test(`unsaved ${change} blocks preview`, async ({ page }) => {
  const state = await setup(page);
  if (change === "sql") await page.locator("textarea").first().fill("SELECT 2 AS VALUE"); else await page.getByRole("combobox", { name: "資料來源", exact: true }).selectOption("");
  await preview(page).click(); await expect(page.getByText(/請先儲存 Dataset；/)).toBeVisible(); expect(state.contexts).toBe(0); expect(state.runs).toEqual([]);
});
test("designer without execute permission cannot request preview", async ({ page }) => {
  const state = await setup(page, true, false); await preview(page).click(); await expect(page.getByText(/預覽需要 DESIGN_QUERY 與 EXECUTE_QUERY 權限/)).toBeVisible(); expect(state.contexts).toBe(0); expect(state.runs).toEqual([]);
});

test("simplified Dataset page never auto-confirms policy or executes rows", async ({ page }) => {
  const state = await setup(page);
  await expect(page.getByRole("region", { name: "Dataset 使用核准" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Dataset 敏感資料欄位管理" })).toHaveCount(0);
  expect(state.policyWrites).toBe(0);
  expect(state.runs).toEqual([]);
});
test("existing confirmed context still supplies exact version without a non-patient declaration", async ({ page }) => {
  const state = await setup(page); state.policyVersion = 1;
  await preview(page).click(); await expect(page.getByText(/預覽完成：1 筆/)).toBeVisible();
  expect(state.runs[0].expectedDefinitionVersion).toBe(version); expect(state.runs[0].nonPatientConfirmed).toBeUndefined();
});

test("designer displays candidate metadata without unlocking sensitive policy or data preview", async ({ page }) => {
  const state = await setup(page);
  const panel = page.getByRole("region", { name: "SQL 欄位候選預覽" });
  await panel.getByRole("button", { name: "取得 SQL 欄位名稱及型別" }).click();
  await expect(panel.getByText("UNBOUND_CANDIDATE", { exact: false })).toBeVisible();
  await expect(panel.getByRole("cell", { name: "VALUE" })).toBeVisible();
  await expect(panel.getByRole("cell", { name: "int" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Dataset 使用核准" })).toBeVisible();
  expect(state.runs).toEqual([]); expect(state.policyWrites).toBe(0);
  await page.locator("textarea").first().fill("SELECT 2 AS VALUE");
  await expect(panel.getByRole("cell", { name: "VALUE" })).toHaveCount(0);
});

test("simplified manager-only Dataset does not expose retired manual sensitivity controls", async ({ page }) => {
  const state=await setup(page);
  await expect(page.getByRole("region",{name:"Dataset 使用核准"})).toBeVisible();
  await expect(page.getByRole("region",{name:"候選欄位遮蔽草稿"})).toHaveCount(0);
  await expect(page.getByRole("region",{name:"已儲存欄位 Snapshot"})).toHaveCount(0);
  await expect(page.getByRole("region",{name:"Dataset 安全初始化狀態"})).toHaveCount(0);
  await expect(page.getByRole("heading",{name:"資料預覽的安全確認狀態"})).toHaveCount(0);
  await page.getByRole("region",{name:"SQL 欄位候選預覽"})
    .getByRole("button",{name:"取得 SQL 欄位名稱及型別"}).click();
  await expect(page.getByRole("region",{name:"候選欄位遮蔽草稿"})).toHaveCount(0);
  expect(state.policyWrites).toBe(0);
  expect(state.runs).toEqual([]);
});
