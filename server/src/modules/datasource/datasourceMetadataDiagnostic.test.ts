import assert from "node:assert/strict";
import test from "node:test";
import { diagnoseSavedMetadata } from "./datasourceMetadataDiagnostic.js";
import { QueryDescriptionError } from "../../query/queryDescription.js";
import type { DataSourceConfig } from "./datasource.types.js";

const config: DataSourceConfig = {
  type: "SQLSERVER", code: "SYNTHETIC", name: "Synthetic", host: "localhost",
  port: 1433, databaseName: "synthetic", username: "u", password: "PRIVATE_SECRET",
  oracleServiceName: null, oracleConnectionMode: null, odbcConnectionMode: null,
  odbcDsn: null, odbcConnectionString: null, connectionTimeoutSec: 5,
  queryTimeoutSec: 10, encryptConnection: true, trustServerCertificate: true, isActive: true,
};
const candidate = {
  trust: "UNBOUND_CANDIDATE" as const,
  evidenceType: "SQLSERVER_DESCRIBE_FIRST_RESULT_SET" as const,
  requiresExecutionComparison: true as const,
  columns: [{name: "UQP_META_TEST", dataType: "int", ordinal: 1}],
};
test("fixed SQL Server metadata diagnostic uses only native describe, never row execution", async () => {
  let descriptions = 0;
  const actual = await diagnoseSavedMetadata(2, {
    config: async () => config,
    adapter: () => ({
      describeQuery: async (_cfg, input) => {
        descriptions++;
        assert.deepEqual(input, {
          sql: "SELECT 1 AS UQP_META_TEST", parameters: [], timeoutSec: 10,
        });
        return candidate;
      },
    }),
  });
  assert.equal(descriptions, 1);
  assert.deepEqual(actual, {
    ok: true, code: "DESCRIPTION_OK",
    message: "安全欄位描述成功：來源可取得固定測試欄位的名稱與型別，未執行資料列查詢。",
    sourceType: "SQLSERVER",
  });
});

test("Oracle uses constant-only DUAL metadata and does not fetch rows", async () => {
  const result = await diagnoseSavedMetadata(1, {
    config: async () => ({...config, type: "ORACLE"}),
    adapter: () => ({
      describeQuery: async (_cfg, input) => {
        assert.deepEqual(input, {
          sql: "SELECT 1 AS UQP_META_TEST FROM DUAL", parameters: [], timeoutSec: 10,
        });
        return {...candidate, evidenceType: "ORACLE_STATEMENT_INFO", columns: [
          {name: "UQP_META_TEST", dataType: "NUMBER", ordinal: 1},
        ]};
      },
    }),
  });
  assert.equal(result.ok, true);
});

test("disabled and unsupported sources do not call metadata adapter", async () => {
  let calls = 0;
  const adapter = () => {calls++; return {};};
  const inactive = await diagnoseSavedMetadata(1, {
    config: async () => ({...config, isActive: false}), adapter,
  });
  const other = await diagnoseSavedMetadata(1, {
    config: async () => ({...config, type: "ODBC"}), adapter,
  });
  assert.equal(inactive.code, "DATASOURCE_DISABLED");
  assert.equal(other.code, "DESCRIPTION_UNSUPPORTED");
  assert.equal(calls, 0);
});

test("driver errors are redacted into fixed stage codes and never leak secrets", async () => {
  for (const [driverCode, expected] of [
    ["DESCRIPTION_CONNECT_FAILED", "DESCRIPTION_CONNECT_FAILED"],
    ["DESCRIPTION_RPC_FAILED", "DESCRIPTION_RPC_FAILED"],
    ["DESCRIPTION_UNSUPPORTED", "DESCRIPTION_UNSUPPORTED"],
  ] as const) {
    const actual = await diagnoseSavedMetadata(1, {
      config: async () => config,
      adapter: () => ({
        describeQuery: async () => { throw new QueryDescriptionError(driverCode); },
      }),
    });
    assert.equal(actual.ok, false);
    assert.equal(actual.code, expected);
    assert.ok(!JSON.stringify(actual).includes(config.password));
  }
  const unknown = await diagnoseSavedMetadata(1, {
    config: async () => config,
    adapter: () => ({
      describeQuery: async () => { throw new Error("PRIVATE_SQL_DRIVER_USERNAME_PASSWORD"); },
    }),
  });
  assert.equal(unknown.code, "DESCRIPTION_FAILED");
  assert.ok(!JSON.stringify(unknown).includes("PRIVATE_SQL_DRIVER"));
});

test("untrusted metadata never counts as diagnostic success", async () => {
  const result = await diagnoseSavedMetadata(1, {
    config: async () => config,
    adapter: () => ({
      describeQuery: async () => ({...candidate,
        columns: [{name: "SECRET_VALUE", dataType: "varchar(80)", ordinal: 1}]}),
    }),
  });
  assert.equal(result.code, "DESCRIPTION_METADATA_INVALID");
  assert.equal(result.ok, false);
});
