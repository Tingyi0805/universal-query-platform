import assert from "node:assert/strict";
import test from "node:test";
import sql from "mssql";
import { createQuickPinService } from "./quickPin.service.js";
function fixture() {
  const state = {
    policy: 6,
    tokenVersion: 1,
    failOn: "",
    queries: [] as string[],
    commits: 0,
    rollbacks: 0,
    pin: {
      PinHash: "hash:804297",
      PinVersion: 1,
      IsEnabled: true,
      FailedAttempts: 0,
      LockedUntilUtc: null as Date | null,
    },
    sessionRevoked: false,
  };
  let staged = structuredClone(state.pin);
  let session = false;
  const tx = {
    begin: async (level: number) => {
      assert.equal(level, sql.ISOLATION_LEVEL.SERIALIZABLE);
      staged = structuredClone(state.pin);
    },
    commit: async () => {
      state.pin = structuredClone(staged);
      state.sessionRevoked = session;
      state.commits++;
    },
    rollback: async () => {
      state.rollbacks++;
    },
  } as unknown as sql.Transaction;
  function request() {
    const values: Record<string, unknown> = {};
    const r = {
      input: (key: string, _type: unknown, value: unknown) => {
        values[key] = value;
        return r;
      },
      query: async (text: string) => {
        state.queries.push(text);
        if (state.failOn && text.includes(state.failOn))
          throw new Error("synthetic password PIN token SQL");
        if (text.startsWith("SELECT PinLength"))
          return { recordset: [{ PinLength: state.policy }] };
        if (text.startsWith("SELECT IsActive"))
          return {
            recordset: [
              {
                IsActive: true,
                TokenVersion: state.tokenVersion,
                PasswordHash: "synthetic-password-hash",
              },
            ],
          };
        if (text.startsWith("SELECT *")) return { recordset: [staged] };
        if (text.includes("SET FailedAttempts=CASE")) {
          staged.FailedAttempts++;
          if (staged.FailedAttempts >= 5)
            staged.LockedUntilUtc = new Date(1000000);
        }
        if (text.includes("SET PinHash=@pinHash")) {
          staged.PinHash = String(values.pinHash);
          staged.PinVersion++;
          staged.IsEnabled = true;
          staged.FailedAttempts = 0;
          staged.LockedUntilUtc = null;
        }
        if (text.includes("SET IsEnabled=0")) {
          staged.IsEnabled = false;
          staged.PinVersion++;
        }
        if (text.includes("SharedWorkstationSession")) session = true;
        return { recordset: [] };
      },
    };
    return r as unknown as sql.Request;
  }
  const service = createQuickPinService({
    getPool: async () => ({}) as sql.ConnectionPool,
    transaction: () => tx,
    request,
    findUser: async () => ({
      id: 1,
      username: "synthetic",
      displayName: "synthetic",
      isActive: true,
      authProvider: "LOCAL",
      passwordHash: "synthetic-password-hash",
      tokenVersion: 1,
      permissions: [],
    }),
    compare: async (value, hash) =>
      hash === "synthetic-password-hash"
        ? value === "synthetic-correct-password"
        : hash === `hash:${value}`,
    hash: async (value) => `hash:${value}`,
    now: () => 1000,
  });
  return { state, service };
}
test("PIN update replaces hash/increments version and revokes workstation sessions", async () => {
  const f = fixture();
  assert.equal(
    await f.service.enrollQuickPin(1, "synthetic-correct-password", "739204"),
    "OK",
  );
  assert.equal(f.state.pin.PinHash, "hash:739204");
  assert.notEqual(f.state.pin.PinHash, "hash:804297");
  assert.equal(f.state.pin.PinVersion, 2);
  assert.equal(f.state.sessionRevoked, true);
});
test("current policy is checked under lock; raced policy cannot accept old-length PIN", async () => {
  const f = fixture();
  f.state.policy = 8;
  assert.equal(
    await f.service.enrollQuickPin(1, "synthetic-correct-password", "739204"),
    "PIN_POLICY_CHANGED",
  );
  assert.equal(f.state.commits, 0);
  assert.equal(f.state.pin.PinHash, "hash:804297");
  assert.ok(f.state.queries[0]!.includes("UPDLOCK,HOLDLOCK"));
});
test("same/weak PIN is rejected and stale password/token version cannot update PIN", async () => {
  const f = fixture();
  assert.equal(
    await f.service.enrollQuickPin(1, "synthetic-correct-password", "804297"),
    "PIN_WEAK",
  );
  assert.equal(
    await f.service.enrollQuickPin(1, "synthetic-correct-password", "123456"),
    "PIN_WEAK",
  );
  f.state.tokenVersion = 2;
  assert.equal(
    await f.service.enrollQuickPin(1, "synthetic-correct-password", "739204"),
    "INVALID_CREDENTIALS",
  );
  assert.equal(f.state.commits, 0);
});
test("wrong password attempts are bounded by persisted PIN lock; locked management cannot mutate", async () => {
  const f = fixture();
  for (let i = 0; i < 5; i++)
    assert.equal(
      await f.service.enrollQuickPin(1, "synthetic-wrong", "739204"),
      "INVALID_CREDENTIALS",
    );
  assert.equal(f.state.pin.FailedAttempts, 5);
  assert.equal(
    await f.service.enrollQuickPin(1, "synthetic-correct-password", "739204"),
    "PIN_LOCKED",
  );
  assert.equal(f.state.pin.PinHash, "hash:804297");
});
test("revocation increments version and disables the PIN without enabling sign-in", async () => {
  const f = fixture();
  assert.equal(
    await f.service.revokeQuickPin(1, "synthetic-correct-password"),
    "OK",
  );
  assert.equal(f.state.pin.IsEnabled, false);
  assert.equal(f.state.pin.PinVersion, 2);
  assert.equal(f.state.sessionRevoked, true);
});
test("session/audit-adjacent failures rollback the PIN mutation and preserve original errors", async () => {
  const f = fixture();
  f.state.failOn = "SharedWorkstationSession";
  await assert.rejects(
    f.service.enrollQuickPin(1, "synthetic-correct-password", "739204"),
  );
  assert.equal(f.state.pin.PinVersion, 1);
  assert.equal(f.state.commits, 0);
  assert.equal(f.state.rollbacks, 1);
});
test("invalid policy fails closed instead of accepting a default length", async () => {
  const f = fixture();
  f.state.policy = 3;
  await assert.rejects(
    f.service.enrollQuickPin(1, "synthetic-correct-password", "739204"),
    /PIN_POLICY_INVALID/,
  );
  assert.equal(f.state.commits, 0);
});
