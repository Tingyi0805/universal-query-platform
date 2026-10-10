import { Router } from "express";
import { z } from "zod";
import { authenticateJwt, requirePermission } from "../auth/auth.middleware.js";
import { executeSavedDataset } from "../dataset/dataset.service.js";
import { auditRequestContext } from "../audit/auditContext.js";
import {
  completeAuditFailure,
  completeAuditSuccess,
  startAudit,
  tryWriteAuditEvent,
} from "../audit/audit.repository.js";
import { getQueryDefinition } from "../queryDefinition/queryDefinition.repository.js";
import { listReportColumns } from "../queryDefinition/reportColumn.repository.js";
import {
  createDashboard,
  deleteDashboard,
  getDashboard,
  listDashboards,
  updateDashboard,
} from "./dashboard.repository.js";

const idSchema = z.coerce.number().int().positive();

const dashboardSchema = z.object({
  code: z.string().trim().min(2).max(100).regex(/^[A-Z0-9_]+$/),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).nullable().optional().default(null),
  queryDefinitionId: z.coerce.number().int().positive(),
  refreshSeconds: z.coerce.number().int().min(5).max(3600).default(10),
  parameters: z.record(z.unknown()).default({}),
  isActive: z.boolean().default(true),
});

export const dashboardRouter = Router();
dashboardRouter.use(authenticateJwt);

dashboardRouter.get("/", requirePermission("DESIGN_QUERY"), async (_req, res, next) => {
  try {
    res.json({ dashboards: await listDashboards() });
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
    await tryWriteAuditEvent({
      eventType: "DASHBOARD_CREATED",
      userId: req.authUser.id,
      queryDefinitionId: parsed.data.queryDefinitionId,
      parameters: {
        dashboardId: id,
        code: parsed.data.code,
        name: parsed.data.name,
        refreshSeconds: parsed.data.refreshSeconds,
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

dashboardRouter.post("/:id/preview", requirePermission("DESIGN_QUERY"), async (req, res, next) => {
  let auditId: number | null = null;
  let started = Date.now();

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

    started = Date.now();
    auditId = await startAudit({
      eventType: "DASHBOARD_PREVIEW",
      userId: req.authUser.id,
      queryDefinitionId: query.id,
      datasetId: query.datasetId,
      parameters: {
        dashboardId: dashboard.id,
        values: dashboard.parameters,
      },
      ...auditRequestContext(req),
    });

    const result = await executeSavedDataset(query.datasetId, dashboard.parameters);
    const reportColumns = await listReportColumns(query.id);

    await completeAuditSuccess(auditId, {
      rowCount: result.rowCount,
      durationMs: Date.now() - started,
    }).catch(() => undefined);

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
    if (auditId) {
      await completeAuditFailure(auditId, {
        errorCode: error instanceof Error ? error.message : "UNKNOWN_ERROR",
        durationMs: Date.now() - started,
      }).catch(() => undefined);
    }

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
