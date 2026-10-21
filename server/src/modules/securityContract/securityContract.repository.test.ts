import test from "node:test";
import assert from "node:assert/strict";
import sql from "mssql";
import { catalogEvidence, requireSecuritySchema, securityCatalogSql } from "./securityContract.repository.js";
import { assertSecuritySchema } from "./securityContract.js";
import { createPatientAuditStore } from "../dataset/patientAuditContract.repository.js";
import { createPatientAuditService, definitionHash } from "../dataset/patientAuditConfig.service.js";

function catalog() {
  const tables = ["Dataset", "DatasetColumn", "DatasetSensitiveColumn", "DatasetSensitivePolicyVersion", "Dashboard", "DashboardDataSource", "AuditLog", "DatasetPatientAuditConfig", "DatasetPatientAuditMetadata"].map(tableName => ({ tableName }));
  const c = (tableName: string, columnName: string, typeId: number, maxLength = 8) => ({ tableName, columnName, typeId, userTypeId: typeId, maxLength, nullable: false, computed: false, defaultDefinition: columnName === "ConfigurationVersion" ? "((1))" : null });
  const columns = [c("Dataset", "Id", 127), c("Dataset", "DataSourceId", 127), c("Dataset", "SqlText", 231, -1),
    c("DatasetPatientAuditConfig", "DatasetId", 127), c("DatasetPatientAuditConfig", "IsEnabled", 104, 1), c("DatasetPatientAuditConfig", "PatientKeyColumn", 231, 256),
    c("DatasetPatientAuditConfig", "UpdatedAtUtc", 42), c("DatasetPatientAuditConfig", "ConfigurationVersion", 127), c("Dashboard", "ApprovalRowVersion", 189), c("DashboardDataSource", "ApprovalRowVersion", 189),
    c("DatasetPatientAuditMetadata", "DatasetId", 127), c("DatasetPatientAuditMetadata", "DefinitionHash", 175, 64), c("DatasetPatientAuditMetadata", "ColumnsJson", 231, -1)];
  const checks = [{ tableName: "DatasetPatientAuditConfig", name: "CK_DatasetPatientAuditConfig_Version", definition: "([ConfigurationVersion]>=(1))", disabled: false, untrusted: false, nfr: false },
    { tableName: "DatasetPatientAuditMetadata", name: "CK_DatasetPatientAuditMetadata_Json", definition: "(isjson([ColumnsJson])=(1))", disabled: false, untrusted: false, nfr: false }];
  const keys = [{ tableName: "DatasetPatientAuditMetadata", name: "PK_DatasetPatientAuditMetadata", columnName: "DatasetId", ordinal: 1, keyCount: 1, disabled: false }];
  const fks = [{ tableName: "DatasetPatientAuditMetadata", name: "FK_DatasetPatientAuditMetadata_Dataset", columnName: "DatasetId", referencedSchema: "uqp", referencedTable: "Dataset", referencedColumn: "Id", keyCount: 1, deleteAction: 1, updateAction: 0, disabled: false, untrusted: false, nfr: false }];
  keys.push({ ...keys[0]!, tableName: "DatasetPatientAuditConfig", name: "synthetic-system-generated-pk-name" });
  fks.push({ ...fks[0]!, tableName: "DatasetPatientAuditConfig", name: "FK_DatasetPatientAuditConfig_Dataset" });
  checks.push({ ...checks[0]!, name: "CK_DatasetPatientAuditConfig_Key", definition: "(len(ltrim(rtrim([PatientKeyColumn])))>(0))" });
  return [tables, columns, checks, keys, fks] as Record<string, unknown>[][];
}
test("real catalog evaluator accepts exact 919 shapes and rejects each missing catalog set", () => {
  assert.doesNotThrow(() => assertSecuritySchema(catalogEvidence(catalog())));
  for (let i = 0; i < 5; i++) {
    const sets = catalog(); sets[i] = [];
    assert.throws(() => assertSecuritySchema(catalogEvidence(sets)), { code: "SECURITY_SCHEMA_REQUIRED" });
  }
});
test("same-name but wrong types, definitions, trust, PK and FK mappings fail closed", () => {
  const mutations = [
    (s: Record<string, unknown>[][]) => { s[1]![7]!.typeId = 56; },
    (s: Record<string, unknown>[][]) => { s[1]![7]!.defaultDefinition = "((0))"; },
    (s: Record<string, unknown>[][]) => { s[2]![0]!.definition = "(1=1)"; },
    (s: Record<string, unknown>[][]) => { s[2]![1]!.untrusted = true; },
    (s: Record<string, unknown>[][]) => { s[3]![0]!.keyCount = 2; },
    (s: Record<string, unknown>[][]) => { s[4]![0]!.referencedColumn = "OtherId"; },
    (s: Record<string, unknown>[][]) => { s[4]![0]!.nfr = true; },
  ];
  for (const mutate of mutations) { const sets = catalog(); mutate(sets); assert.throws(() => assertSecuritySchema(catalogEvidence(sets))); }
});
test("catalog probe compiles only system catalogs when 919 is absent", async () => {
  await assert.rejects(requireSecuritySchema({ query: async (text: string) => {
    assert.equal(text, securityCatalogSql); assert.ok(!text.includes("FROM uqp.")); return { recordsets: [] };
  } } as unknown as sql.Request), { code: "SECURITY_SCHEMA_REQUIRED" });
});
for (const failAudit of [false, true]) test(`production store passes same transaction to mandatory audit and rollback=${failAudit}`, async () => {
  const events: string[] = []; let staged = "0"; let committed = "0";
  const definition = { sqlText: "SELECT MRN FROM synthetic", dataSourceId: 4 };
  const tx = { begin: async (level: number) => { assert.equal(level, sql.ISOLATION_LEVEL.SERIALIZABLE); events.push("begin"); },
    commit: async () => { committed = staged; events.push("commit"); }, rollback: async () => { staged = committed; events.push("rollback"); } } as unknown as sql.Transaction;
  const request = () => {
    const values: Record<string, unknown> = {};
    const r = { input: (name: string, _type: unknown, value: unknown) => { values[name] = value; return r; }, query: async (text: string) => {
      events.push(text);
      if (text === securityCatalogSql) return { recordsets: catalog() };
      if (text.includes("FROM uqp.Dataset WITH")) { assert.ok(text.includes("UPDLOCK,HOLDLOCK")); return { recordset: [{ SqlText: definition.sqlText, DataSourceId: 4 }] }; }
      if (text.includes("FROM uqp.DatasetPatientAuditConfig")) return { recordset: [] };
      if (text.includes("FROM uqp.DatasetPatientAuditMetadata")) return { recordset: [{ DefinitionHash: definitionHash(definition), ColumnsJson: '["MRN"]' }] };
      if (text.includes("UPDATE uqp.DatasetPatientAuditConfig")) { staged = String(values.version); return { recordset: [] }; }
      return { recordset: [] };
    } }; return r as unknown as sql.Request;
  };
  const store = createPatientAuditStore({ getPool: async () => ({}) as sql.ConnectionPool, createTransaction: () => tx, createRequest: actual => { assert.equal(actual, tx); return request(); },
    audit: async (input, actual) => { assert.equal(actual, tx); assert.equal(staged, "1"); assert.ok(!JSON.stringify(input).includes("SELECT")); events.push("audit"); if (failAudit) throw new Error("synthetic-failure"); return 1; } });
  const service = createPatientAuditService(store, () => ({ activeVersion: 1, versions: new Map([[1, Buffer.alloc(32, 3)]]) }));
  const run = service.put(1, { expectedVersion: "0", isEnabled: true, patientKeyColumn: "MRN", identifierConfirmed: true }, 2);
  if (failAudit) { await assert.rejects(run); assert.equal(committed, "0"); assert.equal(staged, "0"); assert.equal(events.at(-1), "rollback"); }
  else { assert.equal((await run).version, "1"); assert.equal(committed, "1"); assert.equal(events.at(-1), "commit"); }
  assert.ok(events.indexOf(securityCatalogSql) < events.findIndex(e => e.includes("FROM uqp.Dataset WITH")));
});

