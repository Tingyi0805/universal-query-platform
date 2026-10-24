import assert from "node:assert/strict";
import test from "node:test";
import sql from "mssql";
import { SecurityContractError } from "../securityContract/securityContract.js";
import {
  assertDatasetDefinitionVersionSchema,
  createDatasetDeliveryPolicyRepository,
  DatasetDeliverySnapshotError,
  type DatasetDeliveryVersionEvidence,
} from "./datasetDeliveryPolicy.repository.js";

type RuleRow = { ColumnName: string; DeviceMaskMode: string; CustomMaskJson: string | null };

function fixture() {
  const state = {
    definition: 1n,
    policyVersion: "1" as string | null,
    rules: [
      { ColumnName: "NAME", DeviceMaskMode: "CUSTOM", CustomMaskJson: JSON.stringify({ prefix: 1, suffix: 1, symbol: "○" }) },
      { ColumnName: "MRN", DeviceMaskMode: "OMIT", CustomMaskJson: null },
    ] as RuleRow[],
    patient: { IsEnabled: true, PatientKeyColumn: "MRN", Version: "2" } as Record<string, unknown> | null,
    schemaMissing: false,
    failOn: "",
    transactions: 0,
    commits: 0,
    rollbacks: 0,
    queries: [] as string[],
  };
  const tx = {
    begin: async (level: number) => {
      if (level !== sql.ISOLATION_LEVEL.SERIALIZABLE) throw new Error("UNSAFE_ISOLATION");
      state.transactions++;
    },
    commit: async () => { state.commits++; },
    rollback: async () => { state.rollbacks++; },
  } as unknown as sql.Transaction;
  function request() {
    const values: Record<string, unknown> = {};
    const result = {
      input(name: string, _type: unknown, value: unknown) { values[name] = value; return result; },
      async query(text: string) {
        state.queries.push(text);
        if (state.failOn && text.includes(state.failOn)) {
          throw new Error("synthetic patient SQL password token custom-mask-secret");
        }
        if (text.includes("SELECT DefinitionRowVersion")) {
          return { recordset: [{ DefinitionRowVersion: Buffer.from(state.definition.toString(16).padStart(16, "0"), "hex") }] };
        }
        if (text.includes("DatasetSensitivePolicyVersion")) {
          return { recordset: state.policyVersion == null ? [] : [{ Version: state.policyVersion }] };
        }
        if (text.includes("FROM uqp.DatasetSensitiveColumn")) return { recordset: structuredClone(state.rules) };
        if (text.includes("FROM uqp.DatasetPatientAuditConfig")) return { recordset: state.patient ? [structuredClone(state.patient)] : [] };
        return { recordset: [] };
      },
    };
    return result as unknown as sql.Request;
  }
  const repository = createDatasetDeliveryPolicyRepository({
    getPool: async () => ({}) as sql.ConnectionPool,
    createTransaction: () => tx,
    createRequest: () => request(),
    requireSchema: async () => {
      if (state.schemaMissing) throw new SecurityContractError("SECURITY_SCHEMA_REQUIRED");
    },
  });
  return { state, repository, tx };
}

test("reads definition, policy, rules and patient evidence in one serializable snapshot", async () => {
  const f = fixture();
  f.state.policyVersion = "9223372036854775806";
  f.state.patient!.Version = "9223372036854775807";
  const before = structuredClone({ rules: f.state.rules, patient: f.state.patient });
  const snapshot = await f.repository.readConfirmedDatasetDeliverySnapshot(7);
  assert.equal(snapshot.definitionVersion, "0000000000000001");
  assert.equal(snapshot.sensitivityVersion, "9223372036854775806");
  assert.equal(snapshot.patientAuditVersion, "9223372036854775807");
  assert.deepEqual(snapshot.policy.rules, [
    { columnName: "NAME", mode: "CUSTOM", customMask: { prefix: 1, suffix: 1, symbol: "○" } },
    { columnName: "MRN", mode: "OMIT", customMask: null },
  ]);
  assert.deepEqual(snapshot.policy.patientAuditOnlyColumns, ["MRN"]);
  assert.deepEqual({ rules: f.state.rules, patient: f.state.patient }, before);
  assert.equal(f.state.transactions, 1); assert.equal(f.state.commits, 1); assert.equal(f.state.rollbacks, 0);
  assert.ok(f.state.queries.filter(query => query.includes("FROM uqp.")).every(query => query.includes("HOLDLOCK")));
});

test("confirmed empty policy differs from a missing or zero-version policy", async () => {
  const confirmed = fixture();
  confirmed.state.rules = []; confirmed.state.patient = null;
  const snapshot = await confirmed.repository.readConfirmedDatasetDeliverySnapshot(7);
  assert.deepEqual(snapshot.policy.rules, []);
  assert.equal(snapshot.policy.version, "1");
  assert.equal(snapshot.patientAuditVersion, "0");

  for (const version of [null, "0"] as const) {
    const unconfirmed = fixture(); unconfirmed.state.rules = []; unconfirmed.state.patient = null; unconfirmed.state.policyVersion = version;
    await assert.rejects(unconfirmed.repository.readConfirmedDatasetDeliverySnapshot(7), /DATASET_DELIVERY_POLICY_UNCONFIRMED/);
    assert.equal(unconfirmed.state.commits, 0); assert.equal(unconfirmed.state.rollbacks, 1);
  }
});

