import assert from "node:assert/strict";
import test from "node:test";
import sql from "mssql";
import { assertDataSourceVersionSchema, createDataSourceVersionRepository } from "./datasourceVersion.repository.js";
import { createNativeParameterVersionRepository } from "../dataset/nativeParameterVersion.repository.js";
import { evidenceId, expectedRowVersion, VersionFoundationError } from "./versionFoundation.js";

const largeId = "9223372036854775806";
const sourceId = "9007199254740993";
const bytes = (value: bigint) => Buffer.from(value.toString(16).padStart(16, "0"), "hex");
const catalog = (columnName: string) => [{ columnName, typeId: 189, userTypeId: 189, maxLength: 8, nullable: false, computed: false }];

function fixture() {
  const state = {
    source: { DataSourceId: sourceId, Type: "SQLSERVER", IsActive: true, SourceInformationValid: 1,
      ConfigurationRowVersion: bytes(1n), EncryptedPassword: "SYNTHETIC_SECRET" } as Record<string, any> | null,
    dataset: { DatasetId: largeId, DataSourceId: sourceId, DefinitionRowVersion: bytes(10n), IsActive: false, IsArchived: false } as Record<string, any> | null,
    contract: null as Record<string, any> | null,
    parameterCount: "0", sourceSchema: catalog("ConfigurationRowVersion"), datasetSchema: catalog("DefinitionRowVersion"),
    foundationInstalled: true, activeTransaction: true, failure: "", began: 0, committed: 0, rolledBack: 0,
    queries: [] as string[], inputs: [] as unknown[],
  };
  const tx = {
    async begin(level: number) {
      assert.equal(level, sql.ISOLATION_LEVEL.SERIALIZABLE);
      if (state.failure === "begin") throw new Error("SYNTHETIC SQL password patient");
      state.began++;
    },
    async commit() { if (state.failure === "commit") throw new Error("SYNTHETIC SQL password patient"); state.committed++; },
    async rollback() { state.rolledBack++; },
  } as unknown as sql.Transaction;
  const deps = {
    getPool: async () => ({}) as sql.ConnectionPool,
    createTransaction: () => tx,
    createRequest: (actual: sql.Transaction) => {
      assert.equal(actual, tx);
      const request = {
        input(_name: string, type: unknown, value: unknown) { assert.equal(type, sql.BigInt); state.inputs.push(value); return request; },
        async query(text: string) {
          state.queries.push(text);
          if (state.failure && text.includes(state.failure)) throw new Error("SYNTHETIC SQL password patient");
          if (text.includes("@@TRANCOUNT")) {
            if (!state.activeTransaction) throw new Error("NO_TRANSACTION");
            return { recordset: [] };
          }
          if (text.includes("DECLARE @ExpectedColumns")) {
            if (!state.foundationInstalled) throw new Error("SCHEMA_CONFLICT");
            return { recordset: [{ SchemaValid: 1 }] };
          }
          if (text.includes("FROM sys.columns")) return { recordset: text.includes("uqp.DataSource") ? state.sourceSchema : state.datasetSchema };
          if (text.includes("FROM uqp.DataSource WITH")) return { recordset: state.source ? [{ ...state.source }] : [] };
          if (text.includes("FROM uqp.DatasetParameter WITH")) return { recordset: [{ ParameterCount: state.parameterCount }] };
          if (text.includes("FROM uqp.DatasetNativeParameterContract WITH")) return { recordset: state.contract ? [{ ...state.contract }] : [] };
          if (text.includes("FROM uqp.Dataset WITH")) return { recordset: state.dataset ? [{ ...state.dataset }] : [] };
          assert.fail("unexpected SQL operation");
        },
      };
      return request as unknown as sql.Request;
    },
  };
  function addUnconfirmed() {
    state.contract = { DatasetId: largeId, DataSourceId: sourceId, DefinitionRowVersion: bytes(10n),
      ConfigurationRowVersion: bytes(1n), ContractRowVersion: bytes(20n), State: "UNCONFIRMED" };
  }
  return { state, tx, addUnconfirmed, sources: createDataSourceVersionRepository(deps), native: createNativeParameterVersionRepository(deps) };
}

