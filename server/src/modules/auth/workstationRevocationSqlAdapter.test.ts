import assert from "node:assert/strict";
import test from "node:test";
import { createIsolatedRevocationSqlDriver, isolatedSqlAdapterReleaseGate } from "./workstationRevocationSqlAdapter.js";
import { runIsolatedRevocationWriter } from "./workstationRevocationOwnedWriter.js";
import type { WorkstationSqlTransaction, WorkstationSqlRequest } from "./workstationSessionSql.repository.js";

function fixture(gate = 0, rollbackFails = false) {
  const events: string[] = [];
  const deps = {
    async getPool() { events.push("pool"); return {}; },
    transaction(_pool: unknown): WorkstationSqlTransaction {
      events.push("transaction");
      return {
        async begin(level: number) { assert.equal(typeof level, "number"); events.push("begin"); },
        async commit() { events.push("UNEXPECTED_COMMIT"); },
        async rollback() { events.push("rollback"); if (rollbackFails) throw Error("ROLLBACK_FAILED"); },
      };
    },
    request(_tx: WorkstationSqlTransaction): WorkstationSqlRequest {
      events.push("request");
      const req: WorkstationSqlRequest = {
        input() { throw Error("NO_MUTATION_ALLOWED"); },
        async query(stmt: string) {
          events.push("gate");
          assert.match(stmt,/sp_getapplock/u);
          return { recordset: [{ GateResult: gate }], rowsAffected: [] };
        },
      };
      return req;
    },
  };
  return { events, driver: createIsolatedRevocationSqlDriver(deps) };
}

test("real-driver seam always rolls back when mutation remains blocked", async () => {
  const f=fixture();
  const result=await runIsolatedRevocationWriter(f.driver);
  assert.equal(result.status,"REJECTED");
  assert.equal(result.authority,"NONE");
  assert.deepEqual(f.events,["pool","transaction","begin","request","gate","rollback"]);
  assert.equal(isolatedSqlAdapterReleaseGate.runtimeRegistered,false);
});
test("negative gate prevents mutation; uncertain rollback reported separately",async()=>{
  const a=fixture(-1);
  assert.equal((await runIsolatedRevocationWriter(a.driver)).status,"REJECTED");
  assert.ok(!a.events.includes("UNEXPECTED_COMMIT"));
  const b=fixture(0,true);
  assert.equal((await runIsolatedRevocationWriter(b.driver)).status,"ROLLBACK_UNKNOWN");
  assert.ok(!b.events.includes("UNEXPECTED_COMMIT"));
});

test("failed SQL transaction begin attempts rollback and never queries security gate", async () => {
  const events: string[] = [];
  const driver = createIsolatedRevocationSqlDriver({
    async getPool() { events.push("pool"); return {}; },
    transaction(): WorkstationSqlTransaction {
      return {
        async begin() { events.push("begin"); throw Error("BEGIN_FAILED"); },
        async commit() { events.push("UNEXPECTED_COMMIT"); },
        async rollback() { events.push("rollback"); },
      };
    },
    request(): WorkstationSqlRequest { throw Error("UNEXPECTED_REQUEST"); },
  });
  assert.equal((await runIsolatedRevocationWriter(driver)).status, "REJECTED");
  assert.deepEqual(events, ["pool", "begin", "rollback"]);
});
test("reacquiring security gate is rejected before another query", async () => {
  const f = fixture();
  const tx = await f.driver.beginSerializable();
  assert.equal(await tx.acquireSecurityGate(), true);
  await assert.rejects(tx.acquireSecurityGate(), /GATE_ALREADY_ATTEMPTED/u);
  await tx.rollback();
  assert.equal(f.events.filter(e => e === "gate").length, 1);
});

test("denied security gate may not be retried inside the same transaction", async () => {
  const f = fixture(-1);
  const tx = await f.driver.beginSerializable();
  assert.equal(await tx.acquireSecurityGate(), false);
  await assert.rejects(tx.acquireSecurityGate(), /GATE_ALREADY_ATTEMPTED/u);
  await tx.rollback();
  assert.equal(f.events.filter(e => e === "gate").length, 1);
});

