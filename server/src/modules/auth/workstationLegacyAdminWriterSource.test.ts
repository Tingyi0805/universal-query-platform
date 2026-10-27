import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { workstationRevocationWriterInventory } from "./workstationRevocationWriterInventory.js";

const root = new URL("../../../../", import.meta.url);
const source = (path: string): string => readFileSync(new URL(path, root), "utf8");

test("PIN policy writer invalidates legacy sessions but does not update 926 policy bindings", () => {
  const writer = workstationRevocationWriterInventory.find(item => item.id === "PIN_POLICY");
  assert.ok(writer?.source);
  assert.equal(writer.state, "GAP");
  const code = source(writer.source);
  assert.match(code, /UPDATE uqp\.QuickPinPolicy SET PinLength=/u);
  assert.match(code, /UPDATE uqp\.UserQuickPin SET IsEnabled=0/u);
  assert.match(code, /UPDATE uqp\.SharedWorkstationSession SET RevokedAtUtc=/u);
  assert.doesNotMatch(code, /UserQuickPinSecurityBinding|SharedWorkstationOperatorState|sp_getapplock/u);
});

test("credential writer revokes legacy sessions but does not invalidate 926 device sessions", () => {
  const writer = workstationRevocationWriterInventory.find(item => item.id === "WORKSTATION_CREDENTIAL");
  assert.ok(writer?.source);
  assert.equal(writer.state, "GAP");
  const code = source(writer.source);
  assert.match(code, /export async function issueDeviceCredential/u);
  assert.match(code, /export async function revokeDeviceCredential/u);
  assert.match(code, /UPDATE uqp\.SharedWorkstationCredential/u);
  assert.match(code, /UPDATE uqp\.SharedWorkstationSession SET RevokedAtUtc=/u);
  assert.doesNotMatch(code, /SharedWorkstationDeviceSession|SharedWorkstationOperatorState|sp_getapplock/u);
});
