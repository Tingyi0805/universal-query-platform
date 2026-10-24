import { managementError } from "./querySourceManagement";
export type DashboardMode = { mode: "LEGACY" | "QUERY_ONLY" | "QUERY_ONLY_DISABLED"; modeVersion: number; version: string };
export type Check = { ok: boolean; code: string | null };
export type Preflight = DashboardMode & { ready: boolean; sourceCount: number; pendingCount: number; checks: (Check & { name: string })[]; queries: (Check & { sourceKey: string })[]; delegators: (Check & { deviceId: number })[] };
export type ManagedDevice = { id: number; deviceName: string; isActive: boolean; isArchived?: boolean; archivedAtUtc?: string | null; revokedAtUtc?: string | null; expiresAtUtc?: string | null; createdByUserId?: number; enforceIpRestriction?: boolean; allowedIp?: string | null; allowedCidr?: string | null; queryModeGrantVersion?: number | null; delegatorTokenVersion?: number | null };
export function dashboardMode(value: DashboardMode): DashboardMode {
  if (!value || !["LEGACY", "QUERY_ONLY", "QUERY_ONLY_DISABLED"].includes(value.mode) || typeof value.version !== "string" || !/^[a-f0-9]{64}$/.test(value.version) || !Number.isSafeInteger(value.modeVersion) || value.modeVersion < 0) throw new Error("MODE_INVALID");
  return value;
}
export function dashboardPreflight(value: Preflight): Preflight {
  dashboardMode(value);
  const valid = (items: unknown): items is Check[] => Array.isArray(items) && items.every(c => c && typeof c.ok === "boolean" && (c.code === null || (typeof c.code === "string" && /^[A-Z][A-Z0-9_]{0,80}$/.test(c.code))));
  const names = ["inactive", "capacity", "primaryConversion", "bindings", "references", "devices"];
  if (typeof value.ready !== "boolean" || !Number.isSafeInteger(value.sourceCount) || value.sourceCount < 1 || !Number.isSafeInteger(value.pendingCount) || value.pendingCount < 0
    || !valid(value.checks) || !valid(value.queries) || !valid(value.delegators)
    || value.queries.some(q => typeof q.sourceKey !== "string" || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(q.sourceKey))
    || value.delegators.some(d => !Number.isSafeInteger(d.deviceId) || d.deviceId < 1)
    || new Set(value.queries.map(q => q.sourceKey.toUpperCase())).size !== value.queries.length
    || new Set(value.delegators.map(d => d.deviceId)).size !== value.delegators.length
    || (value.ready && (value.sourceCount > 8 || value.pendingCount !== 0 || value.queries.length !== value.sourceCount || !value.delegators.length
      || !names.every(name => value.checks.filter(c => c.name === name && c.ok).length === 1)
      || ![...value.checks, ...value.queries, ...value.delegators].every(c => c.ok)))) throw new Error("PREFLIGHT_INVALID");
  return value;
}
export function deviceArchived(device: ManagedDevice) { return device.isArchived === true || !!device.archivedAtUtc; }
export function deviceMayIssue(device: ManagedDevice, now = Date.now()) {
  return device.isActive && !deviceArchived(device) && !device.revokedAtUtc && (device.expiresAtUtc === null || (typeof device.expiresAtUtc === "string" && Number.isFinite(Date.parse(device.expiresAtUtc)) && Date.parse(device.expiresAtUtc) > now));
}
export function deviceStatus(device: ManagedDevice, now = Date.now()) {
  if (deviceArchived(device)) return "已封存（裝置，不代表 Dashboard 退役）";
  if (device.revokedAtUtc || !device.isActive) return "停用／撤銷；不能藉重新整理恢復";
  if (device.expiresAtUtc !== null && (!device.expiresAtUtc || !Number.isFinite(Date.parse(device.expiresAtUtc)))) return "到期證據未知；禁止核發";
  if (!deviceMayIssue(device, now)) return "依本機時間已到期；後端仍會重驗";
  return "啟用設定；有效授權須由核發與執行 API 重驗";
}
export function dashboardOperationError(error: unknown) {
  const code = (error as { code?: unknown })?.code;
  if (code === "QUERY_DEVICE_PLAYBACK_DISABLED") return "Query-only 播放功能旗標關閉：啟用、停用及憑證管理 API 已安全停用；不代表系統故障，不回退 Legacy。";
  if (code === "QUERY_SOURCE_MANAGEMENT_DISABLED") return "新版資料來源管理功能旗標關閉：設定與版型僅供查看，禁止寫入，不回退 Legacy。";
  return managementError(error);
}
export type PlaybackPlacement = { browser: "chrome" | "edge"; screenNumber: number; fullscreen: boolean; windowX: number; windowY: number; windowWidth: number; windowHeight: number };
export function playbackPlacement(value: PlaybackPlacement): PlaybackPlacement {
  if (!value || !["chrome", "edge"].includes(value.browser) || typeof value.fullscreen !== "boolean"
    || !Number.isInteger(value.screenNumber) || value.screenNumber < 1 || value.screenNumber > 16
    || [value.windowX, value.windowY].some(n => !Number.isInteger(n) || n < -32768 || n > 32768)
    || [value.windowWidth, value.windowHeight].some(n => !Number.isInteger(n) || n < 200)
    || value.windowWidth > 7680 || value.windowHeight > 4320) throw new Error("PLAYBACK_SETTINGS_INVALID");
  return { browser: value.browser, screenNumber: value.screenNumber, fullscreen: value.fullscreen, windowX: value.windowX, windowY: value.windowY, windowWidth: value.windowWidth, windowHeight: value.windowHeight };
}
