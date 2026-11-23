import { test, expect } from "@playwright/test";

for (const sourceType of ["SQLSERVER", "ORACLE"]) test(`new ${sourceType} Dataset: save SQL, sync metadata-only choices, save four modes and reopen`, async ({ page }) => {
  const fields = ["NAME", "PHONE", "MRN", "HIDDEN"];
  const state = { dataset: null as any, columns: [] as string[], rules: [] as any[], version: 0, syncs: 0, executions: 0, syncFailure: false };
  await page.addInitScript(() => sessionStorage.setItem("uqp.auth", JSON.stringify({ accessToken: "synthetic-token", user: {
    id: 5, username: "synthetic", displayName: "合成設計者", permissions: ["DESIGN_QUERY", "EXECUTE_QUERY"],
  } })));
  await page.route(url => url.pathname.startsWith("/api/"), async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path === "/api/datasets/datasource-options") { await route.fulfill({ json: { dataSources: [{ id: 4, name: "合成來源", type: sourceType }] } }); return; }
    if (path === "/api/datasets") {
      if (request.method() === "POST") {
        state.dataset = { ...request.postDataJSON(), id: 2, isArchived: false, dataSourceName: "合成來源", dataSourceType: sourceType };
        await route.fulfill({ status: 201, json: { id: 2, parameterNames: [] } }); return;
      }
      await route.fulfill({ json: { datasets: state.dataset ? [state.dataset] : [], total: state.dataset ? 1 : 0, totalPages: 1 } }); return;
    }
    if (path === "/api/datasets/2/columns/sync") {
      expect(request.method()).toBe("POST"); expect(request.postDataJSON()).toEqual({}); expect(state.dataset).not.toBeNull();
      if (state.syncFailure) { await route.fulfill({ status: 409, json: { error: { code: "DATASET_COLUMN_SYNC_CONFLICT", message: "來源版本已變更；欄位同步失敗，既有規則已保留。" } } }); return; }
      state.columns = fields; state.syncs++;
      await route.fulfill({ json: { columns: fields.map((name, index) => ({ name, dataType: "nvarchar(30)", ordinal: index + 1 })),
        trust: "UNBOUND_CANDIDATE", purpose: "DISPLAY_COLUMN_OPTIONS_ONLY", deliveryAllowed: false } }); return;
    }
    if (path === "/api/datasets/2/sensitive-columns") {
      if (request.method() === "PUT") {
        expect(request.postDataJSON().expectedVersion).toBe(state.version);
        state.rules = request.postDataJSON().columns; state.version++;
      }
      await route.fulfill({ json: { columns: state.rules, version: state.version, availableColumns: state.columns.map(name => ({ name })) } }); return;
    }
    if (path.endsWith("/parameters")) { await route.fulfill({ json: { parameters: [] } }); return; }
    if (path.endsWith("/patient-audit-config")) { await route.fulfill({ json: { config: null, version: "0", status: "NOT_CONFIGURED", metadataStatus: "METADATA_UNCONFIRMED", columns: [] } }); return; }
    if (path.endsWith("/preview/run") || path.endsWith("/execute")) state.executions++;
    await route.fulfill({ json: { versions: [] } });
  });
  await page.goto("/designer/datasets");
  await page.getByLabel("代碼", { exact: true }).fill("SYNTHETIC_NEW");
  await page.getByLabel("名稱", { exact: true }).fill("合成新 Dataset");
  await page.getByRole("combobox", { name: "資料來源", exact: true }).selectOption("4");
  await page.locator("textarea").first().fill(sourceType === "SQLSERVER" ? "SELECT 1 AS NAME, 2 AS PHONE, 3 AS MRN, 4 AS HIDDEN" : "SELECT 1 AS NAME, 2 AS PHONE, 3 AS MRN, 4 AS HIDDEN FROM DUAL");
  await page.getByRole("button", { name: "儲存 Dataset", exact: true }).click();
  const policy = page.locator("section").filter({ has: page.getByRole("heading", { name: "Dataset 敏感資料欄位管理", exact: true }) });
  const sync = policy.getByRole("button", { name: "取得並同步欄位清單", exact: true });
  await expect(sync).toBeEnabled();
  await expect(policy.getByRole("combobox", { name: /查詢結果欄位/ }).locator("option")).toHaveCount(1);
  await sync.click();
  await expect(policy.getByText(/欄位清單已同步/)).toBeVisible();
  expect(state.rules).toEqual([]); expect(state.version).toBe(0); expect(state.executions).toBe(0);
  for (const [field, mode] of [["NAME", "自訂遮蔽"], ["PHONE", "顯示原始資料"], ["MRN", "全部遮蔽"], ["HIDDEN", "完全不傳送"]]) {
    await policy.getByRole("combobox", { name: /查詢結果欄位/ }).selectOption(field!);
    await policy.getByRole("radio", { name: mode!, exact: true }).check();
    if (field === "NAME") {
      await policy.getByLabel("保留前幾碼").fill("1"); await policy.getByLabel("保留後幾碼").fill("0");
    }
    await policy.getByRole("button", { name: "加入／更新欄位規則" }).click();
  }
  await expect(sync).toBeDisabled();
  await policy.getByRole("button", { name: "儲存 Dataset 敏感欄位規則", exact: true }).click();
  await expect(policy.getByText(/敏感欄位規則已儲存/)).toBeVisible();
  expect(state.rules.map(r => r.deviceMaskMode)).toEqual(["CUSTOM", "NONE", "FULL", "OMIT"]);
  expect(state.rules.every(r => r.sensitivityType === "OTHER")).toBe(true);
  await page.reload(); await page.getByRole("button", { name: /合成新 Dataset/ }).click();
  await expect(policy.getByRole("cell", { name: "顯示原始資料", exact: true })).toBeVisible();
  await expect(policy.getByRole("row")).toHaveCount(5); expect(state.syncs).toBe(1); expect(state.executions).toBe(0);
  state.syncFailure = true;
  await sync.click(); await expect(policy.getByText(/來源版本已變更/)).toBeVisible();
  await expect(policy.getByRole("row")).toHaveCount(5);
  await page.locator("textarea").first().fill("SELECT 2 AS OTHER");
  await expect(sync).toBeDisabled();
});
