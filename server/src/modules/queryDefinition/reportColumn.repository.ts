import sql from "mssql";
import { getPlatformDbPool } from "../../config/database.js";
import { getQueryDefinition } from "./queryDefinition.repository.js";
import { listDatasetColumns } from "../dataset/column.repository.js";

export type ReportColumnRecord = {
  columnName: string;
  dataType: string | null;
  displayLabel: string;
  displayOrder: number;
  isVisible: boolean;
  width: number | null;
  displayFormat: string | null;
  alignment: "LEFT" | "CENTER" | "RIGHT";
  groupOrder: number | null;
  aggregateType: "NONE" | "SUM" | "AVG" | "MIN" | "MAX" | "COUNT";
};

async function requirePool() {
  const pool = await getPlatformDbPool();
  if (!pool) throw new Error("PLATFORM_DB_NOT_CONFIGURED");
  return pool;
}

export async function listReportColumns(queryId: number): Promise<ReportColumnRecord[]> {
  const query = await getQueryDefinition(queryId);
  if (!query) throw new Error("QUERY_DEFINITION_NOT_FOUND");

  const datasetColumns = await listDatasetColumns(query.datasetId);
  const pool = await requirePool();

  const configured = await pool.request()
    .input("queryId", sql.BigInt, queryId)
    .query(`
      SELECT ColumnName, DisplayLabel, DisplayOrder, IsVisible, Width,
             DisplayFormat, Alignment, GroupOrder, AggregateType
      FROM uqp.ReportColumn
      WHERE QueryDefinitionId=@queryId
    `);

  const configMap = new Map(configured.recordset.map((row) => [String(row.ColumnName), row]));

  return datasetColumns.map((column, index) => {
    const row = configMap.get(column.name);
    return {
      columnName: column.name,
      dataType: column.dataType,
      displayLabel: row ? String(row.DisplayLabel) : column.name,
      displayOrder: row ? Number(row.DisplayOrder) : index,
      isVisible: row ? Boolean(row.IsVisible) : true,
      width: row?.Width == null ? null : Number(row.Width),
      displayFormat: row?.DisplayFormat == null ? null : String(row.DisplayFormat),
      alignment: row?.Alignment ?? "LEFT",
      groupOrder: row?.GroupOrder == null ? null : Number(row.GroupOrder),
      aggregateType: row?.AggregateType ?? "NONE",
    };
  }).sort((a, b) => a.displayOrder - b.displayOrder);
}

export async function replaceReportColumns(
  queryId: number,
  columns: Omit<ReportColumnRecord, "dataType">[],
): Promise<void> {
  const query = await getQueryDefinition(queryId);
  if (!query) throw new Error("QUERY_DEFINITION_NOT_FOUND");

  const datasetColumns = await listDatasetColumns(query.datasetId);
  const allowed = new Set(datasetColumns.map((column) => column.name));
  if (columns.some((column) => !allowed.has(column.columnName))) {
    throw new Error("REPORT_COLUMN_NOT_IN_DATASET");
  }

  const pool = await requirePool();
  const tx = new sql.Transaction(pool);
  await tx.begin();

  try {
    await new sql.Request(tx)
      .input("queryId", sql.BigInt, queryId)
      .query("DELETE FROM uqp.ReportColumn WHERE QueryDefinitionId=@queryId");

    for (const column of columns) {
      await new sql.Request(tx)
        .input("queryId", sql.BigInt, queryId)
        .input("columnName", sql.NVarChar(256), column.columnName)
        .input("displayLabel", sql.NVarChar(256), column.displayLabel)
        .input("displayOrder", sql.Int, column.displayOrder)
        .input("isVisible", sql.Bit, column.isVisible)
        .input("width", sql.Int, column.width)
        .input("displayFormat", sql.NVarChar(100), column.displayFormat)
        .input("alignment", sql.NVarChar(10), column.alignment)
        .input("groupOrder", sql.Int, column.groupOrder)
        .input("aggregateType", sql.NVarChar(10), column.aggregateType)
        .query(`
          INSERT INTO uqp.ReportColumn (
            QueryDefinitionId, ColumnName, DisplayLabel, DisplayOrder,
            IsVisible, Width, DisplayFormat, Alignment, GroupOrder, AggregateType
          )
          VALUES (
            @queryId,@columnName,@displayLabel,@displayOrder,
            @isVisible,@width,@displayFormat,@alignment,@groupOrder,@aggregateType
          )
        `);
    }

    await new sql.Request(tx)
      .input("queryId", sql.BigInt, queryId)
      .query(`
        UPDATE uqp.QueryDefinition
        SET IsPublished=0,
            PublishedAtUtc=NULL,
            PublishedByUserId=NULL,
            UpdatedAtUtc=SYSUTCDATETIME()
        WHERE Id=@queryId AND IsPublished=1
      `);

    await tx.commit();
  } catch (error) {
    await tx.rollback();
    throw error;
  }
}
