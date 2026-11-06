import test from "node:test";
import assert from "node:assert/strict";
import express, { type Request } from "express";
import { createServer } from "node:http";
import { once } from "node:events";
import { forwardedIp, normalizeIp } from "./ipAddress.js";
import { getClientIp, requestHost, requestNetwork, validateProxyRequest } from "./clientIp.js";
import { env } from "../config/env.js";
import { matchesIpRestriction } from "../modules/dashboard/dashboardDeviceIp.js";
import { auditRequestContext } from "../modules/audit/auditContext.js";

for (const [input, expected] of [
  ["192.0.2.1", "192.0.2.1"], [" ::FFFF:192.0.2.1 ", "192.0.2.1"],
  ["0:0:0:0:0:FFFF:C000:0201", "192.0.2.1"], ["2001:0DB8:0:0:0:0:0:0001", "2001:db8::1"],
  ["::1", "::1"], ["::", "::"], ["2001:db8::1234", "2001:db8::1234"],
  ["192.0.2.1:50000", "192.0.2.1"], ["[2001:0db8::1]:443", "2001:db8::1"],
  ["[::FFFF:C000:201]:65535", "192.0.2.1"], ["[::1]", "::1"],
  ["", ""], ["unknown", ""], ["01.2.3.4", ""], ["192.0.2.1:0", ""],
  ["192.0.2.1:65536", ""], ["[2001:db8::1]:-1", ""], ["[::1]:999999", ""],
  ["fe80::1%eth0", ""], ["192.0.2.1,198.51.100.1", ""], ["host.example:443", ""],
] as const) test(`ARR forwarded endpoint ${input || "empty"}`, () => assert.equal(forwardedIp(input), expected));

test("IP ACLs equate mapped/canonical IPv6, preserve IPv4 CIDR and reject invalid identity", () => {
  assert.equal(normalizeIp("192.0.2.1:443"), "");
  assert(matchesIpRestriction("::FFFF:C000:201", "192.0.2.1", null));
  assert(matchesIpRestriction("2001:db8::1", "2001:0DB8:0:0:0:0:0:1", null));
  assert(matchesIpRestriction("::FFFF:192.0.2.1", null, "192.0.2.0/24"));
  assert(!matchesIpRestriction("2001:db8::2", "2001:db8::1", null));
  assert(!matchesIpRestriction("", "invalid", "0.0.0.0/0"));
  assert(!matchesIpRestriction("invalid", "invalid", null));
});
const proxies = ["127.0.0.1", "::1", "10.0.0.2"];
function request(peer: string, headers: Record<string, string | string[]> = {}, tls = false): Request {
  return { socket: { remoteAddress: peer, encrypted: tls }, headers,
    rawHeaders: Object.entries(headers).flatMap(([name, values]) => (Array.isArray(values) ? values : [values]).flatMap(value => [name, value])) } as unknown as Request;
}
test("TCP peer determines trust; right-to-left traversal stops before spoofed prefix", () => {
  const headers = { "x-forwarded-for": "192.0.2.99, 198.51.100.7:54321", "x-forwarded-proto": "https", "x-real-ip": "192.0.2.99" };
  assert.deepEqual(requestNetwork(request("::ffff:127.0.0.1", headers), proxies), { clientIp: "198.51.100.7", secure: true, valid: true, viaTrustedProxy: true });
  assert.equal(requestNetwork(request("127.0.0.1", { ...headers, "x-forwarded-for": "192.0.2.99, [2001:db8::5]:50000, 10.0.0.2" }), proxies).clientIp, "2001:db8::5");
  assert.deepEqual(requestNetwork(request("203.0.113.9", headers), proxies), { clientIp: "203.0.113.9", secure: false, valid: true, viaTrustedProxy: false });
  assert.equal(requestNetwork(request("203.0.113.9", headers, true), proxies).secure, true);
  assert.equal(requestNetwork(request("127.0.0.1", headers), []).clientIp, "127.0.0.1");
});
test("forwarded Host is single-valued and trusted only through a valid allowlisted peer", () => {
  const headers = { host:"127.0.0.1:3200", "x-forwarded-host":"uqp.tjci.org.tw", "x-forwarded-proto":"https", "x-forwarded-for":"192.0.2.1:50000" };
  assert.equal(requestHost(request("127.0.0.1",headers),proxies),"uqp.tjci.org.tw");
  assert.equal(requestHost(request("203.0.113.1",headers),proxies),"127.0.0.1:3200");
  assert.equal(requestHost(request("127.0.0.1",{...headers,"x-forwarded-host":["uqp.tjci.org.tw","evil.test"]}),proxies),null);
  assert.equal(requestHost(request("127.0.0.1",{...headers,"x-forwarded-for":"invalid"}),proxies),null);
});
for (const headers of [
  {}, { "x-forwarded-proto": "https" }, { "x-forwarded-for": "192.0.2.1" },
  { "x-forwarded-for": "PRIVATE_INVALID", "x-forwarded-proto": "https" },
  { "x-forwarded-for": "192.0.2.1,", "x-forwarded-proto": "https" },
  { "x-forwarded-for": ["192.0.2.1", "198.51.100.1"], "x-forwarded-proto": "https" },
  { "x-forwarded-for": "192.0.2.1", "x-forwarded-proto": "http, https" },
  { "x-forwarded-for": "192.0.2.1", "x-forwarded-proto": ["https", "https"] },
  { "x-forwarded-for": Array(33).fill("192.0.2.1").join(","), "x-forwarded-proto": "https" },
  { "x-forwarded-for": " ".repeat(4097), "x-forwarded-proto": "https" },
] as Record<string, string | string[]>[]) test(`malformed trusted proxy metadata case ${Object.keys(headers).join("/")}:${JSON.stringify(headers).length}`, () => {
  const network = requestNetwork(request("127.0.0.1", headers), proxies);
  assert.equal(network.valid, false); assert.equal(network.clientIp, null); assert.equal(network.secure, false);
});

