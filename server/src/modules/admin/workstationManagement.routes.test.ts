import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { createServer } from "node:http";
import { createWorkstationManagementRouter } from "./workstationManagement.routes.js";
import { errorHandler } from "../../middleware/errorHandler.js";
import type { workstationManagement } from "./workstationManagement.repository.js";
async function fixture(
  run: (f: {
    request: (
      path: string,
      method?: string,
      body?: unknown,
    ) => Promise<{ status: number; body: any }>;
    state: { permissions: string[]; calls: number; fail: boolean };
  }) => Promise<void>,
) {
  const state = { permissions: ["MANAGE_USERS"], calls: 0, fail: false };
  const deps = {
    list: async () => ({ schemaReady: true, workstations: [] }),
    saveGrants: async () => {
      state.calls++;
      if (state.fail)
        throw Object.assign(
          new Error(
            "SELECT synthetic_patient;password=synthetic;Token=synthetic",
          ),
          { code: "EREQUEST", number: 229 },
        );
    },
    retire: async () => {
      state.calls++;
    },
    effective: async () => ({ users: [], total: 0, pinLoginEnabled: false }),
  } as unknown as typeof workstationManagement;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.id = "synthetic-request";
    req.authUser = {
      id: 5,
      username: "synthetic",
      displayName: "synthetic",
      permissions: state.permissions,
    };
    next();
  });
  app.use(createWorkstationManagementRouter(deps));
  app.use(errorHandler);
  const server = createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    await run({
      state,
      request: async (path, method = "GET", body) => {
        const res = await fetch(base + path, {
          method,
          headers: { "Content-Type": "application/json" },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        return { status: res.status, body: await res.json() };
      },
    });
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}
test("Mock management API rejects string/duplicate IDs before any mutation", () =>
  fixture(async (f) => {
    for (const userIds of [
      ["1", 1],
      [1, 1],
    ])
      assert.equal(
        (
          await f.request("/shared-workstations/1/grants", "PUT", {
            userIds,
            departmentIds: [],
            groupIds: [],
            expectedVersion: 1,
          })
        ).status,
        400,
      );
    assert.equal(f.state.calls, 0);
    assert.equal(
      (
        await f.request("/shared-workstations/1/grants", "PUT", {
          userIds: [1],
          departmentIds: [10],
          groupIds: [20],
          expectedVersion: 1,
        })
      ).status,
      200,
    );
    assert.equal(f.state.calls, 1);
  }));
test("management/effective preview require current MANAGE_USERS permission", () =>
  fixture(async (f) => {
    f.state.permissions = [];
    assert.equal((await f.request("/workstation-management")).status, 403);
    assert.equal(
      (await f.request("/shared-workstations/1/effective-users")).status,
      403,
    );
    assert.equal(
      (
        await f.request("/shared-workstations/1/retire", "POST", {
          expectedVersion: 1,
        })
      ).status,
      403,
    );
    assert.equal(f.state.calls, 0);
  }));
test("management driver failures preserve Request ID without leaking raw data", () =>
  fixture(async (f) => {
    f.state.fail = true;
    const res = await f.request("/shared-workstations/1/grants", "PUT", {
      userIds: [1],
      departmentIds: [],
      groupIds: [],
      expectedVersion: 1,
    });
    assert.equal(res.status, 500);
    assert.equal(res.body.error.requestId, "synthetic-request");
    for (const text of ["SELECT", "synthetic_patient", "password", "Token"])
      assert.ok(!JSON.stringify(res.body).includes(text));
  }));
