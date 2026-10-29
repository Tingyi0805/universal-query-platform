import { DashboardApprovalError } from "./dashboardApproval.service.js";
import { layoutSchema } from "./dashboardLayout.schema.js";
import { Router } from "express";
import { z } from "zod";
import { requirePermission } from "../auth/auth.middleware.js";
import { querySourcePatchSchema } from "./dashboardQuerySources.schema.js";
import { QuerySourceError, type createQuerySourceManagement } from "./dashboardQuerySources.service.js";

export function createQuerySourceRouter(service: ReturnType<typeof createQuerySourceManagement>) {
  const router = Router();
  const id = z.coerce.number().int().positive().safe();
  router.use("/:id/query-sources/v1", requirePermission("DESIGN_QUERY")); // Mounted after existing JWT/TokenVersion authentication.
  router.use("/:id/query-sources/v1", (_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
  router.get("/:id/query-sources/v1", async (req, res) => {
    try {
      const parsed = id.safeParse(req.params.id);
      if (!parsed.success) throw new QuerySourceError("VALIDATION_ERROR", 400);
      res.json(await service.read(parsed.data, req.authUser!.id));
    } catch (error) { failure(error, res, req.id); }
  });
  router.patch("/:id/query-sources/v1", async (req, res) => {
    try {
      const parsedId = id.safeParse(req.params.id), input = querySourcePatchSchema.safeParse(req.body);
      if (!parsedId.success || !input.success) throw new QuerySourceError("VALIDATION_ERROR", 400);
      res.json(await service.patch(parsedId.data, req.authUser!.id, input.data));
    } catch (error) { failure(error, res, req.id); }
  });
  router.get("/:id/query-sources/v1/configuration", async (req, res) => {
    try {
      const parsed = id.safeParse(req.params.id);
      if (!parsed.success) throw new QuerySourceError("VALIDATION_ERROR", 400);
      res.json(await service.configuration(parsed.data, req.authUser!.id));
    } catch (error) { failure(error, res, req.id); }
  });
  router.patch("/:id/query-sources/v1/disclosure", async (req, res) => {
    try {
      const parsed = id.safeParse(req.params.id);
      const input = z.object({ expectedVersion: z.string().regex(/^[a-f0-9]{64}$/),
        sourceKey: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/), masks: z.record(z.string(), z.unknown()) }).strict().safeParse(req.body);
      if (!parsed.success || !input.success) throw new QuerySourceError("VALIDATION_ERROR", 400);
      res.json(await service.disclosure(parsed.data, req.authUser!.id, input.data));
    } catch (error) { failure(error, res, req.id); }
  });
  router.patch("/:id/query-sources/v1/presentation", async (req, res) => {
    try {
      const parsed = id.safeParse(req.params.id);
      const input = z.object({
        expectedVersion: z.string().regex(/^[a-f0-9]{64}$/),
        name: z.string().trim().min(1).max(200),
        description: z.string().trim().max(1000).nullable(),
        displayMode: z.enum(["TABLE", "BIG_SCREEN"]),
        displayTitle: z.string().trim().max(200).nullable(),
        showClock: z.boolean(),
        showPageNumber: z.boolean(),
        showCountdown: z.boolean(),
      }).strict().safeParse(req.body);
      if (!parsed.success || !input.success) throw new QuerySourceError("VALIDATION_ERROR", 400);
      res.json(await service.presentation(parsed.data, req.authUser!.id, input.data));
    } catch (error) { failure(error, res, req.id); }
  });
  router.patch("/:id/query-sources/v1/primary", async (req, res) => {
    try {
      const parsed = id.safeParse(req.params.id);
      const input = z.object({ expectedVersion: z.string().regex(/^[a-f0-9]{64}$/),
        queryDefinitionId: z.number().int().positive().safe(), parameters: z.record(z.string(), z.unknown()),
        refreshSeconds: z.number().int().min(5).max(3600), pageSize: z.number().int().min(1).max(100),
        pageSeconds: z.number().int().min(5).max(3600), maxRows: z.number().int().min(1).max(10000) }).strict().safeParse(req.body);
      if (!parsed.success || !input.success) throw new QuerySourceError("VALIDATION_ERROR", 400);
      res.json(await service.primary(parsed.data, req.authUser!.id, input.data));
    } catch (error) { failure(error, res, req.id); }
  });
  router.put("/:id/query-sources/v1/layout", async (req, res) => {
    try {
      const parsed = id.safeParse(req.params.id);
      const input = layoutSchema.extend({ expectedVersion: z.string().regex(/^[a-f0-9]{64}$/) }).strict().safeParse(req.body);
      if (!parsed.success || !input.success) throw new QuerySourceError("VALIDATION_ERROR", 400);
      res.json(await service.layout(parsed.data, req.authUser!.id, input.data));
    } catch (error) { failure(error, res, req.id); }
  });
  return router;
}
export function failure(error: unknown, res: import("express").Response, requestId?: unknown) {
  // No raw database/parameter text in responses or logs. Existing middleware keeps Request ID.
  const known = error instanceof QuerySourceError || error instanceof DashboardApprovalError;
  res.status(known ? error.status : 503).json({ error: {
    requestId,
    code: known ? error.code : "QUERY_SOURCE_STORAGE_UNAVAILABLE",
    message: "資料來源管理要求未完成，請依錯誤分類確認設定或權限。",
  } });
}
