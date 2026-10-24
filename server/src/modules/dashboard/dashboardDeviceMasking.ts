export type DeviceMaskMode = "NONE" | "NAME" | "MRN" | "PHONE" | "GENERIC" | "FULL" | "OMIT" | "CUSTOM";
export type DashboardMaskMode = DeviceMaskMode | "INHERIT";
export const dashboardMaskModes = ["NONE", "NAME", "MRN", "PHONE", "GENERIC", "FULL", "OMIT", "CUSTOM", "INHERIT"] as const;
const dashboardModes = new Set<string>(dashboardMaskModes);
const allowedModes = new Set<DeviceMaskMode>(["NONE", "NAME", "MRN", "PHONE", "GENERIC", "FULL", "OMIT", "CUSTOM"]);
export type CustomMaskConfig = { prefix: number; suffix: number; symbol: string; start?: number; end?: number };
export function validCustomMask(config: unknown): config is CustomMaskConfig {
  if (!config || typeof config !== "object" || Array.isArray(config)) return false;
  const c = config as CustomMaskConfig;
  if (Object.keys(c).some(key => !["prefix", "suffix", "symbol", "start", "end"].includes(key))) return false;
  return Number.isInteger(c.prefix) && Number.isInteger(c.suffix)
    && c.prefix >= 0 && c.suffix >= 0 && c.prefix <= 100 && c.suffix <= 100
    && typeof c.symbol === "string" && Array.from(c.symbol).length === 1 && !/[\r\n\t]/u.test(c.symbol)
    && (c.start === undefined && c.end === undefined || c.prefix === 0 && c.suffix === 0
      && Number.isInteger(c.start) && Number.isInteger(c.end) && c.start! >= 1 && c.end! >= c.start! && c.end! <= 10000);
}
/** Invalid/overlapping custom settings fail closed rather than returning original text. */
export function maskCustomValue(value: unknown, config: CustomMaskConfig | null | undefined): string {
  if (!validCustomMask(config)) return "○○○○";
  const chars = Array.from(typeof value === "object" ? JSON.stringify(value) : String(value));
  if (chars.length === 0) return "";
  if (config.start !== undefined) {
    // Positions count Unicode code points, inclusive and one based. Out of
    // bounds starts mask everything, never silently return an unchanged value.
    if (config.start > chars.length) return config.symbol.repeat(chars.length);
    return chars.map((char, index) => index + 1 >= config.start! && index + 1 <= config.end! ? config.symbol : char).join("");
  }
  if (config.prefix + config.suffix >= chars.length) return config.symbol.repeat(chars.length);
  return chars.slice(0, config.prefix).join("")
    + config.symbol.repeat(chars.length - config.prefix - config.suffix)
    + (config.suffix ? chars.slice(-config.suffix).join("") : "");
}
export function maskDeviceValue(value: unknown, mode: DeviceMaskMode, custom?: CustomMaskConfig | null): unknown {
  if (mode === "OMIT") return undefined;
  if (mode === "NONE" || value == null) return value;
  if (mode === "FULL") return "○○○○";
  if (mode === "CUSTOM") return maskCustomValue(value, custom);
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
export function resolveDeviceColumnMask(column: string, masks: Record<string, DashboardMaskMode>): DeviceMaskMode {
  const matches = Object.entries(masks).filter(([name]) => name.toUpperCase() === column.toUpperCase());
  if (matches.length !== 1) return "OMIT";
  return matches[0]![1] === "INHERIT" ? "OMIT" : matches[0]![1];
}

export function maskDeviceRows(rows: Record<string, unknown>[], masks: Record<string, DashboardMaskMode>,
  datasetRules: Array<{ columnName: string; customMask?: CustomMaskConfig | null }> = []): Record<string, unknown>[] {
  return rows.map((row) => Object.fromEntries(Object.entries(row).flatMap(([key, value]) => {
    const mode = resolveDeviceColumnMask(key, masks);
    const matches = datasetRules.filter((rule) => rule.columnName.toUpperCase() === key.toUpperCase());
    const custom = matches.length === 1 ? matches[0]!.customMask : null;
    return mode === "OMIT" ? [] : [[key, maskDeviceValue(value, mode, custom)]];
  })));
}

/** Explicit dashboard-level column policies. Unlisted fields are never sent to device clients. */
export function resolveConfiguredDeviceMasks(value: unknown): Record<string, DashboardMaskMode> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, DashboardMaskMode> = {};
  for (const [column, mode] of Object.entries(value)) {
    if (column.length > 0 && column.length <= 256 && dashboardModes.has(String(mode))) {
      result[column] = mode as DashboardMaskMode;
    }
  }
  return result;
}

