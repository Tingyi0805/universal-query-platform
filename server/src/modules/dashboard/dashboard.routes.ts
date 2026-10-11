import { isIP } from "node:net";
import { enforceClassifiedDeviceMasks, enforceDatasetDeviceMasks, maskDeviceRows, resolveEffectiveDeviceMasks } from "./dashboardDeviceMasking.js";
import { createDashboardPageSnapshot, getDashboardPageSnapshot, resolveDashboardSnapshotSeconds, type DashboardSnapshotKind } from "./dashboardPageSnapshot.js";
import { Router, type Request } from "express";
import { getClientIp } from "../../utils/clientIp.js";
import { z } from "zod";
import { authenticateJwt, requirePermission } from "../auth/auth.middleware.js";
import { executeSavedDataset } from "../dataset/dataset.service.js";
import { getDataset } from "../dataset/dataset.repository.js";
import { listDatasetSensitiveColumns } from "../dataset/datasetSensitiveColumn.repository.js";
import { auditPatientListIfConfigured } from "../audit/patientDisclosure.service.js";
import { auditRequestContext } from "../audit/auditContext.js";
import { tryWriteAuditEvent } from "../audit/audit.repository.js";
import { getEffectiveQueryAccess, getQueryDefinition } from "../queryDefinition/queryDefinition.repository.js";
import { listReportColumns } from "../queryDefinition/reportColumn.repository.js";
import {
  createDashboard,
  deleteDashboard,
  getDashboard,
  listAccessibleDashboards,
  listDashboards,
  listDashboardsPaged,
  updateDashboard,
} from "./dashboard.repository.js";
import {
  ensureDefaultDashboardLayout,
  getDashboardLayout,
  replaceDashboardLayout,
} from "./dashboardLayout.repository.js";
import {
  createDashboardDisplayDevice,
  getDevicePlaybackSettings,
  saveDevicePlaybackSettings,
  getDashboardDeviceArchivePolicy,
  setDashboardDeviceArchivePolicy,
  archiveDashboardDevices,
  listDashboardDisplayDevices,
  listExpiringDashboardDisplayDevices,
  reissueDashboardDisplayDeviceToken,
  renewDashboardDisplayDevice,
  updateDashboardDisplayDeviceSettings,
  revokeDashboardDisplayDevice,
  checkDashboardDisplayDevice,
} from "./dashboardDevice.repository.js";
import { isValidIpOrCidr } from "./dashboardDeviceIp.js";

const idSchema = z.coerce.number().int().positive();

const widgetSchema = z.object({
  id: z.coerce.number().int().positive().nullable().optional(),
  widgetType: z.enum(["TEXT","PARAMETER","FIELD","CLOCK","PAGE_INFO","COUNTDOWN","TABLE","CONTAINER"]),
  title: z.string().trim().max(200).nullable().optional().default(null),
  sourceKey: z.string().trim().max(256).nullable().optional().default(null),
  staticText: z.string().max(1000).nullable().optional().default(null),
  x: z.coerce.number().int().min(0).max(7680),
  y: z.coerce.number().int().min(0).max(4320),
  width: z.coerce.number().int().min(40).max(7680),
  height: z.coerce.number().int().min(30).max(4320),
  fontSize: z.coerce.number().int().min(8).max(240).default(36),
  alignment: z.enum(["LEFT","CENTER","RIGHT"]).default("CENTER"),
  config: z.record(z.unknown()).default({}),
  sortOrder: z.coerce.number().int().min(-10000).max(10000).default(0),
});

const profileSchema = z.object({
  id: z.coerce.number().int().positive().nullable().optional(),
  name: z.string().trim().min(1).max(100),
  canvasWidth: z.coerce.number().int().min(320).max(7680),
  canvasHeight: z.coerce.number().int().min(240).max(4320),
  isDefault: z.boolean().default(false),
  sortOrder: z.coerce.number().int().min(-10000).max(10000).default(0),
  config: z.record(z.unknown()).default({}),
  widgets: z.array(widgetSchema).max(200),
});

const layoutSchema = z.object({
  profiles: z.array(profileSchema).min(1).max(20),
});

const deviceSchema = z.object({
  deviceName: z.string().trim().min(1).max(200),
  expiresDays: z.coerce.number().int().min(1).max(3650).nullable().optional().default(365),
  enforceIpRestriction: z.boolean().default(false),
  allowedIp: z.string().trim().max(64).nullable().optional().default(null),
  allowedCidr: z.string().trim().max(64).nullable().optional().default(null),
}).superRefine((value, ctx) => {
  if (!value.enforceIpRestriction) return;

  const allowedIp = value.allowedIp?.trim() || null;
  const allowedCidr = value.allowedCidr?.trim() || null;
  if (!allowedIp && !allowedCidr) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "啟用來源 IP 限制時，必須設定允許 IP 或 CIDR。",
      path: ["allowedIp"],
    });
    return;
  }

  if (allowedIp && isIP(allowedIp) === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "允許 IP 格式不正確。",
      path: ["allowedIp"],
    });
  }

  if (allowedCidr && (!isValidIpOrCidr(allowedCidr) || !allowedCidr.includes("/"))) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "允許 CIDR 格式不正確，目前支援 IPv4 CIDR。",
      path: ["allowedCidr"],
    });
  }
});

