import { test, expect, type Page } from "@playwright/test";
async function setup(page: Page) {
  const version = (n: number) => n.toString(16).padStart(64, "0");
  const state = {
    revision: 1, transitionRevision: 7, active: false, approved: true, fail: "", status: 409,
    created: false, mode: "LEGACY", writes: [] as Array<{ path: string; method: string; body: any }>,
    presentation: { name: "保存名稱", description: "保存說明", displayMode: "TABLE", displayTitle: "保存標題", showClock: false, showPageNumber: false, showCountdown: false },
    primary: { sourceKey: "PRIMARY", queryDefinitionId: 20, parameters: { WARD: "SYNTHETIC", LIST: [1, 2], LEGACY: { keep: true } }, refreshSeconds: 41, pageSeconds: 17, pageSize: 9, maxRows: 123, requiresConversion: false },
    source: { id: 10, sourceKey: "WARD", queryDefinitionId: null as number | null, parameters: {}, refreshSeconds: 30, pageSeconds: 15, pageSize: 10, maxRows: 100, isEnabled: true, bindingState: "PENDING_CONVERSION" },
  };
  const configuration = () => ({ version: version(state.revision), presentation: state.presentation, dashboardMode: state.mode, isActive: state.active, editable: !state.active, primary: state.primary, sources: [state.source], overCapacity: false });
  await page.addInitScript(() => sessionStorage.setItem("uqp.auth", JSON.stringify({ accessToken: "synthetic", user: { id: 1, username: "synthetic", displayName: "測試", permissions: ["DESIGN_QUERY", "VIEW_QUERY", "EXECUTE_QUERY"] } })));
  await page.route(url => url.pathname.startsWith("/api/"), async route => {
    const req = route.request(), path = new URL(req.url()).pathname, method = req.method();
    if (method !== "GET") {
      state.writes.push({ path, method, body: req.postDataJSON() });
      if (/^\/api\/dashboards\/\d+$/.test(path) || path.endsWith("/column-approvals") || path.endsWith("/data-sources")) throw new Error("Legacy write or hard delete is forbidden");
    }
    if (state.fail && path.endsWith(state.fail)) {
      await route.fulfill({ status: state.status, json: { error: { code: state.status === 409 ? "QUERY_SOURCE_VERSION_CONFLICT" : state.status === 403 ? "FORBIDDEN" : "SECURITY_SCHEMA_REQUIRED", message: "private SQL synthetic-secret" } } }); return;
    }
    if (path.endsWith("/configuration")) { await route.fulfill({ json: configuration() }); return; }
    if (path.endsWith("/presentation")) { const { expectedVersion, ...p } = req.postDataJSON(); expect(expectedVersion).toBe(version(state.revision)); Object.assign(state.presentation, p); state.revision++; await route.fulfill({ json: configuration() }); return; }
    if (path.endsWith("/primary")) { const { expectedVersion, ...source } = req.postDataJSON(); expect(expectedVersion).toBe(version(state.revision)); Object.assign(state.primary, source); state.revision++; await route.fulfill({ json: configuration() }); return; }
    if (path.endsWith("/legacy-disable/v1")) {
      if (method === "POST") { expect(req.postDataJSON()).toEqual({ expectedVersion: version(state.transitionRevision), confirmed: true }); state.active = false; state.revision++; }
      await route.fulfill({ json: { dashboardId: 1, mode: "LEGACY", isActive: state.active, version: version(state.transitionRevision), credentialsInvalidated: method === "POST" } }); return;
    }
    if (path.endsWith("/pending-approvals")) {
      if (method === "POST") { expect(req.postDataJSON()).toEqual({ sourceId: 10, expectedVersion: version(state.transitionRevision), confirmed: true }); state.approved = false; state.revision++; }
      await route.fulfill({ json: { dashboardId: 1, sourceId: 10, sourceKey: "WARD", hasApprovals: state.approved, version: version(state.transitionRevision), reapprovalRequired: true } }); return;
    }
    if (path.endsWith("/query-sources/v1")) {
      const body = req.postDataJSON(); expect(body.expectedVersion).toBe(version(state.revision)); expect(body.removals).toEqual([]);
      expect(state.approved).toBe(false); expect(body.upserts[0]).toMatchObject({ id: 10, sourceKey: "WARD" });
      Object.assign(state.source, body.upserts[0], { bindingState: "BOUND" }); state.revision++; await route.fulfill({ json: configuration() }); return;
    }
    if (path.endsWith("/query-mode/v1")) { await route.fulfill({ json: { mode: state.mode, modeVersion: 1, version: version(state.revision) } }); return; }
    if (path.endsWith("/column-approvals")) { await route.fulfill({ json: { dashboardId: 1, isActive: state.active, version: version(state.revision), sources: [{ id: 1, sourceKey: "PRIMARY", datasetId: 3 }, { id: 10, sourceKey: "WARD", datasetId: 3 }], deviceColumnMasks: {}, deviceColumnTypes: {}, deviceSourceColumnMasks: state.approved ? { WARD: { NAME: "FULL" } } : {} } }); return; }
    if (path === "/api/queries") { await route.fulfill({ json: { queries: [{ id: 20, name: "授權 Query", code: "Q20", canExecute: true }, { id: 21, name: "轉換 Query", code: "Q21", canExecute: true }, { id: 22, name: "無權限 Query", code: "Q22", canExecute: false }] } }); return; }
    if (path === "/api/dashboards") {
      if (method === "POST") { const body = req.postDataJSON(); expect(body.isActive).toBe(false); expect(body).not.toHaveProperty("parameters"); expect(body).not.toHaveProperty("maxRows"); state.created = true; state.presentation = { ...state.presentation, ...body }; state.primary.requiresConversion = true; await route.fulfill({ json: { id: 1 } }); return; }
      await route.fulfill({ json: { dashboards: [{ id: 1, code: "SYNTHETIC", name: "清單舊名稱", displayMode: "BIG_SCREEN", showClock: true, queryDefinitionId: 20, parameters: {}, isActive: state.active, refreshSeconds: 5, pageSeconds: 5, pageSize: 1 }], total: 1, totalPages: 1 } }); return;
    }
    if (/\/query-definitions\/\d+$/.test(path)) { await route.fulfill({ json: { queryDefinition: { datasetId: 3 } } }); return; }
    if (path.endsWith("/sensitive-columns")) { await route.fulfill({ json: { version: 1, columns: [{ columnName: "NAME", sensitivityType: "NAME", deviceMaskMode: "FULL" }] } }); return; }
    await route.fulfill({ json: { queries: [], columns: [], devices: [], profiles: [], organizationName: "Synthetic", platformName: "UQP" } });
  });
  return state;
}
async function edit(page: Page) { await page.goto("/designer/dashboards"); await page.getByRole("button", { name: "編輯", exact: true }).click(); await expect(page.getByLabel("名稱", { exact: true })).toHaveValue("保存名稱"); }
const basicSave = (page: Page) => page.getByRole("button", { name: "儲存一般顯示設定（新版）", exact: true });

