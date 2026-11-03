import assert from "node:assert/strict";
import test from "node:test";
import { createHmac, scryptSync } from "node:crypto";
import { hashPin, verifyPin, parsePinPepper } from "./pinVerifier.js";

const pepper = parsePinPepper("test-v1", Buffer.alloc(32, 17).toString("base64"));
test("scrypt PIN verifier salts records and requires both PIN and external pepper", async () => {
  const a = await hashPin("739204", pepper), b = await hashPin("739204", pepper);
  assert.notEqual(a, b);
  assert.ok(a.length < 512);
  assert.ok(!a.includes("739204"));
  assert.ok(await verifyPin("739204", a, pepper));
  assert.equal(await verifyPin("739205", a, pepper), false);
  assert.equal(await verifyPin("739204", a, { ...pepper, key: Buffer.alloc(32, 18) }), false);
  assert.equal(await verifyPin("739204", a, { ...pepper, id: "test-v2" }), false);
});
test("verifier rejects legacy bcrypt, unknown formats, altered costs and noncanonical encodings", async () => {
  const hash = await hashPin("739204", pepper);
  for (const value of ["$2b$12$legacy", hash.replace("32768", "1048576"), hash.replace("$1$", "$2$"),
    hash + "$extra", hash.slice(0, -1), "x".repeat(513)]) {
    assert.equal(await verifyPin("739204", value, pepper), false);
  }
  assert.equal(await verifyPin("123", hash, pepper), false);
  assert.equal(await verifyPin("１２３４", hash, pepper), false);
});
test("4 and 12 digit boundary PINs supported; malformed pepper fails closed without echoing it", async () => {
  for (const pin of ["7392", "739204857126"]) assert.ok(await verifyPin(pin, await hashPin(pin, pepper), pepper));
  for (const pin of ["123", "1".repeat(13), "73 92"]) await assert.rejects(hashPin(pin, pepper), /PIN_FORMAT_INVALID/);
  for (const value of [undefined, "synthetic-secret", Buffer.alloc(31).toString("base64"), Buffer.alloc(33).toString("base64")]) {
    assert.throws(() => parsePinPepper("test", value), /^Error: PIN_PEPPER_NOT_CONFIGURED$/);
  }
  assert.throws(() => parsePinPepper("bad$id", pepper.key.toString("base64")), /PIN_PEPPER_NOT_CONFIGURED/);
});
test("concurrent KDF jobs are bounded and release slots after completion", async () => {
  const jobs = [hashPin("739204", pepper), hashPin("739205", pepper)];
  await assert.rejects(hashPin("739206", pepper), /PIN_VERIFIER_BUSY/);
  await Promise.all(jobs);
  assert.ok(await verifyPin("739204", await hashPin("739204", pepper), pepper));
});

test("new scrypt hashes use approved p=1; earlier p=3 hashes remain verifiable", async () => {
  const current = await hashPin("739204", pepper);
  assert.match(current, /\$32768\$8\$1\$/);
  const salt = Buffer.alloc(16, 4);
  const input = createHmac("sha256", pepper.key).update("uqp:pin:v1\0").update("739204", "utf8").digest();
  const legacyKey = scryptSync(input, salt, 32, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 });
  input.fill(0);
  const legacy = `$uqp-scrypt$1$${pepper.id}$32768$8$3$${salt.toString("base64url")}$${legacyKey.toString("base64url")}`;
  legacyKey.fill(0);
  assert.equal(await verifyPin("739204", legacy, pepper), true);
  assert.equal(await verifyPin("739205", legacy, pepper), false);
  assert.equal(await verifyPin("739204", legacy.replace("$8$3$", "$8$2$"), pepper), false);
});