const deviceSettingsSchema = z.object({
  deviceName: z.string().trim().min(1).max(200),
  enforceIpRestriction: z.boolean().default(false),
  allowedIp: z.string().trim().max(64).nullable().optional().default(null),
  allowedCidr: z.string().trim().max(64).nullable().optional().default(null),
}).superRefine((value, ctx) => {
  if (!value.enforceIpRestriction) return;

  const allowedIp = value.allowedIp?.trim() || null;
  const allowedCidr = value.allowedCidr?.trim() || null;
  if (!allowedIp && !allowedCidr) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "啟用來源 IP 限制時，必須設定允許 IP 或 CIDR。",
      path: ["allowedIp"],
    });
    return;
  }

  if (allowedIp && isIP(allowedIp) === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "允許 IP 格式不正確。",
      path: ["allowedIp"],
    });
  }

  if (allowedCidr && (!isValidIpOrCidr(allowedCidr) || !allowedCidr.includes("/"))) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "允許 CIDR 格式不正確，目前支援 IPv4 CIDR。",
      path: ["allowedCidr"],
    });
  }
});

function getDeviceToken(req: Request): string {
  const value = req.headers["x-dashboard-device-token"];
  return Array.isArray(value) ? String(value[0] ?? "") : String(value ?? "");
}

function getRequestSourceIp(req: Request): string {
  return getClientIp(req) ?? "";
}

const dashboardSchema = z.object({
  code: z.string().trim().min(2).max(100).regex(/^[A-Z0-9_]+$/),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).nullable().optional().default(null),
  queryDefinitionId: z.coerce.number().int().positive(),
  refreshSeconds: z.coerce.number().int().min(5).max(3600).default(10),
  displayMode: z.enum(["TABLE","BIG_SCREEN"]).default("BIG_SCREEN"),
  displayTitle: z.string().trim().max(200).nullable().optional().default(null),
  pageSize: z.coerce.number().int().min(1).max(50).default(5),
  pageSeconds: z.coerce.number().int().min(5).max(3600).default(20),
  showClock: z.boolean().default(true),
  showPageNumber: z.boolean().default(true),
  showCountdown: z.boolean().default(true),
  parameters: z.record(z.unknown()).refine((value) => {
    const classifications = value.deviceColumnTypes;
    if (classifications !== undefined) {
      if (!classifications || typeof classifications !== "object" || Array.isArray(classifications)) return false;
      if (Object.entries(classifications).length > 300 || Object.entries(classifications).some(([key, category]) => !key.trim() || key.length > 256 || typeof category !== "string" || !/^[A-Z0-9_]{1,64}$/.test(category))) return false;
    }
    const masks = value.deviceColumnMasks;
    if (masks === undefined) return classifications === undefined || Object.keys(classifications as Record<string, unknown>).length === 0;
    if (!masks || typeof masks !== "object" || Array.isArray(masks)) return false;
    const entries = Object.entries(masks);
    if (entries.length > 300 || !entries.every(([key, mode]) => key.trim().length > 0 && key.length <= 256 && ["NONE", "NAME", "MRN", "PHONE", "GENERIC", "FULL", "OMIT"].includes(String(mode)))) return false;
    if (!classifications) return true;
    const types = classifications as Record<string, string>;
    return Object.keys(types).every((key) => Object.prototype.hasOwnProperty.call(masks, key)) && Object.entries(types).every(([key, category]) => category === "OTHER" || (masks as Record<string, unknown>)[key] !== "NONE");
  }, "敏感欄位規則格式不正確").default({}),
  isActive: z.boolean().default(true),
});

export const dashboardRouter = Router();

dashboardRouter.get("/device/:id/layout", async (req, res, next) => {
  try {
    const id = idSchema.safeParse(req.params.id);
    if (!id.success) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Dashboard ID 不正確。" } });
      return;
    }

    const token = getDeviceToken(req);
    const verification = token ? await checkDashboardDisplayDevice(id.data, token, getRequestSourceIp(req)) : { status: "INVALID_TOKEN" as const };
    if (verification.status !== "VALID") {
      const reasons = {
        INVALID_TOKEN: { code: "DASHBOARD_DEVICE_INVALID_TOKEN", message: "Token 無效或已被重新核發，請確認輸入或向管理員取得新 Token。" },
        EXPIRED: { code: "DASHBOARD_DEVICE_TOKEN_EXPIRED", message: "Token 已到期，請聯絡管理員延長裝置有效期限。" },
        DISABLED: { code: "DASHBOARD_DEVICE_DISABLED", message: "播放裝置已停用，請聯絡管理員確認裝置狀態。" },
        IP_RESTRICTED: { code: "DASHBOARD_DEVICE_IP_RESTRICTED", message: "目前來源 IP 不在允許範圍，請聯絡管理員確認播放電腦 IP 限制。" },
      };
      res.status(401).json({ error: reasons[verification.status] });
      return;
    }

    const dashboard = await getDashboard(id.data);
    if (!dashboard || !dashboard.isActive) {
      res.status(409).json({ error: { code: "DASHBOARD_NOT_AVAILABLE", message: "Dashboard 目前不可播放。" } });
      return;
    }

    res.json(await getDashboardLayout(id.data));
  } catch (error) {
    next(error);
  }
});

