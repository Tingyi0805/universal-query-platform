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
  return router;
}
export function failure(error: unknown, res: import("express").Response, requestId?: unknown) {
  // No raw database/parameter text in responses or logs. Existing middleware keeps Request ID.
  const known = error instanceof QuerySourceError;
  res.status(known ? error.status : 503).json({ error: {
    requestId,
    code: known ? error.code : "QUERY_SOURCE_STORAGE_UNAVAILABLE",
    message: "資料來源管理要求未完成，請依錯誤分類確認設定或權限。",
  } });
}
