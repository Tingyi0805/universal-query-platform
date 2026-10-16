export const approvalSettingKeys = ["deviceColumnMasks", "deviceColumnTypes", "deviceSourceColumnMasks"] as const;
export function basicDashboardParameters(parameters: Record<string, unknown>) {
  if (approvalSettingKeys.some(key => Object.prototype.hasOwnProperty.call(parameters, key))) throw Object.assign(new Error("Approval fields require dedicated API"), { code: "DASHBOARD_APPROVAL_WRITE_REQUIRED" });
  return { ...parameters };
}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const aliases = (value: unknown): value is string[] => Array.isArray(value) && value.every(v => typeof v === "string" && v.length > 0 && v.length <= 256) && new Set(value.map(v => v.toUpperCase())).size === value.length;
const version = (value: unknown): value is string => typeof value === "string" && /^(0|[1-9][0-9]{0,18})$(?![\s\S])/.test(value) && (value.length < 19 || value <= "9223372036854775807");
export const patientStatuses: Record<string, string> = { NOT_CONFIGURED: "尚未設定", DISABLED: "目前停用", KEY_UNAVAILABLE: "HMAC 金鑰不可用，請聯絡系統管理者",
  METADATA_UNCONFIRMED: "可信欄位尚未確認，請儲存 Dataset 定義並成功預覽後重新載入", METADATA_AMBIGUOUS: "欄位別名有大小寫歧義，請檢查 Dataset 定義",
  PATIENT_KEY_INVALID: "識別欄位無效或屬姓名分類，請重新確認", CONFIRMED: "已確認" };
export type PatientAuditView = { config: { isEnabled: boolean; patientKeyColumn: string; version: string } | null;
  version: string; status: string; metadataStatus: string; columns: string[] };
export function patientAuditView(value: unknown): PatientAuditView {
  if (!record(value) || !version(value.version) || typeof value.status !== "string" || !Object.prototype.hasOwnProperty.call(patientStatuses, value.status) ||
    !["CONFIRMED", "METADATA_UNCONFIRMED", "METADATA_AMBIGUOUS"].includes(String(value.metadataStatus)) || !aliases(value.columns)) throw new Error("RESPONSE_INVALID");
  if (value.metadataStatus === "CONFIRMED" && !value.columns.length) throw new Error("RESPONSE_INVALID");
  const c = value.config;
  if (c === null && value.version !== "0") throw new Error("RESPONSE_INVALID");
  if (c !== null && (!record(c) || typeof c.isEnabled !== "boolean" || typeof c.patientKeyColumn !== "string" || !c.patientKeyColumn.length || c.patientKeyColumn.length > 128 || !version(c.version) || c.version === "0" || c.version !== value.version)) throw new Error("RESPONSE_INVALID");
  return { config: c === null ? null : { isEnabled: c.isEnabled as boolean, patientKeyColumn: c.patientKeyColumn as string, version: c.version as string },
    version: value.version, status: value.status, metadataStatus: String(value.metadataStatus), columns: value.columns };
}
export type ColumnApprovals = { version: string; dashboardId: number; isActive: boolean; sources: Array<{ id: number; sourceKey: string; datasetId: number }>;
  deviceColumnMasks: Record<string, string>; deviceColumnTypes: Record<string, string>; deviceSourceColumnMasks: Record<string, Record<string, string>> };
