import sql from "mssql";
import { requireDatasetDefinitionVersionSchema } from "./datasetDeliveryPolicy.repository.js";
import { createDataSourceVersionRepository, validateSourceVersionExpectation, type DataSourceVersionEvidence } from "../datasource/datasourceVersion.repository.js";
import { versionFoundationSchemaSql } from "../datasource/versionFoundationSchema.js";
import { evidenceId, expectedRowVersion, rowVersion, VersionFoundationError, versionRepositoryDependencies,
  versionTransaction, type VersionRepositoryDependencies } from "../datasource/versionFoundation.js";

export type NativeParameterVersionExpectation = Readonly<{
  datasetId: string; definitionVersion: string; source: DataSourceVersionEvidence;
  contractVersion: string | null;
}>;
export type NativeParameterVersionSnapshot = NativeParameterVersionExpectation & Readonly<{
  state: "MISSING" | "UNCONFIRMED"; runtimeBindVerified: false; deliveryAllowed: false;
}>;

export function createNativeParameterVersionRepository(deps: VersionRepositoryDependencies) {
  const sources = createDataSourceVersionRepository(deps);
  async function readNativeParameterVersion(datasetId: string | bigint, expected?: NativeParameterVersionExpectation,
    outer?: sql.Transaction): Promise<NativeParameterVersionSnapshot> {
    const id = evidenceId(datasetId);
    if (expected) {
      evidenceId(expected.datasetId); expectedRowVersion(expected.definitionVersion);
      validateSourceVersionExpectation(expected.source);
      if (expected.contractVersion !== null) expectedRowVersion(expected.contractVersion);
    }
    return versionTransaction(deps, outer, async tx => {
      try {
        const schema = await deps.createRequest(tx).query(versionFoundationSchemaSql);
        if (schema.recordset.length !== 1 || schema.recordset[0].SchemaValid !== 1) throw new Error("missing");
        await requireDatasetDefinitionVersionSchema(deps.createRequest(tx));
      } catch { throw new VersionFoundationError("VERSION_FOUNDATION_SCHEMA_REQUIRED"); }
      const dataset = await deps.createRequest(tx).input("datasetId", sql.BigInt, id).query(`
        SELECT CONVERT(VARCHAR(20),Id) AS DatasetId,CONVERT(VARCHAR(20),DataSourceId) AS DataSourceId,
         DefinitionRowVersion,IsActive,IsArchived
        FROM uqp.Dataset WITH (HOLDLOCK) WHERE Id=@datasetId`);
      const row = dataset.recordset[0];
      if (dataset.recordset.length !== 1 || row.DatasetId !== id || ![false, 0].includes(row.IsArchived)) {
        throw new VersionFoundationError("VERSION_FOUNDATION_DATASET_INVALID");
      }
      const definitionVersion = rowVersion(row.DefinitionRowVersion);
      const source = await sources.readDataSourceVersion(evidenceId(row.DataSourceId), expected?.source, tx);
      // Native bind types cannot be inferred by getStatementInfo. An empty
      // parameter set is not a confirmed empty binding contract, either.
      const parameters = await deps.createRequest(tx).input("datasetId", sql.BigInt, id).query(`
        SELECT CONVERT(VARCHAR(20),COUNT_BIG(*)) AS ParameterCount
        FROM uqp.DatasetParameter WITH (HOLDLOCK) WHERE DatasetId=@datasetId`);
      const count = parameters.recordset[0]?.ParameterCount;
      if (typeof count !== "string" || !/^(0|[1-9][0-9]*)$/.test(count)) {
        throw new VersionFoundationError("NATIVE_PARAMETER_CONTRACT_INVALID");
      }
      if (source.sourceType === "ORACLE" && count !== "0") {
        throw new VersionFoundationError("NATIVE_PARAMETER_ORACLE_UNSUPPORTED");
      }
      const contract = await deps.createRequest(tx).input("datasetId", sql.BigInt, id).query(`
        SELECT CONVERT(VARCHAR(20),DatasetId) AS DatasetId,CONVERT(VARCHAR(20),DataSourceId) AS DataSourceId,
         DefinitionRowVersion,ConfigurationRowVersion,ContractRowVersion,State
        FROM uqp.DatasetNativeParameterContract WITH (HOLDLOCK) WHERE DatasetId=@datasetId`);
      if (contract.recordset.length > 1) throw new VersionFoundationError("NATIVE_PARAMETER_CONTRACT_INVALID");
      const c = contract.recordset[0];
      if (c && (c.DatasetId !== id || c.DataSourceId !== source.dataSourceId
        || rowVersion(c.DefinitionRowVersion) !== definitionVersion
        || rowVersion(c.ConfigurationRowVersion) !== source.configurationVersion)) {
        throw new VersionFoundationError("VERSION_FOUNDATION_CONFLICT");
      }
      if (c && c.State !== "UNCONFIRMED") throw new VersionFoundationError("NATIVE_PARAMETER_CONTRACT_INVALID");
      const contractVersion = c ? rowVersion(c.ContractRowVersion) : null;
      if (expected && (expected.datasetId !== id || expected.definitionVersion !== definitionVersion
        || expected.contractVersion !== contractVersion)) throw new VersionFoundationError("VERSION_FOUNDATION_CONFLICT");
      return Object.freeze({ datasetId: id, definitionVersion, source, contractVersion,
        state: c ? "UNCONFIRMED" : "MISSING", runtimeBindVerified: false, deliveryAllowed: false });
    });
  }
  async function requireVerifiedNativeParameterContract(datasetId: string | bigint,
    expected?: NativeParameterVersionExpectation, tx?: sql.Transaction): Promise<never> {
    return versionTransaction(deps, tx, async transaction => {
      const snapshot = await readNativeParameterVersion(datasetId, expected, transaction);
      // No VERIFIED state exists until explicit runtime binding has been proven.
      throw new VersionFoundationError(snapshot.state === "MISSING"
        ? "NATIVE_PARAMETER_CONTRACT_MISSING" : "NATIVE_PARAMETER_CONTRACT_UNCONFIRMED");
    });
  }
  return { readNativeParameterVersion, requireVerifiedNativeParameterContract };
}
export const { readNativeParameterVersion, requireVerifiedNativeParameterContract }
  = createNativeParameterVersionRepository(versionRepositoryDependencies);
