import assert from "node:assert/strict";
import test from "node:test";
import sql from "mssql";
import { createWorkstationManagementRepository } from "./workstationManagement.repository.js";
function fixture() {
  const state = {
    ready: true,
    failOn: "",
    queries: [] as { text: string; values: Record<string, unknown> }[],
    begins: 0,
    commits: 0,
    rollbacks: 0,
    database: {
      station: {
        Id: 1,
        WorkstationCode: "SYNTHETIC",
        IsActive: true,
        PurposeCode: "SHARED_QUERY",
        CredentialVersion: 4,
        RetiredAtUtc: null as string | null,
        LastUsedAtUtc: null,
      },
      grants: { userIds: [1], departmentIds: [10], groupIds: [] },
      credentials: false,
      sessions: false,
      deviceRevoked: false,
      audits: [] as string[],
      deleted: false,
      counts: { Credentials: 0, Sessions: 0, Disclosures: 0, Devices: 0 },
    },
  };
  let staged = structuredClone(state.database);
  function request(inTx = false) {
    const values: Record<string, unknown> = {};
    const r = {
      input: (key: string, _type: unknown, value: unknown) => {
        values[key] = value;
        return r;
      },
      query: async (text: string) => {
        state.queries.push({ text, values: { ...values } });
        if (state.failOn && text.includes(state.failOn))
          throw Object.assign(
            new Error("synthetic SQL password patient token"),
            { code: "EREQUEST", number: 229 },
          );
        const db = inTx ? staged : state.database;
        if (text.includes("AS Ready"))
          return { recordset: [{ Ready: state.ready ? 1 : 0 }] };
        if (text.includes("sp_getapplock")) return { recordset: [] };
        if (text.startsWith("SELECT * FROM uqp.SharedWorkstation"))
          return { recordset: [{ ...db.station, Id: values.id }] };
        if (text.includes("AS Credentials")) return { recordset: [db.counts] };
        if (text.includes("SELECT UserId FROM uqp.SharedWorkstationUser"))
          return {
            recordsets: [
              db.grants.userIds.map((UserId) => ({ UserId })),
              [
                ...db.grants.departmentIds.map((Id) => ({
                  Id,
                  Kind: "DEPARTMENT",
                })),
                ...db.grants.groupIds.map((Id) => ({ Id, Kind: "GROUP" })),
              ],
            ],
          };
        if (text.includes("SELECT Id FROM uqp.AppUser"))
          return {
            recordset: (JSON.parse(String(values.users)) as number[]).map(
              (Id) => ({ Id }),
            ),
            recordsets: [
              (JSON.parse(String(values.users)) as number[]).map((Id) => ({
                Id,
              })),
              [
                ...JSON.parse(String(values.departments ?? "[]")),
                ...JSON.parse(String(values.groups ?? "[]")),
              ].map((Id) => ({ Id })),
            ],
          };
        if (text.includes("SELECT Kind,Revision"))
          return { recordset: [{ Kind: "DEPARTMENT", Revision: 1 }] };
        if (text.includes("SELECT WorkstationId FROM"))
          return { recordset: [{ WorkstationId: 1 }] };
        if (text.startsWith("SELECT SharedWorkstationId"))
          return { recordset: [{ SharedWorkstationId: null }] };
        if (text.startsWith("SELECT Id FROM uqp.DashboardDisplayDevice"))
          return { recordset: [] };
        if (!inTx) throw new Error("UNMOCKED_READ");
        if (text.includes("INSERT INTO uqp.AuditLog"))
          db.audits.push(String(values.event));
        if (text.includes("RetiredAtUtc=SYSUTCDATETIME")) {
          db.station.RetiredAtUtc = "retired";
          db.station.IsActive = false;
        }
        if (text.includes("SET DisplayName=@name")) {
          db.station.IsActive = Boolean(values.active);
          db.station.PurposeCode = String(values.purpose);
        }
        if (text.includes("CredentialVersion=CredentialVersion+1")) {
          db.station.CredentialVersion++;
          db.credentials = true;
          db.sessions = true;
        }
        if (text.includes("TokenHash=")) db.deviceRevoked = true;
        if (text.includes("DELETE FROM uqp.SharedWorkstation WHERE"))
          db.deleted = true;
        return { recordset: [] };
      },
    };
    return r as unknown as sql.Request;
  }
  const tx = {
    begin: async (level: number) => {
      assert.equal(level, sql.ISOLATION_LEVEL.SERIALIZABLE);
      state.begins++;
      staged = structuredClone(state.database);
    },
    commit: async () => {
      state.commits++;
      state.database = structuredClone(staged);
    },
    rollback: async () => {
      state.rollbacks++;
      staged = structuredClone(state.database);
    },
  } as unknown as sql.Transaction;
  const repo = createWorkstationManagementRepository({
    getPool: async () =>
      ({ request: () => request() }) as unknown as sql.ConnectionPool,
    transaction: () => tx,
    request: () => request(true),
    legacyList: async () => [],
  });
  return { state, repo };
}
test("disable invalidates credentials/sessions and bound playback tokens in one audited transaction", async () => {
  const f = fixture();
  await f.repo.metadata(
    1,
    {
      displayName: "synthetic",
      purposeCode: "SHARED_QUERY",
      sortOrder: 1,
      isActive: false,
      expectedVersion: 4,
    },
    5,
  );
  assert.equal(f.state.database.credentials, true);
  assert.equal(f.state.database.sessions, true);
  assert.equal(f.state.database.deviceRevoked, true);
  assert.equal(f.state.database.station.IsActive, false);
  assert.equal(f.state.commits, 1);
  assert.deepEqual(f.state.database.audits, ["SHARED_WORKSTATION_UPDATED"]);
});

