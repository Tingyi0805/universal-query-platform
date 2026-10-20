import { test, expect, type Page } from "@playwright/test";
const rawName = "合成患者甲", rawMrn = "SYNTHETIC987654";
async function setup(page: Page, managed = false, canManage = true) {
  const state = { legacyPreviewRequests: 0, bindingFailure: false, schemaMissing: false, active: false, persisted: null as any, approval: null as any, conflict: false, version: "a".repeat(64), authFail: false, fail: false, primaryFail: false, extraFail: false, saved: null as any };
  const dashboard = { id: 1, code: "SYNTHETIC", name: "合成保護看板", queryDefinitionId: 2, refreshSeconds: 30, displayMode: "TABLE", pageSize: 5, pageSeconds: 10,
    showClock: false, showPageNumber: false, showCountdown: false, isActive: false,
    parameters: { WARD: "OR01", LIST: [1, 2], LEGACY: { keep: true }, deviceColumnMasks: { NAME: "NAME", MRN: "FULL", ROOM: "NONE" }, deviceColumnTypes: { NAME: "NAME", MRN: "MRN", ROOM: "OTHER" }, snapshotKind: "OTHER", snapshotSeconds: 60, deviceSourceColumnMasks: {} as Record<string, Record<string, string>> } };
  state.persisted = dashboard.parameters;
  const result = { columns: [{ name: "NAME" }, { name: "MRN" }, { name: "ROOM" }], rows: [{ NAME: "○○○○", MRN: "*************54", ROOM: "OR01" }], rowCount: 1, elapsedMs: 1, truncated: false };
  await page.addInitScript(manage => sessionStorage.setItem("uqp.auth", JSON.stringify({ accessToken: "synthetic-token", user: { id: 5, username: "synthetic", displayName: "測試", permissions: manage ? ["DESIGN_QUERY", "EXECUTE_QUERY"] : ["VIEW_QUERY", "EXECUTE_QUERY"] } })), canManage);
  await page.route(url => url.pathname.startsWith("/api/"), async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/dashboards/1" && ["PUT", "DELETE"].includes(route.request().method())) throw new Error("FORBIDDEN_LEGACY_WRITE");
    if (path.endsWith("/column-approvals")) {
      if (state.schemaMissing) { await route.fulfill({ status: 503, json: { error: { code: "SECURITY_SCHEMA_REQUIRED", message: "SQL private Bind" } } }); return; }
      if (route.request().method() === "PATCH") {
        const body = route.request().postDataJSON();
        if (state.conflict || body.expectedVersion !== state.version) { await route.fulfill({ status: 409, json: { error: { code: "DASHBOARD_APPROVAL_VERSION_CONFLICT", message: "private SQL Bind Token" } } }); return; }
        if (state.active) { await route.fulfill({ status: 409, json: { error: { code: "DASHBOARD_APPROVAL_REQUIRES_DISABLED" } } }); return; }
        state.approval = body;
        const current: Record<string, string> = body.sourceKey === "PRIMARY" ? dashboard.parameters.deviceColumnMasks : dashboard.parameters.deviceSourceColumnMasks[body.sourceKey] ?? {};
        const next = { ...current, ...body.upsert }; for (const key of body.remove) delete next[key];
        if (body.sourceKey === "PRIMARY") dashboard.parameters.deviceColumnMasks = next as typeof dashboard.parameters.deviceColumnMasks;
        else dashboard.parameters.deviceSourceColumnMasks[body.sourceKey] = next;
        state.version = (BigInt("0x" + state.version) + 1n).toString(16).padStart(64, "0");
      }
      await route.fulfill({ json: { version: state.version, dashboardId: 1, isActive: state.active,
        sources: [{ id: 1, sourceKey: "PRIMARY", datasetId: 3 }, { id: 5, sourceKey: "WARD", datasetId: 3 }],
        deviceColumnMasks: dashboard.parameters.deviceColumnMasks, deviceColumnTypes: dashboard.parameters.deviceColumnTypes, deviceSourceColumnMasks: dashboard.parameters.deviceSourceColumnMasks } }); return;
    }
    if (path.endsWith("/query-sources/v1/configuration") && managed) {
      if (state.schemaMissing) { await route.fulfill({ status: 503, json: { error: { code: "SECURITY_SCHEMA_REQUIRED", message: "SQL private Bind" } } }); return; }
      const { deviceColumnMasks, deviceColumnTypes, deviceSourceColumnMasks, snapshotKind, snapshotSeconds, ...parameters } = dashboard.parameters;
      const primary = { sourceKey: "PRIMARY", queryDefinitionId: 2, parameters, pageSize: 5, pageSeconds: 10, refreshSeconds: 30, maxRows: 100 };
      await route.fulfill({ json: { version: state.version, editable: !state.active, isActive: state.active, dashboardMode: "QUERY_ONLY_DISABLED", presentation: { name: dashboard.name, description: null, displayMode: dashboard.displayMode, displayTitle: null, showClock: false, showPageNumber: false, showCountdown: false }, primary, sources: [{ ...primary, id: 5, sourceKey: "WARD", isEnabled: true }] } }); return;
    }
    if (path.endsWith("/query-sources/v1/primary")) {
      const body = route.request().postDataJSON();
      if (body.queryDefinitionId !== 2 || state.bindingFailure) { await route.fulfill({ status: 409, json: { error: { code: "DASHBOARD_APPROVAL_BINDING_CHANGED" } } }); return; }
      if (body.expectedVersion !== state.version) { await route.fulfill({ status: 409, json: { error: { code: "QUERY_SOURCE_VERSION_CONFLICT" } } }); return; }
      state.saved = body; Object.assign(dashboard.parameters, body.parameters); state.version = (BigInt("0x" + state.version) + 1n).toString(16).padStart(64, "0");
      await route.fulfill({ json: { version: state.version } }); return;
    }
    if (path.endsWith("/query-sources/v1/disclosure")) {
      const body = route.request().postDataJSON();
      if (state.conflict || body.expectedVersion !== state.version) { await route.fulfill({ status: 409, json: { error: { code: "QUERY_SOURCE_VERSION_CONFLICT" } } }); return; }
      if (state.active) { await route.fulfill({ status: 409, json: { error: { code: "QUERY_SOURCE_DASHBOARD_MUST_BE_INACTIVE" } } }); return; }
      state.approval = body; state.version = (BigInt("0x" + state.version) + 1n).toString(16).padStart(64, "0");
      if (body.sourceKey === "PRIMARY") dashboard.parameters.deviceColumnMasks = body.masks;
      else dashboard.parameters.deviceSourceColumnMasks[body.sourceKey] = body.masks;
      await route.fulfill({ json: { version: state.version } }); return;
    }
    if (path.endsWith("/query-sources/v1/configuration") || path.endsWith("/query-mode/v1")) { await route.fulfill({ status: 503, json: { error: { code: "QUERY_SOURCE_MANAGEMENT_DISABLED" } } }); return; }
    if (path === "/api/dashboards") { await route.fulfill({ json: { dashboards: [dashboard], total: 1, totalPages: 1 } }); return; }
    if (path === "/api/queries") { await route.fulfill({ json: { queries: [{ id: 2, code: "Q", name: "合成 Query", canExecute: true }, { id: 3, code: "OTHER", name: "另一合成 Query", canExecute: true }] } }); return; }
    if (path === "/api/query-definitions") { await route.fulfill({ json: { queryDefinitions: [{ id: 2, datasetId: 3, name: "合成 Query", code: "Q", isPublished: true, isActive: true, isArchived: false }, { id: 3, datasetId: 3, name: "另一合成 Query", code: "OTHER", isPublished: true, isActive: true, isArchived: false }] } }); return; }
    if (path === "/api/query-definitions/2") { await route.fulfill({ json: { queryDefinition: { id: 2, datasetId: 3 } } }); return; }
    if (path === "/api/query-definitions/2/report-columns") { await route.fulfill({ json: { columns: ["NAME", "MRN", "ROOM"].map(columnName => ({ columnName })) } }); return; }
    if (path === "/api/datasets/3/parameters") { await route.fulfill({ json: { parameters: [{ name: "WARD", label: "合成病區", dataType: "STRING", defaultValue: "OR01", isRequired: true }], preview: { detected: ["WARD"] } } }); return; }
    if (path === "/api/datasets/3/sensitive-columns") { await route.fulfill({ json: { version: 1, columns: [{ columnName: "NAME", sensitivityType: "NAME", deviceMaskMode: "FULL" }, { columnName: "MRN", sensitivityType: "MRN", deviceMaskMode: "CUSTOM", customMask: { prefix: 0, suffix: 2, symbol: "*" } }, { columnName: "SECRET", sensitivityType: "HEALTH", deviceMaskMode: "OMIT" }] } }); return; }
    if (path.endsWith("/data-sources")) { await route.fulfill({ json: { sources: [{ sourceKey: "WARD", datasetId: 3, isEnabled: true, refreshSeconds: 30 }] } }); return; }
    if (path.endsWith("/layout")) { await route.fulfill({ json: { profiles: [{ id: 1, dashboardId: 1, name: "合成版型", isDefault: true, sortOrder: 0, canvasWidth: 1920, canvasHeight: 1080, config: {}, widgets: [
      { id: 1, widgetType: "TABLE", title: null, x: 0, y: 0, width: 800, height: 500, fontSize: 20, alignment: "LEFT", config: { dataSourceKey: "PRIMARY" }, sortOrder: 0, sourceKey: null },
      { id: 2, widgetType: "TEXT", title: null, x: 0, y: 500, width: 800, height: 60, fontSize: 20, alignment: "LEFT", config: {}, sortOrder: 1, sourceKey: null, staticText: "固定合成標題" },
    ] }] } }); return; }
    if (path.endsWith("/preview")) state.legacyPreviewRequests++;
    if (path.endsWith("/preview") || /query-sources\/v1\/[^/]+\/page$/.test(path)) {
      const extra = path.includes("/data-sources/") || (path.includes("/query-sources/v1/") && !path.includes("/PRIMARY/"));
      if (state.authFail) { await route.fulfill({ status: 403, json: { error: { code: "FORBIDDEN", message: "private Bind patient Token" } } }); return; }
      if (state.fail || (extra ? state.extraFail : state.primaryFail)) { await route.fulfill({ status: extra ? 403 : 503, json: { error: { code: extra ? "DASHBOARD_EXECUTE_FORBIDDEN" : "PATIENT_AUDIT_FAILED", message: "driver SQL Bind patient password Token" } } }); return; }
      const { parameters: _private, ...safeDashboard } = dashboard;
      const body = path.endsWith("/page") ? { page: 1, totalPages: 1, snapshotId: "11111111-1111-4111-8111-111111111111", query: { id: 2, code: "Q", name: "合成預覽" }, refreshSeconds: 30, pageSize: 5, pageSeconds: 10, result } : extra ? { sourceKey: "WARD", pageSize: 5, pageSeconds: 10, refreshSeconds: 30, result } : { dashboard: safeDashboard, reportColumns: [], result, disclosureId: 1 };
      expect(JSON.stringify(body)).not.toContain(rawName); expect(JSON.stringify(body)).not.toContain(rawMrn);
      await route.fulfill({ json: body }); return;
    }
    await route.fulfill({ json: { devices: [], profiles: [], columns: [], queries: [] } });
  });
  return state;
}
test("list preview shows masked values and refresh failure clears previous rows", async ({ page }) => {
  const state = await setup(page, true);
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
  const state = await setup(page, true); await page.goto("/designer/dashboards");
  await page.getByRole("button", { name: "編輯", exact: true }).first().click();
  await expect(page.getByText("NAME：全部遮蔽", { exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: /^核准欄位/ }).selectOption("NAME");
  const modes = page.getByRole("combobox", { name: /^欄位遮蔽模式/ });
  await expect(modes.locator('option[value="NONE"]')).toHaveAttribute("disabled", ""); await expect(modes.locator('option[value="NAME"]')).toHaveAttribute("disabled", "");
  await modes.selectOption("FULL"); await page.getByRole("button", { name: "加入／更新 Dashboard 欄位規則", exact: true }).click();
  await page.getByRole("button", { name: "編輯 PRIMARY", exact: true }).click();
  await page.getByRole("textbox", { name: "查詢參數 JSON", exact: true }).fill('{"WARD":"OR02","LIST":[1,2],"LEGACY":{"keep":true}}');
  await page.getByRole("button", { name: "儲存目前來源", exact: true }).click();
  await expect.poll(() => state.saved).not.toBeNull();
  expect(state.saved.parameters).toMatchObject({ WARD: "OR02", LIST: [1, 2], LEGACY: { keep: true } });
  expect(state.persisted.snapshotKind).toBe("OTHER"); expect(state.persisted.snapshotSeconds).toBe(60);
  expect(state.persisted.deviceColumnMasks).toEqual({ NAME: "FULL", MRN: "FULL", ROOM: "NONE" });
});
test("layout identifies failing PRIMARY and extra source without showing driver text or old values", async ({ page }) => {
  const state = await setup(page, true); state.primaryFail = true; state.extraFail = true;
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
  const state = await setup(page, true); state.extraFail = true;
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

test("CUSTOM inheritance and source approvals save/reload without copying custom configuration or changing other JSON", async ({ page }) => {
  const state = await setup(page, true); page.on("dialog", dialog => void dialog.accept());
  await page.goto("/designer/dashboards"); await page.getByRole("button", { name: "編輯", exact: true }).first().click();
  // Wait for the asynchronously fetched, fail-closed Dataset policy and approvals before asserting modes.
  await expect(page.getByText("MRN：沿用 Dataset CUSTOM（既有設定）", { exact: false })).toBeVisible();
  await expect(page.getByText("尚未確認 Dataset 保護；暫停欄位規則編輯。")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "重新載入核准版本" })).toBeEnabled();
  await page.getByRole("combobox", { name: /^核准欄位/ }).selectOption("MRN");
  const modes = page.getByRole("combobox", { name: /^欄位遮蔽模式/ });
  // Safe CI diagnostics: record only UI readiness, no patient values, SQL, credentials or tokens.
  const modeState = await page.evaluate(() => {
    const field = Array.from(document.querySelectorAll("select")).find(s => s.labels?.[0]?.textContent?.includes("欄位遮蔽模式"));
    const option = field?.querySelector('option[value="INHERIT"]');
    return { selectedColumn: (document.querySelector('select')?.value ?? "").slice(0, 16),
      modeDisabled: (option as HTMLOptionElement | null)?.disabled ?? null,
      editButtonDisabled: Array.from(document.querySelectorAll("button")).find(b => b.textContent?.includes("加入／更新 Dashboard 欄位規則"))?.disabled ?? null,
      policyVisible: document.body.textContent?.includes("MRN：沿用 Dataset CUSTOM") ?? false,
      status: Array.from(document.querySelectorAll('[role="status"],[role="alert"]')).map(e => e.textContent?.slice(0, 100)).filter(Boolean) };
  });
  if (modeState.modeDisabled) console.log("CUSTOM_INHERIT_READINESS", JSON.stringify(modeState));
  await expect(modes.locator('option[value="INHERIT"]')).not.toHaveAttribute("disabled", "");
  await expect(modes.locator('option[value="MRN"]')).toHaveAttribute("disabled", "");
  await modes.selectOption("INHERIT"); await expect(page.getByText(/合成資料預覽：\*{8}56/)).toBeVisible();
  await page.getByRole("button", { name: "加入／更新 Dashboard 欄位規則", exact: true }).click();
  await page.getByLabel("遮蔽核准來源", { exact: true }).selectOption("WARD");
  await expect(page.getByText(/Dataset 最低保護規則（WARD）/)).toBeVisible();
  await page.getByRole("combobox", { name: /^核准欄位/ }).selectOption("MRN");
  await modes.selectOption("INHERIT"); await page.getByRole("button", { name: "加入／更新 Dashboard 欄位規則", exact: true }).click();
  expect(state.persisted.deviceColumnMasks).toEqual({ NAME: "NAME", MRN: "INHERIT", ROOM: "NONE" });
  expect(state.persisted.deviceSourceColumnMasks).toEqual({ WARD: { MRN: "INHERIT" } });
  expect(state.persisted.LIST).toEqual([1, 2]); expect(state.persisted.LEGACY).toEqual({ keep: true });
  expect(JSON.stringify(state.persisted)).not.toContain("prefix"); expect(JSON.stringify(state.persisted)).not.toContain("suffix");
  await page.reload(); await page.getByRole("button", { name: "編輯", exact: true }).first().click();
  await expect(page.getByRole("row").filter({ hasText: /MRN沿用 Dataset 遮蔽規則/ })).toBeVisible();
  await page.getByLabel("遮蔽核准來源", { exact: true }).selectOption("WARD");
  await expect(page.getByRole("row").filter({ hasText: /MRN沿用 Dataset 遮蔽規則/ })).toBeVisible();
});

test("managed Query-only approval uses expectedVersion, keeps conflict draft and avoids the Legacy writer", async ({ page }) => {
  const state = await setup(page, true); page.on("dialog", dialog => void dialog.accept());
  await page.goto("/designer/dashboards"); await page.getByRole("button", { name: "編輯", exact: true }).first().click();
  await page.getByRole("combobox", { name: /^核准欄位/ }).selectOption("MRN");
  const modes = page.getByRole("combobox", { name: /^欄位遮蔽模式/ }); await modes.selectOption("INHERIT");
  state.conflict = true; await page.getByRole("button", { name: "加入／更新 Dashboard 欄位規則", exact: true }).click();
  await expect(page.getByText(/QUERY_SOURCE_VERSION_CONFLICT/)).toBeVisible();
  await expect(modes).toHaveValue("INHERIT"); expect(state.approval).toBeNull(); expect(state.saved).toBeNull();
  state.conflict = false; await expect(page.getByRole("button", { name: "加入／更新 Dashboard 欄位規則", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "重新載入核准版本" }).click();
  await page.getByRole("combobox", { name: /^核准欄位/ }).selectOption("MRN"); await modes.selectOption("INHERIT");
  await page.getByRole("button", { name: "加入／更新 Dashboard 欄位規則", exact: true }).click();
  await expect(page.getByText(/本來源欄位核准已安全儲存/)).toBeVisible();
  expect(state.approval).toEqual({ expectedVersion: "a".repeat(64), sourceKey: "PRIMARY", masks: { NAME: "NAME", MRN: "INHERIT", ROOM: "NONE" } });
  expect(state.saved).toBeNull();
});

test("managed disclosure removes only confirmed MRN approval and retains classifications", async ({ page }) => {
  const state = await setup(page, true); page.on("dialog", dialog => void dialog.accept());
  await page.goto("/designer/dashboards?dashboardId=1#column-approvals");
  await page.getByRole("button", { name: "移除 MRN 核准", exact: true }).click();
  await expect.poll(() => state.approval?.masks).toEqual({ NAME: "NAME", ROOM: "NONE" });
  expect(state.approval.sourceKey).toBe("PRIMARY");
  expect(state.persisted.deviceColumnMasks).not.toHaveProperty("MRN"); expect(state.persisted.deviceColumnTypes.MRN).toBe("MRN");
  await page.getByLabel("遮蔽核准來源", { exact: true }).selectOption("WARD");
  await page.getByRole("combobox", { name: /^核准欄位/ }).selectOption("MRN");
  await page.getByRole("combobox", { name: /^欄位遮蔽模式/ }).selectOption("INHERIT");
  await page.getByRole("button", { name: "加入／更新 Dashboard 欄位規則" }).click();
  await expect.poll(() => state.persisted.deviceSourceColumnMasks.WARD?.MRN).toBe("INHERIT");
  await page.getByRole("button", { name: "移除 MRN 核准", exact: true }).click();
  await expect.poll(() => state.persisted.deviceSourceColumnMasks.WARD).toEqual({});
  expect(state.persisted.deviceColumnMasks.NAME).toBe("NAME"); expect(state.approval.sourceKey).toBe("WARD");
  expect(state.saved).toBeNull(); expect(state.persisted.deviceColumnTypes.MRN).toBe("MRN");
});
test("active Dashboard blocks approval edits without any automatic disable", async ({ page }) => {
  const state = await setup(page, true); state.active = true;
  await page.goto("/designer/dashboards?dashboardId=1#column-approvals");
  await expect(page.getByText(/須先停用 Dashboard 才可修改/)).toBeVisible();
  await expect(page.getByRole("button", { name: "移除 MRN 核准", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "加入／更新 Dashboard 欄位規則", exact: true })).toBeDisabled();
  expect(state.saved).toBeNull(); expect(state.approval).toBeNull(); expect(state.active).toBe(true);
});
test("managed conflict blocks all writes until reload and explicit source reconfirmation", async ({ page }) => {
  const state = await setup(page, true);
  await page.goto("/designer/dashboards?dashboardId=1#column-approvals");
  // Wait for an existing persisted approval; absence of a loading message alone can race initial fetch.
  await expect(page.getByRole("button", { name: "移除 MRN 核准", exact: true })).toBeVisible();
  await expect(page.getByText("尚未確認 Dataset 保護；暫停欄位規則編輯。")).toHaveCount(0);
  await page.getByRole("combobox", { name: /^核准欄位/ }).selectOption("NAME");
  await page.getByRole("combobox", { name: /^欄位遮蔽模式/ }).selectOption("FULL");
  await expect(page.getByRole("button", { name: "加入／更新 Dashboard 欄位規則" })).toBeEnabled();
  state.conflict = true; await page.getByRole("button", { name: "加入／更新 Dashboard 欄位規則" }).click();
  await expect(page.getByText(/QUERY_SOURCE_VERSION_CONFLICT/)).toBeVisible();
  await expect(page.getByRole("button", { name: "移除 MRN 核准", exact: true })).toBeDisabled();
  state.conflict = false; state.version = "c".repeat(64);
  await page.getByRole("button", { name: "重新載入核准版本" }).click();
  await expect(page.getByRole("combobox", { name: /^核准欄位/ })).toHaveValue(""); expect(state.approval).toBeNull();
  await page.getByRole("combobox", { name: /^核准欄位/ }).selectOption("NAME"); await page.getByRole("combobox", { name: /^欄位遮蔽模式/ }).selectOption("FULL");
  await page.getByRole("button", { name: "加入／更新 Dashboard 欄位規則" }).click();
  await expect.poll(() => state.approval?.expectedVersion).toBe("c".repeat(64));
});
test("Schema missing locks managed approval changes without falling back to Legacy", async ({ page }) => {
  const state = await setup(page, true); state.schemaMissing = true;
  await page.goto("/designer/dashboards?dashboardId=1#column-approvals");
  await expect(page.getByText(/SECURITY_SCHEMA_REQUIRED/).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "加入／更新 Dashboard 欄位規則" })).toBeDisabled();
  await expect(page.locator("body")).not.toContainText("SQL private Bind"); expect(state.approval).toBeNull();
});