dashboardRouter.post("/device/:id/preview", async (req, res, next) => {
  try {
    const id = idSchema.safeParse(req.params.id);
    if (!id.success) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Dashboard ID 不正確。" } });
      return;
    }

    const token = getDeviceToken(req);
    const verification = token ? await checkDashboardDisplayDevice(id.data, token, getRequestSourceIp(req)) : { status: "INVALID_TOKEN" as const };
    if (verification.status !== "VALID") {
      const reasons = {
        INVALID_TOKEN: { code: "DASHBOARD_DEVICE_INVALID_TOKEN", message: "Token 無效或已被重新核發，請確認輸入或向管理員取得新 Token。" },
        EXPIRED: { code: "DASHBOARD_DEVICE_TOKEN_EXPIRED", message: "Token 已到期，請聯絡管理員延長裝置有效期限。" },
        DISABLED: { code: "DASHBOARD_DEVICE_DISABLED", message: "播放裝置已停用，請聯絡管理員確認裝置狀態。" },
        IP_RESTRICTED: { code: "DASHBOARD_DEVICE_IP_RESTRICTED", message: "目前來源 IP 不在允許範圍，請聯絡管理員確認播放電腦 IP 限制。" },
      };
      res.status(401).json({ error: reasons[verification.status] });
      return;
    }

    const dashboard = await getDashboard(id.data);
    if (!dashboard || !dashboard.isActive) {
      res.status(409).json({ error: { code: "DASHBOARD_NOT_AVAILABLE", message: "Dashboard 目前不可播放。" } });
      return;
    }

    const query = await getQueryDefinition(dashboard.queryDefinitionId);
    if (!query || !query.isPublished || !query.isActive || query.isArchived) {
      res.status(409).json({ error: { code: "DASHBOARD_QUERY_NOT_AVAILABLE", message: "Dashboard 使用的 Query 目前不可執行。" } });
      return;
    }

    // Legacy full-result device delivery must not bypass the page-scoped masking policy.
    res.status(410).json({ error: { code: "DASHBOARD_DEVICE_PAGE_REQUIRED", message: "此裝置須使用分頁安全播放介面。" } });
    return;

  } catch (error) {
    if (error instanceof Error && error.message.startsWith("PARAMETER_")) {
      res.status(400).json({
        error: {
          code: error.message.split(":")[0],
          message: "Dashboard 預設參數不完整或格式不正確，請檢查設定。",
        },
      });
      return;
    }
    next(error);
  }
});

// Page-scoped device delivery: only the requested page leaves the server.
// The existing preview endpoint remains for compatibility and is audited as full-result delivery.
dashboardRouter.post("/device/:id/page", async (req, res, next) => {
  try {
    const id = idSchema.safeParse(req.params.id);
    const pageInput = z.object({ page: z.number().int().min(1).max(100000), snapshotId: z.string().uuid().optional() }).safeParse(req.body);
    if (!id.success || !pageInput.success) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Dashboard ID 或頁碼不正確。" } });
      return;
    }
    const token = getDeviceToken(req);
    const verification = token ? await checkDashboardDisplayDevice(id.data, token, getRequestSourceIp(req)) : { status: "INVALID_TOKEN" as const };
    if (verification.status !== "VALID") {
      res.status(401).json({ error: { code: "DASHBOARD_DEVICE_UNAUTHORIZED", message: "播放裝置驗證失敗。" } });
      return;
    }
    const dashboard = await getDashboard(id.data);
    if (!dashboard || !dashboard.isActive) {
      res.status(409).json({ error: { code: "DASHBOARD_NOT_AVAILABLE", message: "Dashboard 目前不可播放。" } });
      return;
    }
    const query = await getQueryDefinition(dashboard.queryDefinitionId);
    if (!query || !query.isPublished || !query.isActive || query.isArchived) {
      res.status(409).json({ error: { code: "DASHBOARD_QUERY_NOT_AVAILABLE", message: "Dashboard 使用的 Query 目前不可執行。" } });
      return;
    }
    let snapshot = pageInput.data.snapshotId
      ? getDashboardPageSnapshot(pageInput.data.snapshotId, verification.device.id, id.data)
      : null;
    if (pageInput.data.snapshotId && !snapshot) {
      res.status(409).json({ error: { code: "DASHBOARD_SNAPSHOT_EXPIRED", message: "資料版本已過期，請重新載入。" } });
      return;
    }
    if (snapshot && (snapshot.queryId !== query.id || snapshot.datasetId !== query.datasetId)) {
      res.status(409).json({ error: { code: "DASHBOARD_SNAPSHOT_EXPIRED", message: "資料版本已變更，請重新載入。" } });
      return;
    }
    if (!snapshot) {
      const { snapshotKind: _snapshotKind, snapshotSeconds: _snapshotSeconds, deviceColumnMasks: _deviceColumnMasks, ...queryParameters } = dashboard.parameters;
      const result = await executeSavedDataset(query.datasetId, queryParameters);
      const dataset = await getDataset(query.datasetId);
      if (!dataset) throw new Error("DATASET_NOT_FOUND");
      const snapshotConfig = dashboard.parameters;
      const kindValue = snapshotConfig.snapshotKind;
      const kind: DashboardSnapshotKind = kindValue === "SURGERY" || kindValue === "OUTPATIENT" || kindValue === "EXAM" || kindValue === "STATISTICS"
        ? kindValue : "OTHER";
      const secondsValue = snapshotConfig.snapshotSeconds;
      const configuredSeconds = typeof secondsValue === "number" ? secondsValue : null;
      const totalPagesForSnapshot = Math.max(1, Math.ceil(result.rows.length / Math.max(1, dashboard.pageSize)));
      const cycleSeconds = totalPagesForSnapshot * Math.max(5, dashboard.pageSeconds);
      const minimumSnapshotSeconds = Math.ceil((cycleSeconds + Math.max(10, Math.ceil(cycleSeconds * 0.2))) / 10) * 10;
      if (minimumSnapshotSeconds > 3600) {
        res.status(409).json({ error: { code: "DASHBOARD_PLAYBACK_TOO_LONG", message: "完整輪播超過快照有效時間上限，請調整每頁筆數或換頁秒數。" } });
        return;
      }
      snapshot = createDashboardPageSnapshot({
        ttlSeconds: Math.max(resolveDashboardSnapshotSeconds(kind, configuredSeconds), minimumSnapshotSeconds),
        deviceId: verification.device.id, dashboardId: id.data,
        queryId: query.id, datasetId: query.datasetId,
        sourceScope: `datasource:${dataset.dataSourceId}`,
        columns: result.columns, rows: result.rows,
      });
    }
    const pageSize = Math.max(1, dashboard.pageSize);
    const totalPages = Math.max(1, Math.ceil(snapshot.rows.length / pageSize));
    if (pageInput.data.page > totalPages) {
      res.status(400).json({ error: { code: "DASHBOARD_PAGE_OUT_OF_RANGE", message: "頁碼超出資料範圍。" } });
      return;
    }
    const rawRows = snapshot.rows.slice((pageInput.data.page - 1) * pageSize, pageInput.data.page * pageSize);
    const layout = await getDashboardLayout(id.data);
    const dashboardMasks = enforceClassifiedDeviceMasks(resolveEffectiveDeviceMasks(dashboard.parameters.deviceColumnMasks, layout.profiles), dashboard.parameters.deviceColumnTypes);
    const masks = enforceDatasetDeviceMasks(dashboardMasks, await listDatasetSensitiveColumns(query.datasetId));
    const rows = maskDeviceRows(rawRows, masks);
    const masked = snapshot.columns.some((column) => masks[column.name] !== "NONE");
    const disclosureId = await auditPatientListIfConfigured({
      datasetId: query.datasetId,
      queryDefinitionId: query.id,
      userId: null,
      dashboardDeviceId: verification.device.id,
      sourceScope: snapshot.sourceScope,
      deliveryType: "PAGE",
      pageNumber: pageInput.data.page,
      masked,
      rows: rawRows,
    });
    res.setHeader("Cache-Control", "no-store");
    const reportColumns = (await listReportColumns(query.id)).filter((column) => masks[column.columnName] !== undefined && masks[column.columnName] !== "OMIT");
    const columns = snapshot.columns.filter((column) => masks[column.name] !== undefined && masks[column.name] !== "OMIT");
    const { parameters: _privateParameters, ...safeDashboard } = dashboard;
    res.json({ dashboard: safeDashboard, query: { id: query.id, code: query.code, name: query.name },
      reportColumns,
      result: { columns, rows },
      page: pageInput.data.page, totalPages, totalRows: snapshot.rows.length, snapshotId: snapshot.id, disclosureId });
  } catch (error) {
    next(error);
  }
});