test("926 legacy denial or common-gate failure rolls back before config locks and mutation", async () => {
  const f = fixture();
  const before = structuredClone(f.state.database);
  f.state.failOn = "LEGACY_WRITER_926_INTEGRATION_REQUIRED";
  await assert.rejects(f.repo.metadata(1, {
    displayName: "synthetic", purposeCode: "SHARED_QUERY", sortOrder: 1,
    isActive: false, expectedVersion: 4,
  }, 5));
  assert.deepEqual(f.state.database, before);
  assert.equal(f.state.commits, 0); assert.equal(f.state.rollbacks, 1);
  assert.ok(!f.state.queries.some(q => q.text.includes("uqp.workstation.config")));
});
test("retirement is terminal; stale and retired mutation attempts cannot reactivate credentials", async () => {
  const f = fixture();
  await f.repo.retire(1, 4, 5);
  assert.equal(f.state.database.station.RetiredAtUtc, "retired");
  await assert.rejects(
    f.repo.metadata(
      1,
      {
        displayName: "synthetic",
        purposeCode: "SHARED_QUERY",
        sortOrder: 0,
        isActive: true,
        expectedVersion: 5,
      },
      5,
    ),
    /WORKSTATION_RETIRED/,
  );
  assert.equal(f.state.database.station.IsActive, false);
  assert.equal(f.state.commits, 1);
  const fresh = fixture();
  await assert.rejects(fresh.repo.retire(1, 3, 5), /WORKSTATION_VERSION_STALE/);
  assert.equal(fresh.state.commits, 0);
});
test("auditing failure rolls back state and revocations", async () => {
  const f = fixture();
  f.state.failOn = "INSERT INTO uqp.AuditLog";
  await assert.rejects(f.repo.retire(1, 4, 5));
  assert.equal(f.state.database.station.RetiredAtUtc, null);
  assert.equal(f.state.database.credentials, false);
  assert.equal(f.state.commits, 0);
  assert.equal(f.state.rollbacks, 1);
});
test("delete protects all used history; safe deletion preserves audit", async () => {
  for (const field of [
    "Credentials",
    "Sessions",
    "Disclosures",
    "Devices",
  ] as const) {
    const f = fixture();
    f.state.database.station.IsActive = false;
    f.state.database.counts[field] = 1;
    await assert.rejects(
      f.repo.removeUnused(1, 4, 5),
      /WORKSTATION_DELETE_UNSAFE/,
    );
    assert.equal(f.state.database.deleted, false);
  }
  const f = fixture();
  f.state.database.station.IsActive = false;
  await f.repo.removeUnused(1, 4, 5);
  assert.equal(f.state.database.deleted, true);
  assert.deepEqual(f.state.database.audits, ["SHARED_WORKSTATION_DELETED"]);
});
test("grants/copy revoke previous security state and preserve transaction integrity", async () => {
  const f = fixture();
  await f.repo.saveGrants(
    1,
    { userIds: [1], departmentIds: [10], groupIds: [], expectedVersion: 4 },
    5,
    2,
  );
  assert.equal(f.state.database.credentials, true);
  assert.equal(f.state.database.sessions, true);
  assert.equal(f.state.commits, 1);
  assert.ok(
    f.state.queries.some((q) =>
      q.text.includes("DELETE FROM uqp.SharedWorkstationAudience"),
    ),
  );
  const failed = fixture();
  failed.state.failOn = "INSERT INTO uqp.SharedWorkstationAudience";
  await assert.rejects(
    failed.repo.saveGrants(
      1,
      { userIds: [1], departmentIds: [10], groupIds: [], expectedVersion: 4 },
      5,
    ),
  );
  assert.equal(failed.state.commits, 0);
});
test("audience membership updates revoke all linked workstations; stale revision fails closed", async () => {
  const f = fixture();
  await f.repo.saveAudience(
    {
      kind: "DEPARTMENT",
      code: "TEST",
      displayName: "synthetic",
      isActive: true,
      userIds: [1],
      expectedRevision: 1,
    },
    5,
    10,
  );
  assert.equal(f.state.database.credentials, true);
  assert.equal(f.state.database.sessions, true);
  const stale = fixture();
  await assert.rejects(
    stale.repo.saveAudience(
      {
        kind: "DEPARTMENT",
        code: "TEST",
        displayName: "synthetic",
        isActive: true,
        userIds: [],
        expectedRevision: 2,
      },
      5,
      10,
    ),
    /AUDIENCE_VERSION_STALE/,
  );
  assert.equal(stale.state.commits, 0);
});
test("schema missing blocks every write before transaction; legacy inventory remains readable", async () => {
  const f = fixture();
  f.state.ready = false;
  assert.deepEqual(await f.repo.list(), {
    schemaReady: false,
    workstations: [],
  });
  await assert.rejects(f.repo.retire(1, 4, 5), /WORKSTATION_SCHEMA_REQUIRED/);
  assert.equal(f.state.begins, 0);
});
test("binding playback requires Dashboard purpose and revokes old token", async () => {
  const f = fixture();
  await assert.rejects(
    f.repo.bindDevice(1, 11, 4, 5),
    /WORKSTATION_PURPOSE_INVALID/,
  );
  f.state.database.station.PurposeCode = "DASHBOARD";
  await f.repo.bindDevice(1, 11, 4, 5);
  assert.equal(f.state.database.deviceRevoked, true);
});

test("grant read returns current metadata and version using only SELECT without a transaction",async()=>{
  const f=fixture();const result=await f.repo.grants(1);
  assert.equal(result.expectedVersion,4);assert.equal(result.workstation.id,1);assert.equal(result.workstation.isActive,true);
  assert.deepEqual(result.userIds,[1]);assert.equal(f.state.begins,0);
  assert.ok(f.state.queries.every(q=>q.text.trim().startsWith("SELECT")));
});