test("HTTP middleware and patient Audit agree on ARR IPv4:port/IPv6; malformed metadata never reaches delivery", async t => {
  const prior = { enabled: env.TRUST_PROXY_ENABLED, addresses: env.TRUSTED_PROXY_ADDRESSES };
  env.TRUST_PROXY_ENABLED = true; env.TRUSTED_PROXY_ADDRESSES = proxies;
  t.after(() => { env.TRUST_PROXY_ENABLED = prior.enabled; env.TRUSTED_PROXY_ADDRESSES = prior.addresses; });
  const app = express(); let delivered = 0;
  app.use(validateProxyRequest);
  app.get("/", (req, res) => { delivered++; res.json({ ip: getClientIp(req), audit: auditRequestContext(req).ipAddress }); });
  const server = createServer(app); server.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}/`;
  for (const [forwarded, ip] of [["192.0.2.99, 198.51.100.8:60000", "198.51.100.8"], ["[2001:0DB8::1]:443", "2001:db8::1"], ["::FFFF:C000:201", "192.0.2.1"]]) {
    const res = await fetch(url, { headers: { "x-forwarded-for": forwarded!, "x-forwarded-proto": "https" } });
    assert.equal(res.status, 200); assert.deepEqual(await res.json(), { ip, audit: ip });
  }
  const invalid = await fetch(url, { headers: { "x-forwarded-for": "PRIVATE_INVALID", "x-forwarded-proto": "https" } });
  assert.equal(invalid.status, 400); assert(!JSON.stringify(await invalid.json()).includes("PRIVATE_INVALID")); assert.equal(delivered, 3);
  env.TRUST_PROXY_ENABLED = false;
  const direct = await fetch(url, { headers: { "x-forwarded-for": "192.0.2.99", "x-forwarded-proto": "https" } });
  assert.deepEqual(await direct.json(), { ip: "127.0.0.1", audit: "127.0.0.1" });
});