dashboardRouter.use(authenticateJwt);

dashboardRouter.get("/device-alerts", requirePermission("DESIGN_QUERY"), async (req, res, next) => {
  try {
    const parsed = z.object({
      days: z.coerce.number().int().min(1).max(365).default(30),
    }).safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "提醒天數不正確。" } });
      return;
    }

    res.json({
      days: parsed.data.days,
      devices: await listExpiringDashboardDisplayDevices(parsed.data.days),
    });
  } catch (error) {
    next(error);
  }
});

dashboardRouter.get("/:id/devices", requirePermission("DESIGN_QUERY"), async (req, res, next) => {
  try {
    const id = idSchema.safeParse(req.params.id);
    if (!id.success) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Dashboard ID 不正確。" } });
      return;
    }
    res.json({ devices: await listDashboardDisplayDevices(id.data) });
  } catch (error) {
    next(error);
  }
});

const playbackSettingsSchema = z.object({
  browser: z.enum(["chrome", "edge"]), screenNumber: z.number().int().min(1).max(16),
  fullscreen: z.boolean(), windowX: z.number().int().min(-32768).max(32768),
  windowY: z.number().int().min(-32768).max(32768),
  windowWidth: z.number().int().min(200).max(7680),
  windowHeight: z.number().int().min(200).max(4320),
});

dashboardRouter.get("/:id/devices/:deviceId/playback-settings", requirePermission("DESIGN_QUERY"), async (req, res, next) => {
  try {
    const id = idSchema.safeParse(req.params.id);
    const deviceId = idSchema.safeParse(req.params.deviceId);
    if (!id.success || !deviceId.success) { res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "裝置編號不正確。" } }); return; }
    const settings = await getDevicePlaybackSettings(id.data, deviceId.data);
    if (!settings) { res.status(404).json({ error: { code: "DASHBOARD_DEVICE_NOT_FOUND", message: "找不到裝置。" } }); return; }
    res.json(settings);
  } catch (error) { next(error); }
});

dashboardRouter.put("/:id/devices/:deviceId/playback-settings", requirePermission("DESIGN_QUERY"), async (req, res, next) => {
  try {
    const id = idSchema.safeParse(req.params.id);
    const deviceId = idSchema.safeParse(req.params.deviceId);
    const body = playbackSettingsSchema.safeParse(req.body);
    if (!id.success || !deviceId.success || !body.success || !req.authUser) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "播放位置設定不正確。" } }); return;
    }
    await saveDevicePlaybackSettings(id.data, deviceId.data, body.data);
    await tryWriteAuditEvent({ eventType: "DASHBOARD_DEVICE_PLAYBACK_SETTINGS_UPDATED", userId: req.authUser.id,
      parameters: { dashboardId: id.data, deviceId: deviceId.data, ...body.data }, ...auditRequestContext(req) });
    res.json(body.data);
  } catch (error) {
    if (error instanceof Error && error.message === "DASHBOARD_DEVICE_NOT_FOUND") {
      res.status(404).json({ error: { code: "DASHBOARD_DEVICE_NOT_FOUND", message: "找不到可編輯的裝置。" } }); return;
    }
    next(error);
  }
});