test("new draft stays inactive and has one explicit authorized seed Query", async ({ page }) => {
  const state = await setup(page); await page.goto("/designer/dashboards");
  await page.getByLabel("代碼", { exact: true }).fill("SYNTHETIC"); await page.getByLabel("名稱", { exact: true }).fill("新草稿");
  await expect(page.getByLabel("草稿初始 Query").locator("option[value='22']")).toHaveCount(0);
  await page.getByLabel("草稿初始 Query").selectOption("20"); await page.getByRole("button", { name: "建立 Dashboard", exact: true }).click();
  await expect(page.getByText(/已建立停用草稿/)).toBeVisible(); expect(state.created).toBe(true);
  expect(state.writes).toHaveLength(1); expect(state.writes[0]!.body).toMatchObject({ isActive: false, code: "SYNTHETIC", queryDefinitionId: 20 });
  await expect(page.getByRole("checkbox", { name: "啟用 Dashboard", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "刪除", exact: true })).toHaveCount(0);
  await expect(page.getByText(/PRIMARY 尚未完成新版資料來源轉換/)).toBeVisible();
});

test("presentation loads canonical values and saves only its persistent fields", async ({ page }) => {
  const state = await setup(page); await edit(page);
  await expect(page.getByLabel("顯示系統時間", { exact: true })).not.toBeChecked(); await expect(page.getByLabel("顯示模式", { exact: true })).toHaveValue("TABLE");
  expect(state.writes).toEqual([]); await page.getByLabel("名稱", { exact: true }).fill("更新名稱"); await page.getByLabel("播放標題", { exact: true }).fill("更新標題");
  await basicSave(page).click(); await expect(page.getByText(/一般顯示設定已儲存/)).toBeVisible();
  expect(Object.keys(state.writes[0]!.body).sort()).toEqual(["expectedVersion", "name", "description", "displayMode", "displayTitle", "showClock", "showPageNumber", "showCountdown"].sort());
  expect(state.primary.refreshSeconds).toBe(41); expect(state.primary.parameters.LIST).toEqual([1, 2]);
  await page.reload(); await page.getByRole("button", { name: "編輯", exact: true }).click(); await expect(page.getByLabel("名稱", { exact: true })).toHaveValue("更新名稱"); await expect(page.getByLabel("播放標題", { exact: true })).toHaveValue("更新標題");
});

