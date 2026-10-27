import { expect, test, type Page } from "@playwright/test";

const channel = "uqp.h0-4.synthetic-browser-test";
const session = "00000000-0000-4000-8000-000000000901";
const incarnation = "00000000-0000-4000-8000-000000000902";

async function createGuard(page: Page, workstationId: string, operatorUserId: number) {
  await page.route("**/api/**", (route) => route.fulfill({ json: {} }));
  await page.goto("/login");
  await page.evaluate(async ({ channelName, workstation, user, deviceSession, operatorIncarnation }) => {
    // @ts-expect-error Vite serves this browser-only source path during Playwright.
    const module = await import("/src/security/sharedWorkstationSession.ts");
    const guard = module.createSharedWorkstationSafetyController({
      workstationId: workstation,
      idleTimeoutMs: 30_000,
      transport: module.createBrowserRestrictiveSyncTransport(channelName),
    });
    guard.applyServerObservation({
      format: "WORKSTATION_OPERATOR_BROWSER_OBSERVATION_V1",
      workstationId: workstation,
      deviceSessionId: deviceSession,
      operatorUserId: user,
      generation: 1,
      incarnation: operatorIncarnation,
      expiresAtMs: Date.now() + 60_000,
    });
    (window as unknown as { syntheticH04Guard: typeof guard }).syntheticH04Guard = guard;
  }, {
    channelName: channel,
    workstation: workstationId,
    user: operatorUserId,
    deviceSession: session,
    operatorIncarnation: incarnation,
  });
}

async function status(page: Page) {
  return page.evaluate(() =>
    (window as unknown as { syntheticH04Guard: { getState(): { status: string; reason: string | null } } })
      .syntheticH04Guard.getState(),
  );
}

test("real BroadcastChannel synchronizes only restrictive events for the same workstation", async ({ browser }) => {
  const context = await browser.newContext();
  const first = await context.newPage();
  const second = await context.newPage();
  const other = await context.newPage();
  await createGuard(first, "9007199254740993", 12);
  await createGuard(second, "9007199254740993", 12);
  await createGuard(other, "9007199254740994", 22);

  await first.evaluate(() =>
    (window as unknown as { syntheticH04Guard: { lock(reason: string): void } })
      .syntheticH04Guard.lock("OPERATOR_SWITCH"),
  );
  await expect.poll(async () => (await status(second)).status).toBe("LOCKED");
  expect((await status(second)).reason).toBe("OPERATOR_SWITCH");
  expect((await status(other)).status).toBe("OPERATOR_ACTIVE");

  const offlineState = await other.evaluate(async () => {
    // @ts-expect-error Vite serves this browser-only source path during Playwright.
    const module = await import("/src/security/sharedWorkstationSession.ts");
    const guard = (window as unknown as {
      syntheticH04Guard: { getState(): { status: string; reason: string | null } };
    }).syntheticH04Guard;
    // The page owns the real controller; this narrow cast only crosses Playwright's serialization boundary.
    const browserGuard = guard as Parameters<typeof module.attachBrowserWorkstationSafetyEvents>[0];
    const detach = module.attachBrowserWorkstationSafetyEvents(browserGuard, window, document, 60_000);
    window.dispatchEvent(new Event("offline"));
    window.dispatchEvent(new Event("online"));
    detach();
    return guard.getState();
  });
  expect(offlineState.status).toBe("LOCKED");
  expect(offlineState.reason).toBe("NETWORK_UNAVAILABLE");

  await second.reload();
  const refreshed = await second.evaluate(async ({ channelName, workstation }) => {
    // @ts-expect-error Vite serves this browser-only source path during Playwright.
    const module = await import("/src/security/sharedWorkstationSession.ts");
    const guard = module.createSharedWorkstationSafetyController({
      workstationId: workstation,
      idleTimeoutMs: 30_000,
      transport: module.createBrowserRestrictiveSyncTransport(channelName),
    });
    return guard.getState();
  }, { channelName: channel, workstation: "9007199254740993" });
  expect(refreshed.status).toBe("LOCKED");
  expect(refreshed.operatorUserId).toBeNull();
  await context.close();
});

test("missing BroadcastChannel fails closed without inventing an operator session", async ({ page }) => {
  await page.route("**/api/**", (route) => route.fulfill({ json: {} }));
  await page.goto("/login");
  const outcome = await page.evaluate(async ({ channelName, workstation, deviceSession, operatorIncarnation }) => {
    Object.defineProperty(window, "BroadcastChannel", { configurable: true, value: undefined });
    // @ts-expect-error Vite serves this browser-only source path during Playwright.
    const module = await import("/src/security/sharedWorkstationSession.ts");
    const guard = module.createSharedWorkstationSafetyController({
      workstationId: workstation,
      idleTimeoutMs: 30_000,
      transport: module.createBrowserRestrictiveSyncTransport(channelName),
    });
    const accepted = guard.applyServerObservation({
      format: "WORKSTATION_OPERATOR_BROWSER_OBSERVATION_V1",
      workstationId: workstation,
      deviceSessionId: deviceSession,
      operatorUserId: 12,
      generation: 1,
      incarnation: operatorIncarnation,
      expiresAtMs: Date.now() + 60_000,
    });
    return { accepted, state: guard.getState() };
  }, { channelName: channel, workstation: "9007199254740993", deviceSession: session, operatorIncarnation: incarnation });
  expect(outcome.accepted).toBe(false);
  expect(outcome.state.status).toBe("LOCKED");
  expect(outcome.state.reason).toBe("SYNC_UNAVAILABLE");
});
