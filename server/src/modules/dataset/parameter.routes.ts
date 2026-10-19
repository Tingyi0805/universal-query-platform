import { Router } from "express";
import { z } from "zod";
import { getDataset } from "./dataset.repository.js";
import { listDatasetParameters, syncDatasetParameters } from "./parameter.repository.js";
import { parameterPreview } from "./parameterSync.js";
import { withErrorModule } from "../../middleware/safeErrorDiagnostic.js";

const idSchema = z.coerce.number().int().positive().safe();
const syncSchema = z.object({ previewToken: z.string().regex(/^[a-f0-9]{64}$/),
  removeNames: z.array(z.string().regex(/^[A-Z][A-Z0-9_]{0,99}$/)).max(100).default([]) });
export function createDatasetParameterRouter(deps = { getDataset, listDatasetParameters, syncDatasetParameters }) {
  const router = Router();
  router.get("/:id/parameters", async (req, res, next) => {
    try {
      await withErrorModule("dataset.parameters.read", async () => {
        const id = idSchema.safeParse(req.params.id);
        if (!id.success) { res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Dataset ID 不正確。", requestId: req.id } }); return; }
        const dataset = await deps.getDataset(id.data);
        if (!dataset) { res.status(404).json({ error: { code: "DATASET_NOT_FOUND", message: "找不到 Dataset。", requestId: req.id } }); return; }
        const parameters = await deps.listDatasetParameters(id.data);
        res.setHeader("Cache-Control", "no-store");
        res.json({ parameters, preview: parameterPreview(id.data, dataset.sqlText, parameters) });
      });
    } catch (error) { next(error); }
  });
  router.post("/:id/parameters/sync", async (req, res, next) => {
    try {
      await withErrorModule("dataset.parameters.sync", async () => {
        const id = idSchema.safeParse(req.params.id);
        const body = syncSchema.safeParse(req.body);
        if (!id.success || !body.success) { res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "請先取得同步差異預覽。", requestId: req.id } }); return; }
        await deps.syncDatasetParameters(id.data, body.data.previewToken, body.data.removeNames, req.authUser!.id);
        res.json({ status: "OK" });
      });
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      if (["DATASET_NOT_FOUND", "DATASET_ARCHIVED", "PARAMETER_PREVIEW_STALE", "PARAMETER_PARSE_FAILED", "PARAMETER_REMOVAL_INVALID", "PARAMETER_SYNC_LIMIT"].includes(code)) {
        res.status(code === "DATASET_NOT_FOUND" ? 404 : 409).json({ error: { code,
          message: code === "PARAMETER_SYNC_LIMIT" ? "同步後的參數數量或排序超出限制；請先檢視既有設定。" : "同步未套用；請重新載入差異。解析失敗或未偵測到參數時不允許移除設定。", requestId: req.id } }); return;
      }
      next(error);
    }
  });
  return router;
}
