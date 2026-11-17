// Issue #89: legacy whole-layout PUT must never overwrite a sealed CHART.
// A dedicated, audited CHART writer is required for persistence changes.
export function hasSealedChartWidgets(
  profiles: readonly { readonly widgets: readonly { readonly widgetType: string }[] }[],
): boolean {
  return profiles.some(profile => profile.widgets.some(widget => widget.widgetType === "CHART"));
}
