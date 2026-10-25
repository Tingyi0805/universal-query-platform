import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { workstationRevocationWriterInventory } from "./workstationRevocationWriterInventory.js";

const root = new URL("../../../../", import.meta.url);
const source = (path: string): string => readFileSync(new URL(path, root), "utf8");

test("Quick PIN legacy writer revokes old operator sessions but lacks 926 device/operator invalidation", () => {
  const writer = workstationRevocationWriterInventory.find(item => item.id === "PIN_ENROLL_REVOKE");
  assert.ok(writer);
  assert.equal(writer.state, "GAP");
  assert.ok(writer.source);
  const code = source(writer.source);
  assert.match(code, /UPDATE uqp\.UserQuickPin SET PinHash=/u);
  assert.match(code, /UPDATE uqp\.UserQuickPin SET IsEnabled=0/u);
  assert.match(code, /UPDATE uqp\.SharedWorkstationSession SET RevokedAtUtc=/u);
  // When implementation changes, intentionally re-review the inventory and
  // transactional guarantees instead of silently marking an existing writer safe.
  assert.doesNotMatch(code, /SharedWorkstationOperatorState|SharedWorkstationDeviceSession|sp_getapplock/u);
});

test("password TokenVersion writer is currently not joined to 926 session gate", () => {
  const writer = workstationRevocationWriterInventory.find(item => item.id === "PASSWORD_TOKEN_VERSION");
  assert.ok(writer);
  assert.equal(writer.state, "GAP");
  assert.ok(writer.source);
  const code = source(writer.source);
  assert.match(code, /export async function updateOwnLocalPassword/u);
  assert.match(code, /TokenVersion=TokenVersion\+1/u);
  assert.doesNotMatch(code, /SharedWorkstationOperatorState|sp_getapplock/u);
});
