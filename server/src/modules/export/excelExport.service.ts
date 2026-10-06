import ExcelJS from "exceljs";
import type { QueryResult } from "../../query/query.types.js";
import type { ReportColumnRecord } from "../queryDefinition/reportColumn.repository.js";

function safeSheetName(name: string): string {
  return name.replace(/[\\/*?:\[\]]/g, "_").slice(0, 31) || "Query";
}

function aggregateValue(
  type: ReportColumnRecord["aggregateType"],
  values: unknown[],
): unknown {
  const nonNull = values.filter((value) => value !== null && value !== undefined && value !== "");
  if (type === "COUNT") return nonNull.length;
  if (type === "NONE" || nonNull.length === 0) return null;

  const numbers = nonNull.map(Number).filter(Number.isFinite);
  if (numbers.length === 0) return null;

  if (type === "SUM") return numbers.reduce((sum, value) => sum + value, 0);
  if (type === "AVG") return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
  if (type === "MIN") return Math.min(...numbers);
  if (type === "MAX") return Math.max(...numbers);
  return null;
}

export async function createQueryExcel(
  title: string,
  result: QueryResult,
  reportColumns?: ReportColumnRecord[],
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Universal Query Platform";
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet(safeSheetName(title), {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  const resultNames = new Set(result.columns.map((column) => column.name));
  const configured = (reportColumns ?? [])
    .filter((column) => column.isVisible && resultNames.has(column.columnName))
    .sort((a, b) => a.displayOrder - b.displayOrder);

  const columns = configured.length > 0
    ? configured
    : result.columns.map((column, index) => ({
        columnName: column.name,
        dataType: column.dataType ?? null,
        displayLabel: column.name,
        displayOrder: index,
        isVisible: true,
        width: null,
        displayFormat: null,
        alignment: "LEFT" as const,
        groupOrder: null,
        aggregateType: "NONE" as const,
      }));

  worksheet.columns = columns.map((column) => ({
    header: column.displayLabel,
    key: column.columnName,
    width: column.width ? Math.max(8, Math.min(80, Math.round(column.width / 8))) : 14,
  }));

  for (const row of result.rows) {
    const output: Record<string, unknown> = {};
    for (const column of columns) output[column.columnName] = row[column.columnName];
    worksheet.addRow(output);
  }

  if (columns.length > 0 && result.rows.length > 0) {
    worksheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: columns.length },
    };
  }

  worksheet.getRow(1).font = { bold: true };

  columns.forEach((column, index) => {
    const excelColumn = worksheet.getColumn(index + 1);

    if (!column.width) {
      let width = excelColumn.width ?? 12;
      for (let rowIndex = 2; rowIndex <= Math.min(worksheet.rowCount, 202); rowIndex += 1) {
        const value = worksheet.getRow(rowIndex).getCell(index + 1).value;
        if (value == null) continue;
        width = Math.min(Math.max(width, String(value).length + 2), 50);
      }
      excelColumn.width = width;
    }

    for (let rowIndex = 2; rowIndex <= worksheet.rowCount; rowIndex += 1) {
      const cell = worksheet.getRow(rowIndex).getCell(index + 1);
      cell.alignment = {
        horizontal:
          column.alignment === "RIGHT" ? "right" :
          column.alignment === "CENTER" ? "center" : "left",
      };
      if (column.displayFormat) cell.numFmt = column.displayFormat;
    }
  });

  const aggregateColumns = columns.filter((column) => column.aggregateType !== "NONE");
  if (aggregateColumns.length > 0) {
    const summary = worksheet.addRow({});
    summary.font = { bold: true };

    columns.forEach((column, index) => {
      const cell = summary.getCell(index + 1);
      if (index === 0) cell.value = "彙總";

      if (column.aggregateType !== "NONE") {
        cell.value = aggregateValue(
          column.aggregateType,
          result.rows.map((row) => row[column.columnName]),
        ) as any;
        if (column.displayFormat) cell.numFmt = column.displayFormat;
      }
    });
  }

  const output = await workbook.xlsx.writeBuffer();
  return Buffer.from(output as any);
}

export function buildExcelFilename(queryCode: string): string {
  const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const safeCode = queryCode.replace(/[^A-Z0-9_-]/gi, "_");
  return `${safeCode}_${timestamp}.xlsx`;
}
