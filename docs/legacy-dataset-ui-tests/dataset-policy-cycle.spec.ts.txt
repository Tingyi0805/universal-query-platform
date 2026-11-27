import { test, expect, type Page } from "@playwright/test";
import { applyDatasetDeliveryPolicy } from "../../server/src/modules/dataset/datasetDeliveryPolicy.js";

async function setup(page: Page, options: { parameter?: boolean; empty?: boolean; zeroRows?: boolean } = {}) {
  const names = options.empty ? ["VALUE"] : ["NAME", "PHONE", "MRN", "SECRET"];
  const state = { dataset: null as any, synced: false, rules: [] as any[], version: 0, metadataCalls: 0, rowsExecuted: 0,
    policyReadFailure: true, syncError: false, optionsAllowed: 0, previewResponses: [] as any[] };
  await page.addInitScript(() => sessionStorage.setItem("uqp.auth", JSON.stringify({ accessToken: "synthetic-token", user: {
    id: 5, username: "synthetic", displayName: "合成設計者", permissions: ["DESIGN_QUERY", "EXECUTE_QUERY"],
  } })));
  await page.route(url => url.pathname.startsWith("/api/"), async route => {
    const req = route.request(), path = new URL(req.url()).pathname;
    const failure = (code: string, message: string) => route.fulfill({ status: 409, json: { error: { code, message, requestId: "synthetic-cycle-request" } } });
    if (path.endsWith("/datasource-options")) { await route.fulfill({ json: { dataSources: [{ id: 4, name: "合成來源", type: "SQLSERVER" }] } }); return; }
    if (path === "/api/datasets") {
      if (req.method() === "POST") { state.dataset = { ...req.postDataJSON(), id: 2, isArchived: false }; await route.fulfill({ json: { id: 2, parameterNames: options.parameter ? ["REGNO"] : [] } }); return; }
      await route.fulfill({ json: { datasets: state.dataset ? [state.dataset] : [], total: state.dataset ? 1 : 0, totalPages: 1 } }); return;
    }
    if (path.endsWith("/sensitive-columns")) {
      if (req.method() === "PUT") { expect(req.postDataJSON().expectedVersion).toBe(state.version); state.rules = req.postDataJSON().columns; state.version++; }
      else if (state.policyReadFailure && !state.synced) { await failure("DATASET_DELIVERY_POLICY_UNCONFIRMED", "敏感政策尚未確認"); return; }
      await route.fulfill({ json: { columns: state.rules, version: state.version, availableColumns: state.synced ? names.map(name => ({ name })) : [] } }); return;
    }
    if (path.endsWith("/columns/sync")) {
      expect(req.postDataJSON()).toEqual({}); // No preview inputs/defaults enter discovery.
      if (state.syncError) { await failure("DATASET_COLUMN_DESCRIPTION_UNSUPPORTED", "無法安全描述 SQL 或參數，請檢查 CAST 與參數定義。"); return; }
      state.metadataCalls++; state.synced = true;
      const body = { columns: names.map((name, index) => ({ name, dataType: "nvarchar(30)", ordinal: index + 1 })),
        trust: "UNBOUND_CANDIDATE", purpose: "DISPLAY_COLUMN_OPTIONS_ONLY", deliveryAllowed: false };
      expect(JSON.stringify(body)).not.toContain("SYNTHETIC_PRIVATE_DEFAULT");
      expect(body).not.toHaveProperty("rows"); await route.fulfill({ json: body }); return;
    }
    if (path.endsWith("/parameters")) {
      await route.fulfill({ json: { parameters: options.parameter ? [{ id: 1, datasetId: 2, name: "REGNO", label: "篩選條件", dataType: "STRING",
        controlType: "SELECT", isRequired: true, defaultValue: "SYNTHETIC_PRIVATE_DEFAULT", displayOrder: 0, optionMode: "FIXED", fixedOptionsJson: '[{"value":"10","label":"合成選項"}]' }] : [],
        preview: { detected: options.parameter ? ["REGNO"] : [], added: [], retained: options.parameter ? ["REGNO"] : [], unused: [], detectionStatus: "OK", previewToken: "a".repeat(64) } } }); return;
    }
    if (path.endsWith("/parameters/REGNO/options")) {
      if (!state.version) { await failure("DATASET_DELIVERY_POLICY_UNCONFIRMED", "選項需先儲存政策"); return; }
      state.optionsAllowed++; await route.fulfill({ json: { options: [{ value: "10", label: "合成選項" }] } }); return;
    }
    if (path.endsWith("/patient-audit-config")) { await route.fulfill({ json: { config: null, version: "0", status: "NOT_CONFIGURED", metadataStatus: "METADATA_UNCONFIRMED", columns: [] } }); return; }
    if (path.endsWith("/design-preview/context")) {
      if (!state.version) { await failure("DATASET_DELIVERY_POLICY_UNCONFIRMED", "敏感政策尚未確認"); return; }
      await route.fulfill({ json: { datasetId: 2, definitionVersion: "0000000000000001" } }); return;
    }
    if (path.endsWith("/preview/run")) {
      if (!state.version) { await failure("DATASET_DELIVERY_POLICY_UNCONFIRMED", "敏感政策尚未確認"); return; }
      if (options.parameter) expect(req.postDataJSON().values.REGNO).toBe("10");
      state.rowsExecuted++;
      const raw = options.empty ? { VALUE: "SYNTHETIC_VALUE" } : { NAME: "王小明", PHONE: "0900123456", MRN: "SYNTHETIC_RAW_ID", SECRET: "SYNTHETIC_RAW_HIDDEN" };
      const safe = applyDatasetDeliveryPolicy({ policy: { state: "CONFIRMED", version: String(state.version),
        rules: state.rules.map(rule => ({ columnName: rule.columnName, mode: rule.deviceMaskMode, customMask: rule.customMask })) },
        columns: names.map(name => ({ name })), rows: options.zeroRows ? [] : [raw] });
      const result = { ...safe, rowCount: options.zeroRows ? 0 : 1, elapsedMs: 1, truncated: false };
      state.previewResponses.push(result);
      await route.fulfill({ json: { result, parameterNames: options.parameter ? ["REGNO"] : [] } }); return;
    }
    await route.fulfill({ json: { versions: [] } });
  });
  await page.goto("/designer/datasets");
  await page.getByLabel("代碼", { exact: true }).fill("SYNTHETIC_CYCLE");
  await page.getByLabel("名稱", { exact: true }).fill("合成循環驗證");
  await page.getByRole("combobox", { name: "資料來源", exact: true }).selectOption("4");
  await page.locator("textarea").first().fill(options.parameter ? "SELECT NAME,PHONE,MRN,SECRET FROM T WHERE ID={{REGNO}}" : "SELECT VALUE FROM T");
  await page.getByRole("button", { name: "儲存 Dataset", exact: true }).click();
  const policy = page.locator("section").filter({ has: page.getByRole("heading", { name: "Dataset 敏感資料欄位管理", exact: true }) });
  await expect(policy.getByText(/DATASET_DELIVERY_POLICY_UNCONFIRMED/)).toBeVisible();
  return { state, policy };
}

