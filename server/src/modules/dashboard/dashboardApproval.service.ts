import { createHash } from "node:crypto";
import { parseApprovalVersion } from "../securityContract/securityContract.js";
import { assertDatasetSensitivityPolicy, dashboardMaskModes, resolveDashboardDisclosureMasks,
  validDashboardColumnMasks, validInheritedDashboardApprovalUpdate, type DashboardMaskMode } from "./dashboardDeviceMasking.js";
import type { DatasetSensitiveColumn } from "../dataset/datasetSensitiveColumn.repository.js";

export class DashboardApprovalError extends Error {
  constructor(readonly code: string, readonly status = 409) { super(code); }
}
export const approvalKeys = ["deviceColumnMasks", "deviceColumnTypes", "deviceSourceColumnMasks"] as const;
export function approvalObject(value: unknown): Record<string, unknown> {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new DashboardApprovalError("DASHBOARD_APPROVAL_CONFIG_INVALID");
  return value as Record<string, unknown>;
}
const canonical = (value: unknown): string => JSON.stringify(value && typeof value === "object" && !Array.isArray(value)
  ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, JSON.parse(canonical(item))])) : value);
export function hasPrimaryApprovals(parameters: Record<string, unknown>) { return Object.keys(approvalObject(parameters.deviceColumnMasks)).length > 0; }
export function sourceApprovals(parameters: Record<string, unknown>, key: string) {
  const sources = approvalObject(parameters.deviceSourceColumnMasks);
  // Binding guards must also see historical case-equivalent approval keys.
  return Object.fromEntries(Object.entries(sources).filter(([name]) => name.toUpperCase() === key.toUpperCase())
    .flatMap(([, masks]) => Object.entries(approvalObject(masks))));
}
export function assertEmptyApprovalCreation(parameters: Record<string, unknown>) {
  if (hasPrimaryApprovals(parameters) || Object.keys(approvalObject(parameters.deviceColumnTypes)).length ||
    Object.values(approvalObject(parameters.deviceSourceColumnMasks)).some(value => Object.keys(approvalObject(value)).length))
    throw new DashboardApprovalError("DASHBOARD_APPROVAL_WRITE_REQUIRED");
}
export function assertBasicApprovalWrite(previous: Record<string, unknown>, next: Record<string, unknown>, previousQueryId: number, nextQueryId: number) {
  if (previousQueryId !== nextQueryId && hasPrimaryApprovals(previous)) throw new DashboardApprovalError("DASHBOARD_APPROVAL_BINDING_CHANGED");
  if (approvalKeys.some(key => canonical(approvalObject(previous[key])) !== canonical(approvalObject(next[key]))))
    throw new DashboardApprovalError("DASHBOARD_APPROVAL_WRITE_REQUIRED");
}
/** Omission means retain the locked current setting; explicit changes still hit the guard. */
export function preserveApprovalSettings(previous: Record<string, unknown>, incoming: Record<string, unknown>) {
  const next = { ...incoming };
  for (const key of approvalKeys) if (!Object.hasOwn(incoming, key) && Object.hasOwn(previous, key)) next[key] = previous[key];
  return next;
}
export function assertSourceApprovalBindings(parameters: Record<string, unknown>, previous: Array<{ sourceKey: string; datasetId: number }>, next: Array<{ sourceKey: string; datasetId: number }>) {
  for (const [key, masks] of Object.entries(approvalObject(parameters.deviceSourceColumnMasks))) {
    if (!Object.keys(approvalObject(masks)).length) continue;
    const before = previous.find(s => s.sourceKey === key); const after = next.find(s => s.sourceKey === key);
    if (!before || !after || before.datasetId !== after.datasetId) throw new DashboardApprovalError("DASHBOARD_APPROVAL_BINDING_CHANGED");
  }
}
export type ApprovalSource = { id: number; sourceKey: string; datasetId: number; rowVersion: string;
  policy: { version: number; columns: DatasetSensitiveColumn[] } };
export type ApprovalState = { dashboardId: number; queryId: number; rowVersion: string; isActive: boolean;
  parameters: Record<string, unknown>; sources: ApprovalSource[] };
