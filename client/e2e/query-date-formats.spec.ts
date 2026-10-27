import { test, expect } from "@playwright/test";

test("query DATE uses Dataset Gregorian format and sends canonical value", async ({ page }) => {
  let submitted: unknown = null;
  await page.addInitScript(() => sessionStorage.setItem("uqp.auth", JSON.stringify({
    accessToken: "synthetic-token",
    user: { id: 5, username: "synthetic", displayName: "測試", permissions: ["VIEW_QUERY", "EXECUTE_QUERY"] },
  })));
  await page.route("**/api/queries/2**", async route => {
    const url = new URL(route.request().url());
    if (route.request().method() === "POST" && url.pathname.endsWith("/execute")) {
      submitted = route.request().postDataJSON();
      await route.fulfill({ json: { result: { columns: [], rows: [], rowCount: 0, truncated: false, elapsedMs: 1 } } });
      return;
    }
    if (url.pathname === "/api/queries/2") {
      await route.fulfill({ json: {
        query: { id: 2, code: "SYNTHETIC", name: "日期查詢", description: null, category: null,
          canView: true, canExecute: true, canExport: false },
        parameters: [{ name: "EXAM_DATE", label: "檢查日期", dataType: "DATE", controlType: "DATE",
          isRequired: true, defaultValue: "$TODAY", runtimeDefaultValue: "2026-10-27",
          dateOutputMode: "NATIVE", dateCalendar: "GREGORIAN", dateFormat: "yyyyMMdd",
          displayOrder: 0, placeholder: null, helpText: null, optionMode: "NONE" }],
        reportColumns: [],
      } });
      return;
    }
    await route.fulfill({ json: {} });
  });
  await page.goto("/queries/2");
  const date = page.getByRole("textbox", { name: /檢查日期/ });
  await expect(date).toHaveValue("20261027");
  await date.fill("20261028");
  await expect(date).toHaveValue("20261028");
  await page.getByRole("button", { name: "查詢", exact: true }).click();
  await expect.poll(() => submitted).toEqual({ values: { EXAM_DATE: "2026-10-28" } });
});
