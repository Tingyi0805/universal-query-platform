import assert from "node:assert/strict";
import test from "node:test";
import sql from "mssql";
import { createQuickPinPolicyRepository } from "./quickPinPolicy.repository.js";
test("length change disables existing PINs, advances versions and revokes sessions; unchanged policy does not", async () => {
  const state = {
    length: 6,
    pinVersion: 1,
    enabled: true,
    revoked: false,
    queries: [] as string[],
  };
  const repo = createQuickPinPolicyRepository(
    async () =>
      ({
        request: () => {
          let length = 0;
          const r = {
            input: (_key: string, _type: unknown, value: number) => {
              length = value;
              return r;
            },
            query: async (text: string) => {
              state.queries.push(text);
              if (text.startsWith("SELECT"))
                return { recordset: [{ PinLength: state.length }] };
              assert.match(text, /WITH \(UPDLOCK, HOLDLOCK\)/);
              assert.match(text, /IF @oldLength <> @length/);
              assert.match(text, /IsEnabled=0, PinVersion=PinVersion\+1/);
              if (state.length !== length) {
                state.length = length;
                state.pinVersion++;
                state.enabled = false;
                state.revoked = true;
              }
              return { recordset: [] };
            },
          };
          return r;
        },
      }) as unknown as sql.ConnectionPool,
  );
  assert.equal(await repo.updateQuickPinPolicy(6), true);
  assert.equal(state.pinVersion, 1);
  assert.equal(state.enabled, true);
  await repo.updateQuickPinPolicy(8);
  assert.equal(state.pinVersion, 2);
  assert.equal(state.enabled, false);
  assert.equal(state.revoked, true);
  assert.deepEqual(await repo.readQuickPinPolicy(), { pinLength: 8 });
  await assert.rejects(repo.updateQuickPinPolicy(13), /INVALID_PIN_LENGTH/);
});
