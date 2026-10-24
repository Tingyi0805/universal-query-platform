import { test, expect, type Page } from "@playwright/test";
async function setup(page: Page, canManage = true) {
  const state = { version: "0", column: "", status: "NOT_CONFIGURED", schema: true, metadata: true, conflict: false, reads: 0, writes: [] as any[] };
  await page.addInitScript(manage => sessionStorage.setItem("uqp.auth", JSON.stringify({ accessToken: "synthetic-token", user: { id: 1, username: "synthetic", displayName: "測試管理者", permissions: manage ? ["DESIGN_QUERY"] : ["VIEW_QUERY"] } })), canManage);
  await page.route(url => url.pathname.startsWith("/api/"), async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/patient-audit-config")) {
      state.reads++;
      if (!state.schema) { await route.fulfill({ status: 503, json: { error: { code: "SECURITY_SCHEMA_REQUIRED", message: "SELECT private Bind secret" } } }); return; }
      if (route.request().method() === "PUT") {
        const body = route.request().postDataJSON(); state.writes.push(body);
        if (state.conflict || body.expectedVersion !== state.version) { await route.fulfill({ status: 409, json: { error: { code: "PATIENT_AUDIT_VERSION_CONFLICT", message: "private SQL Bind" } } }); return; }
        expect(body).toEqual({ expectedVersion: state.version, isEnabled: true, patientKeyColumn: "MRN", identifierConfirmed: true });
        state.column = body.patientKeyColumn; state.version = String(BigInt(state.version) + 1n); state.status = "CONFIRMED";
      }
      await route.fulfill({ json: { config: state.column ? { isEnabled: true, patientKeyColumn: state.column, version: state.version } : null,
        version: state.version, status: state.status, metadataStatus: state.metadata ? "CONFIRMED" : "METADATA_UNCONFIRMED", columns: state.metadata ? ["NAME", "PHONE", "MRN"] : [], sql: "SELECT private", key: "synthetic-private-key" } }); return;
    }
    if (path === "/api/datasets") { await route.fulfill({ json: { datasets: [{ id: 2, code: "SYNTHETIC", name: "合成 Dataset", sqlText: "SELECT MRN FROM synthetic", dataSourceId: 4, maxRows: 100, isActive: true, isArchived: false }], total: 1, totalPages: 1 } }); return; }
    if (path.endsWith("/datasource-options")) { await route.fulfill({ json: { dataSources: [{ id: 4, name: "合成來源", type: "SQLSERVER" }] } }); return; }
    if (path.endsWith("/sensitive-columns")) { await route.fulfill({ json: { columns: [], version: 0 } }); return; }
    if (path.endsWith("/parameters")) { await route.fulfill({ json: { parameters: [], preview: { detected: [], added: [], retained: [], unused: [], detectionStatus: "OK", previewToken: "synthetic" } } }); return; }
    await route.fulfill({ json: { versions: [], dashboards: [], queries: [] } });
  });
  await page.goto("/designer/datasets?datasetId=2#patient-audit-settings");
  const panel = page.getByRole("region", { name: "Dataset 患者揭露稽核設定" });
  return { state, panel };
}
test("patient audit requires explicit backend alias selection and administrator confirmation", async ({ page }) => {
  const { state, panel } = await setup(page);
  await expect(panel.getByLabel("患者識別欄位", { exact: true })).toHaveValue("");
  await expect(panel.getByRole("button", { name: "確認並儲存患者稽核設定" })).toBeDisabled();
  expect(state.writes).toEqual([]);
  await panel.getByLabel("患者識別欄位", { exact: true }).selectOption("MRN");
  await panel.getByRole("checkbox").check(); await panel.getByRole("button", { name: "確認並儲存患者稽核設定" }).click();
  await expect(panel.getByText("目前識別欄位：MRN", { exact: true })).toBeVisible();
  expect(state.writes).toHaveLength(1); expect(state.version).toBe("1");
  await expect(panel).not.toContainText("SELECT"); await expect(panel).not.toContainText("synthetic-private-key");
});
test("Schema missing disables audit writes and never renders private driver details", async ({ page }) => {
  const { state, panel } = await setup(page); state.schema = false;
  await panel.getByRole("button", { name: "重新載入稽核版本" }).click();
  await expect(panel.getByText(/SECURITY_SCHEMA_REQUIRED/)).toBeVisible();
  await expect(panel.getByRole("button", { name: "確認並儲存患者稽核設定" })).toBeDisabled();
  expect(state.writes).toEqual([]); await expect(panel).not.toContainText("private Bind");
});
test("audit conflict requires reload and renewed confirmation with the actual new version", async ({ page }) => {
  const { state, panel } = await setup(page);
  await panel.getByLabel("患者識別欄位", { exact: true }).selectOption("MRN"); await panel.getByRole("checkbox").check();
  state.conflict = true; await panel.getByRole("button", { name: "確認並儲存患者稽核設定" }).click();
  await expect(panel.getByText(/PATIENT_AUDIT_VERSION_CONFLICT/)).toBeVisible();
  await expect(panel.getByRole("button", { name: "確認並儲存患者稽核設定" })).toBeDisabled();
  state.conflict = false; state.column = "MRN"; state.version = "9007199254740993"; state.status = "CONFIRMED";
  await panel.getByRole("button", { name: "重新載入稽核版本" }).click();
  await expect(panel.getByRole("checkbox")).not.toBeChecked();
  await panel.getByRole("checkbox").check(); await panel.getByRole("button", { name: "確認並儲存患者稽核設定" }).click();
  await expect.poll(() => state.writes.length).toBe(2); expect(state.writes[1].expectedVersion).toBe("9007199254740993");
});
test("unavailable HMAC key disables setting writes", async ({ page }) => {
  const { state, panel } = await setup(page); state.column = "MRN"; state.version = "1"; state.status = "KEY_UNAVAILABLE";
  await panel.getByRole("button", { name: "重新載入稽核版本" }).click();
  await expect(panel.getByText(/HMAC 金鑰不可用/)).toBeVisible();
  await expect(panel.getByRole("button", { name: "確認並儲存患者稽核設定" })).toBeDisabled(); expect(state.writes).toEqual([]);
});
test("view-only users cannot open the audit management page or fetch its settings", async ({ page }) => {
  const { state, panel } = await setup(page, false);
  await expect(panel).toHaveCount(0); await expect(page).not.toHaveURL(/designer\/datasets/); expect(state.reads).toBe(0);
});

test("missing trusted metadata cannot be replaced by an identifier assertion or candidate aliases", async ({ page }) => {
  const { state, panel } = await setup(page); state.metadata = false;
  await panel.getByRole("button", { name: "重新載入稽核版本" }).click();
  await expect(panel.getByText(/不可用候選描述或停用稽核替代/)).toBeVisible();
  await expect(panel.getByRole("combobox", { name: "患者識別欄位", exact: true })).toBeDisabled();
  await expect(panel.getByRole("combobox", { name: "患者識別欄位", exact: true }).getByRole("option")).toHaveCount(1);
  await expect(panel.getByRole("button", { name: "確認並儲存患者稽核設定" })).toBeDisabled();
  expect(state.writes).toEqual([]);
});
