import { test, expect, type Page } from "@playwright/test";

type DateParameter = {
  name: string; label: string; dataType: string; controlType: string;
  defaultValue: string; runtimeDefaultValue: string; dateOutputMode: string;
  dateCalendar: string; dateFormat: string | null;
};
const examDate: DateParameter = { name: "EXAM_DATE", label: "檢查日期", dataType: "DATE", controlType: "DATE",
  defaultValue: "$TODAY", runtimeDefaultValue: "2026-10-27", dateOutputMode: "NATIVE",
  dateCalendar: "GREGORIAN", dateFormat: "yyyyMMdd" };
async function setup(page: Page, parameters: DateParameter[] = [examDate]) {
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
        parameters: parameters.map(p => ({ ...p, isRequired: true,
          displayOrder: 0, placeholder: null, helpText: null, optionMode: "NONE" })),
        reportColumns: [],
      } });
      return;
    }
    await route.fulfill({ json: {} });
  });
  await page.goto("/queries/2");
  return () => submitted;
}

for (const [calendar, format, initial, edited] of [
  ["GREGORIAN", "yyyyMMdd", "20261027", "20261028"],
  ["ROC", "yyyMMdd", "1151027", "1151028"],
  ["ROC", "yyy/MM/dd", "115/10/27", "115/10/28"],
  ["ROC", "yyy-MM-dd", "115-10-27", "115-10-28"],
]) test(`query DATE ${calendar}/${format} supports text, calendar and reset`, async ({ page }) => {
  const submitted = await setup(page, [{ ...examDate, dateCalendar: calendar, dateFormat: format }]);
  const date = page.getByRole("textbox", { name: `檢查日期（${format}）`, exact: true });
  const picker = page.getByLabel("檢查日期 日曆選擇", { exact: true });
  await expect(date).toHaveValue(initial);
  await expect(picker).toHaveValue("2026-10-27");
  await date.fill(edited);
  await expect(picker).toHaveValue("2026-10-28");
  await page.getByRole("button", { name: "查詢", exact: true }).click();
  await expect.poll(submitted).toEqual({ values: { EXAM_DATE: "2026-10-28" } });
  await picker.fill("2026-10-27");
  await expect(date).toHaveValue(initial);
  await date.fill(edited);
  await page.getByRole("button", { name: "清除", exact: true }).click();
  await expect(date).toHaveValue(initial);
  await expect(picker).toHaveValue("2026-10-27");
});

test("ROC DATE rejects rollover text without corrupting the canonical calendar value", async ({ page }) => {
  await setup(page, [{ ...examDate, dateCalendar: "ROC", dateFormat: "yyyMMdd" }]);
  const date = page.getByRole("textbox", { name: "檢查日期（yyyMMdd）", exact: true });
  await date.fill("1150230");
  await expect(date).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByLabel("檢查日期 日曆選擇", { exact: true })).toHaveValue("2026-10-27");
  await date.blur();
  await expect(date).toHaveValue("1151027");
  await date.fill("1130229");
  await expect(page.getByLabel("檢查日期 日曆選擇", { exact: true })).toHaveValue("2024-02-29");
});

test.describe("platform DATETIME and BETWEEN inputs", () => {
  test.use({ timezoneId: "America/Los_Angeles" });
  test("SDATE/EDATE keep server defaults and seconds without browser timezone conversion", async ({ page }) => {
    const parameters = [
      { ...examDate, name: "SDATE", label: "開始時間", dataType: "DATETIME", controlType: "DATETIME",
        defaultValue: "$TODAY_START", runtimeDefaultValue: "2026-10-27T00:00:00", dateFormat: "yyyy-MM-dd HH:mm:ss" },
      { ...examDate, name: "EDATE", label: "結束時間", dataType: "DATETIME", controlType: "DATETIME",
        defaultValue: "$TODAY_END", runtimeDefaultValue: "2026-10-27T23:59:59", dateFormat: "yyyy-MM-dd HH:mm:ss" },
    ];
    const submitted = await setup(page, parameters);
    const start = page.getByLabel(/開始時間/), end = page.getByLabel(/結束時間/);
    await expect(start).toHaveValue("2026-10-27T00:00");
    await expect(end).toHaveValue("2026-10-27T23:59:59");
    await expect(end).toHaveAttribute("step", "1");
    await start.fill("2026-10-26T11:26:47");
    await end.fill("2026-10-28T12:34:56");
    await page.getByRole("button", { name: "查詢", exact: true }).click();
    await expect.poll(submitted).toEqual({ values: { SDATE: "2026-10-26T11:26:47", EDATE: "2026-10-28T12:34:56" } });
    await page.getByRole("button", { name: "清除", exact: true }).click();
    await expect(start).toHaveValue("2026-10-27T00:00");
    await expect(end).toHaveValue("2026-10-27T23:59:59");
  });
});
