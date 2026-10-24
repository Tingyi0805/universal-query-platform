import assert from "node:assert/strict";
import test from "node:test";
import { createQueryDelivery, defaultQueryDeliveryDependencies } from "../queryDefinition/queryDelivery.js";
import { createQuerySourceExecution, type ExecutionDependencies } from "../dashboard/dashboardQuerySourceExecution.js";
import { type DatasetSensitiveColumn } from "./datasetSensitiveColumn.repository.js";
import { type ConfirmedDatasetDeliverySnapshot } from "./datasetDeliveryPolicy.repository.js";
import { maskCustomValue, validInheritedDashboardApprovalUpdate } from "../dashboard/dashboardDeviceMasking.js";

// All repositories and row observations below are synthetic. Exercise the real
// Query/Dashboard delivery services, not a SQL Server or trusted evidence issuer.
function fixture() {
  let revision = 1;
  let allowed = true;
  let auditFailure = false;
  const rules: DatasetSensitiveColumn[] = [
    { columnName: "NAME", sensitivityType: "OTHER", deviceMaskMode: "CUSTOM", customMask: { prefix: 1, suffix: 0, symbol: "*" } },
    { columnName: "PHONE", sensitivityType: "OTHER", deviceMaskMode: "NONE" },
    { columnName: "MRN", sensitivityType: "OTHER", deviceMaskMode: "FULL" },
    { columnName: "HIDDEN", sensitivityType: "OTHER", deviceMaskMode: "OMIT" },
    { columnName: "AUDIT_ID", sensitivityType: "OTHER", deviceMaskMode: "OMIT" },
  ];
  const raw = { columns: ["NAME", "PHONE", "MRN", "HIDDEN", "AUDIT_ID", "NEW_UNCONFIGURED"].map(name => ({ name })),
    rows: [{ NAME: "王小明", PHONE: "0912345678", MRN: "SYNTHETIC-MRN-001", HIDDEN: "SYNTHETIC-HIDDEN", AUDIT_ID: "SYNTHETIC-AUDIT", NEW_UNCONFIGURED: "SYNTHETIC-DRIFT" }],
    rowCount: 1, truncated: false, elapsedMs: 1 };
  const dataset = { id: 7, dataSourceId: 3, isActive: true, isArchived: false, maxRows: 10, sqlText: "SELECT synthetic_fixture" };
  const query = { id: 4, datasetId: 7, code: "SYNTHETIC", name: "Synthetic", isActive: true, isPublished: true, isArchived: false,
    canView: true, canExecute: true, canExport: true };
  const permissions = ["DESIGN_QUERY", "VIEW_QUERY", "EXECUTE_QUERY"];
  const identity = async () => ({ userId: 1, tokenVersion: 1, permissions: allowed ? permissions : [] });
  const execute = async () => structuredClone(raw);
  let audits = 0;
  const audit = async (input: { rows: ReadonlyArray<Record<string, unknown>> }) => {
    assert.equal(input.rows[0]?.AUDIT_ID, "SYNTHETIC-AUDIT");
    if (auditFailure) throw new Error("SYNTHETIC_AUDIT_FAILURE");
    return ++audits;
  };
  const snapshot = async (): Promise<ConfirmedDatasetDeliverySnapshot> => ({ datasetId: 7, definitionVersion: "0000000000000001",
    sensitivityVersion: String(revision), patientAuditVersion: "1", policy: { state: "CONFIRMED", version: String(revision),
      rules: structuredClone(rules).map(rule => ({ columnName: rule.columnName, mode: rule.deviceMaskMode, customMask: rule.customMask })),
      patientAuditOnlyColumns: ["AUDIT_ID"] }, patientAudit: { configured: true, enabled: true, patientKeyColumn: "AUDIT_ID" } });
  const delivery = createQueryDelivery({ ...defaultQueryDeliveryDependencies, access: async () => allowed ? query : null,
    accessRevision: async () => "acl-1", dataset: async () => dataset, snapshot, reports: async () => [], execute,
    patientState: async () => ({ status: "CONFIRMED", fingerprint: "synthetic-proof" }), auditPatient: audit,
  } as unknown as typeof defaultQueryDeliveryDependencies);
  const grants = Object.fromEntries(rules.map(rule => [rule.columnName, "INHERIT"]));
  const dashboard = createQuerySourceExecution({ getApprovalEvidence: async () => "a".repeat(64),
    loadBinding: async () => ({ dashboardId: 1, sourceId: 1, sourceKey: "PRIMARY", queryDefinitionId: 4, bindingRevision: 1,
      managed: true, dashboardActive: false, enabled: true, deviceMasks: grants, parameters: {}, refreshSeconds: 30, pageSeconds: 5, pageSize: 10, maxRows: 10 }),
    getSession: async () => ({ isActive: true, tokenVersion: 1, permissions: allowed ? permissions : [] }),
    getQuery: async () => query, getAccess: async () => allowed ? query : null, getAccessRevision: async () => "acl-1",
    getDataset: async () => dataset, getDataSource: async () => ({ isActive: true }), getParameters: async () => [],
    getSensitivity: async () => ({ columns: structuredClone(rules), version: revision }), execute, audit,
  } as unknown as ExecutionDependencies, () => true);
  const runQuery = async () => delivery.execute(await delivery.open(4, "EXECUTE", identity), {});
  const runDashboard = () => dashboard.page(1, "PRIMARY", { userId: 1, tokenVersion: 1, tokenHash: "synthetic-only" }, { page: 1 });
  return { rules, raw, runQuery, runDashboard, revision: () => { revision++; }, deny: () => { allowed = false; }, failAudit: () => { auditFailure = true; } };
}