test("patient audit identifier must retain OMIT and CUSTOM is never overwritten", async () => {
  for (const rules of [
    [] as RuleRow[],
    [{ ColumnName: "MRN", DeviceMaskMode: "CUSTOM", CustomMaskJson: JSON.stringify({ prefix: 0, suffix: 2, symbol: "*" }) }],
    [{ ColumnName: "MRN", DeviceMaskMode: "FULL", CustomMaskJson: null }],
  ]) {
    const f = fixture(); f.state.rules = structuredClone(rules); const before = structuredClone(rules);
    await assert.rejects(f.repository.readConfirmedDatasetDeliverySnapshot(7), /DATASET_DELIVERY_POLICY_INVALID/);
    assert.deepEqual(f.state.rules, before);
  }
});

test("explicit legacy modes remain stored and use the same delivery engine", async () => {
  const f = fixture();
  f.state.patient = null;
  f.state.rules = [{ ColumnName: "NAME", DeviceMaskMode: "NAME", CustomMaskJson: null }];
  const before = structuredClone(f.state.rules);
  assert.equal((await f.repository.readConfirmedDatasetDeliverySnapshot(7)).policy.rules[0]?.mode, "NAME");
  assert.deepEqual(f.state.rules, before);
});

test("expected versions detect ROWVERSION A→B→A and policy/config conflicts", async () => {
  const f = fixture();
  const initial = await f.repository.readConfirmedDatasetDeliverySnapshot(7);
  const expected: DatasetDeliveryVersionEvidence = initial;
  f.state.definition = 3n;
  await assert.rejects(f.repository.readConfirmedDatasetDeliverySnapshot(7, expected), /DATASET_DELIVERY_VERSION_CONFLICT/);
  f.state.definition = 1n; f.state.policyVersion = "2";
  await assert.rejects(f.repository.readConfirmedDatasetDeliverySnapshot(7, expected), /DATASET_DELIVERY_VERSION_CONFLICT/);
  f.state.policyVersion = "1"; f.state.patient!.Version = "3";
  await assert.rejects(f.repository.readConfirmedDatasetDeliverySnapshot(7, expected), /DATASET_DELIVERY_VERSION_CONFLICT/);
});

test("missing, partial or malformed DefinitionRowVersion Schema fails closed", async () => {
  const valid = [{ columnName: "DefinitionRowVersion", typeId: 189, userTypeId: 189, maxLength: 8, nullable: false, computed: false }];
  assert.doesNotThrow(() => assertDatasetDefinitionVersionSchema(valid));
  for (const columns of [[], [{ ...valid[0], maxLength: 7 }], [...valid, { ...valid[0], columnName: "OtherVersion" }]]) {
    assert.throws(() => assertDatasetDefinitionVersionSchema(columns), /DATASET_DELIVERY_SCHEMA_REQUIRED/);
  }
  const f = fixture(); f.state.schemaMissing = true;
  await assert.rejects(f.repository.readConfirmedDatasetDeliverySnapshot(7), /DATASET_DELIVERY_SCHEMA_REQUIRED/);
});

test("malformed ROWVERSION and invalid policy revisions fail closed", async () => {
  const f = fixture();
  f.state.policyVersion = "9007199254740993.0";
  await assert.rejects(f.repository.readConfirmedDatasetDeliverySnapshot(7), /DATASET_DELIVERY_POLICY_UNCONFIRMED/);
  const malformed = fixture(); malformed.state.definition = -1n;
  await assert.rejects(malformed.repository.readConfirmedDatasetDeliverySnapshot(7), /DATASET_DELIVERY_SCHEMA_REQUIRED/);
});

test("database failures roll back and expose no SQL, patient, token or mask settings", async () => {
  const f = fixture(); f.state.failOn = "DatasetSensitiveColumn";
  await assert.rejects(f.repository.readConfirmedDatasetDeliverySnapshot(7), (error) => {
    assert.ok(error instanceof DatasetDeliverySnapshotError);
    assert.equal(error.code, "DATASET_DELIVERY_POLICY_UNAVAILABLE");
    for (const secret of ["SELECT", "patient", "password", "token", "custom-mask-secret"])
      assert.equal(error.message.includes(secret), false);
    return true;
  });
  assert.equal(f.state.commits, 0); assert.equal(f.state.rollbacks, 1);
});

for (const failure of [false, true]) test(`delivery snapshot joins outer transaction without owning its completion (failure=${failure})`, async () => {
  const f = fixture();
  if (failure) f.state.schemaMissing = true;
  const read = f.repository.readConfirmedDatasetDeliverySnapshot(7, undefined, f.tx);
  if (failure) await assert.rejects(read, /DATASET_DELIVERY_SCHEMA_REQUIRED/);
  else assert.equal((await read).datasetId, 7);
  assert.equal(f.state.transactions, 0); assert.equal(f.state.commits, 0); assert.equal(f.state.rollbacks, 0);
});
