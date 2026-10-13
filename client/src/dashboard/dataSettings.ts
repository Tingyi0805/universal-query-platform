export const reservedDashboardParameters = new Set(["deviceColumnMasks", "deviceColumnTypes", "snapshotKind", "snapshotSeconds"]);
export function objectJson(text: string): Record<string, unknown> {
  const value: unknown = JSON.parse(text || "{}");
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_OBJECT");
  return value as Record<string, unknown>;
}
export function queryParameterValues(value: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !reservedDashboardParameters.has(key)));
}
const modes = new Set(["NONE", "NAME", "MRN", "PHONE", "GENERIC", "FULL", "OMIT", "CUSTOM"]);
export function maskAtLeastAsStrong(next: string, existing: unknown): boolean {
  if (existing === undefined) return modes.has(next);
  if (typeof existing !== "string" || !modes.has(existing) || !modes.has(next)) return false;
  return existing === "NONE" || next === "OMIT" || (existing !== "OMIT" && next === "FULL") || next === existing;
}
export function sourcePreviewFailure(key: string, error: unknown): string {
  const value = error as { code?: unknown; status?: unknown } | null;
  const code = typeof value?.code === "string" && /^(?:QUERY_SOURCE_|DASHBOARD_|PARAMETER_|PATIENT_AUDIT_)[A-Z0-9_]{1,65}$/.test(value.code)
    || ["FORBIDDEN", "UNAUTHORIZED", "TOKEN_REVOKED", "INVALID_TOKEN", "VALIDATION_ERROR"].includes(String(value?.code)) ? String(value?.code) : "REQUEST_FAILED";
  const safeKey = /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key) ? key : "UNKNOWN";
  return `來源 ${safeKey}：${code}。此來源不顯示舊資料；遮蔽由後端執行。`;
}