test("patient proof inspection joins final delivery transaction without a second connection or commit", async () => {
  const definition = { sqlText: "SELECT MRN FROM synthetic", dataSourceId: 4 };
  const tx = { begin: async () => assert.fail("must not begin"), commit: async () => assert.fail("must not commit"),
    rollback: async () => assert.fail("must not rollback") } as unknown as sql.Transaction;
  const request = { input() { return request; }, query: async (statement: string) => {
    if (statement === securityCatalogSql) return { recordsets: catalog() };
    if (statement.includes("FROM uqp.Dataset WITH")) return { recordset: [{ SqlText: definition.sqlText, DataSourceId: 4 }] };
    if (statement.includes("FROM uqp.DatasetPatientAuditMetadata")) return { recordset: [{ DefinitionHash: definitionHash(definition), ColumnsJson: '["MRN"]' }] };
    assert.ok(!/INSERT|UPDATE|DELETE/.test(statement));
    return { recordset: [] };
  } };
  const service = createPatientAuditService(createPatientAuditStore({
    getPool: async () => assert.fail("must use outer connection"),
    createTransaction: () => assert.fail("must use outer transaction"),
    createRequest: actual => { assert.equal(actual, tx); return request as never; },
    audit: async () => assert.fail("inspection must not write"),
  }), () => ({ activeVersion: 1, versions: new Map([[1, Buffer.alloc(32, 3)]]) }));
  assert.equal((await service.dashboardState(1, tx)).status, "NOT_CONFIGURED");
});
