export const reservedDashboardParameters = new Set(["deviceColumnMasks", "deviceColumnTypes", "snapshotKind", "snapshotSeconds", "deviceSourceColumnMasks"]);
export function objectJson(text: string): Record<string, unknown> {
  const value: unknown = JSON.parse(text || "{}");
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_OBJECT");
  return value as Record<string, unknown>;
}
export function queryParameterValues(value: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !reservedDashboardParameters.has(key)));
}
const modes = new Set(["NONE", "NAME", "MRN", "PHONE", "GENERIC", "FULL", "OMIT", "CUSTOM", "INHERIT"]);
export function maskAtLeastAsStrong(next: string, existing: unknown): boolean {
  if (existing === undefined) return modes.has(next);
  if (typeof existing !== "string" || !modes.has(existing) || !modes.has(next)) return false;
  if (next === "INHERIT" && (existing === "CUSTOM" || existing === "INHERIT")) return true;
  return existing === "NONE" || next === "OMIT" || (existing !== "OMIT" && next === "FULL") || next === existing;
}
export function sourcePreviewFailure(key: string, error: unknown): string {
  const value = error as { code?: unknown; status?: unknown } | null;
  const code = typeof value?.code === "string" && /^(?:QUERY_SOURCE_|DASHBOARD_|PARAMETER_|PATIENT_AUDIT_)[A-Z0-9_]{1,65}$/.test(value.code)
    || ["FORBIDDEN", "UNAUTHORIZED", "TOKEN_REVOKED", "INVALID_TOKEN", "VALIDATION_ERROR"].includes(String(value?.code)) ? String(value?.code) : "REQUEST_FAILED";
  const safeKey = /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key) ? key : "UNKNOWN";
  return `來源 ${safeKey}：${code}。此來源不顯示舊資料；遮蔽由後端執行。`;
}

export function datasetApprovalAllowed(mode: string, rule?: { sensitivityType: string; deviceMaskMode: string }): boolean {
  if (!rule) return mode === "OMIT";
  if (rule.deviceMaskMode === "OMIT") return mode === "OMIT";
  if (mode === "INHERIT") return !!rule;
  if (rule?.deviceMaskMode === "CUSTOM") return mode === "CUSTOM" || mode === "FULL" || mode === "OMIT";
  return (!rule || rule.sensitivityType === "OTHER" || mode !== "NONE") && maskAtLeastAsStrong(mode, rule?.deviceMaskMode);
}
export function inheritedMaskSample(rule?: { deviceMaskMode: string; customMask?: { prefix: number; suffix: number; symbol: string } | null }): string {
  if (rule?.deviceMaskMode === "OMIT" || !rule) return "欄位不傳送";
  if (rule.deviceMaskMode === "CUSTOM") {
    const value = "0000123456", config = rule.customMask;
    if (!config || !Number.isInteger(config.prefix) || !Number.isInteger(config.suffix) || config.prefix < 0 || config.suffix < 0 || config.prefix > 100 || config.suffix > 100 || Array.from(config.symbol).length !== 1 || /[\r\n\t]/.test(config.symbol)) return "○○○○";
    if (config.prefix + config.suffix >= value.length) return config.symbol.repeat(value.length);
    return value.slice(0, config.prefix) + config.symbol.repeat(value.length - config.prefix - config.suffix) + (config.suffix ? value.slice(-config.suffix) : "");
  }
  return rule.deviceMaskMode === "FULL" ? "○○○○" : rule.deviceMaskMode === "NONE" ? "合成非敏感文字" : "已沿用 Dataset 部分遮蔽";
}
