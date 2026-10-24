import sql from "mssql";
import { getPlatformDbPool } from "../../config/database.js";
import { candidateDescription, compileDescription, QueryDescriptionError, type CandidateQueryDescription, type DescribeQueryInput } from "../../query/queryDescription.js";
import { OracleAdapter } from "../datasource/adapters/oracleAdapter.js";
import { SqlServerAdapter } from "../datasource/adapters/sqlServerAdapter.js";
import { getDataSourceConfig } from "../datasource/datasource.repository.js";
import type { DataSourceConfig } from "../datasource/datasource.types.js";
import { listDatasetParameters } from "./parameter.repository.js";

/**
 * A metadata-only aid for the Designer. May be saved as DatasetColumn display
 * choices, never patient or Native Type evidence. Never executes Dataset SQL,
 * writes a policy, or grants preview/data-delivery authority.
 * A source DDL fence and source-generation witness are still missing.
 */
export class DatasetColumnCandidateError extends Error {
  constructor(readonly code: "DATASET_COLUMN_DESCRIPTION_INVALID_COLUMNS" | "DATASET_COLUMN_DESCRIPTION_UNSUPPORTED" | "DATASET_COLUMN_DESCRIPTION_CONFLICT"
    | "DATASET_COLUMN_DESCRIPTION_FAILED" | "DATASET_NOT_AVAILABLE" | "DATASOURCE_NOT_AVAILABLE",
    readonly status = 409) { super(code); this.name = "DatasetColumnCandidateError"; }
}

export type ColumnCandidateSnapshot = Readonly<{
  datasetId: number; dataSourceId: number; sqlText: string;
  definitionVersion: string; configurationVersion: string;
  datasetActive: boolean; datasetArchived: boolean; sourceActive: boolean; sourceType: string;
}>;
export const defaultColumnCandidateDependencies = {
  async snapshot(datasetId: number): Promise<ColumnCandidateSnapshot | null> {
    const pool = await getPlatformDbPool();
    if (!pool) throw new DatasetColumnCandidateError("DATASET_COLUMN_DESCRIPTION_FAILED", 503);
    const result = await pool.request().input("id", sql.BigInt, datasetId).query(`
      SELECT d.Id AS DatasetId, d.DataSourceId, d.SqlText,
        d.IsActive AS DatasetActive, d.IsArchived AS DatasetArchived,
        s.IsActive AS SourceActive, s.Type AS SourceType,
        d.DefinitionRowVersion AS DefinitionVersion,
        s.ConfigurationRowVersion AS ConfigurationVersion
      FROM uqp.Dataset d
      INNER JOIN uqp.DataSource s ON s.Id=d.DataSourceId
      WHERE d.Id=@id`);
    const row = result.recordset[0];
    return row ? {
      datasetId: Number(row.DatasetId), dataSourceId: Number(row.DataSourceId),
      sqlText: String(row.SqlText), definitionVersion: Buffer.isBuffer(row.DefinitionVersion) && row.DefinitionVersion.length === 8 ? row.DefinitionVersion.toString("hex") : "",
      configurationVersion: Buffer.isBuffer(row.ConfigurationVersion) && row.ConfigurationVersion.length === 8 ? row.ConfigurationVersion.toString("hex") : "",
      datasetActive: Boolean(row.DatasetActive), datasetArchived: Boolean(row.DatasetArchived),
      sourceActive: Boolean(row.SourceActive), sourceType: String(row.SourceType),
    } : null;
  },
  parameters: listDatasetParameters,
  config: getDataSourceConfig,
  describe: (config: DataSourceConfig, input: DescribeQueryInput) => (config.type === "ORACLE" ? new OracleAdapter() : new SqlServerAdapter()).describeQuery(config, input),
};