/** A layout is only presentation; explicit administrator rules are the disclosure allowlist. */
export function resolveEffectiveDeviceMasks(
  configured: unknown,
  _profiles: Array<{ isDefault: boolean; widgets: Array<{ widgetType: string; sourceKey: string | null; config: Record<string, unknown> }> }>,
): Record<string, DashboardMaskMode> {
  return resolveConfiguredDeviceMasks(configured);
}

/** Classified fields may never be disclosed raw, even if an older saved dashboard bypassed write validation. */
export function enforceClassifiedDeviceMasks<T extends DashboardMaskMode>(masks: Record<string, T>, classifications: unknown): Record<string, T | "OMIT"> {
  if (!classifications || typeof classifications !== "object" || Array.isArray(classifications)) return masks;
  const safe: Record<string, T | "OMIT"> = { ...masks };
  for (const [column, category] of Object.entries(classifications)) {
    if (category !== "OTHER" && typeof category === "string" && category.length > 0) {
      for (const key of Object.keys(safe)) {
        if (key.toUpperCase() === column.toUpperCase() && safe[key] === "NONE") safe[key] = "OMIT";
      }
    }
  }
  return safe;
}

/** Dataset policy is authoritative; a dashboard cannot weaken it. */
export function enforceDatasetDeviceMasks(
  dashboardMasks: Record<string, DashboardMaskMode>,
  datasetRules: Array<{ columnName: string; sensitivityType: string; deviceMaskMode: DeviceMaskMode }>,
): Record<string, DeviceMaskMode> {
  return Object.fromEntries(Object.entries(dashboardMasks).map(([column, approval]) => {
    const matches = datasetRules.filter(rule => rule.columnName.toUpperCase() === column.toUpperCase());
    const rule = matches.length === 1 ? matches[0] : undefined;
    let mode: DeviceMaskMode = "OMIT";
    if (matches.length > 1 || approval === "OMIT" || rule?.deviceMaskMode === "OMIT") return [column, mode];
    if (approval === "INHERIT") mode = rule?.deviceMaskMode ?? "OMIT";
    // Historical CUSTOM means the Dataset's CUSTOM, never an independent configuration.
    else if (approval === "CUSTOM") mode = rule?.deviceMaskMode === "CUSTOM" ? "CUSTOM" : "OMIT";
    else if (!rule || rule.deviceMaskMode === "NONE") mode = approval;
    else mode = approval === "FULL" || rule.deviceMaskMode === "FULL" ? "FULL"
      : approval === "NONE" || approval === rule.deviceMaskMode ? rule.deviceMaskMode : "FULL";
    if (rule && rule.sensitivityType !== "OTHER" && rule.deviceMaskMode === "NONE") mode = "OMIT";
    return [column, mode];
  }));
}

/** Explicit source-scoped approvals. Dataset rules never implicitly grant a column. */
export function resolveDashboardDisclosureMasks(parameters: Record<string, unknown>, sourceKey: string,
  rules: Array<{ columnName: string; sensitivityType: string; deviceMaskMode: DeviceMaskMode }>): Record<string, DeviceMaskMode> {
  const scoped = parameters.deviceSourceColumnMasks;
  const value = sourceKey === "PRIMARY" ? parameters.deviceColumnMasks
    : scoped && typeof scoped === "object" && !Array.isArray(scoped) && Object.hasOwn(scoped, sourceKey)
      ? (scoped as Record<string, unknown>)[sourceKey] : undefined;
  const types = sourceKey === "PRIMARY" ? parameters.deviceColumnTypes : undefined;
  const effective = enforceDatasetDeviceMasks(enforceClassifiedDeviceMasks(resolveConfiguredDeviceMasks(value), types), rules);
  // No current Dataset rule means a field has no reliable first-layer approval.
  // Keep historical JSON intact, but never reuse that grant after a rule was removed/renamed.
  for (const column of Object.keys(effective)) {
    if (rules.filter(rule => rule.columnName.toUpperCase() === column.toUpperCase()).length !== 1) effective[column] = "OMIT";
  }
  // Preserve the existing per-source disclosure allowlist. Legacy independent
  // masks may never yield a different value or silently become weaker: retain
  // only grants compatible with the current Dataset rule, otherwise omit.
  for (const column of Object.keys(effective)) {
    const rule = rules.find(rule => rule.columnName.toUpperCase() === column.toUpperCase());
    if (rule && effective[column] !== rule.deviceMaskMode) effective[column] = "OMIT";
  }
  return enforceClassifiedDeviceMasks(effective, types);
}

