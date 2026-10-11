export type DeviceMaskMode = "NONE" | "NAME" | "MRN" | "PHONE" | "GENERIC" | "FULL" | "OMIT";
const allowedModes = new Set<DeviceMaskMode>(["NONE", "NAME", "MRN", "PHONE", "GENERIC", "FULL", "OMIT"]);
export function maskDeviceValue(value: unknown, mode: DeviceMaskMode): unknown {
  if (mode === "NONE" || value == null) return value;
  if (mode === "OMIT") return undefined;
  if (mode === "FULL") return "○○○○";
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

/** A case-insensitive ambiguous approval is denied rather than choosing an arbitrary mask. */
export function resolveDeviceColumnMask(column: string, masks: Record<string, DeviceMaskMode>): DeviceMaskMode {
  const matches = Object.entries(masks).filter(([name]) => name.toUpperCase() === column.toUpperCase());
  if (matches.length !== 1) return "OMIT";
  return matches[0]![1];
}

export function maskDeviceRows(rows: Record<string, unknown>[], masks: Record<string, DeviceMaskMode>): Record<string, unknown>[] {
  return rows.map((row) => Object.fromEntries(Object.entries(row).flatMap(([key, value]) => {
    const mode = resolveDeviceColumnMask(key, masks);
    return mode === "OMIT" ? [] : [[key, maskDeviceValue(value, mode)]];
  })));
}

/** Explicit dashboard-level column policies. Unlisted fields are never sent to device clients. */
export function resolveConfiguredDeviceMasks(value: unknown): Record<string, DeviceMaskMode> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, DeviceMaskMode> = {};
  for (const [column, mode] of Object.entries(value)) {
    if (column.length > 0 && column.length <= 256 && allowedModes.has(mode as DeviceMaskMode)) {
      result[column] = mode as DeviceMaskMode;
    }
  }
  return result;
}

/** A layout is only presentation; explicit administrator rules are the disclosure allowlist. */
export function resolveEffectiveDeviceMasks(
  configured: unknown,
  _profiles: Array<{ isDefault: boolean; widgets: Array<{ widgetType: string; sourceKey: string | null; config: Record<string, unknown> }> }>,
): Record<string, DeviceMaskMode> {
  return resolveConfiguredDeviceMasks(configured);
}

/** Classified fields may never be disclosed raw, even if an older saved dashboard bypassed write validation. */
export function enforceClassifiedDeviceMasks(masks: Record<string, DeviceMaskMode>, classifications: unknown): Record<string, DeviceMaskMode> {
  if (!classifications || typeof classifications !== "object" || Array.isArray(classifications)) return masks;
  const safe = { ...masks };
  for (const [column, category] of Object.entries(classifications)) {
    if (category !== "OTHER" && typeof category === "string" && category.length > 0) {
      if (safe[column] === "NONE") safe[column] = "OMIT";
    }
  }
  return safe;
}

/** Dataset policy is authoritative; a dashboard cannot weaken it. */
export function enforceDatasetDeviceMasks(
  dashboardMasks: Record<string, DeviceMaskMode>,
  datasetRules: Array<{ columnName: string; sensitivityType: string; deviceMaskMode: DeviceMaskMode }>,
): Record<string, DeviceMaskMode> {
  const result = { ...dashboardMasks };
  for (const rule of datasetRules) {
    // SQL Server column names are commonly case-insensitive; use the approved
    // Dashboard spelling so a differently-cased Dataset rule cannot be bypassed.
    const approvedColumn = Object.keys(result).find((key) => key.toUpperCase() === rule.columnName.toUpperCase());
    if (approvedColumn === undefined) continue;
    const column = approvedColumn;
    if (rule.deviceMaskMode === "OMIT" || (rule.sensitivityType !== "OTHER" && rule.deviceMaskMode === "NONE")) {
      result[column] = "OMIT";
    } else if (rule.sensitivityType !== "OTHER") {
      // Dataset policy restricts existing dashboard approvals; it does not grant new fields.
      if (result[column] !== undefined && result[column] !== "OMIT") {
        // FULL is stronger than any partial mask; different partial masks are not safely comparable.
        const current = result[column];
        result[column] = current === "FULL" || rule.deviceMaskMode === "FULL"
          ? "FULL"
          : current === "NONE" || current === rule.deviceMaskMode
            ? rule.deviceMaskMode
            : "FULL";
      }
    }
  }
  return result;
}
