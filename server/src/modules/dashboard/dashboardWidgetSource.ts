/**
 * Widget source selection is stored in widget.config.dataSourceKey.
 * Empty / PRIMARY means the existing Dashboard query; supplemental keys
 * refer only to saved DashboardDataSource records, never arbitrary SQL.
 */
export function resolveWidgetDataSourceKey(config: Record<string, unknown>): string {
  const key = config.dataSourceKey;
  if (key == null || key === "" || key === "PRIMARY") return "PRIMARY";
  if (typeof key !== "string" || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key)) return "INVALID";
  return key;
}

export function validateWidgetDataSources(
  profiles: Array<{ widgets: Array<{ widgetType: string; config: Record<string, unknown> }> }>,
  sourceKeys: readonly string[],
): { valid: true } | { valid: false; sourceKey: string } {
  const allowed = new Set(sourceKeys);
  for (const profile of profiles) {
    for (const widget of profile.widgets) {
      if (widget.widgetType !== "FIELD" && widget.widgetType !== "TABLE") continue;
      const sourceKey = resolveWidgetDataSourceKey(widget.config);
      if (sourceKey === "INVALID" || (sourceKey !== "PRIMARY" && !allowed.has(sourceKey))) return { valid: false, sourceKey };
    }
  }
  return { valid: true };
}
