import type { ManagedDevice } from "./managementStatus";
export type LifecycleDevice = ManagedDevice & { suspendedAtUtc: string | null; reenrollmentRequired: boolean | null };
export type LifecycleAction = "suspend" | "restore" | "credential" | "revoke" | "archive";
export const lifecycleLabels: Record<LifecycleAction, string> = { suspend: "暫停", restore: "恢復", credential: "核發新 Token", revoke: "永久撤銷", archive: "封存" };
export function lifecycleStatus(d: LifecycleDevice, now = Date.now()) {
  if (d.archivedAtUtc) return "已封存";
  if (d.revokedAtUtc) return "已撤銷（永久）";
  if (d.expiresAtUtc !== null && (!d.expiresAtUtc || !Number.isFinite(Date.parse(d.expiresAtUtc)))) return "無法驗證（到期證據無效）";
  if (d.expiresAtUtc && Date.parse(d.expiresAtUtc) <= now) return "已到期";
  if (d.suspendedAtUtc) return "已暫停";
  if (d.reenrollmentRequired === true) return "待重新授權";
  return d.isActive ? "啟用設定／無法驗證播放授權" : "無法驗證";
}
// A management snapshot has no live token/ACL proof. Never infer normal playback.
export function lifecycleActions(d: LifecycleDevice, design: boolean, execute: boolean, now = Date.now()): LifecycleAction[] {
  if (!design || d.archivedAtUtc) return [];
  if (d.revokedAtUtc) return !d.isActive ? ["archive"] : [];
  const actions: LifecycleAction[] = ["revoke"];
  if (d.expiresAtUtc !== null && (!d.expiresAtUtc || !Number.isFinite(Date.parse(d.expiresAtUtc)) || Date.parse(d.expiresAtUtc) <= now)) return actions;
  if (d.suspendedAtUtc) { if (execute) actions.unshift("restore"); }
  else if (d.isActive) { actions.unshift("suspend"); if (execute && d.reenrollmentRequired === true) actions.unshift("credential"); }
  return actions;
}
export function lifecycleConfirmation(action: LifecycleAction, name: string) {
  const warning = { suspend: "舊 Token 與既有授權將失效。恢復後仍須重新授權。", restore: "只恢復為待重新授權，不會直接正常播放。", credential: "舊 Token 立即失效；新 Token 只顯示一次，關閉後無法讀回。", revoke: "永久撤銷不可恢復；原 Token 不可恢復，不能藉重新整理或恢復裝置取回。", archive: "僅封存已永久撤銷的裝置，保留歷史且不可還原。" }[action];
  return `確認${lifecycleLabels[action]}「${name}」？${warning}`;
}