test("scoped SQL adapter reads unmapped legacy count in same transaction and still refuses writes", async () => {
  const statements: string[] = [];
  const bindings: string[] = [];
  const deps = {
    async getPool() { return {}; },
    transaction(): WorkstationSqlTransaction {
      return { async begin() {}, async commit() { throw Error("UNEXPECTED_COMMIT"); }, async rollback() {} };
    },
    request(): WorkstationSqlRequest {
      const req: WorkstationSqlRequest = {
        input(name: string) { bindings.push(name); return req; },
        async query(statement: string) {
          statements.push(statement);
          return { recordset: statement.includes("sp_getapplock")
            ? [{ GateResult: 0 }]
            : statement.includes("os.OperatorSessionId=ls.Id")
              ? []
              : [statement.includes("UnmappedActiveLegacySessions")
              ? { UnmappedActiveLegacySessions: "0" }
              : statement.includes("ActiveLegacySessions")
              ? { ActiveLegacySessions: "0" }
              : statement.includes("AS WorkstationId")
              ? { WorkstationId: "1", IsActive: true, RetiredAtUtc: null }
              : statement.includes("SharedWorkstationCredential")
              ? { CredentialId: "f0a14a4d-870b-4379-82b0-cc4d2d1c21ad" }
              : { UnmappedActiveLegacySessions: "0" }], rowsAffected: [] };
        },
      };
      return req;
    },
  };
  const driver = createIsolatedRevocationSqlDriver(deps, {
    workstationId: "1", credentialId: "f0a14a4d-870b-4379-82b0-cc4d2d1c21ad",
  });
  assert.equal((await runIsolatedRevocationWriter(driver)).status, "REJECTED");
  assert.equal(statements.length, 6);
  assert.match(statements[1]!, /UnmappedActiveLegacySessions/u);
  assert.deepEqual(bindings, ["workstationId", "credentialId", "workstationId", "workstationId", "credentialId", "workstationId", "credentialId", "workstationId"]);
});

test("nonzero or missing COUNT_BIG evidence refuses mutation and commits nothing", async () => {
  for (const count of ["1", 1n, 1, null, undefined, "0.0"]) {
    let rolledBack = 0;
    let queried = 0;
    const deps = {
      async getPool() { return {}; },
      transaction(): WorkstationSqlTransaction {
        return { async begin() {}, async commit() { throw Error("COMMIT_NOT_ALLOWED"); },
          async rollback() { rolledBack++; } };
      },
      request(): WorkstationSqlRequest {
        const request: WorkstationSqlRequest = {
          input() { return request; },
          async query(statement: string) {
            queried++;
            return { recordset: [statement.includes("sp_getapplock")
              ? { GateResult: 0 } : { UnmappedActiveLegacySessions: count }], rowsAffected: [] };
          },
        };
        return request;
      },
    };
    const driver = createIsolatedRevocationSqlDriver(deps, {
      workstationId: "1", credentialId: "f0a14a4d-870b-4379-82b0-cc4d2d1c21ad",
    });
    assert.equal((await runIsolatedRevocationWriter(driver)).status, "REJECTED");
    assert.equal(queried, 2);
    assert.equal(rolledBack, 1);
  }
});