export function columnApprovals(value: unknown): ColumnApprovals {
  if (!record(value) || typeof value.version !== "string" || !/^[a-f0-9]{64}$(?![\s\S])/.test(value.version) || !Number.isSafeInteger(value.dashboardId) || typeof value.isActive !== "boolean" ||
    Number(value.dashboardId) < 1 || !Array.isArray(value.sources) || value.sources.some(s => !record(s) || !Number.isSafeInteger(s.id) || Number(s.id) < 1 || !Number.isSafeInteger(s.datasetId) || Number(s.datasetId) < 1 || typeof s.sourceKey !== "string" || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(s.sourceKey)) ||
    !value.sources.some(s => s.sourceKey === "PRIMARY") || new Set(value.sources.map(s => s.sourceKey.toUpperCase())).size !== value.sources.length) throw new Error("RESPONSE_INVALID");
  const masks = (v: unknown) => record(v) && Object.entries(v).every(([key, mode]) => key.length > 0 && key.length <= 256 && typeof mode === "string" && ["NONE", "NAME", "MRN", "PHONE", "GENERIC", "CUSTOM", "FULL", "OMIT", "INHERIT"].includes(mode));
  if (!masks(value.deviceColumnMasks) || !record(value.deviceColumnTypes) || Object.values(value.deviceColumnTypes).some(v => typeof v !== "string" || !/^[A-Z0-9_]{1,64}$/.test(v)) ||
    !record(value.deviceSourceColumnMasks) || Object.values(value.deviceSourceColumnMasks).some(v => !masks(v))) throw new Error("RESPONSE_INVALID");
  return { version: value.version, dashboardId: Number(value.dashboardId), isActive: value.isActive,
    sources: value.sources.map(s => ({ id: s.id, sourceKey: s.sourceKey, datasetId: s.datasetId })), deviceColumnMasks: value.deviceColumnMasks as Record<string, string>,
    deviceColumnTypes: value.deviceColumnTypes as Record<string, string>, deviceSourceColumnMasks: value.deviceSourceColumnMasks as Record<string, Record<string, string>> };
}
const guidance: Record<string, string> = {
  DASHBOARD_DELIVERY_FAILED: "資料未安全送達，請管理者檢查 Dataset 稽核、政策與服務狀態。", DASHBOARD_PREVIEW_FAILED: "安全預覽未完成，請管理者檢查稽核、授權與設定。",
  PATIENT_AUDIT_NOT_CONFIGURED: "請管理者完成 Dataset 患者揭露稽核設定。", PATIENT_AUDIT_NOT_CONFIRMED: "請管理者確認 Dataset 的可信欄位、識別碼及金鑰狀態。",
  PATIENT_AUDIT_FAILED: "患者揭露稽核未完成，資料不會傳送；請管理者檢查稽核服務與金鑰。", PATIENT_AUDIT_KEY_UNAVAILABLE: "HMAC 金鑰不可用，請聯絡系統管理者；不得停用稽核繞過。",
  SECURITY_SCHEMA_REQUIRED: "安全 Schema 919 尚未就緒，修改已禁止；請系統管理者安排隔離驗證與核准的安裝流程。",
  PATIENT_AUDIT_VERSION_CONFLICT: "其他管理者已更新設定。請重新載入，再確認識別欄位後儲存。",
  DASHBOARD_APPROVAL_VERSION_CONFLICT: "核准版本已變更。請重新載入，再確認本來源的修改；不會覆蓋其他管理者。",
  DASHBOARD_APPROVAL_WRITE_REQUIRED: "欄位核准與分類不能由基本設定修改，請使用欄位核准管理。",
  DASHBOARD_APPROVAL_BINDING_CHANGED: "既有核准不能移轉到其他 Query／Dataset 或重用的 SourceKey。請先明確移除原來源核准，再更換綁定。",
  DASHBOARD_APPROVAL_REQUIRES_DISABLED: "須先停用 Dashboard 才可修改；系統不會自動停用或啟用。",
  DASHBOARD_PREVIEW_STATE_CHANGED: "預覽期間授權或設定已變更，請重新載入安全預覽。",
  FORBIDDEN: "權限不足，請聯絡管理者確認授權。", DASHBOARD_EXECUTE_FORBIDDEN: "本來源沒有查詢執行權限，請管理者確認主 Query 授權。",
  QUERY_SOURCE_QUERY_FORBIDDEN: "本來源沒有查詢執行權限，請管理者確認 Query 授權。",
  TOKEN_REVOKED: "登入授權已失效，請重新登入。", INVALID_TOKEN: "登入授權已失效，請重新登入。", UNAUTHORIZED: "請重新登入或重新完成裝置授權。",
  DASHBOARD_DEVICE_UNAUTHORIZED: "裝置授權已失效，請管理者重新完成授權。", QUERY_SOURCE_LEGACY_WRITER_DISABLED: "此看板受轉換或寫入者保護，請使用對應管理流程，不能回退到舊寫入。",
  METADATA_UNCONFIRMED: "請先儲存 Dataset 定義並成功預覽，再重新載入可信欄位。", METADATA_AMBIGUOUS: "結果別名有大小寫歧義，請管理者修正定義。",
  PARAMETER_REQUIRED: "請管理者確認本來源的必要查詢參數。",
  PATIENT_KEY_INVALID: "請選擇後端確認的精確識別別名；姓名不能作為患者識別碼。",
};
export function securityGuidance(error: unknown) {
  const raw = (error as { code?: unknown } | null)?.code;
  const code = typeof raw === "string" && Object.prototype.hasOwnProperty.call(guidance, raw) ? raw : "REQUEST_FAILED";
  return { code, message: guidance[code] ?? "要求未完成，請重新載入或聯絡管理者；原編輯內容保留。" };
}
