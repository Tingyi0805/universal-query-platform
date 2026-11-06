import { test } from "node:test";
import assert from "node:assert/strict";
import type { Request, Response } from "express";
import { credentialCookie, sessionCookie, readOpaqueCookie, parseOpaqueToken, setOpaqueCookie, clearPinSession,
  workstationBoundary, workstationCsrf, matchesWorkstationCsrf, pinSessionHash } from "./workstationCookies.js";
const token = `12345678-1234-4234-8234-123456789abc.${Buffer.alloc(32, 7).toString("base64url")}`;
const other = `12345678-1234-4234-8234-123456789abd.${Buffer.alloc(32, 8).toString("base64url")}`;
test("opaque cookies reject duplicates, malformed, noncanonical and oversized input", () => {
  assert.equal(readOpaqueCookie(`${credentialCookie}=${token}`, credentialCookie), token);
  for (const h of [undefined, `${credentialCookie}=${token}; ${credentialCookie}=${other}`, `${credentialCookie}=%20`, "x".repeat(9000)])
    assert.equal(readOpaqueCookie(h, credentialCookie), null);
  assert.equal(parseOpaqueToken(`${token}.extra`), null);
});
test("credential/session cookies are Secure HttpOnly host-only Strict; session has no persistence by default", () => {
  const writes: unknown[][] = [];
  const res = { cookie: (...args: unknown[]) => writes.push(args), clearCookie: (...args: unknown[]) => writes.push(args) } as unknown as Response;
  setOpaqueCookie(res, credentialCookie, token, 3600000);
  setOpaqueCookie(res, sessionCookie, other);
  clearPinSession(res);
  assert.deepEqual(writes[1], [sessionCookie, other, { secure: true, httpOnly: true, sameSite: "strict", path: "/" }]);
  assert.deepEqual(writes[2], [sessionCookie, { secure: true, httpOnly: true, sameSite: "strict", path: "/" }]);
});
test("CSRF is bound to credential and current session and rejects missing/malformed tokens", () => {
  const key = Buffer.alloc(32, 9), before = workstationCsrf(key, token, null), after = workstationCsrf(key, token, other);
  assert.notEqual(before, after);
  assert.notEqual(before, workstationCsrf(key, other, null));
  assert.ok(matchesWorkstationCsrf(after, after));
  for (const bad of [undefined, [], before, "x".repeat(10000)]) assert.equal(matchesWorkstationCsrf(bad, after), false);
});
test("session hash binds opaque credential, version and BIGINT generation without rounding", () => {
  const hash = pinSessionHash(token, other, 1, "9007199254740992");
  for (const changed of [pinSessionHash(other, other, 1, "9007199254740992"), pinSessionHash(token, token, 1, "9007199254740992"),
    pinSessionHash(token, other, 2, "9007199254740992"), pinSessionHash(token, other, 1, "9007199254740993")]) assert.notDeepEqual(hash, changed);
});
test("HTTPS origin/host and trusted network boundary rejects cross-origin, device/Bearer and spoofed TLS", () => {
  const req = { socket: { remoteAddress: "192.0.2.1", encrypted: true }, headers: { host: "uqp.example", origin: "https://uqp.example" }, rawHeaders: [] } as unknown as Request;
  assert.ok(workstationBoundary(req, "https://uqp.example", true));
  for (const headers of [{ origin: "https://evil.example" }, { authorization: "Bearer x" }, { "x-dashboard-device-token": "x" }, { host: "evil.example" }, { "sec-fetch-site": "cross-site" }])
    assert.equal(workstationBoundary({ ...req, headers: { ...req.headers, ...headers } } as Request, "https://uqp.example", true), false);
  assert.equal(workstationBoundary({ ...req, headers: { host: "uqp.example" } } as Request, "https://uqp.example", true), false);
  assert.equal(workstationBoundary({ ...req, socket: { remoteAddress: "192.0.2.1" }, headers: { ...req.headers, "x-forwarded-proto": "https" } } as unknown as Request, "https://uqp.example", true), false);
  assert.equal(workstationBoundary(req, "http://uqp.example", true), false);
});
