import { test, expect, type Page } from "@playwright/test";
async function setup(page: Page, initialSql = "SELECT {{REGNO_NAME}}") {
  const state = { sqlText: initialSql, failSql: false, policyError: "", version: 1,
    rules: [{ columnName: "SYNTHETIC", sensitivityType: "OTHER", deviceMaskMode: "FULL" }] as Array<{ columnName: string; sensitivityType: string; deviceMaskMode: string; customMask?: { prefix: number; suffix: number; symbol: string; start?: number; end?: number } | null }>,
    availableColumns: ["SYNTHETIC", "NAME", "PHONE", "MRN", "HIDDEN"],
    writes: [] as string[] };
  await page.addInitScript(() => sessionStorage.setItem("uqp.auth", JSON.stringify({ accessToken: "synthetic-token",
    user: { id: 5, username: "synthetic", displayName: "測試", permissions: ["DESIGN_QUERY"] } })));
  await page.route(url => url.pathname.startsWith("/api/"), async route => {
    const request = route.request(); const path = new URL(request.url()).pathname;
    if(path==="/api/dataset-mask-templates"){await route.fulfill({json:{templates:[{id:"1",revision:"1",version:"0000000000000001",name:"病歷號",aliases:["MRN"],mode:"CUSTOM",customMask:{prefix:0,suffix:4,symbol:"*"},isActive:true,suggestedPublicAllowed:false}]}});return;}
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
      await route.fulfill({ json: { columns: state.rules, version: state.version, availableColumns: state.availableColumns.map(name => ({ name })) } }); return;
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

test("saved Dataset columns support four explicit modes and persist a single Dataset policy", async ({ page }) => {
  const { state, policy } = await setup(page);
  state.rules = [];
  await policy.getByRole("button", { name: "重新載入伺服器規則" }).click();
  await policy.getByRole("combobox", { name: /查詢結果欄位/ }).selectOption("NAME");
  await policy.getByRole("radio", { name: "自訂遮蔽", exact: true }).check();
  await policy.getByLabel("保留前幾碼").fill("1");
  await policy.getByLabel("保留後幾碼").fill("0");
  await policy.getByLabel("遮蔽符號", { exact: true }).fill("*");
  await policy.getByRole("button", { name: "加入／更新欄位規則" }).click();
  for (const [name, mode] of [["PHONE", "顯示原始資料"], ["MRN", "全部遮蔽"], ["HIDDEN", "完全不傳送"]]) {
    await policy.getByRole("combobox", { name: /查詢結果欄位/ }).selectOption(name!);
    await policy.getByRole("radio", { name: mode!, exact: true }).check();
    await policy.getByRole("button", { name: "加入／更新欄位規則" }).click();
  }
  await policy.getByRole("button", { name: "儲存 Dataset 敏感欄位規則", exact: true }).click();
  await expect(policy.getByText(/敏感欄位規則已儲存/)).toBeVisible();
  expect(state.rules).toEqual([
    { columnName: "NAME", sensitivityType: "OTHER", deviceMaskMode: "CUSTOM", customMask: { prefix: 1, suffix: 0, symbol: "*" } },
    { columnName: "PHONE", sensitivityType: "OTHER", deviceMaskMode: "NONE", customMask: null },
    { columnName: "MRN", sensitivityType: "OTHER", deviceMaskMode: "FULL", customMask: null },
    { columnName: "HIDDEN", sensitivityType: "OTHER", deviceMaskMode: "OMIT", customMask: null },
  ]);
  expect(state.writes).toEqual(["sensitivity"]);
  await policy.getByRole("button", { name: "重新載入伺服器規則" }).click();
  await expect(policy.getByRole("cell", { name: "顯示原始資料", exact: true })).toBeVisible();
  await policy.getByRole("combobox", { name: /查詢結果欄位/ }).selectOption("NAME");
  await policy.getByRole("combobox", { name: "遮蔽位置", exact: true }).selectOption("RANGE");
  await policy.getByLabel("起始位置（從 1 起）").fill("2");
  await policy.getByLabel("結束位置（含）").fill("3");
  await policy.getByRole("button", { name: "加入／更新欄位規則" }).click();
  await policy.getByRole("button", { name: "儲存 Dataset 敏感欄位規則", exact: true }).click();
  await expect(policy.getByText(/敏感欄位規則已儲存/)).toBeVisible();
  expect(state.rules.find(rule => rule.columnName === "NAME")!.customMask).toEqual({ prefix: 0, suffix: 0, symbol: "*", start: 2, end: 3 });
  await policy.getByRole("button", { name: "重新載入伺服器規則" }).click();
  await policy.getByRole("combobox", { name: /查詢結果欄位/ }).selectOption("NAME");
  await expect(policy.getByRole("combobox", { name: "遮蔽位置", exact: true })).toHaveValue("RANGE");
  await expect(policy.getByLabel("起始位置（從 1 起）")).toHaveValue("2");
});

test("raw display is an explicit designer choice, never inferred from a saved sensitivity label", async ({ page }) => {
  const { state, policy } = await setup(page);
  state.rules = [{ columnName: "PHONE", sensitivityType: "PHONE", deviceMaskMode: "FULL" }];
  await policy.getByRole("button", { name: "重新載入伺服器規則" }).click();
  await policy.getByRole("combobox", { name: /查詢結果欄位/ }).selectOption("PHONE");
  await policy.getByRole("radio", { name: "顯示原始資料", exact: true }).check();
  await expect(policy.getByText(/您明確允許此欄位原始值/)).toBeVisible();
  await policy.getByRole("button", { name: "加入／更新欄位規則" }).click();
  expect(state.rules[0]!.sensitivityType).toBe("PHONE");
  await policy.getByRole("button", { name: "儲存 Dataset 敏感欄位規則", exact: true }).click();
  await expect(policy.getByText(/敏感欄位規則已儲存/)).toBeVisible();
  expect(state.rules).toEqual([{ columnName: "PHONE", sensitivityType: "OTHER", deviceMaskMode: "NONE", customMask: null }]);
});


test("Dataset alias suggestion requires explicit apply and save; never grants Dashboard disclosure", async ({ page }) => {
  const { state, policy } = await setup(page);
  await policy.getByLabel("查詢結果欄位").selectOption("MRN");
  await expect(policy.getByText(/系統建議：病歷號/)).toBeVisible();
  expect(state.writes).toEqual([]);
  await policy.getByRole("button", { name: "使用建議遮蔽" }).click();
  await expect(policy.getByText(/已套用範本/)).toBeVisible();
  expect(state.writes).toEqual([]);
  expect(state.writes).toEqual([]);
  await policy.getByRole("button", { name: "儲存 Dataset 敏感欄位規則", exact:true }).click();
  await expect.poll(() => state.writes).toEqual(["sensitivity"]);
  expect(state.rules.find(rule => rule.columnName === "MRN")).toMatchObject({
    deviceMaskMode: "CUSTOM", customMask: { prefix: 0, suffix: 4, symbol: "*" },
  });
});

for (const allowed of [true, false]) test(`protected SQL ${allowed ? "filter save preserves policy" : "unproven change retains SQL draft and policy"}`, async ({ page }) => {
  const initial = "SELECT A.NAME AS SYNTHETIC FROM SYNTHETIC_OPERATIONS A";
  const { state, policy } = await setup(page, initial);
  state.failSql = !allowed;
  const beforeRules = structuredClone(state.rules), beforeVersion = state.version;
  const edited = allowed ? `${initial} WHERE A.APP_DATE BETWEEN {{S_DATE}} AND {{EXAM_DATE}}`
    : "SELECT A.SECRET AS SYNTHETIC FROM SYNTHETIC_OPERATIONS A";
  await page.locator("textarea").first().fill(edited);
  await page.getByRole("button", { name: "儲存 Dataset", exact: true }).click();
  if (allowed) await expect(page.getByText(/SQL／資料來源與已儲存設定一致/)).toBeVisible();
  else await expect(page.getByText(/Dataset 儲存失敗；未儲存內容已保留/)).toBeVisible();
  await expect(page.locator("textarea").first()).toHaveValue(edited);
  await expect(policy.getByRole("button", { name: "移除", exact: true })).toBeVisible();
  expect(state.sqlText).toBe(allowed ? edited : initial);
  expect(state.rules).toEqual(beforeRules); expect(state.version).toBe(beforeVersion);
  expect(state.writes).toEqual(["dataset"]);
});
