import { securityGuidance } from "../security/securityContracts";
export type QuerySourceSettings = {
  id?: number; sourceKey: string; queryDefinitionId: number | null; parameters?: Record<string, unknown>;
  refreshSeconds: number; pageSize: number; pageSeconds: number; maxRows: number | null;
  isEnabled?: boolean; bindingState?: string; errorCode?: string | null; requiresConversion?: boolean;
};
export type DashboardPresentation = { name: string; description: string | null; displayMode: "TABLE" | "BIG_SCREEN"; displayTitle: string | null; showClock: boolean; showPageNumber: boolean; showCountdown: boolean };
export type QuerySourceConfiguration = { presentation?: DashboardPresentation; version: string; dashboardMode?: string; isActive?: boolean; editable: boolean; overCapacity: boolean;
  primary: QuerySourceSettings; sources: QuerySourceSettings[] };
export function trustedConfiguration(value: QuerySourceConfiguration): QuerySourceConfiguration {
  if (!value || !/^[a-f0-9]{64}$/.test(value.version) || typeof value.editable !== "boolean"
    || value.primary?.sourceKey !== "PRIMARY" || !Array.isArray(value.sources)
    || value.sources.some(source => !source || typeof source.sourceKey !== "string" || !Number.isSafeInteger(source.id) || Number(source.id) < 1)) throw new Error("CONFIGURATION_INVALID");
  return value;
}
export function managementError(error: unknown) {
  const code = (error as { code?: unknown })?.code;
  const safe = securityGuidance(error);
  return `${safe.code !== "REQUEST_FAILED" ? safe.message : ""} 設定未完成：${typeof code === "string" && /^[A-Z][A-Z0-9_]{0,80}$/.test(code) ? code : "REQUEST_FAILED"}。原編輯內容保留；版本衝突時請先另行保存草稿，再重新載入。`;
}
export function sourceSettings(source: QuerySourceSettings, parametersJson: string) {
  const parameters: unknown = JSON.parse(parametersJson);
  if (!parameters || typeof parameters !== "object" || Array.isArray(parameters)) throw new Error("PARAMETERS_INVALID");
  if (!Number.isSafeInteger(source.queryDefinitionId) || Number(source.queryDefinitionId) <= 0) throw new Error("QUERY_REQUIRED");
  for (const [value, min, max] of [[source.refreshSeconds,5,3600],[source.pageSize,1,100],[source.pageSeconds,5,3600],[source.maxRows,1,10000]])
    if (!Number.isInteger(value) || Number(value) < min! || Number(value) > max!) throw new Error("SETTINGS_INVALID");
  return { queryDefinitionId: source.queryDefinitionId as number, parameters: parameters as Record<string, unknown>,
    refreshSeconds: source.refreshSeconds, pageSize: source.pageSize, pageSeconds: source.pageSeconds, maxRows: source.maxRows as number };
}

export function previewAuthorizationFailed(error:unknown):boolean {
  const value=error as {status?:unknown;code?:unknown};
  return value?.status===401 || (value?.status===403 && (value?.code==="FORBIDDEN" || value?.code==="QUERY_SOURCE_PERMISSION_REVOKED"));
}