dashboardRouter.get("/:id/devices/archive-policy", requirePermission("DESIGN_QUERY"), async (req, res, next) => {
  try {
    const id = idSchema.safeParse(req.params.id);
    if (!id.success) { res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Dashboard ID 不正確。" } }); return; }
    res.json(await getDashboardDeviceArchivePolicy(id.data));
  } catch (error) { next(error); }
});

dashboardRouter.put("/:id/devices/archive-policy", requirePermission("DESIGN_QUERY"), async (req, res, next) => {
  try {
    const id = idSchema.safeParse(req.params.id);
    const body = z.object({ enabled: z.boolean(), retentionDays: z.number().int().min(1).max(3650) }).safeParse(req.body);
    if (!id.success || !body.success || !req.authUser) { res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "封存政策設定不正確。" } }); return; }
    if (!(await getDashboard(id.data))) { res.status(404).json({ error: { code: "DASHBOARD_NOT_FOUND", message: "找不到 Dashboard。" } }); return; }
    const policy = await setDashboardDeviceArchivePolicy(id.data, body.data.enabled, body.data.retentionDays, req.authUser.id);
    await tryWriteAuditEvent({ eventType: "DASHBOARD_DEVICE_ARCHIVE_POLICY_UPDATED", userId: req.authUser.id,
      parameters: { dashboardId: id.data, ...policy }, ...auditRequestContext(req) });
    res.json(policy);
  } catch (error) { next(error); }
});

dashboardRouter.post("/:id/devices/archive", requirePermission("DESIGN_QUERY"), async (req, res, next) => {
  try {
    const id = idSchema.safeParse(req.params.id);
    const body = z.object({ deviceIds: z.array(z.number().int().positive()).min(1).max(100) }).safeParse(req.body);
    if (!id.success || !body.success || !req.authUser) { res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "請選擇 1～100 筆已停用裝置。" } }); return; }
    const count = await archiveDashboardDevices(id.data, body.data.deviceIds, req.authUser.id);
    await tryWriteAuditEvent({ eventType: "DASHBOARD_DEVICES_ARCHIVED", userId: req.authUser.id,
      parameters: { dashboardId: id.data, deviceIds: body.data.deviceIds, archivedCount: count }, ...auditRequestContext(req) });
    res.json({ archivedCount: count });
  } catch (error) { next(error); }
});

dashboardRouter.post("/:id/devices", requirePermission("DESIGN_QUERY"), async (req, res, next) => {
  try {
    const id = idSchema.safeParse(req.params.id);
    const parsed = deviceSchema.safeParse(req.body);
    if (!id.success || !parsed.success || !req.authUser) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "顯示裝置設定不正確。" } });
      return;
    }

    const dashboard = await getDashboard(id.data);
    if (!dashboard) {
      res.status(404).json({ error: { code: "DASHBOARD_NOT_FOUND", message: "找不到 Dashboard。" } });
      return;
    }

    const created = await createDashboardDisplayDevice({
      dashboardId: id.data,
      deviceName: parsed.data.deviceName,
      expiresDays: parsed.data.expiresDays,
      enforceIpRestriction: parsed.data.enforceIpRestriction,
      allowedIp: parsed.data.enforceIpRestriction ? parsed.data.allowedIp : null,
      allowedCidr: parsed.data.enforceIpRestriction ? parsed.data.allowedCidr : null,
      createdByUserId: req.authUser.id,
    });

    await tryWriteAuditEvent({
      eventType: "DASHBOARD_DEVICE_CREATED",
      userId: req.authUser.id,
      queryDefinitionId: dashboard.queryDefinitionId,
      parameters: {
        dashboardId: id.data,
        deviceId: created.device.id,
        deviceName: created.device.deviceName,
        expiresAtUtc: created.device.expiresAtUtc,
        enforceIpRestriction: created.device.enforceIpRestriction,
        allowedIp: created.device.allowedIp,
        allowedCidr: created.device.allowedCidr,
      },
      ...auditRequestContext(req),
    });

    res.status(201).json(created);
  } catch (error) {
    next(error);
  }
});

dashboardRouter.patch("/:id/devices/:deviceId/settings", requirePermission("DESIGN_QUERY"), async (req, res, next) => {
  try {
    const id = idSchema.safeParse(req.params.id);
    const deviceId = idSchema.safeParse(req.params.deviceId);
    const parsed = deviceSettingsSchema.safeParse(req.body);

    if (!id.success || !deviceId.success || !parsed.success || !req.authUser) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "顯示裝置設定不正確。" } });
      return;
    }

    const device = await updateDashboardDisplayDeviceSettings({
      dashboardId: id.data,
      deviceId: deviceId.data,
      deviceName: parsed.data.deviceName,
      enforceIpRestriction: parsed.data.enforceIpRestriction,
      allowedIp: parsed.data.enforceIpRestriction ? parsed.data.allowedIp : null,
      allowedCidr: parsed.data.enforceIpRestriction ? parsed.data.allowedCidr : null,
    });

    await tryWriteAuditEvent({
      eventType: "DASHBOARD_DEVICE_UPDATED",
      userId: req.authUser.id,
      parameters: {
        dashboardId: id.data,
        deviceId: deviceId.data,
        deviceName: device.deviceName,
        enforceIpRestriction: device.enforceIpRestriction,
        allowedIp: device.allowedIp,
        allowedCidr: device.allowedCidr,
      },
      ...auditRequestContext(req),
    });

    res.json({ status: "OK", device });
  } catch (error) {
    if (error instanceof Error && error.message === "DASHBOARD_DEVICE_NOT_FOUND") {
      res.status(404).json({ error: { code: error.message, message: "找不到可編輯的顯示裝置。" } });
      return;
    }
    next(error);
  }
});

