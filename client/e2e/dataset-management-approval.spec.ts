import { test, expect, type Page } from "@playwright/test";

// Synthetic-only end-to-end regression for the simplified Dataset approval UI.
// These HTTP fixtures cannot bypass or validate SQL protections; those remain
// covered by the Server's policy, permission and delivery contract tests.
const definitionVersion = "0000000000000001";
type Playback = "APPROVED" | "UNAPPROVED" | "STALE" | "BLOCKED";
async function setup(page: Page, options: { manager?: boolean; exists?: boolean; active?: boolean; playback?: Playback; conflict?: boolean } = {}) {
  const manager = options.manager ?? true;
  const state = {
    exists: options.exists ?? true,
    active: options.active ?? false,
    playback: options.playback ?? "UNAPPROVED",
    conflict: options.conflict ?? false,
    usageWrites: [] as any[],
    playbackWrites: [] as any[],
    adminReads: 0,
    publicPolicyWrites: 0,
    queryPublishWrites: 0,
    datasetCreates: [] as any[],
    datasetSaves: [] as any[],
    columnDescribeRequests: 0,
    columnSyncWrites: [] as any[],
  };
  const userPermissions = ["DESIGN_QUERY", "EXECUTE_QUERY", ...(manager ? ["MANAGE_USERS"] : [])];
  await page.addInitScript((permissions) => {
    sessionStorage.setItem("uqp.auth", JSON.stringify({
      accessToken: "synthetic-dataset-approval", user: {
        id: 9, username: "synthetic", displayName: "合成管理者", permissions,
      },
    }));
  }, userPermissions);
  const record = () => ({
    id: 2, code: "SYNTHETIC", name: "合成 Dataset", description: null,
    dataSourceId: 4, dataSourceName: "合成來源", dataSourceType: "SQLSERVER",
    sqlText: "SELECT VALUE FROM synthetic", maxRows: 100, queryTimeoutSec: null,
    isActive: state.active, isArchived: false,
    archivedAtUtc: null, archivedByUserId: null, parameterNames: [],
  });
  await page.route(url => url.pathname.startsWith("/api/"), async route => {
    const req = route.request(), p = new URL(req.url()).pathname;
    const method = req.method();
    if (p === "/api/datasets/2/management-approval" && method === "GET") {
      state.adminReads++;
      await route.fulfill({ json: {
        usage: { active: state.active, definitionVersion },
        previewSafety: { status: "BLOCKED", code: state.active ? "POLICY_UNCONFIRMED" : "USAGE_NOT_APPROVED",
          message: state.active ? "尚未確認欄位保護政策，預覽維持禁止。" : "尚未核准使用，不能執行資料預覽。" },
        playback: { status: state.playback, permittedColumns: state.playback === "APPROVED" ? 2 : 0,
          message: state.playback === "BLOCKED" ? "安全政策尚未完成。" :
            state.playback === "STALE" ? "需重新核准。" : "" },
      } }); return;
    }
    if (p === "/api/datasets/2/management-approval/usage" && method === "PUT") {
      const body = req.postDataJSON();
      state.usageWrites.push(body);
      if (state.conflict) {
        await route.fulfill({ status: 409, json: { error: {
          code: "MANAGER_APPROVAL_VERSION_CONFLICT", message: "版本衝突，未修改原核准狀態。" } } });
        return;
      }
      expect(Object.keys(body).sort()).toEqual(["approve", "expectedVersion"]);
      expect(body.expectedVersion).toBe(definitionVersion);
      state.active = body.approve;
      await route.fulfill({ json: { status: "OK" } }); return;
    }
    if (p === "/api/datasets/2/management-approval/playback" && method === "PUT") {
      const body = req.postDataJSON();
      state.playbackWrites.push(body);
      if (state.conflict) {
        await route.fulfill({ status: 409, json: { error: {
          code: "DATASET_DISPLAY_VERSION_CONFLICT", message: "播放核准版本衝突，未修改。" } } });
        return;
      }
      expect(Object.keys(body).sort()).toEqual(["approve", "requestId"]);
      expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/i);
      state.playback = body.approve ? "APPROVED" : "UNAPPROVED";
      await route.fulfill({ json: {
        status: "CONFIRMED", permittedColumns: state.playback === "APPROVED" ? 2 : 0,
      } }); return;
    }
    if (p === "/api/datasets/2/public-display-policy" && method !== "GET") {
      state.publicPolicyWrites++;
      await route.fulfill({ status: 403, json: { error: { code: "FORBIDDEN" } } }); return;
    }
    if (/\/api\/query-definitions/.test(p) && method !== "GET") {
      state.queryPublishWrites++;
      await route.fulfill({ json: { status: "OK" } }); return;
    }
    if (p === "/api/datasets" && method === "POST") {
      const body = req.postDataJSON();
      state.datasetCreates.push(body);
      state.exists = true;
      state.active = false;
      await route.fulfill({ status: 201, json: { id: 2, parameterNames: [] } }); return;
    }
    if (p === "/api/datasets/2/column-candidates" && method === "GET") {
      state.columnDescribeRequests++;
      await route.fulfill({ json: { columns: [{ name: "TEST_VALUE", dataType: "int", ordinal: 1 }],
        trust: "UNBOUND_CANDIDATE", metadataState: "NOT_INITIALIZED", deliveryAllowed: false } }); return;
    }
    if (p === "/api/datasets/2/columns/sync" && method === "POST") {
      state.columnSyncWrites.push(req.postDataJSON());
      await route.fulfill({ json: { columns: [{ name: "TEST_VALUE", dataType: "int", ordinal: 1 }],
        trust: "UNBOUND_CANDIDATE", purpose: "DISPLAY_COLUMN_OPTIONS_ONLY", deliveryAllowed: false } }); return;
    }
    if (p === "/api/datasets/2" && method === "GET") {
      await route.fulfill({ json: { dataset: record() } }); return;
    }
    if (p === "/api/datasets/2" && method === "PUT") {
      state.datasetSaves.push(req.postDataJSON());
      await route.fulfill({ json: { status: "OK", parameterNames: [] } }); return;
    }
    if (p === "/api/datasets" && method === "GET") {
      await route.fulfill({ json: {
        datasets: state.exists ? [record()] : [], total: state.exists ? 1 : 0, totalPages: 1,
      } }); return;
    }
    if (p === "/api/datasets/datasource-options") {
      await route.fulfill({ json: { dataSources: [
        { id: 4, code: "SYNTH", name: "合成來源", type: "SQLSERVER" },
      ] } }); return;
    }
    if (p.endsWith("/parameters")) {
      await route.fulfill({ json: { parameters: [], preview: {
        detected: [], added: [], retained: [], unused: [], detectionStatus: "OK",
      } } }); return;
    }
    await route.fulfill({ json: { versions: [], queries: [], dashboards: [] } });
  });
  await page.goto("/designer/datasets");
  if (state.exists) {
    await page.getByRole("button", { name: /合成 Dataset/ }).first().click();
  }
  const panel = page.getByRole("region", { name: "Dataset 使用核准" });
  if (state.exists) await expect(panel).toBeVisible();
  if (manager && state.exists) await expect(panel.getByText("允許使用")).toBeVisible();
  return { state, panel };
}

