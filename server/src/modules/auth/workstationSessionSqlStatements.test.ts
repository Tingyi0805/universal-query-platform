import assert from "node:assert/strict";
import test from "node:test";
import { deviceRenewalCasSql, renewalCasRequiredBindings } from "./workstationSessionSqlStatements.js";

test("926 device renewal CAS is guarded by revision, counter, expiry and device revocation", () => {
  for (const expression of [
    "ds.RowVersion = @expectedRevision", "ds.RenewalCounter = @expectedCounter",
    "ds.RevokedAtUtc IS NULL", "ds.IdleExpiresAtUtc > SYSUTCDATETIME()",
    "ds.AbsoluteExpiresAtUtc > SYSUTCDATETIME()", "w.IsActive = 1",
    "w.RetiredAtUtc IS NULL", "w.CredentialVersion = ds.BoundCredentialVersion",
    "c.IsRevoked = 0", "c.CredentialVersion = ds.BoundCredentialVersion",
    "@idleExpiresUtc <= ds.AbsoluteExpiresAtUtc",
  ]) assert.ok(deviceRenewalCasSql.includes(expression), expression);
});

test("renewal counter advances exactly once without SQL BIGINT overflow", () => {
  assert.match(deviceRenewalCasSql, /@nextCounter = ds\.RenewalCounter \+ CONVERT\(BIGINT, 1\)/u);
  assert.match(deviceRenewalCasSql, /ds\.RenewalCounter < 9223372036854775807/u);
  assert.match(deviceRenewalCasSql, /OUTPUT INSERTED\.RowVersion INTO @changed/u);
  assert.match(deviceRenewalCasSql, /CONVERT\(VARCHAR\(16\), Revision, 2\)/u);
});

test("statement does not interpolate caller data, issue authorization, or open its own connection", () => {
  assert.doesNotMatch(deviceRenewalCasSql, /\$\{|EXEC\s*\(|GRANT\s|JWT|AuditLog|QueryExecution/iu);
  const used = new Set([...deviceRenewalCasSql.matchAll(/@(\w+)/gu)].map(match => match[1])
    .filter(name => !["changed"].includes(name)));
  const required = new Set<string>(renewalCasRequiredBindings);
  for (const name of required) assert.ok(used.has(name), name);
  assert.equal(required.size, renewalCasRequiredBindings.length);
});
