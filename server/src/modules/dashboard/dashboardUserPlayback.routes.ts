import { createHash } from "node:crypto";
import jwt from "jsonwebtoken";
import { Router } from "express";
import { z } from "zod";
import { requirePermission } from "../auth/auth.middleware.js";
import { QuerySourceError } from "./dashboardQuerySources.service.js";
import { failure } from "./dashboardQuerySources.routes.js";
import type { createQuerySourceExecution, ExecutionSubject } from "./dashboardQuerySourceExecution.js";
export type UserPlaybackDependencies = {
  mode: typeof import("./dashboardQueryMode.repository.js").readDashboardQueryMode;
  dashboard: typeof import("./dashboard.repository.js").getDashboard;
  layout: typeof import("./dashboardLayout.repository.js").getDashboardLayout;
  reportColumns?: typeof import("../queryDefinition/reportColumn.repository.js").listReportColumns;
};
export function createUserPlaybackRouter(service: ReturnType<typeof createQuerySourceExecution>, deps: UserPlaybackDependencies) {
  const router = Router(), id = z.coerce.number().int().positive().safe();
  router.use("/:id/playback/v1", (_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); }, requirePermission("VIEW_QUERY"), requirePermission("EXECUTE_QUERY"));
  const context = (req: import("express").Request) => {
    const parsed = id.safeParse(req.params.id), token = req.header("Authorization")?.slice(7) ?? "", payload = jwt.decode(token);
    if (!parsed.success) throw new QuerySourceError("VALIDATION_ERROR", 400);
    if (!payload || typeof payload === "string" || Number(payload.sub) !== req.authUser!.id || !Number.isSafeInteger(payload.tokenVersion) || payload.tokenVersion < 1 || !Number.isSafeInteger(payload.exp))
      throw new QuerySourceError("INVALID_TOKEN", 401);
    return { id: parsed.data, subject: { context: "user", expiresAt: Number(payload.exp), userId: req.authUser!.id, tokenVersion: Number(payload.tokenVersion),
      tokenHash: createHash("sha256").update(token).digest("hex") } satisfies ExecutionSubject };
  };
  const metadata = async (dashboardId: number) => {
    const row = await deps.dashboard(dashboardId);
    if (!row?.isActive) throw new QuerySourceError("QUERY_SOURCE_MODE_NOT_ACTIVATED");
    // Explicit allowlist: parameters and disclosure configuration never reach user playback.
    return { id: row.id, code: row.code, name: row.name, displayTitle: row.displayTitle,
      refreshSeconds: row.refreshSeconds, pageSeconds: row.pageSeconds, pageSize: row.pageSize,
      showClock: row.showClock, showPageNumber: row.showPageNumber, showCountdown: row.showCountdown, parameters: {} };
  };
  router.get("/:id/playback/v1", async (req, res) => {
    try {
      const c = context(req), mode = await deps.mode(c.id);
      if (mode.mode === "LEGACY") { res.json({ mode: "LEGACY" }); return; } // Only this explicit response permits the existing Legacy UI path.
      const before = await service.inspect(c.id, c.subject), dashboard = await metadata(c.id), layout = await deps.layout(c.id);
      if ((await service.inspect(c.id, c.subject)).fingerprint !== before.fingerprint) throw new QuerySourceError("DASHBOARD_SNAPSHOT_EXPIRED");
      res.json({ mode: "QUERY_ONLY", securityVersion: before.fingerprint, authorizationExpiresAt: c.subject.expiresAt * 1000, dashboard, profiles: layout.profiles });
    } catch (error) { failure(error, res, req.id); }
  });
  router.post("/:id/playback/v1/:sourceKey/page", async (req, res) => {
    try {
      const c = context(req), key = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/).safeParse(req.params.sourceKey);
      const input = z.object({ page: z.number().int().min(1).max(100000), snapshotId: z.string().uuid().optional() }).strict().safeParse(req.body);
      if (!key.success || !input.success) throw new QuerySourceError("VALIDATION_ERROR", 400);
      const before = await service.inspect(c.id, c.subject), dashboard = key.data === "PRIMARY" ? await metadata(c.id) : null;
      const page = await service.page(c.id, key.data, c.subject, input.data);
      const visible = new Set(page.result.columns.map(c => c.name.toUpperCase()));
      const reports = dashboard && deps.reportColumns ? (await deps.reportColumns(page.query.id)).filter(c => visible.has(c.columnName.toUpperCase())) : [];
      // Metadata/layout callers and page callers use the same complete user security fingerprint.
      if ((await service.inspect(c.id, c.subject)).fingerprint !== before.fingerprint) throw new QuerySourceError("DASHBOARD_SNAPSHOT_EXPIRED");
      res.json({ ...page, ...(dashboard ? { dashboard, reportColumns: reports } : {}) });
    } catch (error) { failure(error, res, req.id); }
  });
  return router;
}
