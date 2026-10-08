import { createDataSourceAdapter } from "../datasource/adapters/adapterFactory.js";
import { getDataSourceConfig } from "../datasource/datasource.repository.js";
import { assertSelectOnlySql } from "../../query/selectOnlySql.js";
import { compileQuery, extractParameterNames } from "../../query/queryCompiler.js";
import type { QueryResult } from "../../query/query.types.js";
import { getDataset } from "./dataset.repository.js";
import { listDatasetParameters } from "./parameter.repository.js";
import { coerceRuntimeParameters } from "./parameter.service.js";

export async function previewDataset(input: {
  dataSourceId: number;
  datasetId?: number;
  sqlText: string;
  values: Record<string, unknown>;
  maxRows: number;
  queryTimeoutSec?: number | null;
}): Promise<QueryResult> {
  assertSelectOnlySql(input.sqlText);

  const dataSource = await getDataSourceConfig(input.dataSourceId);
  if (!dataSource) throw new Error("DATASOURCE_NOT_FOUND");
  if (!dataSource.isActive) throw new Error("DATASOURCE_DISABLED");

  let values = input.values;

  if (input.datasetId) {
    const dataset = await getDataset(input.datasetId);
    if (!dataset) throw new Error("DATASET_NOT_FOUND");
    if (dataset.isArchived) throw new Error("DATASET_ARCHIVED");

    const definitions = await listDatasetParameters(input.datasetId);
    const tokenNames = extractParameterNames(input.sqlText);
    const definitionNames = definitions.map((parameter) => parameter.name);
    if (
      tokenNames.length === definitionNames.length &&
      tokenNames.every((name) => definitionNames.includes(name))
    ) {
      values = coerceRuntimeParameters(definitions, input.values);
    }
  }

  const compiled = compileQuery(input.sqlText, dataSource.type, values);
  const adapter = createDataSourceAdapter(dataSource.type);

  return adapter.executeQuery(dataSource, {
    sql: compiled.sql,
    binds: compiled.binds,
    bindValues: compiled.bindValues,
    maxRows: input.maxRows,
    timeoutSec: input.queryTimeoutSec ?? dataSource.queryTimeoutSec,
  });
}

export async function executeSavedDataset(
  datasetId: number,
  rawValues: Record<string, unknown>,
  maxRowsOverride?: number,
): Promise<QueryResult> {
  const dataset = await getDataset(datasetId);
  if (!dataset) throw new Error("DATASET_NOT_FOUND");
  if (dataset.isArchived) throw new Error("DATASET_ARCHIVED");
  if (!dataset.isActive) throw new Error("DATASET_DISABLED");

  assertSelectOnlySql(dataset.sqlText);

  const definitions = await listDatasetParameters(datasetId);
  const tokenNames = extractParameterNames(dataset.sqlText);
  const definitionNames = definitions.map((parameter) => parameter.name);

  if (
    tokenNames.length !== definitionNames.length ||
    tokenNames.some((name) => !definitionNames.includes(name))
  ) {
    throw new Error("PARAMETER_DEFINITION_MISMATCH");
  }

  const values = coerceRuntimeParameters(definitions, rawValues);

  return previewDataset({
    dataSourceId: dataset.dataSourceId,
    datasetId,
    sqlText: dataset.sqlText,
    values,
    maxRows: Math.min(maxRowsOverride ?? dataset.maxRows, dataset.maxRows),
    queryTimeoutSec: dataset.queryTimeoutSec,
  });
}

export async function getParameterOptions(datasetId: number, parameterName: string) {
  const definitions = await listDatasetParameters(datasetId);
  const parameter = definitions.find((item) => item.name === parameterName);
  if (!parameter) throw new Error("PARAMETER_NOT_FOUND");

  if (parameter.optionMode === "NONE") return [];

  if (parameter.optionMode === "FIXED") {
    const parsed = JSON.parse(parameter.fixedOptionsJson ?? "[]");
    if (!Array.isArray(parsed)) throw new Error("PARAMETER_OPTIONS_INVALID");

    return parsed.map((item) => {
      if (item && typeof item === "object" && "value" in item) {
        const objectItem = item as { value: unknown; label?: unknown };
        return {
          value: objectItem.value,
          label: objectItem.label == null ? String(objectItem.value) : String(objectItem.label),
        };
      }
      return { value: item, label: String(item) };
    });
  }

  if (!parameter.lookupDatasetId || !parameter.lookupValueField || !parameter.lookupLabelField) {
    throw new Error("PARAMETER_LOOKUP_NOT_CONFIGURED");
  }

  const lookupDefinitions = await listDatasetParameters(parameter.lookupDatasetId);
  if (lookupDefinitions.some((item) => item.isRequired && item.defaultValue == null)) {
    throw new Error("PARAMETER_LOOKUP_REQUIRES_INPUT");
  }

  const result = await executeSavedDataset(parameter.lookupDatasetId, {}, 500);

  return result.rows.map((row) => ({
    value: row[parameter.lookupValueField!],
    label: row[parameter.lookupLabelField!] == null
      ? String(row[parameter.lookupValueField!] ?? "")
      : String(row[parameter.lookupLabelField!]),
  }));
}
