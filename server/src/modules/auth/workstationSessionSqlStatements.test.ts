import assert from "node:assert/strict";
import test from "node:test";
import {
  deviceRenewalCasSql,
  renewalCasRequiredBindings,
  workstationSessionRepositorySql,
} from "./workstationSessionSqlStatements.js";

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
    .filter((name): name is string => typeof name === "string" && name !== "changed"));
  const required = new Set<string>(renewalCasRequiredBindings);
  for (const name of required) assert.ok(used.has(name), name);
  assert.equal(required.size, renewalCasRequiredBindings.length);
});

test("repository statements use a cooperative transaction gate and exact OUTPUT receipts", () => {
  assert.match(workstationSessionRepositorySql.acquireGate, /SET XACT_ABORT ON/u);
  assert.match(workstationSessionRepositorySql.acquireGate, /sp_getapplock/u);
  for (const statement of [
    workstationSessionRepositorySql.lockWorkstation,
    workstationSessionRepositorySql.lockCredential,
    workstationSessionRepositorySql.lockDevice,
    workstationSessionRepositorySql.readRequest,
  ]) assert.match(statement, /UPDLOCK, HOLDLOCK/u);
  assert.match(workstationSessionRepositorySql.insertRequest, /OUTPUT CONVERT\(VARCHAR\(36\), INSERTED\.RequestId\)/u);
  assert.match(workstationSessionRepositorySql.insertAudit, /OUTPUT CONVERT\(VARCHAR\(20\), INSERTED\.Id\)/u);
  assert.match(workstationSessionRepositorySql.insertDecision, /OUTPUT CONVERT\(VARCHAR\(36\), INSERTED\.RequestId\)/u);
  assert.doesNotMatch(Object.values(workstationSessionRepositorySql).join("\n"), /\$\{/u);
});


test("unreviewed broad revocation statements are no longer exported by the old Device repository", () => {
  for (const key of ["revokeDevice", "revokeDependents", "revokeCredentialSessions", "revokeWorkstationSessions"])
    assert.equal(key in workstationSessionRepositorySql, false);
});