test("removed patient audit and sensitive-column forms never surface in Dataset designer", async ({ page }) => {
  const { state, panel } = await setup(page, { manager: false });
  await expect(page.getByRole("heading", { name: "Dataset 患者揭露稽核設定" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Dataset 敏感資料欄位管理" })).toHaveCount(0);
  await expect(panel).toContainText("由系統依現有安全規則檢查");
  await expect(panel.getByRole("button", { name: "核准使用" })).toHaveCount(0);
  expect(state.adminReads).toBe(0);
  expect(state.usageWrites).toEqual([]);
});

test("new Dataset creates as inactive; never auto-grants query or public playback", async ({ page }) => {
  const { state, panel } = await setup(page, { exists: false });
  await page.getByLabel("代碼", { exact: true }).fill("SYNTHETIC");
  await page.getByLabel("名稱", { exact: true }).fill("合成 Dataset");
  await page.getByRole("combobox", { name: "資料來源", exact: true }).selectOption("4");
  await page.locator("textarea").first().fill("SELECT VALUE FROM synthetic");
  await page.getByRole("button", { name: "儲存 Dataset", exact: true }).click();
  await expect(panel.getByRole("button", { name: "核准使用" })).toBeVisible();
  expect(state.datasetCreates).toHaveLength(1);
  expect(state.datasetCreates[0].isActive).toBe(false);
  expect(state.usageWrites).toEqual([]);
  expect(state.playbackWrites).toEqual([]);
  expect(state.publicPolicyWrites).toBe(0);
});

test("administrator approves usage through dedicated API without publishing a Query", async ({ page }) => {
  const { state, panel } = await setup(page);
  page.on("dialog", d => d.accept());
  await panel.getByRole("button", { name: "核准使用" }).click();
  await expect(panel.getByRole("button", { name: "停止使用" })).toBeVisible();
  expect(state.active).toBe(true);
  expect(state.usageWrites).toEqual([{ approve: true, expectedVersion: definitionVersion }]);
  expect(state.queryPublishWrites).toBe(0);
  expect(state.playbackWrites).toEqual([]);
});

test("administrator revokes usage without granting playback", async ({ page }) => {
  const { state, panel } = await setup(page, { active: true });
  page.on("dialog", d => d.accept());
  await panel.getByRole("button", { name: "停止使用" }).click();
  await expect(panel.getByRole("button", { name: "核准使用" })).toBeVisible();
  expect(state.usageWrites).toEqual([{ approve: false, expectedVersion: definitionVersion }]);
  expect(state.playbackWrites).toEqual([]);
});

test("manager has usage and public playback decisions without individual field selection", async ({ page }) => {
  const { state, panel } = await setup(page, { active: true });
  await expect(panel.getByRole("button", { name: "停止使用" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "核准公共播放", exact: true })).toBeEnabled();
  await expect(panel.getByRole("button", { name: /簡化安全審查/ })).toHaveCount(0);
  await expect(panel.getByRole("combobox", { name: /保護方式/ })).toHaveCount(0);
  await expect(panel.getByRole("checkbox", { name: /我已核對 SQL/ })).toHaveCount(0);
  expect(state.playbackWrites).toHaveLength(0);
  expect(state.publicPolicyWrites).toBe(0);
});

test("unsafe or unavailable playback policy remains blocked", async ({ page }) => {
  const { state, panel } = await setup(page, { active: true, playback: "BLOCKED" });
  await expect(panel.getByRole("button", { name: "核准公共播放", exact: true })).toBeDisabled();
  await expect(panel).toContainText("核准使用不會自動公開未通過安全檢查的資料");
  expect(state.playbackWrites).toHaveLength(0);
});

test("unsaved SQL changes prevent both approvals", async ({ page }) => {
  const { state, panel } = await setup(page, { active: true });
  await page.locator("textarea").first().fill("SELECT changed FROM synthetic");
  await expect(panel.getByRole("button", { name: "停止使用" })).toBeDisabled();
  await expect(panel.getByRole("button", { name: "核准公共播放", exact: true })).toBeDisabled();
  expect(state.usageWrites).toHaveLength(0);
  expect(state.playbackWrites).toHaveLength(0);
});

test("conflicting approval does not report a successful decision or change status", async ({ page }) => {
  const { state, panel } = await setup(page, { conflict: true });
  page.on("dialog", d => d.accept());
  await panel.getByRole("button", { name: "核准使用" }).click();
  await expect(panel).toContainText("版本衝突");
  await expect(panel.getByRole("button", { name: "核准使用" })).toBeVisible();
  expect(state.active).toBe(false);
  expect(state.usageWrites).toHaveLength(1);
});

test("stale public policy is not auto-approved by the single usage control", async ({ page }) => {
  const { state, panel } = await setup(page, { active: true, playback: "STALE" });
  await expect(panel.getByRole("button", {name:"核准公共播放",exact:true})).toBeEnabled();
  expect(state.playbackWrites).toHaveLength(0);
  expect(state.publicPolicyWrites).toBe(0);
});

test("preview safety status is distinct from usage and playback grants", async ({ page }) => {
  const { state, panel } = await setup(page, { active: true, playback: "BLOCKED" });
  const preview = panel.getByRole("group", { name: "資料預覽安全狀態" });
  await expect(preview).toContainText("安全條件尚未具備");
  await expect(preview).toContainText("尚未確認欄位保護政策");
  expect(state.usageWrites).toHaveLength(0);
  expect(state.playbackWrites).toHaveLength(0);
});

// Design-time metadata may be saved before usage approval, but it is never an
// implicit sensitivity decision, a row-preview grant, or a public display grant.
test("inactive Dataset can save display columns without approving usage or preview", async ({ page }) => {
  const { state, panel } = await setup(page, { active: false, playback: "BLOCKED" });
  await page.getByRole("button", { name: "取得 SQL 欄位名稱及型別" }).click();
  await expect(page.getByText("UNBOUND_CANDIDATE", { exact: false }).first()).toBeVisible();
  expect(state.columnDescribeRequests).toBe(1);
  expect(state.columnSyncWrites).toHaveLength(0);
  await page.getByRole("button", { name: "儲存欄位候選清單（僅供設計）" }).click();
  await expect(page.getByText(/設計用欄位清單已儲存/)).toBeVisible();
  expect(state.columnSyncWrites).toEqual([{}]);
  expect(state.usageWrites).toHaveLength(0);
  expect(state.playbackWrites).toHaveLength(0);
  expect(state.publicPolicyWrites).toBe(0);
  await expect(panel.getByRole("button", { name: "核准使用" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "核准公共播放", exact: true })).toBeDisabled();
});

test("removed field review is not available to manager or nonmanager", async ({ page }) => {
  const { state, panel } = await setup(page, { active: false, playback: "BLOCKED" });
  await expect(panel.getByRole("button", { name: "核准使用" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "管理者簡化安全審查" })).toHaveCount(0);
  await expect(page.getByRole("table", { name: "安全審查欄位清單" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "確認並儲存一般資料安全審查" })).toHaveCount(0);
  expect(state.usageWrites).toHaveLength(0);
  expect(state.playbackWrites).toHaveLength(0);
});


test("manager explicitly approves and revokes public playback without a field editor", async ({ page }) => {
  const { state, panel } = await setup(page, { active: true });
  page.on("dialog", d => d.accept());
  await panel.getByRole("button", { name: "核准公共播放", exact: true }).click();
  await expect(panel.getByRole("button", { name: "撤銷播放核准" })).toBeVisible();
  expect(state.playbackWrites).toHaveLength(1);
  expect(state.playbackWrites[0].approve).toBe(true);
  await panel.getByRole("button", { name: "撤銷播放核准" }).click();
  await expect(panel.getByRole("button", { name: "核准公共播放", exact: true })).toBeVisible();
  expect(state.playbackWrites).toHaveLength(2);
  expect(state.playbackWrites[1].approve).toBe(false);
  expect(state.usageWrites).toHaveLength(0);
  expect(state.publicPolicyWrites).toBe(0);
});