test("new parameterized Dataset escapes policy/options cycle: metadata, four rules, then masked preview", async ({ page }) => {
  const { state, policy } = await setup(page, { parameter: true });
  await policy.getByRole("button", { name: "取得並同步欄位清單" }).click();
  await expect(policy.getByText(/欄位清單已同步/)).toBeVisible();
  expect(state.rowsExecuted).toBe(0); expect(state.rules).toEqual([]);
  for (const [field, mode] of [["NAME", "自訂遮蔽"], ["PHONE", "顯示原始資料"], ["MRN", "全部遮蔽"], ["SECRET", "完全不傳送"]]) {
    await policy.getByRole("combobox", { name: /查詢結果欄位/ }).selectOption(field!);
    await policy.getByRole("radio", { name: mode!, exact: true }).check();
    if (field === "NAME") { await policy.getByLabel("保留前幾碼").fill("1"); await policy.getByLabel("保留後幾碼").fill("0"); }
    await policy.getByRole("button", { name: "加入／更新欄位規則" }).click();
  }
  await policy.getByRole("button", { name: "儲存 Dataset 敏感欄位規則", exact: true }).click();
  await expect.poll(() => state.optionsAllowed).toBeGreaterThan(0);
  await page.getByRole("combobox", { name: "篩選條件", exact: true }).selectOption("10");
  await page.getByRole("button", { name: "執行預覽", exact: true }).click();
  await expect(page.getByText(/預覽完成：1 筆/)).toBeVisible();
  expect(state.previewResponses[0].rows).toEqual([{ NAME: "王**", PHONE: "0900123456", MRN: "○○○○" }]);
  const before = structuredClone(state.rules);
  await policy.getByRole("button", { name: "取得並同步欄位清單" }).click();
  await expect.poll(() => state.metadataCalls).toBe(2); expect(state.rules).toEqual(before);
});

for (const zeroRows of [false, true]) test(`explicit empty sensitive policy previews only named raw fields (zeroRows=${zeroRows})`, async ({ page }) => {
  const { state, policy } = await setup(page, { empty: true, zeroRows });
  await page.getByRole("button", { name: "執行預覽", exact: true }).click();
  expect(state.rowsExecuted).toBe(0);
  await policy.getByRole("button", { name: "取得並同步欄位清單" }).click();
  await expect(policy.getByText(/欄位清單已同步/)).toBeVisible();
  await policy.getByRole("checkbox", { name: /明確確認空政策/ }).check();
  await policy.getByRole("button", { name: "儲存 Dataset 敏感欄位規則", exact: true }).click();
  await expect(policy.getByText(/敏感欄位規則已儲存/)).toBeVisible();
  expect(state.rules).toEqual([{ columnName: "VALUE", sensitivityType: "OTHER", deviceMaskMode: "NONE", customMask: null }]);
  await page.getByRole("button", { name: "執行預覽", exact: true }).click();
  await expect(page.getByText(new RegExp(`預覽完成：${zeroRows ? 0 : 1} 筆`))).toBeVisible();
  expect(state.previewResponses[0].columns.map((c: any) => c.name)).toEqual(["VALUE"]);
  expect(state.previewResponses[0].rows).toEqual(zeroRows ? [] : [{ VALUE: "SYNTHETIC_VALUE" }]);
});

test("metadata failure is traceable and does not execute data or clear settings", async ({ page }) => {
  const { state, policy } = await setup(page);
  state.syncError = true;
  await policy.getByRole("button", { name: "取得並同步欄位清單" }).click();
  await expect(policy.getByText(/DATASET_COLUMN_DESCRIPTION_UNSUPPORTED/)).toBeVisible();
  await expect(policy.getByText(/synthetic-cycle-request/)).toBeVisible();
  expect(state.rowsExecuted).toBe(0); expect(state.rules).toEqual([]);
});