test("DataSource evidence contains only exact string identity, opaque version and active source type", async () => {
  const f = fixture();
  const result = await f.sources.readDataSourceVersion(sourceId);
  assert.deepEqual(result, { dataSourceId: sourceId, configurationVersion: "0000000000000001", sourceType: "SQLSERVER", isActive: true });
  assert.ok(Object.isFrozen(result));
  assert.deepEqual(f.state.inputs, [sourceId]);
  assert.equal(f.state.began, 1); assert.equal(f.state.committed, 1);
  assert.doesNotMatch(JSON.stringify(result), /SYNTHETIC_SECRET|EncryptedPassword|Host|Username/);
  assert.ok(f.state.queries.find(q => q.includes("FROM uqp.DataSource WITH (HOLDLOCK)")));
});

test("DataSource A→B→A, same-value updates and credential changes never revive old ROWVERSION", async () => {
  const f = fixture();
  const original = await f.sources.readDataSourceVersion(sourceId);
  // Simulate SQL Server-generated revisions; the payload can return to A.
  f.state.source!.ConfigurationRowVersion = bytes(2n);
  await assert.rejects(f.sources.readDataSourceVersion(sourceId, original), /VERSION_FOUNDATION_CONFLICT/);
  f.state.source!.ConfigurationRowVersion = bytes(3n);
  await assert.rejects(f.sources.readDataSourceVersion(sourceId, original), /VERSION_FOUNDATION_CONFLICT/);
  const beforePassword = await f.sources.readDataSourceVersion(sourceId);
  f.state.source!.EncryptedPassword = "SYNTHETIC_ROTATION";
  f.state.source!.ConfigurationRowVersion = bytes(4n);
  await assert.rejects(f.sources.readDataSourceVersion(sourceId, beforePassword), /VERSION_FOUNDATION_CONFLICT/);
});

for (const patch of [null, { IsActive: false }, { IsActive: "true" }, { SourceInformationValid: 0 },
  { DataSourceId: "5" }, { Type: "UNKNOWN" }, { ConfigurationRowVersion: Buffer.alloc(7) }]) {
  test("missing, disabled, mismatched or malformed DataSource evidence fails closed", async () => {
    const f = fixture(); f.state.source = patch ? { ...f.state.source, ...patch } : null;
    await assert.rejects(f.sources.readDataSourceVersion(sourceId), VersionFoundationError);
    assert.equal(f.state.committed, 0); assert.equal(f.state.rolledBack, 1);
  });
}

test("DataSource expected identity and type cannot be substituted even with a matching version", async () => {
  const f = fixture(); const before = await f.sources.readDataSourceVersion(sourceId);
  for (const expected of [{ ...before, dataSourceId: "5" }, { ...before, sourceType: "ORACLE" as const }]) {
    await assert.rejects(f.sources.readDataSourceVersion(sourceId, expected), /VERSION_FOUNDATION_CONFLICT/);
  }
});

test("BIGINT identifiers and ROWVERSION never transit through JavaScript Number", async () => {
  assert.equal(evidenceId(9223372036854775807n), "9223372036854775807");
  assert.equal(expectedRowVersion("ffffffffffffffff"), "ffffffffffffffff");
  for (const bad of [9007199254740993, "9223372036854775808", "01", "0", -1n, "1;SELECT"]) {
    assert.throws(() => evidenceId(bad as any), /VERSION_FOUNDATION_INVALID_INPUT/);
  }
  for (const bad of [1, "0x0000000000000001", "1", "FFFFFFFFFFFFFFFF", "SQL password"]) {
    assert.throws(() => expectedRowVersion(bad as any), /VERSION_FOUNDATION_INVALID_INPUT/);
  }
  const f = fixture(); f.state.source!.ConfigurationRowVersion = bytes(18446744073709551615n);
  assert.equal((await f.sources.readDataSourceVersion(sourceId)).configurationVersion, "ffffffffffffffff");
});