export function createDatasetColumnCandidate(deps = defaultColumnCandidateDependencies) {
  async function open(datasetId: number) {
    if (!Number.isSafeInteger(datasetId) || datasetId <= 0)
      throw new DatasetColumnCandidateError("DATASET_NOT_AVAILABLE", 404);
    let initial: ColumnCandidateSnapshot;
    try {
      const snapshot = await deps.snapshot(datasetId);
      if (!snapshot) throw new DatasetColumnCandidateError("DATASET_NOT_AVAILABLE", 404);
      initial = snapshot;
    } catch (error) {
      if (error instanceof DatasetColumnCandidateError) throw error;
      throw new DatasetColumnCandidateError("DATASET_COLUMN_DESCRIPTION_FAILED", 503);
    }
    if (initial.datasetId !== datasetId || !Number.isSafeInteger(initial.dataSourceId)
      || initial.dataSourceId <= 0 || !initial.datasetActive || initial.datasetArchived)
      throw new DatasetColumnCandidateError("DATASET_NOT_AVAILABLE", 409);
    if (!initial.sourceActive) throw new DatasetColumnCandidateError("DATASOURCE_NOT_AVAILABLE", 409);
    if (!["SQLSERVER", "ORACLE"].includes(initial.sourceType) || !/^[0-9a-f]{16}$/u.test(initial.definitionVersion)
      || !/^[0-9a-f]{16}$/u.test(initial.configurationVersion)
      || initial.sqlText.length === 0 || initial.sqlText.length > 200000)
      throw new DatasetColumnCandidateError("DATASET_COLUMN_DESCRIPTION_UNSUPPORTED");

    const revalidate = async () => {
      try {
        const current = await deps.snapshot(datasetId);
        if (!current || Object.keys(initial).some(key =>
          current[key as keyof ColumnCandidateSnapshot] !== initial[key as keyof ColumnCandidateSnapshot]))
          throw new DatasetColumnCandidateError("DATASET_COLUMN_DESCRIPTION_CONFLICT");
        const parameters = await deps.parameters(datasetId);
        if (!Array.isArray(parameters) || parameters.length)
          throw new DatasetColumnCandidateError("DATASET_COLUMN_DESCRIPTION_UNSUPPORTED");
      } catch (error) {
        if (error instanceof DatasetColumnCandidateError) throw error;
        throw new DatasetColumnCandidateError("DATASET_COLUMN_DESCRIPTION_FAILED", 503);
      }
    };

    // The saved-parameter check and the SQL lexer both fail closed.
    await revalidate();
    try { compileDescription({ sql: initial.sqlText, parameters: [], timeoutSec: 10 }, initial.sourceType as "SQLSERVER" | "ORACLE"); }
    catch { throw new DatasetColumnCandidateError("DATASET_COLUMN_DESCRIPTION_UNSUPPORTED"); }

    const describe = async (): Promise<CandidateQueryDescription> => {
      let source: DataSourceConfig | null;
      try { source = await deps.config(initial.dataSourceId); }
      catch { throw new DatasetColumnCandidateError("DATASET_COLUMN_DESCRIPTION_FAILED", 503); }
      if (!source || !source.isActive) throw new DatasetColumnCandidateError("DATASOURCE_NOT_AVAILABLE");
      if (source.type !== initial.sourceType) throw new DatasetColumnCandidateError("DATASET_COLUMN_DESCRIPTION_UNSUPPORTED");
      await revalidate();
      let candidate: CandidateQueryDescription;
      try {
        candidate = await deps.describe(source, { sql: initial.sqlText, parameters: [], timeoutSec: 10 });
      } catch (error) {
        if (error instanceof QueryDescriptionError && error.code === "DESCRIPTION_METADATA_INVALID")
          throw new DatasetColumnCandidateError("DATASET_COLUMN_DESCRIPTION_INVALID_COLUMNS");
        if (error instanceof QueryDescriptionError && ["DESCRIPTION_UNSUPPORTED", "DESCRIPTION_PARAMETER_UNSUPPORTED"].includes(error.code))
          throw new DatasetColumnCandidateError("DATASET_COLUMN_DESCRIPTION_UNSUPPORTED");
        // Never expose driver exceptions, SQL, parameters, credential or row values.
        throw new DatasetColumnCandidateError("DATASET_COLUMN_DESCRIPTION_FAILED", 503);
      }
      if (candidate.trust !== "UNBOUND_CANDIDATE" || candidate.requiresExecutionComparison !== true
        || candidate.evidenceType !== (initial.sourceType === "ORACLE" ? "ORACLE_STATEMENT_INFO" : "SQLSERVER_DESCRIBE_FIRST_RESULT_SET")
        || !Array.isArray(candidate.columns) || candidate.columns.length < 1 || candidate.columns.length > 4096)
        throw new DatasetColumnCandidateError("DATASET_COLUMN_DESCRIPTION_FAILED", 503);
      try {
        candidate = candidateDescription(candidate.evidenceType, candidate.columns);
        if (candidate.columns.some(c => c.name.length > 256 || /[\x00-\x1f\x7f]/u.test(c.name) || c.dataType.length > 100)) throw new Error();
      } catch { throw new DatasetColumnCandidateError("DATASET_COLUMN_DESCRIPTION_INVALID_COLUMNS"); }
      await revalidate();
      return candidate;
    };
    return { revalidate, describe, dataSourceId: initial.dataSourceId, definitionVersion: initial.definitionVersion,
      configurationVersion: initial.configurationVersion };
  }
  return { open };
}

export const datasetColumnCandidate = createDatasetColumnCandidate();
