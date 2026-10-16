import { test, expect, type Page } from "@playwright/test";
test.use({ hasTouch: true });
async function auth(page: Page, permissions = ["MANAGE_USERS"]) {
  await page.addInitScript(
    (perms) =>
      sessionStorage.setItem(
        "uqp.auth",
        JSON.stringify({
          accessToken: "synthetic-token",
          user: {
            id: 5,
            username: "synthetic",
            displayName: "測試",
            permissions: perms,
          },
        }),
      ),
    permissions,
  );
}
async function stations(page: Page, ready = true) {
  const state = {
    writes: [] as { path: string; method: string; body: any }[],
    retired: false,
    failGrants: false,
  };
  await auth(page);
  await page.route(
    (url) => url.pathname.startsWith("/api/"),
    async (route) => {
      const r = route.request();
      const url = new URL(r.url());
      const path = url.pathname;
      if (r.method() !== "GET") {
        const body = r.postDataJSON();
        state.writes.push({ path, method: r.method(), body });
        if (path.endsWith("/retire")) state.retired = true;
        await route.fulfill({ json: { status: "OK" } });
        return;
      }
      if (path === "/api/admin/workstation-management") {
        await route.fulfill({
          json: {
            schemaReady: ready,
            workstations: [
              {
                id: "1",
                workstationCode: "SYNTHETIC",
                displayName: "測試工作站",
                platformCode: "ANDROID",
                purposeCode: "SHARED_QUERY",
                sortOrder: 0,
                isActive: !state.retired,
                retiredAtUtc: state.retired ? "2026-01-01" : null,
                credentialVersion: 4,
              },
              {
                id: 2,
                workstationCode: "SOURCE",
                displayName: "來源工作站",
                platformCode: "IOS",
                purposeCode: "SHARED_QUERY",
                sortOrder: 0,
                isActive: false,
                retiredAtUtc: null,
                credentialVersion: 4,
              },
            ],
          },
        });
        return;
      }
      if (path === "/api/admin/users") {
        await route.fulfill({
          json: {
            users: [
              {
                id: "1",
                displayName: "測試員工",
                username: "synthetic",
                isActive: true,
              },
            ],
            total: 1,
            totalPages: 1,
          },
        });
        return;
      }
      if (path.endsWith("/grants")) {
        if (state.failGrants) {
          await route.fulfill({
            status: 500,
            json: {
              error: {
                code: "INTERNAL_SERVER_ERROR",
                message: "讀取失敗",
                requestId: "synthetic-request",
              },
            },
          });
          return;
        }
        await route.fulfill({
          json: {
            userIds: ["1", 1],
            departmentIds: [],
            groupIds: [],
            expectedVersion: 4,
            workstation: {id:Number(path.split("/")[4]),workstationCode:"SYNTHETIC",displayName:path.includes("/1/")?"測試工作站":"來源工作站",
              platformCode:"ANDROID",purposeCode:"SHARED_QUERY",sortOrder:0,isActive:!state.retired,retiredAtUtc:state.retired?"2026-01-01":null,credentialVersion:4},
          },
        });
        return;
      }
      if (path.endsWith("/users")) {
        await route.fulfill({
          json: { users: [{ userId: "1" }, { userId: 1 }] },
        });
        return;
      }
      if (path === "/api/admin/workstation-audiences") {
        await route.fulfill({
          json: {
            audiences: [
              {
                id: 10,
                kind: "DEPARTMENT",
                code: "D",
                displayName: "測試部門",
                isActive: true,
                revision: 1,
              },
              {
                id: 20,
                kind: "GROUP",
                code: "G",
                displayName: "測試群組",
                isActive: true,
                revision: 1,
              },
            ],
            total: 2,
          },
        });
        return;
      }
      if (path.endsWith("/members")) {
        await route.fulfill({
          json: { userIds: ["1", 1], expectedRevision: 1 },
        });
        return;
      }
      if (path.endsWith("/effective-users")) {
        await route.fulfill({
          json: {
            users: [
              {
                userId: 1,
                displayName: "測試員工",
                username: "synthetic",
                permissions: ["VIEW_QUERY"],
                workstationEnabled: !state.retired,
              },
            ],
            total: 1,
          },
        });
        return;
      }
      if (path === "/api/admin/workstation-dashboard-devices") {
        await route.fulfill({ json: { devices: [] } });
        return;
      }
      await route.fulfill({
        json: {
          users: [],
          roles: [],
          permissions: [],
          total: 0,
          totalPages: 1,
        },
      });
    },
  );
  await page.goto("/admin/shared-workstations");
  await page.getByRole("button", { name: /測試工作站/ }).click();
  return state;
}
test("legacy string/number IDs are deduplicated at UI boundary before strict PUT", async ({
  page,
}) => {
  const state = await stations(page, false);
  page.on("dialog", (d) => d.accept());
  const checkbox = page.getByLabel("測試員工（synthetic）");
  await expect(checkbox).toBeChecked();
  await checkbox.uncheck();
  await checkbox.check();
  await page.getByRole("button", { name: "儲存授權", exact: true }).click();
  await expect.poll(() => state.writes.length).toBe(1);
  expect(state.writes[0]!.body).toEqual({ userIds: [1] });
  expect(state.writes[0]!.path).toMatch(/\/users$/);
});
test("department/group/personal grants merge in one strict API; preview retains existing RBAC", async ({
  page,
}) => {
  const state = await stations(page);
  page.on("dialog", (d) => d.accept());
  await page.getByLabel("部門：測試部門", { exact: true }).check();
  await page.getByLabel("群組：測試群組", { exact: true }).check();
  await page.getByRole("button", { name: "選取本頁員工", exact: true }).click();
  await page.getByRole("button", { name: "儲存授權", exact: true }).click();
  await expect.poll(() => state.writes.length).toBe(1);
  expect(state.writes[0]!.body).toEqual({
    userIds: [1],
    departmentIds: [10],
    groupIds: [20],
    expectedVersion: 4,
  });
  await expect(page.getByText(/角色權限：VIEW_QUERY/)).toBeVisible();
});
test("retirement is explicitly confirmed and cannot be reactivated from management", async ({
  page,
}) => {
  const state = await stations(page);
  page.on("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "安全退役", exact: true }).click();
  await expect.poll(() => state.retired).toBe(true);
  await expect(
    page.getByRole("button", { name: "重新啟用工作站", exact: true }),
  ).toBeDisabled();
  expect(state.writes[0]!.body).toEqual({ expectedVersion: 4 });
});
test("authorization read failure never clears grants via an enabled save control", async ({
  page,
}) => {
  const state = await stations(page);
  state.failGrants = true;
  await page.getByRole("button", { name: /來源工作站/ }).click();
  await expect(page.getByRole("alert").first()).toContainText(
    "synthetic-request",
  );
  await expect(
    page.getByRole("button", { name: "儲存授權", exact: true }),
  ).toBeDisabled();
  expect(state.writes).toEqual([]);
});
test("copying another workstation uses the reviewed target version and does not persist secrets", async ({
  page,
}) => {
  const state = await stations(page);
  page.on("dialog", (d) => d.accept());
  await page.getByLabel("複製其他工作站授權").selectOption("2");
  await page.getByRole("button", { name: "複製授權", exact: true }).click();
  await expect.poll(() => state.writes.length).toBe(1);
  expect(state.writes[0]!.body).toEqual({ sourceId: 2, expectedVersion: 4 });
});
test("existing department membership saves normalized IDs and only documented API fields", async ({
  page,
}) => {
  const state = await stations(page);
  page.on("dialog", (d) => d.accept());
  const panel = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "部門與自訂群組成員" }) });
  await panel
    .getByRole("button", { name: "部門：測試部門", exact: true })
    .click();
  await panel
    .getByRole("button", { name: "儲存分類與成員", exact: true })
    .click();
  await expect.poll(() => state.writes.length).toBe(1);
  expect(state.writes[0]!.body).toEqual({
    kind: "DEPARTMENT",
    code: "D",
    displayName: "測試部門",
    isActive: true,
    expectedRevision: 1,
    userIds: [1],
  });
});
test("PIN policy is a permission-management tab and legacy URL redirects", async ({
  page,
}) => {
  await auth(page);
  await page.route(
    (url) => url.pathname.startsWith("/api/"),
    async (route) => {
      const path = new URL(route.request().url()).pathname;
      await route.fulfill({
        json: path.endsWith("/quick-pin-policy")
          ? { pinLength: 6 }
          : { users: [], roles: [], permissions: [], total: 0, totalPages: 1 },
      });
    },
  );
  await page.goto("/admin/quick-pin-policy");
  await expect(page).toHaveURL(/\/admin\/users\?tab=pin$/);
  await expect(page.getByRole("tab", { name: "PIN 安全設定" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByLabel("PIN 長度")).toHaveValue("6");
});
for (const size of [
  { name: "Windows portrait", width: 800, height: 1280 },
  { name: "Android landscape", width: 1024, height: 600 },
  { name: "iOS narrow portrait", width: 375, height: 812 },
]) {
  test(`PIN touch/native entry and secret clearing: ${size.name}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await auth(page, []);
    const submitted: unknown[] = [];
    await page.route(
      (url) => url.pathname.startsWith("/api/"),
      async (route) => {
        if (route.request().method() === "POST")
          submitted.push(route.request().postDataJSON());
        await route.fulfill({
          json:
            route.request().method() === "GET"
              ? { pinLength: 6 }
              : { status: "OK" },
        });
      },
    );
    await page.goto("/account/quick-pin");
    await page.getByLabel("正式登入密碼").fill("synthetic-password");
    const pin = page.getByLabel("個人 PIN", { exact: true });
    await expect(pin).toHaveAttribute("inputmode", "numeric");
    for (const digit of ["8", "0", "4", "2", "9", "7"])
      await page.getByRole("button", { name: digit, exact: true }).tap();
    await expect(pin).toHaveValue("804297");
    await page.setViewportSize({ width: size.height, height: size.width });
    await expect(pin).toHaveValue("804297");
    await page.getByRole("button", { name: "下一步：確認 PIN" }).click();
    await pin.fill("804297");
    await page
      .getByRole("button", { name: "儲存新 PIN（取代舊 PIN）" })
      .click();
    await expect.poll(() => submitted.length).toBe(1);
    await expect(pin).toHaveValue("");
    await expect(page.getByLabel("正式登入密碼")).toHaveValue("");
    const storage = await page.evaluate(() =>
      JSON.stringify([
        Object.entries(localStorage),
        Object.entries(sessionStorage),
      ]),
    );
    expect(storage).not.toContain("804297");
    expect(storage).not.toContain("synthetic-password");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  });
}
