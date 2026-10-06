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

function compareGroupValue(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;

  const aNumber = Number(a);
  const bNumber = Number(b);
  if (Number.isFinite(aNumber) && Number.isFinite(bNumber)) return aNumber - bNumber;

  return String(a).localeCompare(String(b), "zh-Hant", { numeric: true });
}

function sortedRowsForGroups(
  rows: Record<string, unknown>[],
  groupColumns: ReportColumnRecord[],
): Record<string, unknown>[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      for (const column of groupColumns) {
        const compared = compareGroupValue(a.row[column.columnName], b.row[column.columnName]);
        if (compared !== 0) return compared;
      }
      return a.index - b.index;
    })
    .map((item) => item.row);
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

  const groupColumns = columns
    .filter((column) => column.groupOrder !== null)
    .sort((a, b) =>
      (a.groupOrder ?? Number.MAX_SAFE_INTEGER) - (b.groupOrder ?? Number.MAX_SAFE_INTEGER)
      || a.displayOrder - b.displayOrder
    );

  const addDataRow = (row: Record<string, unknown>, outlineLevel = 0) => {
    const output: Record<string, unknown> = {};
    for (const column of columns) output[column.columnName] = row[column.columnName];
    const excelRow = worksheet.addRow(output);
    excelRow.outlineLevel = Math.min(outlineLevel, 7);
    return excelRow;
  };

  const addSubtotalRow = (
    label: string,
    rows: Record<string, unknown>[],
    outlineLevel: number,
  ) => {
    const summary = worksheet.addRow({});
    summary.font = { bold: true };
    summary.outlineLevel = Math.min(outlineLevel, 7);

    columns.forEach((column, index) => {
      const cell = summary.getCell(index + 1);
      if (index === 0 && column.aggregateType === "NONE") cell.value = label;

      if (column.aggregateType !== "NONE") {
        cell.value = aggregateValue(
          column.aggregateType,
          rows.map((row) => row[column.columnName]),
        ) as any;
        if (column.displayFormat) cell.numFmt = column.displayFormat;
      }
    });
  };

  if (groupColumns.length === 0) {
    for (const row of result.rows) addDataRow(row);
  } else {
    const sortedRows = sortedRowsForGroups(result.rows, groupColumns);

    const appendGroupLevel = (
      level: number,
      levelRows: Record<string, unknown>[],
    ) => {
      if (level >= groupColumns.length) {
        for (const row of levelRows) addDataRow(row, groupColumns.length);
        return;
      }

      const column = groupColumns[level];
      const groups = new Map<string, { label: string; rows: Record<string, unknown>[] }>();

      for (const row of levelRows) {
        const raw = row[column.columnName];
        const label = raw == null || raw === "" ? "（空白）" : String(raw);
        const key = raw == null ? "__NULL__" : String(raw);
        const existing = groups.get(key);
        if (existing) existing.rows.push(row);
        else groups.set(key, { label, rows: [row] });
      }

      for (const group of groups.values()) {
        const heading = worksheet.addRow({});
        heading.font = { bold: true };
        heading.outlineLevel = Math.min(level, 7);
        heading.getCell(1).value = `${column.displayLabel}：${group.label}（${group.rows.length} 筆）`;
        if (columns.length > 1) worksheet.mergeCells(heading.number, 1, heading.number, columns.length);

        appendGroupLevel(level + 1, group.rows);
        addSubtotalRow(`${group.label} 小計`, group.rows, level);
      }
    };

    appendGroupLevel(0, sortedRows);
  }

  if (columns.length > 0 && result.rows.length > 0) {
    worksheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: columns.length },
    };
  }

  worksheet.getRow(1).font = { bold: true };
  worksheet.properties.outlineProperties = {
    summaryBelow: true,
    summaryRight: true,
  };

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
