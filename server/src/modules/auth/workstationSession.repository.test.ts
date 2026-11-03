import test from "node:test";
import assert from "node:assert/strict";
import type sql from "mssql";
import { createWorkstationSessions } from "./workstationSession.repository.js";
import { pinSessionHash } from "./workstationCookies.js";
import { hashDeviceSecret } from "./workstationCredential.service.js";
const credential = `12345678-1234-4234-8234-123456789abc.${Buffer.alloc(32, 7).toString("base64url")}`;
const token = `12345678-1234-4234-8234-123456789abd.${Buffer.alloc(32, 8).toString("base64url")}`;
function fixture() {
  const state = { enabled: true, calls: 0, version: 1, generation: "9007199254740993", active: true, tokenVersion: 2, missing: false };
  const tx = {} as sql.Transaction;
  const request = () => {
    const req = { input: () => req, query: async (text: string) => {
      state.calls++;
      return { recordset: state.missing ? [] : text.includes("c.SecretHash")
        ? [{ Id: 7, CredentialVersion: state.version, Generation: state.generation, SecretHash: hashDeviceSecret(credential.split(".")[1]!) }]
        : [{ UserId: 8, TokenVersion: 2, PinVersion: 3, Username: "synthetic", DisplayName: "Synthetic",
          SessionSecretHash: pinSessionHash(token, credential, 1, "9007199254740993") }] };
    } };
    return req as unknown as sql.Request;
  };
  const sessions = createWorkstationSessions({ enabled: () => state.enabled, getPool: async () => ({ request }) as unknown as sql.ConnectionPool,
    request: current => { assert.equal(current, tx); return request(); },
    userState: async (_user, current) => { assert.equal(current, tx); return { isActive: state.active, tokenVersion: state.tokenVersion,
      permissions: ["VIEW_QUERY", "EXECUTE_QUERY", "EXPORT_QUERY", "MANAGE_USERS"] }; },
  });
  return { state, sessions, tx };
}
test("PIN session returns only query permissions and preserves exact generation", async () => {
  const f = fixture(), actor = await f.sessions.read(token, credential, f.tx);
  assert.equal(actor?.generation, "9007199254740993"); assert.equal(actor?.authMethod, "PIN");
  assert.deepEqual(actor?.permissions, ["VIEW_QUERY", "EXECUTE_QUERY"]);
});
test("live credential version/generation and user TokenVersion/active changes invalidate old session", async () => {
  for (const mutation of [{ version: 2 }, { generation: "9007199254740994" }, { active: false }, { tokenVersion: 3 }, { missing: true }]) {
    const f = fixture(); Object.assign(f.state, mutation);
    assert.equal(await f.sessions.read(token, credential, f.tx), null);
  }
});
test("malformed tokens do not reach DB; disabled runtime rejects valid opaque credentials", async () => {
  const f = fixture();
  assert.equal(await f.sessions.read("invalid", credential, f.tx), null); assert.equal(f.state.calls, 0);
  f.state.enabled = false; await assert.rejects(f.sessions.read(token, credential, f.tx), /DISABLED/); assert.equal(f.state.calls, 0);
});