test("DataSource schema validates the single real nonnullable ROWVERSION, including alias-type conflicts", async () => {
  assert.doesNotThrow(() => assertDataSourceVersionSchema(catalog("ConfigurationRowVersion")));
  for (const columns of [[], catalog("OtherVersion"), [...catalog("ConfigurationRowVersion"), ...catalog("Other")],
    [{ ...catalog("ConfigurationRowVersion")[0], typeId: 173 }],
    [{ ...catalog("ConfigurationRowVersion")[0], userTypeId: 999 }],
    [{ ...catalog("ConfigurationRowVersion")[0], nullable: true }],
    [{ ...catalog("ConfigurationRowVersion")[0], computed: true }],
    [{ ...catalog("ConfigurationRowVersion")[0], maxLength: 7 }]]) {
    assert.throws(() => assertDataSourceVersionSchema(columns), /VERSION_FOUNDATION_SCHEMA_REQUIRED/);
  }
  const f = fixture(); f.state.sourceSchema = [];
  await assert.rejects(f.sources.readDataSourceVersion(sourceId), /VERSION_FOUNDATION_SCHEMA_REQUIRED/);
});

test("missing native contract is explicitly non-deliverable, not a verified empty binding set", async () => {
  const f = fixture();
  const snapshot = await f.native.readNativeParameterVersion(largeId);
  assert.equal(snapshot.datasetId, largeId);
  assert.equal(snapshot.state, "MISSING"); assert.equal(snapshot.contractVersion, null);
  assert.equal(snapshot.runtimeBindVerified, false); assert.equal(snapshot.deliveryAllowed, false);
  await assert.rejects(f.native.requireVerifiedNativeParameterContract(largeId), /NATIVE_PARAMETER_CONTRACT_MISSING/);
  assert.equal(f.state.rolledBack, 1);
});

test("persisted unconfirmed binding version is inspectable but can never grant verification or delivery", async () => {
  const f = fixture(); f.addUnconfirmed();
  const snapshot = await f.native.readNativeParameterVersion(largeId);
  assert.equal(snapshot.contractVersion, "0000000000000014");
  assert.equal(snapshot.state, "UNCONFIRMED"); assert.equal(snapshot.deliveryAllowed, false);
  await assert.rejects(f.native.requireVerifiedNativeParameterContract(largeId), /NATIVE_PARAMETER_CONTRACT_UNCONFIRMED/);
  assert.equal(f.state.rolledBack, 1);
  assert.ok(f.state.queries.filter(q => /FROM uqp\./.test(q)).every(q => q.includes("HOLDLOCK")));
});

for (const patch of [{ DefinitionRowVersion: bytes(11n) }, { ConfigurationRowVersion: bytes(2n) },
  { DataSourceId: "5" }, { DatasetId: "6" }, { State: "VERIFIED" }, { ContractRowVersion: Buffer.alloc(7) }]) {
  test("stale or malformed stored native binding cannot become version evidence", async () => {
    const f = fixture(); f.addUnconfirmed(); Object.assign(f.state.contract!, patch);
    await assert.rejects(f.native.readNativeParameterVersion(largeId), VersionFoundationError);
    assert.equal(f.state.committed, 0); assert.equal(f.state.rolledBack, 1);
  });
}

test("definition, source and independent binding A→B→A changes invalidate a previous snapshot", async () => {
  const f = fixture(); f.addUnconfirmed(); const before = await f.native.readNativeParameterVersion(largeId);
  f.state.contract!.ContractRowVersion = bytes(22n);
  await assert.rejects(f.native.readNativeParameterVersion(largeId, before), /VERSION_FOUNDATION_CONFLICT/);
  f.state.contract!.ContractRowVersion = bytes(20n);
  f.state.dataset!.DefinitionRowVersion = bytes(12n);
  await assert.rejects(f.native.readNativeParameterVersion(largeId, before), /VERSION_FOUNDATION_CONFLICT/);
  f.state.dataset!.DefinitionRowVersion = bytes(10n);
  f.state.source!.ConfigurationRowVersion = bytes(3n);
  await assert.rejects(f.native.readNativeParameterVersion(largeId, before), /VERSION_FOUNDATION_CONFLICT/);
});

test("native expectation cross-checks Dataset identity and captured definition even if contract is missing", async () => {
  const f = fixture(); const before = await f.native.readNativeParameterVersion(largeId);
  for (const expected of [{ ...before, datasetId: "6" }, { ...before, definitionVersion: "0000000000000009" },
    { ...before, contractVersion: "0000000000000001" }]) {
    await assert.rejects(f.native.readNativeParameterVersion(largeId, expected), /VERSION_FOUNDATION_CONFLICT/);
  }
});

