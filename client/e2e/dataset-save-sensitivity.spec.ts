import { test, expect, type Page } from "@playwright/test";
async function setup(page: Page) {
  const state = { sqlText: "SELECT {{REGNO_NAME}}", failSql: false, policyError: "", version: 1,
    rules: [{ columnName: "SYNTHETIC", sensitivityType: "OTHER", deviceMaskMode: "FULL" }],
    writes: [] as string[] };
  await page.addInitScript(() => sessionStorage.setItem("uqp.auth", JSON.stringify({ accessToken: "synthetic-token",
    user: { id: 5, username: "synthetic", displayName: "測試", permissions: ["DESIGN_QUERY"] } })));
  await page.route(url => url.pathname.startsWith("/api/"), async route => {
    const request = route.request(); const path = new URL(request.url()).pathname;
    if (path === "/api/datasets/2" && request.method() === "PUT") {
      state.writes.push("dataset");
      if (state.failSql) { await route.fulfill({ status: 409, json: { error: { code: "DATASET_SENSITIVITY_REVIEW_REQUIRED", message: "無法可靠驗證遮蔽適用性；現有設定已保留。" } } }); return; }
      state.sqlText = request.postDataJSON().sqlText;
      await route.fulfill({ json: { status: "OK" } }); return;
    }
    if (path === "/api/datasets/2/sensitive-columns") {
      if (request.method() === "PUT") {
        state.writes.push("sensitivity");
        if (state.policyError) { await route.fulfill({ status: 409, json: { error: { code: state.policyError, message: "啟用中的 Dashboard 保護，規則未儲存。" } } }); return; }
        expect(request.postDataJSON().expectedVersion).toBe(state.version);
        state.rules = request.postDataJSON().columns; state.version++;
      }
      await route.fulfill({ json: { columns: state.rules, version: state.version } }); return;
    }
    if (path === "/api/datasets/2/parameters") {
      await route.fulfill({ json: { parameters: [{ id: 10, datasetId: 2, name: "REGNO_NAME", label: "舊設定", dataType: "STRING", controlType: "TEXT", isRequired: false, defaultValue: "synthetic", displayOrder: 1, optionMode: "NONE" }],
        preview: { previewToken: "a".repeat(64), detectionStatus: "OK", detected: state.sqlText.includes("{{REGNO}}") ? ["REGNO"] : ["REGNO_NAME"],
          added: state.sqlText.includes("{{REGNO}}") ? ["REGNO"] : [], retained: [], unused: state.sqlText.includes("{{REGNO}}") ? ["REGNO_NAME"] : [] } } }); return;
    }
    if (path === "/api/datasets/datasource-options") { await route.fulfill({ json: { dataSources: [{ id: 4, name: "合成來源", type: "ORACLE" }] } }); return; }
    if (path === "/api/datasets") { await route.fulfill({ json: { datasets: [{ id: 2, code: "SYNTHETIC", name: "合成 Dataset", sqlText: state.sqlText, dataSourceId: 4, dataSourceName: "合成來源", dataSourceType: "ORACLE", maxRows: 100, queryTimeoutSec: 10, isActive: true, isArchived: false }], total: 1, totalPages: 1 } }); return; }
    await route.fulfill({ json: { versions: [] } });
  });
  await page.goto("/designer/datasets");
  await page.getByRole("button", { name: /合成 Dataset/ }).click();
  await expect(page.locator(".parameter-designer").getByLabel("顯示名稱")).toHaveValue("舊設定");
  const policy = page.locator("section").filter({ has: page.getByRole("heading", { name: "Dataset 敏感資料欄位管理", exact: true }) });
  await expect(policy.getByRole("button", { name: "移除", exact: true })).toBeVisible();
  return { state, policy };
}
test("successful SQL save refreshes saved differences without renaming or losing parameter drafts", async ({ page }) => {
  const { state } = await setup(page);
  const editor = page.locator(".parameter-designer");
  await editor.getByLabel("顯示名稱").fill("未儲存標籤");
  await page.locator("textarea").first().fill("SELECT {{REGNO}}");
  await expect(page.getByText(/編輯中 SQL／資料來源尚未儲存/)).toBeVisible();
  await page.getByRole("button", { name: "儲存 Dataset", exact: true }).click();
  await expect(editor.getByText(/新增：REGNO/)).toBeVisible();
  await expect(editor.getByText(/SQL 未使用：REGNO_NAME/)).toBeVisible();
  await expect(editor.getByLabel("顯示名稱")).toHaveValue("未儲存標籤");
  await expect(page.getByText(/SQL／資料來源與已儲存設定一致/)).toBeVisible();
  expect(state.writes).toEqual(["dataset"]);
});
test("failed SQL save retains edited SQL and persisted parameter differences", async ({ page }) => {
  const { state } = await setup(page); state.failSql = true;
  await page.locator("textarea").first().fill("SELECT {{REGNO}}");
  await page.getByRole("button", { name: "儲存 Dataset", exact: true }).click();
  await expect(page.getByText(/Dataset 儲存失敗；未儲存內容已保留/)).toBeVisible();
  await expect(page.locator("textarea").first()).toHaveValue("SELECT {{REGNO}}");
  await expect(page.getByText(/編輯中 SQL／資料來源尚未儲存/)).toBeVisible();
  await expect(page.locator(".parameter-designer").getByLabel("顯示名稱")).toHaveValue("舊設定");
  expect(state.sqlText).toBe("SELECT {{REGNO_NAME}}");
  expect(state.rules).toHaveLength(1);
});
test("basic Dataset save never submits policy; independent policy save persists on reentry", async ({ page }) => {
  const { state, policy } = await setup(page);
  await policy.getByRole("button", { name: "移除", exact: true }).click();
  await page.getByRole("button", { name: "儲存 Dataset", exact: true }).click();
  await expect(page.getByText(/Dataset 基本設定已更新；敏感欄位規則尚未儲存/)).toBeVisible();
  expect(state.rules).toHaveLength(1);
  await policy.getByRole("button", { name: "儲存 Dataset 敏感欄位規則", exact: true }).click();
  await expect(policy.getByText(/敏感欄位規則已儲存/)).toBeVisible();
  expect(state.rules).toEqual([]);
  await page.reload();
  await page.getByRole("button", { name: /合成 Dataset/ }).click();
  await expect(policy.getByRole("button", { name: "儲存 Dataset 敏感欄位規則", exact: true })).toBeDisabled();
  await expect(policy.getByRole("button", { name: "移除", exact: true })).toHaveCount(0);
});
for (const code of ["SENSITIVITY_VERSION_CONFLICT", "SENSITIVITY_ACTIVE_DASHBOARD"]) {
  test(`policy ${code} preserves draft and server rules`, async ({ page }) => {
    const { state, policy } = await setup(page); state.policyError = code;
    await policy.getByRole("button", { name: "移除", exact: true }).click();
    await policy.getByRole("button", { name: "儲存 Dataset 敏感欄位規則", exact: true }).click();
    await expect(policy.getByText(/尚有未儲存的敏感欄位規則變更/)).toBeVisible();
    await expect(policy.getByText(code === "SENSITIVITY_VERSION_CONFLICT" ? /規則已由其他管理者更新/ : /啟用中的 Dashboard 保護/)).toBeVisible();
    expect(state.rules).toHaveLength(1);
    if (code === "SENSITIVITY_VERSION_CONFLICT") await expect(policy.getByRole("button", { name: "儲存 Dataset 敏感欄位規則", exact: true })).toBeDisabled();
  });
}

for (const name of ["NAME", "MRN", "PHONE", "OPAQUE_7"]) test(`user selects ${name} and full mask without inferred classification`, async ({ page }) => {
  const { state, policy } = await setup(page);
  state.rules = [{ columnName: name, sensitivityType: "OTHER", deviceMaskMode: "FULL" }];
  await policy.getByRole("button", { name: "重新載入伺服器規則" }).click();
  await expect(policy.getByRole("cell", { name, exact: true })).toBeVisible();
  expect(state.writes).toEqual([]);
  await policy.getByRole("combobox", { name: /查詢結果欄位/ }).selectOption(name);
  await policy.getByRole("radio", { name: "全部遮蔽", exact: true }).check();
  await policy.getByRole("button", { name: "加入／更新欄位規則" }).click();
  await policy.getByRole("button", { name: "儲存 Dataset 敏感欄位規則", exact: true }).click();
  await expect(policy.getByText(/敏感欄位規則已儲存/)).toBeVisible();
  expect(state.rules).toEqual([{ columnName: name, sensitivityType: "OTHER", deviceMaskMode: "FULL", customMask: null }]);
});
