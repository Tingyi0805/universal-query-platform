import type { DataSourceAdapter } from "../datasource/adapters/datasourceAdapter.js";
import type { DataSourceType } from "../datasource/datasource.types.js";
import { withErrorModule } from "../../middleware/safeErrorDiagnostic.js";
import { getDataSourceConfig } from "../datasource/datasource.repository.js";
import { assertSelectOnlySql } from "../../query/selectOnlySql.js";
import { compileQuery } from "../../query/queryCompiler.js";
import { detectParameterNames, runtimeParameterDefinitions } from "./parameterSync.js";
import type { QueryResult } from "../../query/query.types.js";
import { getDataset } from "./dataset.repository.js";
import { listDatasetParameters, type DatasetParameterRecord } from "./parameter.repository.js";
import { coerceRuntimeParameters } from "./parameter.service.js";

/** Pure fixed-option projection; never follows a Dataset binding. */
export function fixedParameterOptions(parameter: DatasetParameterRecord): Array<{ value: unknown; label: string }> {
  if (parameter.optionMode === "NONE") return [];
  if (parameter.optionMode !== "FIXED") throw new Error("PARAMETER_LOOKUP_REQUIRES_AUTHORIZED_DELIVERY");
  let parsed: unknown;
  try { parsed = JSON.parse(parameter.fixedOptionsJson ?? "[]"); }
  catch { throw new Error("PARAMETER_OPTIONS_INVALID"); }
  if (!Array.isArray(parsed)) throw new Error("PARAMETER_OPTIONS_INVALID");
  return parsed.map(item => {
    if (item && typeof item === "object" && "value" in item) {
      return { value: item.value, label: item.label == null ? String(item.value) : String(item.label) };
    }
    return { value: item, label: String(item) };
  });
}

export type DatasetServiceDependencies = {
  getDataset: typeof getDataset;
  listDatasetParameters: typeof listDatasetParameters;
  getDataSourceConfig: typeof getDataSourceConfig;
  createAdapter: (type: DataSourceType) => Promise<DataSourceAdapter>;
};
export function createDatasetService(deps: DatasetServiceDependencies) {
  async function previewDataset(input: {
    dataSourceId: number;
    datasetId?: number;
    sqlText: string;
    values: Record<string, unknown>;
    maxRows: number;
    queryTimeoutSec?: number | null;
  }): Promise<QueryResult> {
    assertSelectOnlySql(input.sqlText);

    const dataSource = await withErrorModule("datasource.load", () => deps.getDataSourceConfig(input.dataSourceId));
    if (!dataSource) throw new Error("DATASOURCE_NOT_FOUND");
    if (!dataSource.isActive) throw new Error("DATASOURCE_DISABLED");

    let values = input.values;

    if (input.datasetId) {
      const dataset = await withErrorModule("dataset.load", () => deps.getDataset(input.datasetId!));
      if (!dataset) throw new Error("DATASET_NOT_FOUND");
      if (dataset.isArchived) throw new Error("DATASET_ARCHIVED");

      const definitions = await withErrorModule("dataset.parameters.load", () => deps.listDatasetParameters(input.datasetId!));
      const tokenNames = detectParameterNames(input.sqlText);
      // Apply saved metadata to matching tokens even when unused settings are retained.
      // Newly edited SQL tokens still use explicit preview values until synchronized.
      values = { ...input.values, ...await withErrorModule("dataset.parameters.validate", async () =>
        coerceRuntimeParameters(definitions.filter(p => tokenNames.includes(p.name)), input.values)) };
    }

    const compiled = await withErrorModule("dataset.query.compile", async () => compileQuery(input.sqlText, dataSource.type, values));
    const adapter = await withErrorModule("dataset.query.execute", () => deps.createAdapter(dataSource.type));

    return withErrorModule("dataset.query.execute", () => adapter.executeQuery(dataSource, {
      sql: compiled.sql,
      binds: compiled.binds,
      bindValues: compiled.bindValues,
      maxRows: input.maxRows,
      timeoutSec: input.queryTimeoutSec ?? dataSource.queryTimeoutSec,
    }));
  }

  async function executeSavedDataset(
    datasetId: number,
    rawValues: Record<string, unknown>,
    maxRowsOverride?: number,
  ): Promise<QueryResult> {
    const dataset = await withErrorModule("dataset.load", () => deps.getDataset(datasetId));
    if (!dataset) throw new Error("DATASET_NOT_FOUND");
    if (dataset.isArchived) throw new Error("DATASET_ARCHIVED");
    if (!dataset.isActive) throw new Error("DATASET_DISABLED");

    assertSelectOnlySql(dataset.sqlText);

    const definitions = await withErrorModule("dataset.parameters.load", () => deps.listDatasetParameters(datasetId));
    const activeDefinitions = await withErrorModule("dataset.parameters.validate", async () =>
      runtimeParameterDefinitions(dataset.sqlText, definitions));
    const values = await withErrorModule("dataset.parameters.validate", async () => coerceRuntimeParameters(activeDefinitions, rawValues));

    return previewDataset({
      dataSourceId: dataset.dataSourceId,
      // Already loaded and validated once; do not reload/coerce a second time.
      sqlText: dataset.sqlText,
      values,
      maxRows: Math.min(maxRowsOverride ?? dataset.maxRows, dataset.maxRows),
      queryTimeoutSec: dataset.queryTimeoutSec,
    });
  }

  async function getParameterOptions(datasetId: number, parameterName: string) {
    const definitions = await withErrorModule("dataset.parameters.load", () => deps.listDatasetParameters(datasetId));
    const parameter = definitions.find((item) => item.name === parameterName);
    if (!parameter) throw new Error("PARAMETER_NOT_FOUND");

    // No identity/source policy is available in this low-level resolver.
    // Dataset-backed options must use the authorized delivery coordinator.
    return fixedParameterOptions(parameter);
  }

  return { previewDataset, executeSavedDataset, getParameterOptions };
}
const service = createDatasetService({ getDataset, listDatasetParameters, getDataSourceConfig,
  createAdapter: async type => (await import("../datasource/adapters/adapterFactory.js")).createDataSourceAdapter(type) });
export const { previewDataset, executeSavedDataset, getParameterOptions } = service;