dashboardRouter.post("/:id/devices/:deviceId/reissue-token", requirePermission("DESIGN_QUERY"), async (req, res, next) => {
  try {
    const id = idSchema.safeParse(req.params.id);
    const deviceId = idSchema.safeParse(req.params.deviceId);

    if (!id.success || !deviceId.success || !req.authUser) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "顯示裝置 ID 不正確。" } });
      return;
    }

    const result = await reissueDashboardDisplayDeviceToken(id.data, deviceId.data);

    await tryWriteAuditEvent({
      eventType: "DASHBOARD_DEVICE_TOKEN_REISSUED",
      userId: req.authUser.id,
      parameters: {
        dashboardId: id.data,
        deviceId: deviceId.data,
        deviceName: result.device.deviceName,
      },
      ...auditRequestContext(req),
    });

    res.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === "DASHBOARD_DEVICE_NOT_FOUND") {
      res.status(404).json({ error: { code: error.message, message: "找不到可重新核發 Token 的顯示裝置。" } });
      return;
    }
    next(error);
  }
});

dashboardRouter.patch("/:id/devices/:deviceId/renew", requirePermission("DESIGN_QUERY"), async (req, res, next) => {
  try {
    const id = idSchema.safeParse(req.params.id);
    const deviceId = idSchema.safeParse(req.params.deviceId);
    const parsed = z.object({
      days: z.coerce.number().int().min(1).max(3650).default(365),
    }).safeParse(req.body ?? {});

    if (!id.success || !deviceId.success || !parsed.success || !req.authUser) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "延長顯示裝置期限的設定不正確。" } });
      return;
    }

    const device = await renewDashboardDisplayDevice(id.data, deviceId.data, parsed.data.days);
    await tryWriteAuditEvent({
      eventType: "DASHBOARD_DEVICE_RENEWED",
      userId: req.authUser.id,
      parameters: {
        dashboardId: id.data,
        deviceId: deviceId.data,
        extendDays: parsed.data.days,
        expiresAtUtc: device.expiresAtUtc,
      },
      ...auditRequestContext(req),
    });

    res.json({ status: "OK", device });
  } catch (error) {
    if (error instanceof Error && error.message === "DASHBOARD_DEVICE_NOT_FOUND") {
      res.status(404).json({ error: { code: error.message, message: "找不到可延長的顯示裝置。" } });
      return;
    }
    next(error);
  }
});

dashboardRouter.delete("/:id/devices/:deviceId", requirePermission("DESIGN_QUERY"), async (req, res, next) => {
  try {
    const id = idSchema.safeParse(req.params.id);
    const deviceId = idSchema.safeParse(req.params.deviceId);
    if (!id.success || !deviceId.success || !req.authUser) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "顯示裝置 ID 不正確。" } });
      return;
    }

    await revokeDashboardDisplayDevice(id.data, deviceId.data);
    await tryWriteAuditEvent({
      eventType: "DASHBOARD_DEVICE_REVOKED",
      userId: req.authUser.id,
      parameters: { dashboardId: id.data, deviceId: deviceId.data },
      ...auditRequestContext(req),
    });
    res.json({ status: "OK" });
  } catch (error) {
    if (error instanceof Error && error.message === "DASHBOARD_DEVICE_NOT_FOUND") {
      res.status(404).json({ error: { code: error.message, message: "找不到可停用的顯示裝置。" } });
      return;
    }
    next(error);
  }
});

dashboardRouter.get("/available", requirePermission("VIEW_QUERY"), async (req, res, next) => {
  try {
    if (!req.authUser) {
      res.status(401).json({ error: { code: "UNAUTHORIZED", message: "需要登入。" } });
      return;
    }
    res.json({ dashboards: await listAccessibleDashboards(req.authUser.id) });
  } catch (error) {
    next(error);
  }
});

dashboardRouter.get("/", requirePermission("DESIGN_QUERY"), async (req, res, next) => {
  try {
    if (Object.keys(req.query).length === 0) {
      res.json({ dashboards: await listDashboards() });
      return;
    }

    const parsed = z.object({
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(100).default(20),
      search: z.string().trim().max(200).optional(),
      status: z.enum(["ACTIVE","INACTIVE","ALL"]).default("ACTIVE"),
      displayMode: z.enum(["TABLE","BIG_SCREEN"]).optional(),
    }).safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Dashboard 清單查詢條件不正確。" } });
      return;
    }

    const result = await listDashboardsPaged(parsed.data);
    res.json({
      dashboards: result.items,
      page: parsed.data.page,
      pageSize: parsed.data.pageSize,
      total: result.total,
      totalPages: Math.max(1, Math.ceil(result.total / parsed.data.pageSize)),
    });
  } catch (error) {
    next(error);
  }
});