test("Dataset OMIT cannot be weakened and Query rebinding cannot carry primary approvals", async ({ page }) => {
  const state = await setup(page, true);
  await page.goto("/designer/dashboards?dashboardId=1#column-approvals");
  await page.getByRole("combobox", { name: /^核准欄位/ }).selectOption("SECRET");
  const modes = page.getByRole("combobox", { name: /^欄位遮蔽模式/ });
  await expect(modes.locator('option[value="FULL"]')).toHaveAttribute("disabled", "");
  await expect(modes.locator('option[value="NONE"]')).toHaveAttribute("disabled", "");
  await expect(modes.locator('option[value="INHERIT"]')).not.toHaveAttribute("disabled", "");
  await page.getByRole("button", { name: "編輯 PRIMARY", exact: true }).click();
  await page.getByLabel("已發布 Query", { exact: true }).selectOption("3");
  await page.getByRole("button", { name: "儲存目前來源", exact: true }).click();
  await expect(page.getByText(/DASHBOARD_APPROVAL_BINDING_CHANGED/).first()).toBeVisible(); expect(state.saved).toBeNull();
});
test("view-only preview errors never expose management entry points or private details", async ({ page }) => {
  const state = await setup(page, false, false); state.primaryFail = true;
  await page.goto("/designer/dashboards/1/display");
  await expect(page.getByText(/PATIENT_AUDIT_FAILED/).first()).toBeVisible();
  await expect(page.getByRole("navigation", { name: "安全設定入口" })).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("driver SQL Bind");
});