test("new, inactive Dataset can inspect versions but archived or missing Dataset is rejected", async () => {
  const f = fixture(); assert.equal((await f.native.readNativeParameterVersion(largeId)).deliveryAllowed, false);
  f.state.dataset!.IsArchived = true;
  await assert.rejects(f.native.readNativeParameterVersion(largeId), /VERSION_FOUNDATION_DATASET_INVALID/);
  f.state.dataset = null;
  await assert.rejects(f.native.readNativeParameterVersion(largeId), /VERSION_FOUNDATION_DATASET_INVALID/);
});

test("Oracle parameterized contract remains unsupported without calling any source adapter", async () => {
  const f = fixture(); f.state.source!.Type = "ORACLE"; f.state.parameterCount = "1";
  await assert.rejects(f.native.readNativeParameterVersion(largeId), /NATIVE_PARAMETER_ORACLE_UNSUPPORTED/);
  f.state.parameterCount = "0";
  await assert.rejects(f.native.requireVerifiedNativeParameterContract(largeId), /NATIVE_PARAMETER_CONTRACT_MISSING/);
});

test("missing 920/921, partial installation and malformed count all fail closed", async () => {
  const f = fixture(); f.state.foundationInstalled = false;
  await assert.rejects(f.native.readNativeParameterVersion(largeId), /VERSION_FOUNDATION_SCHEMA_REQUIRED/);
  f.state.foundationInstalled = true; f.state.datasetSchema = [];
  await assert.rejects(f.native.readNativeParameterVersion(largeId), /VERSION_FOUNDATION_SCHEMA_REQUIRED/);
  f.state.datasetSchema = catalog("DefinitionRowVersion"); f.state.parameterCount = "UNKNOWN";
  await assert.rejects(f.native.readNativeParameterVersion(largeId), /NATIVE_PARAMETER_CONTRACT_INVALID/);
});

for (const failure of ["begin", "commit", "FROM uqp.DatasetParameter", "FROM uqp.DatasetNativeParameterContract"]) {
  test(`transaction or read failure returns no partial trustworthy state (${failure})`, async () => {
    const f = fixture(); f.addUnconfirmed(); f.state.failure = failure;
    const before = { ...f.state.contract };
    await assert.rejects(f.native.readNativeParameterVersion(largeId), error => {
      assert.ok(error instanceof VersionFoundationError);
      assert.equal(error.message, error.code);
      assert.doesNotMatch(error.message, /SYNTHETIC|password|patient|SELECT/);
      assert.equal(error.cause, undefined);
      return true;
    });
    assert.deepEqual(f.state.contract, before);
    assert.equal(f.state.committed, 0);
    assert.equal(f.state.rolledBack, failure === "begin" ? 0 : 1);
    assert.ok(!f.state.queries.some(q => /(?:UPDATE|INSERT INTO|DELETE FROM) uqp\./i.test(q)));
  });
}

for (const fail of [false, true]) {
  test(`outer transaction completion remains caller-owned (failure=${fail})`, async () => {
    const f = fixture(); if (fail) f.state.failure = "FROM uqp.DatasetParameter";
    const result = f.native.readNativeParameterVersion(largeId, undefined, f.tx);
    if (fail) await assert.rejects(result, /VERSION_FOUNDATION_UNAVAILABLE/);
    else assert.equal((await result).state, "MISSING");
    assert.equal(f.state.began, 0); assert.equal(f.state.committed, 0); assert.equal(f.state.rolledBack, 0);
  });
}

test("inactive outer transaction and driver schema errors never leak raw diagnostics", async () => {
  const f = fixture(); f.state.activeTransaction = false;
  await assert.rejects(f.sources.readDataSourceVersion(sourceId, undefined, f.tx), /^VersionFoundationError: VERSION_FOUNDATION_UNAVAILABLE$/);
  f.state.activeTransaction = true; f.state.failure = "FROM sys.columns";
  await assert.rejects(f.sources.readDataSourceVersion(sourceId), /^VersionFoundationError: VERSION_FOUNDATION_SCHEMA_REQUIRED$/);
});
