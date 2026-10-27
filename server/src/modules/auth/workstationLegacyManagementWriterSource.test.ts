import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { workstationRevocationWriterInventory } from "./workstationRevocationWriterInventory.js";

const root = new URL("../../../../", import.meta.url);
const source = (id: string): string => {
  const writer = workstationRevocationWriterInventory.find(item => item.id === id);
  assert.ok(writer?.source, id);
  assert.equal(writer.state, "GAP", id);
  return readFileSync(new URL(writer.source, root), "utf8");
};

test("user, role and permission mutations use the common owner; no unreviewed 926 sidecar writes", () => {
  const code = source("USER_ROLE_PERMISSION");
  for (const marker of [
    "export async function updateUser(", "export async function resetUserPassword(",
    "export async function updateRole(", "export async function deleteUser(",
    "export async function revokeUserSessions(", "DELETE FROM uqp.UserRole",
    "DELETE FROM uqp.RolePermission",
  ]) assert.ok(code.includes(marker), marker);
  assert.match(code, /withLegacyWorkstationTransaction/u);
  assert.doesNotMatch(code, /new sql.Transaction|\.begin\(|\.commit\(|\.rollback\(/u);
  assert.doesNotMatch(code, /SharedWorkstationOperatorState|SharedWorkstationDeviceSession|uqp\.workstation\.session\.security/u);
});

test("legacy workstation status and grants retain old invalidation behind the transitional guard", () => {
  const code = source("WORKSTATION_STATE");
  for (const marker of [
    "export async function updateSharedWorkstation(",
    "export async function setWorkstationUsers(",
    "UPDATE uqp.SharedWorkstationSession SET RevokedAtUtc",
    "DELETE FROM uqp.SharedWorkstationUser",
  ]) assert.ok(code.includes(marker), marker);
  assert.match(code, /legacyWorkstationWriterFenceSql/u);
  assert.doesNotMatch(code, /SharedWorkstationOperatorState|SharedWorkstationDeviceSession|uqp\.workstation\.session\.security/u);
});

test("workstation management takes the H0 legacy denial fence before its config gate", () => {
  const code = source("WORKSTATION_GRANTS");
  for (const marker of [
    "uqp.workstation.config", "UPDATE uqp.SharedWorkstationCredential SET IsRevoked=1",
    "UPDATE uqp.SharedWorkstationSession SET RevokedAtUtc",
    "DELETE FROM uqp.SharedWorkstationAudience",
    "WorkstationAudienceMember",
  ]) assert.ok(code.includes(marker), marker);
  assert.match(code, /await deps.request\(tx\).query\(legacyWorkstationWriterFenceSql\)/u);
  assert.ok(code.indexOf("await deps.request(tx).query(legacyWorkstationWriterFenceSql)") <
    code.indexOf("EXEC @lock=sys.sp_getapplock"));
  assert.doesNotMatch(code, /SharedWorkstationOperatorState|SharedWorkstationDeviceSession|uqp\.workstation\.session\.security/u);
});
