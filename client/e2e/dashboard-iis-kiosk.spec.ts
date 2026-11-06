import { test, expect, chromium, request, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";

// Actual TLS frontend -> loopback HTTP backend; synthetic ARR/DB, not live IIS.
let fixture: ChildProcess, port: number, control: APIRequestContext;
const origin = () => `https://127.0.0.1:${port}`;
const display = () => `${origin()}/display/dashboards/1?deviceId=7`;
const token = "A".repeat(43);
test.use({ ignoreHTTPSErrors: true });
test.beforeAll(async () => {
  fixture = spawn(process.execPath, ["--import", "tsx", "src/modules/dashboard/dashboardKiosk.testFixture.ts", "--serve-arr-fixture"], { cwd: path.resolve("../server"), stdio: ["ignore", "pipe", "pipe"] });
  port = await new Promise<number>((resolve, reject) => { let output = ""; fixture.stdout!.on("data", chunk => { output += chunk.toString(); if (/^\d+\n/.test(output)) resolve(Number(output.trim())); }); fixture.on("error", reject); fixture.on("exit", () => reject(new Error("Synthetic ARR fixture exited"))); });
  control = await request.newContext({ baseURL: origin(), ignoreHTTPSErrors: true });
});
test.afterAll(async () => { await control?.dispose(); fixture?.kill(); });
async function state(value: Record<string, unknown>) { expect((await control.post("/test/state", { data: value })).ok()).toBe(true); }
test.beforeEach(async () => state({ revoked: false, expired: false, ipDenied: false, delegationDenied: false, policyDenied: false, auditDenied: false, mode: "QUERY_ONLY", version: 4, token, expires: Date.now() + 31 * 86400000, requiredIp: "198.51.100.8", proxyClientEndpoint: "198.51.100.8:54321", seenIp: "", patientAuditIp: "", delivered: 0 }));
async function enroll(page: Page) {
  await page.goto(display()); await expect(page.getByLabel("Device Token", { exact: true })).toBeVisible();
  await page.getByLabel("Device Token", { exact: true }).fill(token); await page.getByRole("button", { name: "驗證並啟用播放", exact: true }).click();
  await expect(page.getByText("合○播放", { exact: true })).toBeVisible();
}
for (const [endpoint, ip] of [["198.51.100.8:54321", "198.51.100.8"], ["[2001:0DB8:0:0:0:0:0:7]:60000", "2001:db8::7"], ["[::FFFF:C633:6408]:50000", "198.51.100.8"]]) test(`IIS-equivalent TLS + BAT profile restart, ACL and Audit: ${endpoint}`, async () => {
  await state({ requiredIp: ip, proxyClientEndpoint: endpoint });
  const root = await mkdtemp(path.join(tmpdir(), "uqp-arr-profile-82-")); let context: BrowserContext | undefined;
  const profile = path.join(root, "UQP", "Kiosk", createHash("sha256").update(origin()).digest("hex").slice(0, 16), "device-7");
  try {
    const launch = () => chromium.launchPersistentContext(profile, { headless: true, executablePath: process.env.CHROMIUM_PATH, ignoreHTTPSErrors: true, args: ["--window-size=1400,800", "--start-fullscreen"] });
    context = await launch(); const page = await context.newPage(); await enroll(page);
    const cookies = await context.cookies(origin()); expect(cookies).toHaveLength(2);
    for (const c of cookies) { expect(c.secure && c.httpOnly && c.sameSite === "Strict").toBe(true); expect(c.value).not.toContain(token); expect(c.expires).toBeLessThanOrEqual((Date.now() + 31 * 86400000) / 1000); }
    expect(await page.evaluate(() => JSON.stringify([document.cookie, localStorage, sessionStorage]))).not.toContain(token); expect(page.url()).not.toContain(token);
    await page.reload(); await expect(page.getByText("合○播放", { exact: true })).toBeVisible();
    await context.close(); context = await launch(); const restored = await context.newPage(); await restored.goto(display());
    await expect(restored.getByText("合○播放", { exact: true })).toBeVisible(); await expect(restored.getByLabel("Device Token", { exact: true })).toHaveCount(0);
    const status = await (await control.get("/test/status")).json(); expect(status.seenIp).toBe(ip); expect(status.patientAuditIp).toBe(ip);
    await state({ revoked: true }); await restored.reload(); await expect(restored.getByLabel("Device Token", { exact: true })).toBeVisible(); await expect(restored.getByText("合○播放", { exact: true })).toHaveCount(0);
  } finally { await context?.close(); await rm(root, { recursive: true, force: true }); }
});
test("ARR appending the actual caller defeats a forged prefix; site overwrites Host/Proto", async ({ page, context }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": "192.0.2.99", "x-forwarded-proto": "http", "x-forwarded-host": "evil.test" });
  await enroll(page); const status = await (await control.get("/test/status")).json(); expect(status.seenIp).toBe("198.51.100.8"); expect(status.patientAuditIp).toBe("198.51.100.8");
  const badHost = await control.post("/api/dashboards/device/1/kiosk/enrollment", { headers: { host: "evil.test", origin: origin(), "x-uqp-kiosk": "1" }, data: { deviceId: 7, token } });
  expect(badHost.status()).toBe(400); expect(badHost.headers()["set-cookie"]).toBeUndefined();
});
for (const change of [{ revoked: true }, { expired: true }, { delegationDenied: true }, { mode: "QUERY_ONLY_DISABLED" }, { policyDenied: true }, { auditDenied: true }, { proxyClientEndpoint: "203.0.113.8:55000" }]) test(`ARR cookie playback refuses subsequent delivery: ${JSON.stringify(change)}`, async ({ page }) => {
  await enroll(page); await state(change); const status = await (await control.get("/test/status")).json();
  await page.reload(); await expect(page.getByLabel("Device Token", { exact: true })).toBeVisible(); await expect(page.getByText("合○播放", { exact: true })).toHaveCount(0);
  const after = await (await control.get("/test/status")).json(); expect(after.delivered).toBe(status.delivered); await expect(page.locator("body")).not.toContainText("PRIVATE");
});
