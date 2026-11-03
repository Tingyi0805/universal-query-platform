import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import { createWorkstationPinRouter } from "./workstationPin.routes.js";
import { credentialCookie, sessionCookie, workstationCsrf } from "./workstationCookies.js";
const credential = `12345678-1234-4234-8234-123456789abc.${Buffer.alloc(32, 7).toString("base64url")}`;
const token = `12345678-1234-4234-8234-123456789abd.${Buffer.alloc(32, 8).toString("base64url")}`;
const key = Buffer.alloc(32, 9);
async function fixture(run: (f: { state: { enabled: boolean; valid: boolean; fail: boolean; calls: number }; request: (path: string, method?: string, body?: unknown, headers?: Record<string, string>) => Promise<Response> }) => Promise<void>) {
  const state = { enabled: true, valid: true, fail: false, calls: 0 };
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { Object.assign(req.socket, { encrypted: true }); req.headers.host = "uqp.example"; next(); });
  app.use(createWorkstationPinRouter({ enabled: () => state.enabled, origin: () => "https://uqp.example", key: () => key,
    sessions: { credential: async () => state.valid ? { workstationId: 7, credentialVersion: 1, generation: "2" } : null,
      read: async () => state.valid ? { userId: 8, username: "synthetic", displayName: "Synthetic", sessionId: "session-B" } as never : null,
      candidate: async () => null, accountBucketIdentity: async () => "user:8", expire: async () => [], insert: async () => {}, touch: async () => null },
    service: { login: async () => { state.calls++; if (state.fail) throw new Error("password=synthetic;SELECT private"); return { status: "OK", token }; },
      lock: async () => { state.calls++; }, activity: async () => null, current: async () => null },
  }));
  const server = createServer(app); await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try { await run({ state, request: (path, method = "GET", body, headers = {}) => fetch(base + path, {
    method, headers: { origin: "https://uqp.example", "content-type": "application/json", cookie: `${credentialCookie}=${credential}`,
      "x-workstation-csrf": workstationCsrf(key, credential, null), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }) }); } finally { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); }
}
test("runtime off returns 404 before database or mutation", () => fixture(async f => {
  f.state.enabled = false; const res = await f.request("/login", "POST", { username: "synthetic", pin: "837294" });
  assert.equal(res.status, 404); assert.equal(f.state.calls, 0); assert.equal(res.headers.get("cache-control"), "no-store");
}));
test("CSRF/origin/Bearer/device failures precede PIN verification and never set cookies", () => fixture(async f => {
  for (const headers of [{ "x-workstation-csrf": "" }, { origin: "https://evil.example" }, { authorization: "Bearer synthetic" }, { "x-dashboard-device-token": "synthetic" }] as Record<string, string>[]) {
    const res = await f.request("/login", "POST", { username: "synthetic", pin: "837294" }, headers);
    assert.equal(res.status, 403); assert.equal(res.headers.get("set-cookie"), null);
  }
  assert.equal(f.state.calls, 0);
}));
test("login returns restricted opaque Secure HttpOnly cookie and rotated session-bound CSRF, no JWT", () => fixture(async f => {
  const res = await f.request("/login", "POST", { username: "synthetic", pin: "837294" });
  assert.equal(res.status, 200); const body = await res.json();
  assert.equal(body.accessToken, undefined); assert.equal(body.csrfToken, workstationCsrf(key, credential, token));
  assert.match(res.headers.get("set-cookie")!, /__Host-uqp-pin-session=.*HttpOnly; Secure; SameSite=Strict/);
  const lock = await f.request("/lock", "POST", {}, { cookie: `${credentialCookie}=${credential}; ${sessionCookie}=${token}` });
  assert.equal(lock.status, 403); // Pre-login CSRF no longer works.
}));
test("pair requires custom header; invalid credentials and driver failures expose no secrets", () => fixture(async f => {
  assert.equal((await f.request("/pair", "POST", { credential })).status, 400);
  f.state.valid = false;
  assert.equal((await f.request("/pair", "POST", { credential }, { "x-workstation-pair": "1" })).status, 401);
  f.state.valid = true; f.state.fail = true;
  const res = await f.request("/switch", "POST", { username: "synthetic", pin: "837294" });
  assert.equal(res.status, 503); assert.deepEqual(await res.json(), { error: { code: "PIN_SERVICE_UNAVAILABLE" } });
  assert.equal(res.headers.get("set-cookie"), null);
}));
test("malformed B switch still revokes A before rejecting input", () => fixture(async f => {
  const res = await f.request("/switch", "POST", { username: "B", pin: "bad" });
  assert.equal(res.status, 400); assert.equal(f.state.calls, 1); assert.equal(res.headers.get("set-cookie"), null);
}));