test("PRIMARY persists Query parameters maxRows and timing through v1 and reload", async ({ page }) => {
  const state = await setup(page); await edit(page); await page.getByRole("button", { name: "編輯 PRIMARY", exact: true }).click();
  await expect(page.getByLabel("更新秒數", { exact: true })).toHaveValue("41");
  await page.getByLabel("已發布 Query", { exact: true }).selectOption("21");
  await page.getByLabel("更新秒數", { exact: true }).fill("55"); await page.getByLabel("換頁秒數", { exact: true }).fill("23"); await page.getByLabel("每頁筆數", { exact: true }).fill("11"); await page.getByLabel("資料量上限", { exact: true }).fill("456");
  await page.getByRole("textbox", { name: "查詢參數 JSON", exact: true }).fill('{"WARD":"NEW","LIST":[1,2],"LEGACY":{"keep":true}}');
  await page.getByRole("button", { name: "儲存目前來源", exact: true }).click(); await expect(page.getByText("設定已儲存。", { exact: true })).toBeVisible();
  expect(state.writes[0]!.path).toMatch(/\/primary$/); expect(state.primary).toMatchObject({ queryDefinitionId: 21, refreshSeconds: 55, pageSeconds: 23, pageSize: 11, maxRows: 456 });
  await page.reload(); await page.getByRole("button", { name: "編輯", exact: true }).click(); await page.getByRole("button", { name: "編輯 PRIMARY", exact: true }).click();
  await expect(page.getByLabel("更新秒數", { exact: true })).toHaveValue("55"); await expect(page.getByLabel("每頁筆數", { exact: true })).toHaveValue("11"); await expect(page.getByLabel("資料量上限", { exact: true })).toHaveValue("456");
  await expect(page.getByRole("spinbutton", { name: "快照秒數（選填）", exact: true })).toHaveCount(0);
});

test("Legacy disable confirms the latest dedicated version and cannot re-enable or modify settings", async ({ page }) => {
  const state = await setup(page); state.active = true; await page.goto("/designer/dashboards?dashboardId=1");
  const stop = page.getByRole("button", { name: "安全停用 Legacy Dashboard（撤銷裝置憑證）", exact: true }); await expect(stop).toBeVisible();
  page.once("dialog", d => void d.dismiss()); await stop.click(); await expect(stop).toBeEnabled(); expect(state.writes).toEqual([]);
  state.transitionRevision = 8; page.once("dialog", d => void d.accept()); await stop.click();
  await expect(page.getByText(/Legacy Dashboard 已安全停用/)).toBeVisible(); expect(state.active).toBe(false); expect(state.writes).toHaveLength(1);
  expect(state.writes[0]!.path).toMatch(/legacy-disable\/v1$/); expect(Object.keys(state.writes[0]!.body).sort()).toEqual(["confirmed", "expectedVersion"]);
  await expect(stop).toHaveCount(0); expect(state.presentation.name).toBe("保存名稱");
});

test("pending approval revoke is confirmed and followed by explicit Query selection and reapproval notice", async ({ page }) => {
  const state = await setup(page); await edit(page);
  const revoke = page.getByRole("button", { name: "撤銷 WARD 舊核准", exact: true });
  page.once("dialog", d => void d.dismiss()); await revoke.click(); await expect(revoke).toBeEnabled(); expect(state.approved).toBe(true); expect(state.writes).toEqual([]);
  state.transitionRevision = 9; page.once("dialog", d => void d.accept()); await revoke.click(); await expect(page.getByText(/此來源舊核准已撤銷/)).toBeVisible();
  expect(state.approved).toBe(false); expect(state.source.queryDefinitionId).toBeNull();
  await page.getByRole("button", { name: "編輯 WARD", exact: true }).click(); await expect(page.getByLabel("已發布 Query", { exact: true })).toHaveValue("");
  await page.getByRole("button", { name: "儲存目前來源", exact: true }).click(); expect(state.writes).toHaveLength(1);
  await page.getByLabel("已發布 Query", { exact: true }).selectOption("21"); page.once("dialog", d => void d.accept()); await page.getByRole("button", { name: "儲存目前來源", exact: true }).click();
  await expect(page.getByText(/來源已轉換；敏感欄位需要重新核准/)).toBeVisible(); expect(state.source).toMatchObject({ id: 10, sourceKey: "WARD", queryDefinitionId: 21 }); expect(state.active).toBe(false); expect(state.approved).toBe(false);
});

