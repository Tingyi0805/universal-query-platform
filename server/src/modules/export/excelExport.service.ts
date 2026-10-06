import ExcelJS from "exceljs";
import type { QueryResult } from "../../query/query.types.js";

function safeSheetName(name: string): string {
  return name.replace(/[\\/*?:\[\]]/g, "_").slice(0, 31) || "Query";
}

export async function createQueryExcel(
  title: string,
  result: QueryResult,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Universal Query Platform";
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet(safeSheetName(title), {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  worksheet.columns = result.columns.map((column) => ({
    header: column.name,
    key: column.name,
    width: Math.min(Math.max(column.name.length + 2, 12), 40),
  }));

  for (const row of result.rows) {
    worksheet.addRow(row);
  }

  if (result.columns.length > 0 && result.rows.length > 0) {
    worksheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: result.columns.length },
    };
  }

  worksheet.getRow(1).font = { bold: true };

  for (let index = 1; index <= result.columns.length; index += 1) {
    const column = worksheet.getColumn(index);
    let width = column.width ?? 12;

    for (let rowIndex = 2; rowIndex <= Math.min(worksheet.rowCount, 202); rowIndex += 1) {
      const value = worksheet.getRow(rowIndex).getCell(index).value;
      if (value == null) continue;
      const length = String(value).length + 2;
      width = Math.min(Math.max(width, length), 50);
    }

    column.width = width;
  }

  const output = await workbook.xlsx.writeBuffer();
  return Buffer.from(output as any);
}

export function buildExcelFilename(queryCode: string): string {
  const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const safeCode = queryCode.replace(/[^A-Z0-9_-]/gi, "_");
  return `${safeCode}_${timestamp}.xlsx`;
}
