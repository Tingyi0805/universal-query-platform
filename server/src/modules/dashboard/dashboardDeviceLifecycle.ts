import { timingSafeEqual } from "node:crypto";

// Private server-side projection, not a public API payload or authorization grant.
export type DeviceLifecycleRecord = {
  id: number; dashboardId: number; isActive: boolean;
  suspendedAtUtc: string | null; reenrollmentRequired: boolean | null;
  revokedAtUtc: string | null; archivedAtUtc: string | null; expiresAtUtc: string | null;
  tokenHash: string; queryModeGrantVersion: number | null; delegatorTokenVersion: number | null;
};
export type DeviceLifecycleState = "ACTIVE" | "SUSPENDED" | "PENDING_REENROLLMENT" | "REVOKED" | "ARCHIVED" | "EXPIRED" | "UNVERIFIED";
export type DeviceLifecycleAction = "SUSPEND" | "RESTORE" | "ISSUE" | "ENROLL" | "REVOKE" | "ARCHIVE";
export class DeviceLifecycleContractError extends Error {
  constructor() { super("DEVICE_LIFECYCLE_CONTRACT_REJECTED"); }
}
const reject = (): never => { throw new DeviceLifecycleContractError(); };
const positive = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
const sameHash = (a: string, b: string) => hash(a) && hash(b) && timingSafeEqual(Buffer.from(a,"hex"),Buffer.from(b,"hex"));
// SELECT * remains compatible with installations that have not applied 926.
// Only NULL/absent legacy evidence or an explicit false marker may proceed to
// the existing checks. D2 enrollment needs a separate, non-delivery proof path.
export function deviceLifecycleBlocksPlayback(row: {SuspendedAtUtc?:unknown;ReenrollmentRequired?:unknown}): boolean {
  return row.SuspendedAtUtc != null || row.ReenrollmentRequired != null && row.ReenrollmentRequired !== false;
}
function instant(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.000)?Z$/.test(value) || !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().replace(".000Z","Z") !== value.replace(".000Z","Z")) reject();
  return Date.parse(value);
}
export function assertDeviceLifecycleRecord(row: DeviceLifecycleRecord): void {
  if (!positive(row.id) || !positive(row.dashboardId) || typeof row.isActive !== "boolean" || !hash(row.tokenHash) ||
    ![null,true,false].includes(row.reenrollmentRequired)) reject();
  for (const date of [row.suspendedAtUtc,row.revokedAtUtc,row.archivedAtUtc,row.expiresAtUtc]) if (date !== null) instant(date);
  const grants = [row.queryModeGrantVersion,row.delegatorTokenVersion];
  if (!(grants.every(v=>v===null) || grants.every(positive))) reject();
  if ((row.revokedAtUtc !== null || row.archivedAtUtc !== null) && row.isActive) reject();
  if (row.suspendedAtUtc !== null && (row.isActive || row.revokedAtUtc !== null || row.archivedAtUtc !== null ||
      row.reenrollmentRequired !== true || !grants.every(v=>v===null))) reject();
  if (row.reenrollmentRequired !== null && (row.revokedAtUtc !== null || row.archivedAtUtc !== null ||
      (!row.isActive && row.suspendedAtUtc === null))) reject();
}
// A valid live proof must come from existing server-side device/ACL/policy checks.
// Even ACTIVE is a management label: no caller may use it instead of those checks.
export function deviceLifecycleState(row: DeviceLifecycleRecord, now: number, verifiedTokenHash?: string): DeviceLifecycleState {
  assertDeviceLifecycleRecord(row); if (!Number.isSafeInteger(now)) reject();
  if (row.archivedAtUtc !== null) return "ARCHIVED";
  if (row.revokedAtUtc !== null) return "REVOKED";
  if (row.expiresAtUtc !== null && instant(row.expiresAtUtc) <= now) return "EXPIRED";
  if (row.suspendedAtUtc !== null) return "SUSPENDED";
  if (row.reenrollmentRequired === true) return "PENDING_REENROLLMENT";
  if (row.isActive && row.queryModeGrantVersion !== null && row.delegatorTokenVersion !== null &&
      verifiedTokenHash !== undefined && sameHash(row.tokenHash,verifiedTokenHash)) return "ACTIVE";
  return "UNVERIFIED";
}
export function assertDeviceLifecycleTransition(before: DeviceLifecycleRecord, after: DeviceLifecycleRecord,
  action: DeviceLifecycleAction, now: number, verifiedTokenHash?: string): void {
  assertDeviceLifecycleRecord(before); assertDeviceLifecycleRecord(after);
  if (!Number.isSafeInteger(now) || before.id !== after.id || before.dashboardId !== after.dashboardId || before.expiresAtUtc !== after.expiresAtUtc) reject();
  if (before.archivedAtUtc !== null || before.revokedAtUtc !== null && action !== "ARCHIVE") reject();
  const allowed: Record<DeviceLifecycleAction, (keyof DeviceLifecycleRecord)[]> = {
    SUSPEND:["isActive","suspendedAtUtc","reenrollmentRequired","tokenHash","queryModeGrantVersion","delegatorTokenVersion"],
    RESTORE:["isActive","suspendedAtUtc","reenrollmentRequired","tokenHash"],
    ISSUE:["tokenHash","reenrollmentRequired","queryModeGrantVersion","delegatorTokenVersion"],
    ENROLL:["reenrollmentRequired"],
    REVOKE:["isActive","suspendedAtUtc","reenrollmentRequired","revokedAtUtc","tokenHash","queryModeGrantVersion","delegatorTokenVersion"],
    ARCHIVE:["archivedAtUtc"],
  };
  if (!Object.hasOwn(allowed,action)) reject();
  for (const key of Object.keys(before) as (keyof DeviceLifecycleRecord)[]) if (!allowed[action].includes(key) && before[key] !== after[key]) reject();
  const unexpired = before.expiresAtUtc === null || instant(before.expiresAtUtc) > now;
  const noGrants = after.queryModeGrantVersion === null && after.delegatorTokenVersion === null;
  if (["SUSPEND","RESTORE","ISSUE","REVOKE"].includes(action) && sameHash(before.tokenHash,after.tokenHash)) reject();
  switch (action) {
    case "SUSPEND":
      if (!before.isActive || before.suspendedAtUtc !== null || !unexpired || after.isActive ||
          after.suspendedAtUtc === null || instant(after.suspendedAtUtc) !== now || after.reenrollmentRequired !== true || !noGrants) reject();
      break;
    case "RESTORE":
      if (before.suspendedAtUtc === null || !unexpired || !after.isActive || after.suspendedAtUtc !== null ||
          after.reenrollmentRequired !== true || !noGrants) reject();
      break;
    case "ISSUE":
      if (!before.isActive || !unexpired || after.reenrollmentRequired !== true || after.queryModeGrantVersion === null || after.delegatorTokenVersion === null) reject();
      break;
    case "ENROLL":
      if (!before.isActive || !unexpired || before.reenrollmentRequired !== true || after.reenrollmentRequired !== false ||
          after.queryModeGrantVersion === null || after.delegatorTokenVersion === null || verifiedTokenHash === undefined || !sameHash(after.tokenHash,verifiedTokenHash)) reject();
      break;
    case "REVOKE":
      if (after.isActive || after.suspendedAtUtc !== null || after.reenrollmentRequired !== null || !noGrants ||
          after.revokedAtUtc === null || instant(after.revokedAtUtc) !== now) reject();
      break;
    case "ARCHIVE":
      if (before.revokedAtUtc === null || before.suspendedAtUtc !== null || after.archivedAtUtc === null || instant(after.archivedAtUtc) !== now) reject();
      break;
  }
}
