import { isIP } from "node:net";
import { Router, type Request } from "express";
import { z } from "zod";
import { authenticateJwt, requirePermission } from "../auth/auth.middleware.js";
import { executeSavedDataset } from "../dataset/dataset.service.js";
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
  listDashboardDisplayDevices,
  revokeDashboardDisplayDevice,
  validateDashboardDisplayDevice,
} from "./dashboardDevice.repository.js";
import { isValidIpOrCidr, normalizeClientIp } from "./dashboardDeviceIp.js";

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

function getDeviceToken(req: Request): string {
  const value = req.headers["x-dashboard-device-token"];
  return Array.isArray(value) ? String(value[0] ?? "") : String(value ?? "");
}

function getRequestSourceIp(req: Request): string {
  return normalizeClientIp(req.socket.remoteAddress);
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
  parameters: z.record(z.unknown()).default({}),
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
    if (!token || !(await validateDashboardDisplayDevice(id.data, token, getRequestSourceIp(req)))) {
      res.status(401).json({ error: { code: "DASHBOARD_DEVICE_INVALID", message: "Dashboard 顯示裝置憑證無效或已停用。" } });
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
    if (!token || !(await validateDashboardDisplayDevice(id.data, token, getRequestSourceIp(req)))) {
      res.status(401).json({ error: { code: "DASHBOARD_DEVICE_INVALID", message: "Dashboard 顯示裝置憑證無效或已停用。" } });
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

    const result = await executeSavedDataset(query.datasetId, dashboard.parameters);
    const reportColumns = await listReportColumns(query.id);

    res.json({
      dashboard,
      query: { id: query.id, code: query.code, name: query.name },
      reportColumns,
      result,
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

dashboardRouter.use(authenticateJwt);

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
    const reportColumns = await listReportColumns(query.id);

    res.json({
      dashboard,
      query: {
        id: query.id,
        code: query.code,
        name: query.name,
      },
      reportColumns,
      result,
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