test("scope validation cannot be replayed after initial rejection", async () => {
  let scopeQueries = 0;
  const deps = {
    async getPool() { return {}; },
    transaction(): WorkstationSqlTransaction {
      return { async begin() {}, async commit() { throw Error("COMMIT_NOT_ALLOWED"); }, async rollback() {} };
    },
    request(): WorkstationSqlRequest {
      const req: WorkstationSqlRequest = {
        input() { return req; },
        async query(statement: string) {
          if (statement.includes("sp_getapplock")) {
            return { recordset: [{ GateResult: 0 }], rowsAffected: [] };
          }
          scopeQueries++;
          return { recordset: [{ UnmappedActiveLegacySessions: "1" }], rowsAffected: [] };
        },
      };
      return req;
    },
  };
  const tx = await createIsolatedRevocationSqlDriver(deps, {
    workstationId: "1", credentialId: "f0a14a4d-870b-4379-82b0-cc4d2d1c21ad",
  }).beginSerializable();
  assert.equal(await tx.acquireSecurityGate(), true);
  await assert.rejects(tx.lockAndRevalidateScope(), /UNMAPPED_LEGACY_SESSIONS/u);
  await assert.rejects(tx.lockAndRevalidateScope(), /SCOPE_ALREADY_ATTEMPTED/u);
  assert.equal(scopeQueries, 1);
  await tx.rollback();
});

test("credential evidence rejects absent or non-string SQL credential values", async () => {
  for (const credentialId of [undefined, null, 1, {}, "00000000-0000-4000-8000-000000000000"]) {
    let rolledBack = 0;
    const deps = {
      async getPool() { return {}; },
      transaction(): WorkstationSqlTransaction {
        return { async begin() {}, async commit() { throw Error("UNEXPECTED_COMMIT"); },
          async rollback() { rolledBack++; } };
      },
      request(): WorkstationSqlRequest {
        const req: WorkstationSqlRequest = {
          input() { return req; },
          async query(stmt: string) {
            return { recordset: [stmt.includes("sp_getapplock")
              ? { GateResult: 0 } : stmt.includes("AS WorkstationId")
                ? { WorkstationId: "1", IsActive: 1, RetiredAtUtc: null }
                : stmt.includes("SharedWorkstationCredential")
                ? { CredentialId: credentialId } : { UnmappedActiveLegacySessions: "0" }],
              rowsAffected: [] };
          },
        };
        return req;
      },
    };
    const driver = createIsolatedRevocationSqlDriver(deps, {
      workstationId: "1", credentialId: "f0a14a4d-870b-4379-82b0-cc4d2d1c21ad",
    });
    assert.equal((await runIsolatedRevocationWriter(driver)).status, "REJECTED");
    assert.equal(rolledBack, 1);
  }
});

test("version-bound device is queried in the owned transaction but writes remain disabled", async () => {
  const statements: string[] = [];
  let rollbacks = 0;
  const deviceId = "0de670b0-6b21-4e51-b013-1c84c4d21d02";
  const credentialId = "f0a14a4d-870b-4379-82b0-cc4d2d1c21ad";
  const deps = {
    async getPool() { return {}; },
    transaction(): WorkstationSqlTransaction {
      return { async begin() {}, async commit() { throw Error("COMMIT_FORBIDDEN"); },
        async rollback() { rollbacks++; } };
    },
    request(): WorkstationSqlRequest {
      const req: WorkstationSqlRequest = {
        input() { return req; },
        async query(statement: string) {
          statements.push(statement);
          const row = statement.includes("sp_getapplock") ? { GateResult: 0 }
            : statement.includes("UnmappedActiveLegacySessions") ? { UnmappedActiveLegacySessions: "0" }
            : statement.includes("ActiveLegacySessions") ? { ActiveLegacySessions: "0" }
            : statement.includes("AS WorkstationId") ? { WorkstationId: "1", IsActive: true, RetiredAtUtc: null }
            : statement.includes("AS CredentialId") ? { CredentialId: credentialId, CredentialVersion: 2 }
            : statement.includes("os.OperatorSessionId=ls.Id") ? null
            : statement.includes("AS SessionId") ? { SessionId: deviceId }
            : { DeviceSessionId: deviceId, BoundCredentialVersion: 2 };
          return { recordset: row === null ? [] : [row], rowsAffected: [] };
        },
      };
      return req;
    },
  };
  const driver = createIsolatedRevocationSqlDriver(deps, {
    workstationId: "1", credentialId, deviceSessionId: deviceId, expectedCredentialVersion: 2,
  });
  assert.equal((await runIsolatedRevocationWriter(driver)).status, "REJECTED");
  assert.equal(statements.length, 8);
  assert.match(statements[4]!, /BoundCredentialVersion=@expectedCredentialVersion/u);
  assert.match(statements[5]!, /ORDER BY Id/u);
  assert.match(statements[6]!, /os.OperatorSessionId=ls.Id/u);
  assert.match(statements[7]!, /ActiveLegacySessions/u);
  assert.equal(rollbacks, 1);
});

