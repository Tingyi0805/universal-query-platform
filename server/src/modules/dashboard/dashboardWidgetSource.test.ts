import { describe, expect, it } from "vitest";
import { resolveWidgetDataSourceKey, validateWidgetDataSources } from "./dashboardWidgetSource.js";

describe("Dashboard widget Dataset source binding", () => {
  it("preserves existing single-query layouts", () => {
    expect(resolveWidgetDataSourceKey({})).toBe("PRIMARY");
    expect(resolveWidgetDataSourceKey({ dataSourceKey: "PRIMARY" })).toBe("PRIMARY");
    expect(validateWidgetDataSources([{ widgets: [
      { widgetType: "FIELD", config: {} },
      { widgetType: "TABLE", config: { dataSourceKey: "PRIMARY" } },
    ] }], [])).toEqual({ valid: true });
  });
  it("accepts configured supplemental sources only", () => {
    const profiles = [{ widgets: [{ widgetType: "FIELD", config: { dataSourceKey: "CLINIC" } }] }];
    expect(validateWidgetDataSources(profiles, ["CLINIC"])).toEqual({ valid: true });
    expect(validateWidgetDataSources(profiles, ["WAITING"])).toEqual({ valid: false, sourceKey: "CLINIC" });
  });
  it("rejects malformed source keys", () => {
    for (const value of ["../secret", "a.b", " ", 5, {}, "x".repeat(65)]) {
      expect(resolveWidgetDataSourceKey({ dataSourceKey: value })).toBe("INVALID");
    }
    expect(validateWidgetDataSources([{ widgets: [{ widgetType: "TABLE", config: { dataSourceKey: "../secret" } }] }], ["CLINIC"]))
      .toEqual({ valid: false, sourceKey: "INVALID" });
  });
});