export function approvalVersion(state: { dashboardId: number; queryId: number; rowVersion: string;
  sources: Array<Pick<ApprovalSource, "id" | "sourceKey" | "datasetId" | "rowVersion">> }) {
  if (!Number.isSafeInteger(state.dashboardId) || state.dashboardId < 1 || !Number.isSafeInteger(state.queryId) || state.queryId < 1 ||
    !/^[0-9a-f]{16}$/.test(state.rowVersion) || state.sources.some(s => !/^[0-9a-f]{16}$/.test(s.rowVersion) ||
      !Number.isSafeInteger(s.id) || s.id < 1 || !Number.isSafeInteger(s.datasetId) || s.datasetId < 1 || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(s.sourceKey)))
    throw new DashboardApprovalError("SECURITY_SCHEMA_REQUIRED", 503);
  return createHash("sha256").update(JSON.stringify([state.dashboardId, state.queryId, state.rowVersion,
    [...state.sources].sort((a, b) => a.id - b.id).map(s => [s.id, s.sourceKey, s.datasetId, s.rowVersion])])).digest("hex");
}
export type ApprovalPatch = { expectedVersion: string; sourceKey: string; upsert: Record<string, DashboardMaskMode>; remove: string[] };
export interface ApprovalTransaction {
  read(id: number, actor: { userId: number; tokenVersion: number }): Promise<ApprovalState>;
  update(id: number, parameters: Record<string, unknown>): Promise<void>;
  audit(id: number, userId: number, sourceKey: string, context: { ipAddress?: string | null; userAgent?: string | null }): Promise<void>;
}
export interface ApprovalStore { transaction<T>(id: number, run: (tx: ApprovalTransaction) => Promise<T>): Promise<T> }
function project(state: ApprovalState) {
  for (const source of state.sources) assertDatasetSensitivityPolicy(source.policy);
  // Only the three owned settings leave the server; unrelated Parameters may contain binds.
  const settings = Object.fromEntries(approvalKeys.map(key => [key, approvalObject(state.parameters[key])]));
  for (const [key, value] of Object.entries(settings.deviceColumnTypes!))
    if (!key || key.length > 256 || typeof value !== "string" || !/^[A-Z0-9_]{1,64}$/.test(value)) throw new DashboardApprovalError("DASHBOARD_APPROVAL_CONFIG_INVALID");
  for (const masks of [settings.deviceColumnMasks!, ...Object.values(settings.deviceSourceColumnMasks!).map(approvalObject)])
    for (const [key, mode] of Object.entries(masks)) if (!key || key.length > 256 || !dashboardMaskModes.includes(mode as DashboardMaskMode))
      throw new DashboardApprovalError("DASHBOARD_APPROVAL_CONFIG_INVALID");
  return { version: approvalVersion(state), dashboardId: state.dashboardId, isActive: state.isActive,
    sources: state.sources.map(s => ({ id: s.id, sourceKey: s.sourceKey, datasetId: s.datasetId })), ...settings };
}
export function applyApprovalPatch(state: ApprovalState, patch: ApprovalPatch) {
  parseApprovalVersion(patch.expectedVersion);
  if (patch.expectedVersion !== approvalVersion(state)) throw new DashboardApprovalError("DASHBOARD_APPROVAL_VERSION_CONFLICT");
  if (state.isActive) throw new DashboardApprovalError("DASHBOARD_APPROVAL_REQUIRES_DISABLED");
  const source = state.sources.find(s => s.sourceKey === patch.sourceKey);
  if (!source) throw new DashboardApprovalError("DASHBOARD_SOURCE_NOT_FOUND", 404);
  assertDatasetSensitivityPolicy(source.policy);
  const old = patch.sourceKey === "PRIMARY" ? approvalObject(state.parameters.deviceColumnMasks) : sourceApprovals(state.parameters, patch.sourceKey);
  const upsert = Object.entries(patch.upsert); const names = [...upsert.map(([key]) => key), ...patch.remove];
  if (names.some(key => !key || key.trim() !== key || key.length > 256 || /[\x00-\x1f\x7f]/.test(key)) || new Set(names.map(k => k.toUpperCase())).size !== names.length)
    throw new DashboardApprovalError("VALIDATION_ERROR", 400);
  const next = new Map(Object.entries(old));
  for (const key of names) for (const existing of next.keys()) if (existing.toUpperCase() === key.toUpperCase()) next.delete(existing);
  for (const [key, mode] of upsert) {
    const matches = source.policy.columns.filter(rule => rule.columnName.toUpperCase() === key.toUpperCase());
    if (matches.length !== 1) throw new DashboardApprovalError("DASHBOARD_APPROVAL_COLUMN_INVALID", 400);
    const minimum = matches[0]!.deviceMaskMode;
    const allowed = minimum === "CUSTOM" ? ["INHERIT", "CUSTOM", "FULL", "OMIT"] : minimum === "OMIT" ? ["INHERIT", "OMIT"] :
      minimum === "FULL" ? ["INHERIT", "FULL", "OMIT"] : minimum === "NONE" ? dashboardMaskModes.filter(m => m !== "CUSTOM") : ["INHERIT", minimum, "FULL", "OMIT"];
    if (!allowed.includes(mode)) throw new DashboardApprovalError("DASHBOARD_APPROVAL_MASK_INVALID", 400);
    next.set(key, mode);
  }
  const masks = Object.fromEntries(next);
  if (!validInheritedDashboardApprovalUpdate(old, masks)) throw new DashboardApprovalError("DASHBOARD_APPROVAL_MASK_INVALID", 400);
  if (!validDashboardColumnMasks(masks)) throw new DashboardApprovalError("DASHBOARD_APPROVAL_CONFIG_INVALID");
  const parameters = { ...state.parameters, ...(patch.sourceKey === "PRIMARY" ? { deviceColumnMasks: masks } : {
    deviceSourceColumnMasks: { ...approvalObject(state.parameters.deviceSourceColumnMasks), [patch.sourceKey]: masks } }) };
  const effective = resolveDashboardDisclosureMasks(parameters, patch.sourceKey, source.policy.columns);
  for (const [key, mode] of upsert) if (mode !== "OMIT" && effective[key] === "OMIT" && !["OMIT"].includes(source.policy.columns.find(r => r.columnName.toUpperCase() === key.toUpperCase())!.deviceMaskMode))
    throw new DashboardApprovalError("DASHBOARD_APPROVAL_MASK_INVALID", 400);
  return parameters;
}
export function createDashboardApprovalService(store: ApprovalStore) {
  return {
    get: (id: number, actor: { userId: number; tokenVersion: number }) => store.transaction(id, async tx => project(await tx.read(id, actor))),
    patch: (id: number, actor: { userId: number; tokenVersion: number }, patch: ApprovalPatch, context: { ipAddress?: string | null; userAgent?: string | null } = {}) =>
      store.transaction(id, async tx => { const state = await tx.read(id, actor); const parameters = applyApprovalPatch(state, patch);
        await tx.update(id, parameters); await tx.audit(id, actor.userId, patch.sourceKey, context);
        return project(await tx.read(id, actor)); }),
  };
}