test("credential version drift rejects before the device lock or any mutation", async () => {
  const statements: string[] = [];
  let rollbacks = 0;
  const credentialId = "f0a14a4d-870b-4379-82b0-cc4d2d1c21ad";
  const deps = {
    async getPool() { return {}; },
    transaction(): WorkstationSqlTransaction {
      return { async begin() {}, async commit() { throw Error("UNEXPECTED_COMMIT"); },
        async rollback() { rollbacks++; } };
    },
    request(): WorkstationSqlRequest {
      const req: WorkstationSqlRequest = {
        input() { return req; },
        async query(stmt: string) {
          statements.push(stmt);
          return { recordset: [stmt.includes("sp_getapplock")
            ? { GateResult: 0 }
            : stmt.includes("UnmappedActiveLegacySessions")
              ? { UnmappedActiveLegacySessions: "0" }
            : stmt.includes("AS WorkstationId")
              ? { WorkstationId: "1", IsActive: true, RetiredAtUtc: null }
            : { CredentialId: credentialId, CredentialVersion: 3 }], rowsAffected: [] };
        },
      };
      return req;
    },
  };
  const result = await runIsolatedRevocationWriter(createIsolatedRevocationSqlDriver(deps, {
    workstationId: "1", credentialId,
    deviceSessionId: "0de670b0-6b21-4e51-b013-1c84c4d21d02", expectedCredentialVersion: 2,
  }));
  assert.equal(result.status, "REJECTED");
  assert.equal(statements.length, 4);
  assert.equal(rollbacks, 1);
});

test("multiple linked legacy session rows prevent writer admission and force rollback", async () => {
  let rollbacks = 0;
  const credentialId = "f0a14a4d-870b-4379-82b0-cc4d2d1c21ad";
  const deps = {
    async getPool() { return {}; },
    transaction(): WorkstationSqlTransaction {
      return { async begin() {}, async commit() { throw Error("COMMIT_FORBIDDEN"); },
        async rollback() { rollbacks++; } };
    },
    request(): WorkstationSqlRequest {
      const req: WorkstationSqlRequest = {
        input() { return req; },
        async query(statement: string) {
          const rows = statement.includes("sp_getapplock") ? [{ GateResult: 0 }]
            : statement.includes("UnmappedActiveLegacySessions") ? [{ UnmappedActiveLegacySessions: "0" }]
            : statement.includes("AS WorkstationId") ? [{ WorkstationId: "1", IsActive: true, RetiredAtUtc: null }]
            : statement.includes("AS CredentialId") ? [{ CredentialId: credentialId, CredentialVersion: 2 }]
            : statement.includes("AS DeviceSessionId") ? [{ DeviceSessionId: "0de670b0-6b21-4e51-b013-1c84c4d21d02", BoundCredentialVersion: 2 }]
            : statement.includes("ORDER BY Id") ? [{ SessionId: "0de670b0-6b21-4e51-b013-1c84c4d21d02" }]
            : [{ SessionId: "a" }, { SessionId: "b" }];
          return { recordset: rows, rowsAffected: [] };
        },
      };
      return req;
    },
  };
  const driver = createIsolatedRevocationSqlDriver(deps, {
    workstationId: "1", credentialId,
    deviceSessionId: "0de670b0-6b21-4e51-b013-1c84c4d21d02", expectedCredentialVersion: 2,
  });
  assert.equal((await runIsolatedRevocationWriter(driver)).status, "REJECTED");
  assert.equal(rollbacks, 1);
});
