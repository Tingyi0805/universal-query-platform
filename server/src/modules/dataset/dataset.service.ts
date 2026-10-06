import { createDataSourceAdapter } from "../datasource/adapters/adapterFactory.js";
import { getDataSourceConfig } from "../datasource/datasource.repository.js";
import { assertSelectOnlySql } from "../../query/selectOnlySql.js";
import { compileQuery } from "../../query/queryCompiler.js";
import type { QueryResult } from "../../query/query.types.js";

export async function previewDataset(input: {
  dataSourceId: number;
  sqlText: string;
  values: Record<string, unknown>;
  maxRows: number;
  queryTimeoutSec?: number | null;
}): Promise<QueryResult> {
  assertSelectOnlySql(input.sqlText);

  const dataSource = await getDataSourceConfig(input.dataSourceId);
  if (!dataSource) throw new Error("DATASOURCE_NOT_FOUND");
  if (!dataSource.isActive) throw new Error("DATASOURCE_DISABLED");

  const compiled = compileQuery(input.sqlText, dataSource.type, input.values);
  const adapter = createDataSourceAdapter(dataSource.type);

  return adapter.executeQuery(dataSource, {
    sql: compiled.sql,
    binds: compiled.binds,
    maxRows: input.maxRows,
    timeoutSec: input.queryTimeoutSec ?? dataSource.queryTimeoutSec,
  });
}
