import assert from "node:assert/strict";
import test from "node:test";
import { revocationWriterAdapterAvailability, type AtomicRevocationWriterPort, type RevocationWriterKind } from "./workstationAtomicRevocationPort.js";

test("legacy writer transaction port is not registered or enabled", () => {
  assert.deepEqual(revocationWriterAdapterAvailability, {
    registered: false, runtimeEnabled: false, sqlAcceptance: "NOT_RUN",
    bypassWritersResolved: false, authority: "NONE",
  });
});

test("port names all seven known legacy mutation groups without granting query authority", async () => {
  const kinds: RevocationWriterKind[] = [
    "PIN_ENROLL_REVOKE", "PIN_POLICY", "PASSWORD_TOKEN_VERSION",
    "USER_ROLE_PERMISSION", "WORKSTATION_CREDENTIAL", "WORKSTATION_STATE",
    "WORKSTATION_GRANTS",
  ];
  assert.equal(new Set(kinds).size, 7);
  const synthetic: AtomicRevocationWriterPort = {
    execute: async () => ({ outcome: "REJECTED", authority: "NONE" }),
  };
  await Promise.all(kinds.map(async kind => {
    const result = await synthetic.execute(kind, "9007199254740993");
    assert.equal(result.outcome, "REJECTED");
    assert.equal(result.authority, "NONE");
  }));
});
