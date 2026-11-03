// Dashboard chart V1 contract only. Keep CHART out of layoutSchema,
// SQL WidgetType constraint, editor and playback until approval.
import { z } from "zod";

const sourceKeySchema = z.string().regex(/^(?:PRIMARY|[A-Za-z][A-Za-z0-9_]{0,63})$/);
const columnName = z.string().min(1).max(128);

export const chartWidgetConfigSchema = z.object({
  version: z.literal(1),
  chartType: z.enum(["BAR", "LINE", "PIE"]),
  dataSourceKey: sourceKeySchema,
  categoryColumn: columnName,
  valueColumn: columnName,
  // Query must already return approved aggregate values; no browser COUNT/SUM.
  valueMode: z.literal("QUERY_RESULT"),
  maxPoints: z.number().int().min(1).max(50),
  showLegend: z.boolean(),
}).strict().refine(value => value.categoryColumn !== value.valueColumn, {
  message: "CHART_COLUMNS_MUST_DIFFER",
});

export type ChartWidgetConfig = z.infer<typeof chartWidgetConfigSchema>;
export type AuthorizedChartDelivery = {
  // These assertions MUST come from a trusted server-side delivery coordinator,
  // NEVER from client input or unvalidated Widget ConfigJson.
  sourceKey: string;
  authorized: boolean;
  maskedBeforeDelivery: boolean;
  complete: boolean;
  truncated: boolean;
  columns: readonly string[];
  approvedCategoryColumns: readonly string[];
  approvedNumericColumns: readonly string[];
  rows: readonly Readonly<Record<string, unknown>>[];
};
export type ChartPoint = { label: string; value: number };
export class ChartContractError extends Error {
  constructor(public readonly code: string) { super(code); }
}

const numericLiteral = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
function numberFromDeliveredValue(value: unknown): number {
  if (typeof value !== "number" && !(typeof value === "string" && numericLiteral.test(value)))
    throw new ChartContractError("CHART_VALUE_NOT_NUMERIC");
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || Math.abs(parsed) > 1_000_000_000_000 ||
      (Number.isInteger(parsed) && !Number.isSafeInteger(parsed)))
    throw new ChartContractError("CHART_VALUE_OUT_OF_RANGE");
  return parsed;
}

export function projectAuthorizedChart(
  rawConfig: unknown,
  delivery: AuthorizedChartDelivery,
): { chartType: ChartWidgetConfig["chartType"]; points: ChartPoint[]; showLegend: boolean } {
  const parsed = chartWidgetConfigSchema.safeParse(rawConfig);
  if (!parsed.success) throw new ChartContractError("CHART_CONFIG_INVALID");
  const config = parsed.data;
  if (!delivery.authorized || !delivery.maskedBeforeDelivery ||
      !delivery.complete || delivery.truncated || delivery.sourceKey !== config.dataSourceKey)
    throw new ChartContractError("CHART_DELIVERY_NOT_AUTHORIZED");
  if (!delivery.columns.includes(config.categoryColumn) ||
      !delivery.columns.includes(config.valueColumn) ||
      !delivery.approvedCategoryColumns.includes(config.categoryColumn) ||
      !delivery.approvedNumericColumns.includes(config.valueColumn))
    throw new ChartContractError("CHART_COLUMNS_NOT_APPROVED");
  if (delivery.rows.length > config.maxPoints)
    throw new ChartContractError("CHART_POINT_LIMIT_EXCEEDED");

  const seen = new Set<string>();
  const points = delivery.rows.map(row => {
    if (!row || typeof row !== "object" || Array.isArray(row))
      throw new ChartContractError("CHART_ROW_INVALID");
    const rawLabel = row[config.categoryColumn];
    if (!(typeof rawLabel === "string" || typeof rawLabel === "number") ||
        (typeof rawLabel === "number" && !Number.isFinite(rawLabel)))
      throw new ChartContractError("CHART_CATEGORY_INVALID");
    const label = String(rawLabel);
    if (!label || label.length > 100 || seen.has(label))
      throw new ChartContractError("CHART_CATEGORY_INVALID");
    seen.add(label);
    const value = numberFromDeliveredValue(row[config.valueColumn]);
    if (config.chartType === "PIE" && value < 0)
      throw new ChartContractError("CHART_PIE_REQUIRES_NONNEGATIVE");
    return { label, value };
  });
  // Do not project extra fields, row metadata or patient identifiers.
  return { chartType: config.chartType, points, showLegend: config.showLegend };
}
