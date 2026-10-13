import assert from "node:assert/strict";
import test from "node:test";
import {
  effectiveWorkstationUsers,
  canDeleteUnusedWorkstation,
  grantSchema,
} from "./workstationManagement.js";
test("workstation personal/department/group grants merge without granting new RBAC permissions", () => {
  const grants = { userIds: [1, 2], departmentIds: [10], groupIds: [20] };
  const audiences = [
    { id: 10, kind: "DEPARTMENT" as const, isActive: true, userIds: [2, 3, 4] },
    { id: 20, kind: "GROUP" as const, isActive: true, userIds: [3, 5] },
    { id: 30, kind: "GROUP" as const, isActive: true, userIds: [6] },
  ];
  assert.deepEqual(
    effectiveWorkstationUsers(grants, audiences, [1, 2, 3, 5, 6]),
    [1, 2, 3, 5],
  );
  audiences[0]!.userIds = [6];
  assert.deepEqual(
    effectiveWorkstationUsers(grants, audiences, [1, 2, 3, 5, 6]),
    [1, 2, 3, 5, 6],
  );
  audiences[1]!.isActive = false;
  assert.deepEqual(
    effectiveWorkstationUsers(grants, audiences, [1, 2, 3, 5, 6]),
    [1, 2, 6],
  );
});
test("strict backend IDs reject mixed strings, duplicates and unsafe integers", () => {
  const valid = {
    userIds: [1],
    departmentIds: [],
    groupIds: [],
    expectedVersion: 1,
  };
  for (const ids of [
    ["1", 1],
    [1, 1],
    [0],
    [-1],
    [1.2],
    [Number.MAX_SAFE_INTEGER + 1],
    [null],
  ])
    assert.equal(
      grantSchema.safeParse({ ...valid, userIds: ids }).success,
      false,
    );
  assert.equal(grantSchema.safeParse(valid).success, true);
});
test("deletion is limited to inactive unused records with no security/disclosure history", () => {
  const base = {
    isActive: false,
    retired: false,
    lastUsed: null,
    credentials: 0,
    sessions: 0,
    disclosures: 0,
    devices: 0,
  };
  assert.equal(canDeleteUnusedWorkstation(base), true);
  for (const field of [
    "isActive",
    "retired",
    "lastUsed",
    "credentials",
    "sessions",
    "disclosures",
    "devices",
  ] as const) {
    assert.equal(
      canDeleteUnusedWorkstation({
        ...base,
        [field]:
          field === "lastUsed"
            ? "synthetic-date"
            : field === "isActive" || field === "retired"
              ? true
              : 1,
      }),
      false,
    );
  }
});