export function validDashboardColumnMasks(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  return entries.length <= 300 && new Set(entries.map(([key]) => key.toUpperCase())).size === entries.length
    && entries.every(([key, mode]) => key.trim().length > 0 && key.length <= 256 && typeof mode === "string" && dashboardModes.has(mode));
}
/** New grants inherit Dataset behavior. Legacy entries can be retained or
 * removed, but cannot be changed into another independent masking policy. */
export function validInheritedDashboardApprovalUpdate(previous: unknown, next: unknown): boolean {
  if (!validDashboardColumnMasks(next)) return false;
  const old = previous && typeof previous === "object" && !Array.isArray(previous) ? Object.entries(previous) : [];
  return Object.entries(next as Record<string, unknown>).every(([key, mode]) => {
    const matches = old.filter(([name]) => name.toUpperCase() === key.toUpperCase());
    return mode === "INHERIT" || mode === "OMIT" || matches.length === 1 && matches[0]![0] === key && matches[0]![1] === mode;
  });
}
export function validSourceColumnMasks(value: unknown): boolean {
  if (value === undefined) return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  return entries.length <= 7 && new Set(entries.map(([key]) => key.toUpperCase())).size === entries.length
    && entries.every(([key, masks]) => /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key) && key.toUpperCase() !== "PRIMARY" && validDashboardColumnMasks(masks));
}
export const dashboardReservedParameters = ["snapshotKind", "snapshotSeconds", "deviceColumnMasks", "deviceColumnTypes", "deviceSourceColumnMasks"];
export function dashboardQueryParameters(parameters: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(parameters).filter(([key]) => !dashboardReservedParameters.includes(key)));
}

/** Supplemental approvals require a unique Dataset rule; ambiguous or raw rules never grant fields. */
export function resolveSupplementalDeviceRules<T extends { columnName: string; deviceMaskMode: DeviceMaskMode }>(rules: T[]): Map<string, T> {
  const counts = new Map<string, number>();
  for (const rule of rules) {
    const key = rule.columnName.toUpperCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return new Map(rules.filter(rule => counts.get(rule.columnName.toUpperCase()) === 1
    && allowedModes.has(rule.deviceMaskMode) && rule.deviceMaskMode !== "NONE" && rule.deviceMaskMode !== "OMIT")
    .map(rule => [rule.columnName.toUpperCase(), rule]));
}

/** A failed/malformed/conflicting policy must never be treated as an empty policy. */
export function assertDatasetSensitivityPolicy(policy: { version: number; columns: Array<{ columnName: string; sensitivityType: string; deviceMaskMode: DeviceMaskMode; customMask?: CustomMaskConfig | null }> }): void {
  if (!policy || !Number.isSafeInteger(policy.version) || policy.version < 0 || !Array.isArray(policy.columns)) throw new Error("DASHBOARD_SENSITIVITY_POLICY_INVALID");
  if (policy.version === 0 && policy.columns.length === 0) throw new Error("DASHBOARD_SENSITIVITY_POLICY_REQUIRED");
  const names = new Set<string>();
  for (const rule of policy.columns) {
    if (!rule || typeof rule.columnName !== "string" || !rule.columnName || !allowedModes.has(rule.deviceMaskMode)
      || typeof rule.sensitivityType !== "string" || !/^[A-Z0-9_]{1,64}$/.test(rule.sensitivityType)
      || names.has(rule.columnName.toUpperCase()) || (rule.sensitivityType !== "OTHER" && rule.deviceMaskMode === "NONE")) throw new Error("DASHBOARD_SENSITIVITY_POLICY_INVALID");
    names.add(rule.columnName.toUpperCase());
    if (rule.deviceMaskMode !== "CUSTOM" && rule.customMask != null) throw new Error("DASHBOARD_SENSITIVITY_POLICY_INVALID");
    if (rule.deviceMaskMode === "CUSTOM") {
      if (!validCustomMask(rule.customMask)) throw new Error("DASHBOARD_SENSITIVITY_POLICY_INVALID");
    }
  }
}

/** Case-insensitive policy matching cannot safely authorize ambiguous result aliases. */
export function assertDashboardResultColumns(columns: Array<{ name: string }>, rows: Record<string,unknown>[] = []) {
  if(!Array.isArray(columns)||columns.some(c=>!c||typeof c.name!=="string"||!c.name.trim()||c.name!==c.name.trim()||c.name.length>256||/[\x00-\x1f\x7f]/u.test(c.name)))throw new Error("DASHBOARD_COLUMNS_AMBIGUOUS");
  const names = columns.map(column => column.name.toUpperCase());
  if (new Set(names).size !== names.length || rows.some(row=>{const keys=Object.keys(row).map(k=>k.toUpperCase());return new Set(keys).size!==keys.length||keys.some(k=>!names.includes(k));})) throw new Error("DASHBOARD_COLUMNS_AMBIGUOUS");
}
