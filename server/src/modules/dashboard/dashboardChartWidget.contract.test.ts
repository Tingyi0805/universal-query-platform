import test from "node:test";
import assert from "node:assert/strict";
import { ChartContractError, projectAuthorizedChart, type AuthorizedChartDelivery } from "./dashboardChartWidget.contract.js";

const config = {
  version: 1, chartType: "BAR", dataSourceKey: "PRIMARY",
  categoryColumn: "room", valueColumn: "total", valueMode: "QUERY_RESULT",
  maxPoints: 20, showLegend: false,
};
const delivery = (): AuthorizedChartDelivery => ({
  sourceKey: "PRIMARY", authorized: true, maskedBeforeDelivery: true,
  complete: true, truncated: false,
  columns: ["room", "total", "privatePatientIdentifier"],
  approvedCategoryColumns: ["room"], approvedNumericColumns: ["total"],
  rows: [
    { room: "OR-01", total: 5, privatePatientIdentifier: "NOT_FOR_CHART" },
    { room: "OR-02", total: "7", privatePatientIdentifier: "NOT_FOR_CHART" },
  ],
});
const reject = (expected: string, c: unknown = config, d: AuthorizedChartDelivery = delivery()) =>
  assert.throws(() => projectAuthorizedChart(c, d), (error: unknown) =>
    error instanceof ChartContractError && error.code === expected);

test("approved complete masked Query result projects only allowed fields", () => {
  assert.deepEqual(projectAuthorizedChart(config, delivery()), {
    chartType: "BAR", showLegend: false,
    points: [{ label: "OR-01", value: 5 }, { label: "OR-02", value: 7 }],
  });
});
test("config rejects unknown keys, client grouping and invalid values", () => {
  reject("CHART_CONFIG_INVALID", { ...config, datasetId: 88 });
  reject("CHART_CONFIG_INVALID", { ...config, valueMode: "COUNT_ROWS" });
  reject("CHART_CONFIG_INVALID", { ...config, chartType: "SCRIPT" });
  reject("CHART_CONFIG_INVALID", { ...config, dataSourceKey: "PRIMARY; SELECT *" });
  reject("CHART_CONFIG_INVALID", { ...config, categoryColumn: "total" });
  reject("CHART_CONFIG_INVALID", { ...config, maxPoints: 5000 });
  reject("CHART_CONFIG_INVALID", { ...config, showLegend: "true" });
});
test("unauthorized, unmasked, incomplete, truncated or wrong source rejected", () => {
  for (const delta of [
    { authorized: false }, { maskedBeforeDelivery: false }, { complete: false },
    { truncated: true }, { sourceKey: "OTHER" },
  ]) reject("CHART_DELIVERY_NOT_AUTHORIZED", config, { ...delivery(), ...delta });
});
test("columns must exist and be explicitly approved", () => {
  reject("CHART_COLUMNS_NOT_APPROVED", config, { ...delivery(), approvedCategoryColumns: [] });
  reject("CHART_COLUMNS_NOT_APPROVED", config, { ...delivery(), approvedNumericColumns: [] });
  reject("CHART_COLUMNS_NOT_APPROVED", config, { ...delivery(), columns: ["room", "privatePatientIdentifier"] });
  reject("CHART_COLUMNS_NOT_APPROVED", { ...config, valueColumn: "privatePatientIdentifier" });
});
test("point count cap rejects instead of silently truncating", () => {
  reject("CHART_POINT_LIMIT_EXCEEDED", { ...config, maxPoints: 1 });
  assert.deepEqual(projectAuthorizedChart(config, { ...delivery(), rows: [] }).points, []);
});
test("masked and malformed numeric data and duplicate groups are refused", () => {
  for (const value of ["●●", "1,200", "1e3", null, {}])
    reject("CHART_VALUE_NOT_NUMERIC", config, { ...delivery(), rows: [{ room: "OR-01", total: value }] });
  reject("CHART_VALUE_OUT_OF_RANGE", config, { ...delivery(), rows: [{ room: "OR-01", total: 1e15 }] });
  reject("CHART_VALUE_OUT_OF_RANGE", config, { ...delivery(), rows: [{ room: "OR-01", total: Number.POSITIVE_INFINITY }] });
  reject("CHART_ROW_INVALID", config, { ...delivery(), rows: [null as unknown as Record<string, unknown>] });
  reject("CHART_CATEGORY_INVALID", config, { ...delivery(), rows: [
    { room: "OR-01", total: 1 }, { room: "OR-01", total: 3 },
  ] });
});
test("pie requires nonnegative values; line supports signed values", () => {
  reject("CHART_PIE_REQUIRES_NONNEGATIVE", { ...config, chartType: "PIE" }, {
    ...delivery(), rows: [{ room: "OR-01", total: -1 }],
  });
  assert.equal(projectAuthorizedChart({ ...config, chartType: "LINE" }, {
    ...delivery(), rows: [{ room: "OR-01", total: -1 }],
  }).points[0]?.value, -1);
});
