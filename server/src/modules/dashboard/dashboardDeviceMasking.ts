export type DeviceMaskMode = "NONE" | "NAME" | "MRN" | "PHONE" | "GENERIC";
const allowedModes = new Set<DeviceMaskMode>(["NONE", "NAME", "MRN", "PHONE", "GENERIC"]);
export function maskDeviceValue(value: unknown, mode: DeviceMaskMode): unknown {
  if (mode === "NONE" || value == null) return value;
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  if (!text) return text;
  if (mode === "NAME") {
    const chars = Array.from(text);
    if (chars.length <= 1) return "○";
    if (chars.length === 2) return chars[0] + "○";
    return chars[0] + "○".repeat(chars.length - 2) + chars[chars.length - 1];
  }
  if (mode === "MRN") {
    if (text.length <= 4) return "○".repeat(text.length);
    const head = text.slice(0, Math.min(4, text.length - 2));
    return head + "○".repeat(Math.max(1, text.length - head.length - 2)) + text.slice(-2);
  }
  if (mode === "PHONE") {
    if (text.length <= 5) return "○".repeat(text.length);
    return text.slice(0, 4) + "○".repeat(Math.max(1, text.length - 7)) + text.slice(-3);
  }
  return text.length <= 2 ? "○".repeat(text.length) : text[0] + "○".repeat(text.length - 2) + text.slice(-1);
}

export function resolveDeviceColumnMasks(profiles: Array<{ isDefault: boolean; widgets: Array<{ widgetType: string; sourceKey: string | null; config: Record<string, unknown> }> }>): Record<string, DeviceMaskMode> {
  const profile = profiles.find((item) => item.isDefault) ?? profiles[0];
  const masks: Record<string, DeviceMaskMode> = {};
  for (const widget of profile?.widgets ?? []) {
    if (widget.widgetType === "FIELD" && widget.sourceKey) {
      const mode = widget.config.maskMode;
      if (allowedModes.has(mode as DeviceMaskMode)) masks[widget.sourceKey] = mode as DeviceMaskMode;
    }
    if (widget.widgetType === "TABLE") {
      const columnMasks = widget.config.columnMasks;
      if (columnMasks && typeof columnMasks === "object" && !Array.isArray(columnMasks)) {
        for (const [column, mode] of Object.entries(columnMasks)) {
          if (allowedModes.has(mode as DeviceMaskMode)) masks[column] = mode as DeviceMaskMode;
        }
      }
    }
  }
  return masks;
}

export function maskDeviceRows(rows: Record<string, unknown>[], masks: Record<string, DeviceMaskMode>): Record<string, unknown>[] {
  return rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, maskDeviceValue(value, masks[key] ?? "NONE")])));
}