test("version conflict preserves draft and requires reload without automatic overwrite", async ({ page }) => {
  const state = await setup(page); await edit(page); await page.getByLabel("名稱", { exact: true }).fill("尚未儲存草稿"); state.fail = "/presentation";
  await basicSave(page).click(); await expect(page.getByText(/設定未完成：QUERY_SOURCE_VERSION_CONFLICT/).first()).toBeVisible();
  await expect(page.getByLabel("名稱", { exact: true })).toHaveValue("尚未儲存草稿"); await expect(basicSave(page)).toBeDisabled(); expect(state.writes).toHaveLength(1);
  state.fail = ""; state.revision++; state.presentation.name = "其他管理者名稱";
  page.once("dialog", d => void d.accept()); await page.getByRole("button", { name: "重新載入基本設定", exact: true }).click();
  await expect(page.getByLabel("名稱", { exact: true })).toHaveValue("其他管理者名稱"); expect(state.writes).toHaveLength(1);
  await basicSave(page).click(); await expect(page.getByText(/一般顯示設定已儲存/)).toBeVisible(); expect(state.writes).toHaveLength(2);
});

for (const status of [403, 503]) test(`API ${status} rejects source save without false success or Legacy fallback`, async ({ page }) => {
  const state = await setup(page); await edit(page); await page.getByRole("button", { name: "編輯 PRIMARY", exact: true }).click(); state.status = status; state.fail = "/primary";
  await page.getByRole("button", { name: "儲存目前來源", exact: true }).click(); await expect(page.getByText(/設定未完成：/).last()).toBeVisible();
  await expect(page.getByText("設定已儲存。", { exact: true })).toHaveCount(0); await expect(page.locator("body")).not.toContainText("private SQL synthetic-secret");
  await expect(page.getByRole("button", { name: "儲存目前來源", exact: true })).toBeDisabled(); expect(state.writes).toHaveLength(1);
});

test("missing managed configuration fails closed without default-value writes", async ({ page }) => {
  const state = await setup(page); state.fail = "/configuration"; state.status = 503;
  await page.goto("/designer/dashboards?dashboardId=1"); await expect(basicSave(page)).toBeDisabled(); await expect(page.getByText(/SECURITY_SCHEMA_REQUIRED/).first()).toBeVisible();
  expect(state.writes).toEqual([]); await expect(page.getByRole("button", { name: "儲存修改", exact: true })).toHaveCount(0);
});

test("Legacy disable permission refusal never reports success and reload never retries the mutation", async ({ page }) => {
  const state = await setup(page); state.active = true;
  await page.goto("/designer/dashboards?dashboardId=1");
  const stop = page.getByRole("button", { name: "安全停用 Legacy Dashboard（撤銷裝置憑證）", exact: true });
  await expect(stop).toBeVisible();
  // The read succeeds; permission is revoked immediately after the explicit confirmation.
  page.once("dialog", async d => { state.fail = "/legacy-disable/v1"; state.status = 403; await d.accept(); });
  await stop.click(); await expect(page.getByRole("region", { name: "Legacy 安全停用" }).getByText(/FORBIDDEN/)).toBeVisible();
  expect(state.active).toBe(true); expect(state.writes).toHaveLength(1);
  await expect(page.getByText(/Legacy Dashboard 已安全停用/)).toHaveCount(0);
  state.fail = ""; await page.getByRole("button", { name: "重新載入 Legacy 停用狀態", exact: true }).click();
  await expect(stop).toBeEnabled(); expect(state.writes).toHaveLength(1);
});

test("pending revoke conflict locks source writes and never silently converts or clears approvals", async ({ page }) => {
  const state = await setup(page); await edit(page);
  const revoke = page.getByRole("button", { name: "撤銷 WARD 舊核准", exact: true });
  page.once("dialog", async d => { state.fail = "/pending-approvals"; await d.accept(); });
  await revoke.click(); await expect(page.getByText(/設定未完成：QUERY_SOURCE_VERSION_CONFLICT/).first()).toBeVisible();
  expect(state.approved).toBe(true); expect(state.source.queryDefinitionId).toBeNull(); expect(state.writes).toHaveLength(1);
  await expect(page.getByText(/此來源舊核准已撤銷/)).toHaveCount(0); await expect(page.getByRole("button", { name: "儲存目前來源", exact: true })).toBeDisabled();
});

test("failed explicit conversion keeps previously revoked approvals revoked", async ({ page }) => {
  const state = await setup(page); await edit(page); page.on("dialog", d => void d.accept());
  await page.getByRole("button", { name: "撤銷 WARD 舊核准", exact: true }).click(); await expect(page.getByText(/此來源舊核准已撤銷/)).toBeVisible();
  await page.getByRole("button", { name: "編輯 WARD", exact: true }).click(); await page.getByLabel("已發布 Query", { exact: true }).selectOption("21");
  state.fail = "/query-sources/v1"; state.status = 403;
  await page.getByRole("button", { name: "儲存目前來源", exact: true }).click(); await expect(page.getByText(/FORBIDDEN/).first()).toBeVisible();
  expect(state.approved).toBe(false); expect(state.source.queryDefinitionId).toBeNull(); expect(state.active).toBe(false); expect(state.writes).toHaveLength(2);
  await expect(page.getByText(/來源已轉換；敏感欄位需要重新核准/)).toHaveCount(0);
});