dashboardRouter.post("/", requirePermission("DESIGN_QUERY"), async (req, res, next) => {
  try {
    const parsed = dashboardSchema.safeParse(req.body);
    if (!parsed.success || !req.authUser) {
      res.status(400).json({
        error: { code: "VALIDATION_ERROR", message: "Dashboard 設定格式不正確。" },
      });
      return;
    }

    const id = await createDashboard(parsed.data, req.authUser.id);
    await ensureDefaultDashboardLayout(id, parsed.data.displayTitle ?? parsed.data.name);
    await tryWriteAuditEvent({
      eventType: "DASHBOARD_CREATED",
      userId: req.authUser.id,
      queryDefinitionId: parsed.data.queryDefinitionId,
      parameters: {
        dashboardId: id,
        code: parsed.data.code,
        name: parsed.data.name,
        refreshSeconds: parsed.data.refreshSeconds,
        displayMode: parsed.data.displayMode,
        pageSize: parsed.data.pageSize,
        pageSeconds: parsed.data.pageSeconds,
        isActive: parsed.data.isActive,
        deviceColumnMasks: parsed.data.parameters.deviceColumnMasks ?? {},
        deviceColumnTypes: parsed.data.parameters.deviceColumnTypes ?? {},
      },
      ...auditRequestContext(req),
    });

    res.status(201).json({ id, dashboard: await getDashboard(id) });
  } catch (error) {
    const number = (error as { number?: number })?.number;
    if (number === 2627 || number === 2601) {
      res.status(409).json({
        error: { code: "DASHBOARD_CODE_EXISTS", message: "Dashboard 代碼已存在。" },
      });
      return;
    }
    if (error instanceof Error && error.message === "DASHBOARD_QUERY_NOT_AVAILABLE") {
      res.status(409).json({
        error: {
          code: error.message,
          message: "Dashboard 僅能使用目前已發佈且可執行的 Query。",
        },
      });
      return;
    }
    next(error);
  }
});

dashboardRouter.put("/:id", requirePermission("DESIGN_QUERY"), async (req, res, next) => {
  try {
    const id = idSchema.safeParse(req.params.id);
    const parsed = dashboardSchema.safeParse(req.body);
    if (!id.success || !parsed.success || !req.authUser) {
      res.status(400).json({
        error: { code: "VALIDATION_ERROR", message: "Dashboard 設定格式不正確。" },
      });
      return;
    }

    await updateDashboard(id.data, parsed.data, req.authUser.id);
    await tryWriteAuditEvent({
      eventType: "DASHBOARD_UPDATED",
      userId: req.authUser.id,
      queryDefinitionId: parsed.data.queryDefinitionId,
      parameters: {
        dashboardId: id.data,
        code: parsed.data.code,
        name: parsed.data.name,
        refreshSeconds: parsed.data.refreshSeconds,
        displayMode: parsed.data.displayMode,
        pageSize: parsed.data.pageSize,
        pageSeconds: parsed.data.pageSeconds,
        isActive: parsed.data.isActive,
        deviceColumnMasks: parsed.data.parameters.deviceColumnMasks ?? {},
      },
      ...auditRequestContext(req),
    });

    res.json({ status: "OK", dashboard: await getDashboard(id.data) });
  } catch (error) {
    const number = (error as { number?: number })?.number;
    if (number === 2627 || number === 2601) {
      res.status(409).json({
        error: { code: "DASHBOARD_CODE_EXISTS", message: "Dashboard 代碼已存在。" },
      });
      return;
    }
    if (error instanceof Error && error.message === "DASHBOARD_NOT_FOUND") {
      res.status(404).json({
        error: { code: error.message, message: "找不到 Dashboard。" },
      });
      return;
    }
    if (error instanceof Error && error.message === "DASHBOARD_QUERY_NOT_AVAILABLE") {
      res.status(409).json({
        error: {
          code: error.message,
          message: "Dashboard 僅能使用目前已發佈且可執行的 Query。",
        },
      });
      return;
    }
    next(error);
  }
});

dashboardRouter.delete("/:id", requirePermission("DESIGN_QUERY"), async (req, res, next) => {
  try {
    const id = idSchema.safeParse(req.params.id);
    if (!id.success || !req.authUser) {
      res.status(400).json({
        error: { code: "VALIDATION_ERROR", message: "Dashboard ID 不正確。" },
      });
      return;
    }

    const current = await getDashboard(id.data);
    if (!current) {
      res.status(404).json({
        error: { code: "DASHBOARD_NOT_FOUND", message: "找不到 Dashboard。" },
      });
      return;
    }

    await deleteDashboard(id.data);
    await tryWriteAuditEvent({
      eventType: "DASHBOARD_DELETED",
      userId: req.authUser.id,
      queryDefinitionId: current.queryDefinitionId,
      parameters: {
        dashboardId: current.id,
        code: current.code,
        name: current.name,
      },
      ...auditRequestContext(req),
    });

    res.json({ status: "OK" });
  } catch (error) {
    next(error);
  }
});

dashboardRouter.get("/:id/layout", async (req, res, next) => {
  try {
    const id = idSchema.safeParse(req.params.id);
    if (!id.success || !req.authUser) {
      res.status(400).json({
        error: { code: "VALIDATION_ERROR", message: "Dashboard ID 不正確。" },
      });
      return;
    }

    const dashboard = await getDashboard(id.data);
    if (!dashboard) {
      res.status(404).json({
        error: { code: "DASHBOARD_NOT_FOUND", message: "找不到 Dashboard。" },
      });
      return;
    }

    const canDesign = req.authUser.permissions.includes("DESIGN_QUERY");
    if (!canDesign) {
      if (!req.authUser.permissions.includes("VIEW_QUERY") || !dashboard.isActive) {
        res.status(403).json({ error: { code: "FORBIDDEN", message: "沒有查看此 Dashboard 的權限。" } });
        return;
      }
      const access = await getEffectiveQueryAccess(req.authUser.id, dashboard.queryDefinitionId);
      if (!access?.canView) {
        res.status(403).json({ error: { code: "DASHBOARD_VIEW_FORBIDDEN", message: "沒有查看此 Dashboard 的權限。" } });
        return;
      }
    }

    res.json(await getDashboardLayout(id.data));
  } catch (error) {
    next(error);
  }
});

