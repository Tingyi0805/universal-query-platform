import { createHash } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { getClientIp } from "../../utils/clientIp.js";
import { QuerySourceError } from "./dashboardQuerySources.service.js";
import { failure } from "./dashboardQuerySources.routes.js";
import type { createQuerySourceExecution } from "./dashboardQuerySourceExecution.js";

export type QueryDeviceDependencies = {
  mode: (id: number) => Promise<{ mode: string; version: number }>;
  checkDevice: typeof import("./dashboardDevice.repository.js").checkDashboardDisplayDevice;
  dashboard: typeof import("./dashboard.repository.js").getDashboard;
  reportColumns?: typeof import("../queryDefinition/reportColumn.repository.js").listReportColumns;
};
export function createQueryDeviceRouter(service: ReturnType<typeof createQuerySourceExecution>, deps: QueryDeviceDependencies) {
  const router = Router();
  router.post(["/device/:id/page", "/device/:id/data-sources/:sourceKey/page"], async (req, res, next) => {
    try {
      const id = z.coerce.number().int().positive().safe().safeParse(req.params.id);
      if (!id.success) throw new QuerySourceError("VALIDATION_ERROR", 400);
      const mode = await deps.mode(id.data);
      if (mode.mode === "LEGACY") { next(); return; } // Only explicit persisted LEGACY may use the old handler.
      res.setHeader("Cache-Control", "no-store");
      const token = req.header("X-Dashboard-Device-Token") ?? "", ip = getClientIp(req) ?? "";
      const verified = await deps.checkDevice(id.data, token, ip);
      if (verified.status !== "VALID") throw new QuerySourceError("DASHBOARD_DEVICE_UNAUTHORIZED", 401);
      if (mode.mode !== "QUERY_ONLY") throw new QuerySourceError("QUERY_SOURCE_MODE_NOT_ACTIVATED");
      if (verified.device.queryModeGrantVersion !== mode.version || verified.device.delegatorTokenVersion !== verified.device.authorizationRevision)
        throw new QuerySourceError("DASHBOARD_DEVICE_UNAUTHORIZED", 401);
      const key = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/).safeParse(req.params.sourceKey ?? "PRIMARY");
      const input = z.object({ page: z.number().int().min(1).max(100000), snapshotId: z.string().uuid().optional() }).strict().safeParse(req.body);
      if (!input.success || !key.success) throw new QuerySourceError("VALIDATION_ERROR", 400);
      const dashboard = await deps.dashboard(id.data);
      if (!dashboard) throw new QuerySourceError("DASHBOARD_NOT_FOUND", 404);
      const subject = { userId: verified.device.createdByUserId, tokenVersion: verified.device.authorizationRevision,
        deviceId: verified.device.id, tokenHash: createHash("sha256").update(token).digest("hex"),
        verifyDevice: async () => {
          const current = await deps.checkDevice(id.data, token, ip), currentMode = await deps.mode(id.data);
          if (current.status !== "VALID" || currentMode.mode !== "QUERY_ONLY" || currentMode.version !== mode.version ||
            current.device.queryModeGrantVersion !== currentMode.version || current.device.delegatorTokenVersion !== current.device.authorizationRevision)
            throw new QuerySourceError("DASHBOARD_DEVICE_UNAUTHORIZED", 401);
          const { lastUsedAtUtc: _lastUsed, ...device } = current.device;
          return { deviceId: device.id, userId: device.createdByUserId, tokenVersion: device.authorizationRevision,
            fingerprint: createHash("sha256").update(JSON.stringify(device)).digest("hex") };
        } };
      const reports = key.data === "PRIMARY" && deps.reportColumns ? await deps.reportColumns(dashboard.queryDefinitionId) : [];
      const page = await service.page(id.data, key.data, subject, input.data);
      if (key.data === "PRIMARY") {
        const { parameters: _parameters, ...safeDashboard } = dashboard;
        const visible = new Set(page.result.columns.map(c => c.name.toUpperCase()));
        const reportColumns = reports.filter(c => visible.has(c.columnName.toUpperCase()));
        res.json({ ...page, dashboard: safeDashboard, reportColumns });
      } else res.json(page);
    } catch (error) { res.setHeader("Cache-Control", "no-store"); failure(error, res, req.id); }
  });
  return router;
}
