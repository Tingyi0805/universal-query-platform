export type QuerySourceSettings = {
  id?: number; sourceKey: string; queryDefinitionId: number | null; parameters?: Record<string, unknown>;
  refreshSeconds: number; pageSize: number; pageSeconds: number; maxRows: number | null;
  isEnabled?: boolean; bindingState?: string; errorCode?: string | null;
};
export type QuerySourceConfiguration = { version: string; dashboardMode?: string; isActive?: boolean; editable: boolean; overCapacity: boolean;
  primary: QuerySourceSettings; sources: QuerySourceSettings[] };
export function managementError(error: unknown) {
  const code = (error as { code?: unknown })?.code;
  return `設定未完成：${typeof code === "string" && /^[A-Z][A-Z0-9_]{0,80}$/.test(code) ? code : "REQUEST_FAILED"}。原編輯內容保留；版本衝突時請先另行保存草稿，再重新載入。`;
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