dashboardRouter.put("/:id/layout", requirePermission("DESIGN_QUERY"), async (req, res, next) => {
  try {
    const id = idSchema.safeParse(req.params.id);
    const parsed = layoutSchema.safeParse(req.body);
    if (!id.success || !parsed.success || !req.authUser) {
      res.status(400).json({
        error: { code: "VALIDATION_ERROR", message: "Dashboard 版面設定格式不正確。" },
      });
      return;
    }

    const defaults = parsed.data.profiles.filter((profile) => profile.isDefault).length;
    if (defaults > 1) {
      res.status(400).json({
        error: { code: "DASHBOARD_MULTIPLE_DEFAULT_PROFILES", message: "只能設定一個預設螢幕版型。" },
      });
      return;
    }

    for (const profile of parsed.data.profiles) {
      for (const widget of profile.widgets) {
        if (widget.x + widget.width > profile.canvasWidth || widget.y + widget.height > profile.canvasHeight) {
          res.status(400).json({
            error: {
              code: "DASHBOARD_WIDGET_OUT_OF_BOUNDS",
              message: `版型「${profile.name}」有元件超出畫布範圍。`,
            },
          });
          return;
        }
      }
    }

    await replaceDashboardLayout(id.data, parsed.data.profiles);
    await tryWriteAuditEvent({
      eventType: "DASHBOARD_LAYOUT_UPDATED",
      userId: req.authUser.id,
      parameters: {
        dashboardId: id.data,
        profileCount: parsed.data.profiles.length,
        widgetCount: parsed.data.profiles.reduce((total, profile) => total + profile.widgets.length, 0),
      },
      ...auditRequestContext(req),
    });

    res.json({ status: "OK", ...(await getDashboardLayout(id.data)) });
  } catch (error) {
    if (error instanceof Error && error.message === "DASHBOARD_NOT_FOUND") {
      res.status(404).json({
        error: { code: error.message, message: "找不到 Dashboard。" },
      });
      return;
    }

    const number = (error as { number?: number })?.number;
    if (number === 2627 || number === 2601) {
      res.status(409).json({
        error: { code: "DASHBOARD_PROFILE_NAME_EXISTS", message: "同一 Dashboard 的螢幕版型名稱不可重複。" },
      });
      return;
    }

    next(error);
  }
});

dashboardRouter.post("/:id/preview", async (req, res, next) => {
  try {
    const id = idSchema.safeParse(req.params.id);
    if (!id.success || !req.authUser) {
      res.status(400).json({
        error: { code: "VALIDATION_ERROR", message: "Dashboard ID 不正確。" },
      });
      return;
    }

    const dashboard = await getDashboard(id.data);
    if (!dashboard) {
      res.status(404).json({
        error: { code: "DASHBOARD_NOT_FOUND", message: "找不到 Dashboard。" },
      });
      return;
    }

    const canDesign = req.authUser.permissions.includes("DESIGN_QUERY");
    if (!canDesign) {
      if (!req.authUser.permissions.includes("EXECUTE_QUERY") || !dashboard.isActive) {
        res.status(403).json({ error: { code: "FORBIDDEN", message: "沒有播放此 Dashboard 的權限。" } });
        return;
      }
      const access = await getEffectiveQueryAccess(req.authUser.id, dashboard.queryDefinitionId);
      if (!access?.canExecute) {
        res.status(403).json({ error: { code: "DASHBOARD_EXECUTE_FORBIDDEN", message: "沒有播放此 Dashboard 的權限。" } });
        return;
      }
    }

    const query = await getQueryDefinition(dashboard.queryDefinitionId);
    if (!query || !query.isPublished || !query.isActive || query.isArchived) {
      res.status(409).json({
        error: {
          code: "DASHBOARD_QUERY_NOT_AVAILABLE",
          message: "Dashboard 使用的 Query 目前不可執行。",
        },
      });
      return;
    }

    const result = await executeSavedDataset(query.datasetId, dashboard.parameters);
    const dataset = await getDataset(query.datasetId);
    if (!dataset) throw new Error("DATASET_NOT_FOUND");
    // Every preview/refresh request is a new disclosure; persist before returning rows.
    const disclosureId = await auditPatientListIfConfigured({
      datasetId: query.datasetId,
      queryDefinitionId: query.id,
      userId: req.authUser!.id,
      sourceScope: `datasource:${dataset.dataSourceId}`,
      deliveryType: "DASHBOARD",
      masked: false,
      rows: result.rows,
    });
    const reportColumns = await listReportColumns(query.id);

    res.setHeader("Cache-Control", "no-store");
    res.json({
      dashboard,
      query: {
        id: query.id,
        code: query.code,
        name: query.name,
      },
      reportColumns,
      result,
      disclosureId,
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("PARAMETER_")) {
      res.status(400).json({
        error: {
          code: error.message.split(":")[0],
          message: "Dashboard 預設參數不完整或格式不正確，請檢查設定。",
        },
      });
      return;
    }

    next(error);
  }
});