test("management preview with its flag disabled shows safe status without Legacy execution fallback", async ({ page }) => {
  const state = await setup(page, false);
  await page.goto("/designer/dashboards"); await page.getByRole("button", { name: "預覽", exact: true }).click();
  await expect(page.getByText(/新版資料來源管理功能旗標關閉/)).toBeVisible();
  expect(state.legacyPreviewRequests).toBe(0); expect(state.saved).toBeNull(); expect(state.approval).toBeNull();
  await expect(page.locator(".dashboard-preview-card").getByText("*************54", { exact: true })).toHaveCount(0);
});

test("approval reload waits for this read's Dataset policy before enabling reconfirmation", async ({ page }) => {
  const state = await setup(page, true); await page.goto("/designer/dashboards?dashboardId=1#column-approvals");
  const column = page.getByRole("combobox", { name: /^核准欄位/ }); await expect(column).toBeEnabled();
  state.version = "c".repeat(64);
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/datasets/3/sensitive-columns", async route => { await gate; await route.fallback(); });
  try {
    await page.getByRole("button", { name: "重新載入核准版本", exact: true }).click();
    await expect(column).toBeDisabled(); await expect(page.getByRole("button", { name: "加入／更新 Dashboard 欄位規則", exact: true })).toBeDisabled();
    expect(state.approval).toBeNull();
  } finally { release(); }
  await expect(column).toBeEnabled(); await column.selectOption("NAME");
  await page.getByRole("combobox", { name: /^欄位遮蔽模式/ }).selectOption("FULL");
  await page.getByRole("button", { name: "加入／更新 Dashboard 欄位規則", exact: true }).click();
  await expect.poll(() => state.approval?.expectedVersion).toBe("c".repeat(64));
});
