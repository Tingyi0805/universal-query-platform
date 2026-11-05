import test from "node:test";
import assert from "node:assert/strict";
import { assertSecuritySchema, nextConfigurationVersion, parseApprovalVersion, parseConfigurationVersion,
  securitySchemaRequirements, SecurityContractError } from "./securityContract.js";

test("configuration versions preserve BIGINT precision and unconfigured zero", () => {
  assert.equal(parseConfigurationVersion("0"), 0n);
  assert.equal(nextConfigurationVersion("0"), "1");
  assert.equal(nextConfigurationVersion("9007199254740992"), "9007199254740993");
  assert.equal(nextConfigurationVersion("9223372036854775806"), "9223372036854775807");
});
test("invalid representations and BIGINT overflow fail closed", () => {
  for (const value of [0, 1n, null, undefined, "", "01", "-1", " 1", "1\n", "1.0", "1e2", "9223372036854775808", "9".repeat(100)])
    assert.throws(() => parseConfigurationVersion(value), SecurityContractError);
  assert.throws(() => parseConfigurationVersion("0", false), SecurityContractError);
  assert.throws(() => nextConfigurationVersion("9223372036854775807"), { code: "SECURITY_VERSION_EXHAUSTED", status: 409 });
});
test("approval digest has canonical format", () => {
  assert.equal(parseApprovalVersion("a".repeat(64)), "a".repeat(64));
  for (const value of [null, "a".repeat(63), "A".repeat(64), "g".repeat(64), "a".repeat(64) + "\n"])
    assert.throws(() => parseApprovalVersion(value), SecurityContractError);
});
test("mock catalog evidence rejects every missing or false requirement", () => {
  const complete = Object.fromEntries(securitySchemaRequirements.map(key => [key, true]));
  assert.doesNotThrow(() => assertSecuritySchema(complete));
  for (const key of securitySchemaRequirements) {
    assert.throws(() => assertSecuritySchema({ ...complete, [key]: false }), { code: "SECURITY_SCHEMA_REQUIRED", status: 503 });
    const missing = { ...complete }; delete missing[key];
    assert.throws(() => assertSecuritySchema(missing), SecurityContractError);
  }
  assert.throws(() => assertSecuritySchema(null), SecurityContractError);
  assert.throws(() => assertSecuritySchema({}), SecurityContractError);
});