test("one Dataset supplies identical CUSTOM/raw/FULL/OMIT values to real Query and Dashboard services", async () => {
  const f = fixture();
  const before = JSON.stringify(f.raw);
  const query = await f.runQuery(), dashboard = await f.runDashboard();
  const expected = [{ NAME: "王**", PHONE: "0912345678", MRN: "○○○○" }];
  assert.deepEqual(query.result.rows, expected);
  assert.deepEqual(dashboard.result.rows, expected);
  assert.deepEqual(query.result.columns, dashboard.result.columns);
  assert.deepEqual(query.result.columns.map(c => c.name), ["NAME", "PHONE", "MRN"]);
  for (const response of [query, dashboard]) {
    const serialized = JSON.stringify(response);
    for (const secret of ["王小明", "SYNTHETIC-MRN-001", "SYNTHETIC-HIDDEN", "SYNTHETIC-AUDIT", "SYNTHETIC-DRIFT"])
      assert.ok(!serialized.includes(secret));
  }
  assert.equal(JSON.stringify(f.raw), before);
});

test("Dataset update changes both services without changing Query or Dashboard configuration", async () => {
  const f = fixture();
  const initial = await f.runDashboard();
  assert.deepEqual(initial.result.rows, [{ NAME: "王**", PHONE: "0912345678", MRN: "○○○○" }]);
  f.rules[0]!.customMask = { prefix: 0, suffix: 1, symbol: "#" }; f.revision();
  assert.deepEqual((await f.runQuery()).result.rows, [{ NAME: "##明", PHONE: "0912345678", MRN: "○○○○" }]);
  assert.deepEqual((await f.runDashboard()).result.rows, (await f.runQuery()).result.rows);
  f.rules[1]!.deviceMaskMode = "OMIT"; f.revision();
  assert.deepEqual((await f.runDashboard()).result.rows, (await f.runQuery()).result.rows);
  assert.equal(Object.hasOwn((await f.runQuery()).result.rows[0]!, "PHONE"), false);
});

test("unified masking never grants an unauthorized user access, and audit failure still prevents delivery", async () => {
  const denied = fixture(); denied.deny();
  await assert.rejects(denied.runQuery(), /FORBIDDEN/);
  await assert.rejects(denied.runDashboard(), /PERMISSION_REVOKED/);
  const failed = fixture(); failed.failAudit();
  await assert.rejects(failed.runQuery(), /SYNTHETIC_AUDIT_FAILURE/);
  await assert.rejects(failed.runDashboard(), /PATIENT_AUDIT_FAILED/);
});

test("range positions count Unicode characters and invalid or out of bounds ranges never reveal raw values", () => {
  assert.equal(maskCustomValue("😀甲乙丙", { prefix: 0, suffix: 0, symbol: "#", start: 2, end: 3 }), "😀##丙");
  assert.equal(maskCustomValue("1234", { prefix: 0, suffix: 0, symbol: "*", start: 3, end: 100 }), "12**");
  assert.equal(maskCustomValue("1234", { prefix: 0, suffix: 0, symbol: "*", start: 5, end: 6 }), "****");
  for (const config of [
    { prefix: 0, suffix: 0, symbol: "*", start: 0, end: 1 },
    { prefix: 0, suffix: 0, symbol: "*", start: 1 },
    { prefix: 1, suffix: 0, symbol: "*", start: 1, end: 2 },
    { prefix: 0, suffix: 0, symbol: "*", start: 3, end: 2 },
    { prefix: 0, suffix: 0, symbol: "*", unexpected: true },
  ]) assert.equal(maskCustomValue("1234", config), "○○○○");
});

test("new Dashboard grants only inherit or deny; legacy independent grants cannot be silently rewritten", () => {
  assert.equal(validInheritedDashboardApprovalUpdate({}, { PHONE: "INHERIT", SECRET: "OMIT" }), true);
  assert.equal(validInheritedDashboardApprovalUpdate({}, { PHONE: "NONE" }), false);
  assert.equal(validInheritedDashboardApprovalUpdate({ NAME: "FULL" }, { NAME: "FULL", PHONE: "INHERIT" }), true);
  assert.equal(validInheritedDashboardApprovalUpdate({ NAME: "FULL" }, { NAME: "CUSTOM" }), false);
});
