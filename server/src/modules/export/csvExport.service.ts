import type { QueryResult } from "../../query/query.types.js";
import type { ReportColumnRecord } from "../queryDefinition/reportColumn.repository.js";

function escapeCsvValue(value: unknown): string {
  if (value === null || value === undefined) return "";

  let text: string;
  if (value instanceof Date) {
    text = value.toISOString();
  } else {
    text = String(value);
  }

  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

export function createQueryCsv(
  result: QueryResult,
  reportColumns?: ReportColumnRecord[],
): Buffer {
  const resultNames = new Set(result.columns.map((column) => column.name));
  const configured = (reportColumns ?? [])
    .filter((column) => column.isVisible && resultNames.has(column.columnName))
    .sort((a, b) => a.displayOrder - b.displayOrder);

  const columns = configured.length > 0
    ? configured.map((column) => ({
        columnName: column.columnName,
        displayLabel: column.displayLabel,
      }))
    : result.columns.map((column) => ({
        columnName: column.name,
        displayLabel: column.name,
      }));

  const lines: string[] = [];
  lines.push(columns.map((column) => escapeCsvValue(column.displayLabel)).join(","));

  for (const row of result.rows) {
    lines.push(
      columns
        .map((column) => escapeCsvValue(row[column.columnName]))
        .join(","),
    );
  }

  const content = "\uFEFF" + lines.join("\r\n");
  return Buffer.from(content, "utf8");
}

export function buildCsvFilename(queryCode: string): string {
  const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const safeCode = queryCode.replace(/[^A-Z0-9_-]/gi, "_");
  return `${safeCode}_${timestamp}.csv`;
}
