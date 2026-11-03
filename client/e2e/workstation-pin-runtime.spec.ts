import { test, expect, type Page } from "@playwright/test";
async function setup(page: Page) {
  const state = { user: null as { id: number; username: string; displayName: string } | null, sessionId: null as string | null,
    failLogin: false, locks: 0, logins: 0, pending: null as (() => void) | null, delay: false };
  await page.route("**/api/workstations/current/**", async route => {
    const path = new URL(route.request().url()).pathname.split("/current")[1]!;
    let body: unknown = {};
    if (path === "/session") body = { user: state.user, sessionId: state.sessionId, csrfToken: "synthetic-csrf", idleSeconds: 180 };
    else if (path === "/login") {
      state.logins++;
      if (state.failLogin) { await route.fulfill({ status: 401, json: { error: { code: "PIN_SIGN_IN_FAILED" } } }); return; }
      const input = route.request().postDataJSON();
      state.user = { id: state.logins, username: input.username, displayName: input.username === "A" ? "員工 A" : "員工 B" };
      state.sessionId = `session-${state.logins}`;
      body = { user: state.user, sessionId: state.sessionId, csrfToken: "synthetic-session-csrf", idleSeconds: 180 };
    } else if (path === "/lock" || path === "/logout") { state.locks++; state.user = null; state.sessionId = null; body = { status: "OK" }; }
    else if (path === "/activity") body = { status: "OK", sessionId: state.sessionId };
    else if (path === "/queries") body = { queries: [{ id: 4, code: "ROOMS", name: "非敏感房間查詢" }] };
    else if (path === "/queries/4") body = { parameters: [{ name: "WARD", label: "病區", dataType: "STRING", isRequired: false, optionMode: "NONE" }] };
    else if (path === "/queries/4/execute") {
      const actor = state.user?.username;
      if (state.delay) await new Promise<void>(resolve => { state.pending = resolve; });
      body = { result: { columns: [{ name: "ROOM" }], rows: [{ ROOM: `${actor}-ROOM-ONLY` }], truncated: false } };
    } else { await route.fulfill({ status: 404, json: { error: { code: "NOT_FOUND" } } }); return; }
    await route.fulfill({ status: 200, json: body }).catch(() => {});
  });
  await page.goto("/workstation");
  await expect(page.getByRole("status")).toContainText("已鎖定");
  return state;
}
async function login(page: Page, username = "A") {
  await page.getByLabel("帳號", { exact: true }).fill(username);
  await page.getByLabel("PIN", { exact: true }).fill("837294");
  await page.getByRole("button", { name: "登入", exact: true }).click();
  await expect(page.getByText(`目前使用者：員工 ${username}`)).toBeVisible();
}
async function query(page: Page) {
  await page.getByLabel("查詢", { exact: true }).selectOption("4");
  await expect(page.getByLabel("病區")).toBeVisible();
  await page.getByRole("button", { name: "執行查詢", exact: true }).click();
}
test("PIN login, query and A→B clear all A values before showing B; no credential storage", async ({ page }) => {
  await setup(page); await login(page); await query(page); await expect(page.getByText("A-ROOM-ONLY")).toBeVisible();
  await page.getByRole("button", { name: "鎖定／切換使用者" }).click();
  await expect(page.getByRole("button", { name: "登入", exact: true })).toBeVisible();
  await expect(page.getByText("A-ROOM-ONLY")).toHaveCount(0); await expect(page.getByLabel("PIN", { exact: true })).toHaveValue("");
  await login(page, "B"); await expect(page.getByText("A-ROOM-ONLY")).toHaveCount(0);
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  await expect(page.getByRole("button", { name: /匯出/ })).toHaveCount(0);
});
test("B verification failure leaves A cleared; no automatic PIN retry", async ({ page }) => {
  const state = await setup(page); await login(page); await query(page); await expect(page.getByText("A-ROOM-ONLY")).toBeVisible();
  await page.getByRole("button", { name: "鎖定／切換使用者" }).click();
  await expect(page.getByLabel("PIN", { exact: true })).toBeVisible(); state.failLogin = true;
  await page.getByLabel("帳號", { exact: true }).fill("B"); await page.getByLabel("PIN", { exact: true }).fill("837295");
  await page.getByRole("button", { name: "登入", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("無法登入"); expect(state.logins).toBe(2);
  await expect(page.getByText("A-ROOM-ONLY")).toHaveCount(0); await expect(page.getByLabel("PIN", { exact: true })).toHaveValue("");
});
test("late A query after identity clear cannot repopulate results", async ({ page }) => {
  const state = await setup(page); await login(page); state.delay = true; await query(page);
  await expect.poll(() => state.pending !== null).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  await expect(page.getByLabel("PIN", { exact: true })).toBeVisible();
  state.pending?.(); await expect(page.getByText("A-ROOM-ONLY")).toHaveCount(0);
  await expect.poll(() => state.locks).toBeGreaterThan(0);
});
test("idle lock clears current results and calls server revocation", async ({ page }) => {
  await page.clock.install(); const state = await setup(page); await login(page); await query(page);
  await expect(page.getByText("A-ROOM-ONLY")).toBeVisible(); await page.clock.fastForward(181000);
  await expect.poll(() => state.locks).toBeGreaterThan(0); await expect(page.getByText("A-ROOM-ONLY")).toHaveCount(0);
});
for (const [platform, width, height, touch] of [["Windows", 1280, 800, false], ["Android", 393, 851, true], ["iOS", 390, 844, true]] as const) {
  test(`${platform} touch-size PIN entry and landscape layout`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch }); const page = await context.newPage();
    await setup(page); const input = page.getByLabel("PIN", { exact: true }); await expect(input).toHaveAttribute("inputmode", "numeric");
    const box = await input.boundingBox(); expect(box!.height).toBeGreaterThanOrEqual(44);
    await login(page); await page.setViewportSize({ width: height, height: width });
    const button = page.getByRole("button", { name: "鎖定／切換使用者" }); const size = await button.boundingBox(); expect(size!.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await context.close();
  });
}
