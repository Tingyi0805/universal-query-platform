import { Router } from "express";
import { z } from "zod";
import { authenticateJwt, requirePermission } from "../auth/auth.middleware.js";
import { executeSavedDataset, getParameterOptions } from "../dataset/dataset.service.js";
import { listDatasetParameters } from "../dataset/parameter.repository.js";
import {
  getEffectiveQueryAccess,
  listAccessibleQueries,
} from "./queryDefinition.repository.js";

const idSchema = z.coerce.number().int().positive();

export const queryRuntimeRouter = Router();
queryRuntimeRouter.use(authenticateJwt);

queryRuntimeRouter.get("/", requirePermission("VIEW_QUERY"), async (req, res, next) => {
  try {
    res.json({ queries: await listAccessibleQueries(req.authUser!.id) });
  } catch (error) { next(error); }
});

queryRuntimeRouter.get("/:id", requirePermission("VIEW_QUERY"), async (req, res, next) => {
  try {
    const id = idSchema.safeParse(req.params.id);
    if (!id.success) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Query ID 不正確。" } });
      return;
    }

    const query = await getEffectiveQueryAccess(req.authUser!.id, id.data);
    if (!query?.canView) {
      res.status(404).json({ error: { code: "QUERY_NOT_FOUND", message: "找不到可使用的查詢。" } });
      return;
    }

    const parameters = await listDatasetParameters(query.datasetId);
    res.json({
      query,
      parameters: parameters.map((parameter) => ({
        name: parameter.name,
        label: parameter.label,
        dataType: parameter.dataType,
        controlType: parameter.controlType,
        isRequired: parameter.isRequired,
        defaultValue: parameter.defaultValue,
        displayOrder: parameter.displayOrder,
        placeholder: parameter.placeholder,
        helpText: parameter.helpText,
        optionMode: parameter.optionMode,
      })),
    });
  } catch (error) { next(error); }
});

queryRuntimeRouter.get("/:id/parameters/:name/options", requirePermission("VIEW_QUERY"), async (req, res, next) => {
  try {
    const id = idSchema.safeParse(req.params.id);
    const name = z.string().regex(/^[A-Z][A-Z0-9_]*$/).safeParse(req.params.name);
    if (!id.success || !name.success) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "參數識別資料不正確。" } });
      return;
    }

    const query = await getEffectiveQueryAccess(req.authUser!.id, id.data);
    if (!query?.canView) {
      res.status(404).json({ error: { code: "QUERY_NOT_FOUND", message: "找不到可使用的查詢。" } });
      return;
    }

    res.json({ options: await getParameterOptions(query.datasetId, name.data) });
  } catch (error) { next(error); }
});

queryRuntimeRouter.post("/:id/execute", requirePermission("EXECUTE_QUERY"), async (req, res, next) => {
  try {
    const id = idSchema.safeParse(req.params.id);
    const body = z.object({
      values: z.record(z.unknown()).default({}),
    }).safeParse(req.body);

    if (!id.success || !body.success) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "查詢參數格式不正確。" } });
      return;
    }

    const query = await getEffectiveQueryAccess(req.authUser!.id, id.data);
    if (!query?.canExecute) {
      res.status(403).json({ error: { code: "QUERY_EXECUTE_FORBIDDEN", message: "沒有執行此查詢的權限。" } });
      return;
    }

    res.json({ result: await executeSavedDataset(query.datasetId, body.data.values) });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("PARAMETER_REQUIRED:")) {
      const name = error.message.split(":")[1];
      res.status(400).json({ error: { code: "PARAMETER_REQUIRED", message: `參數 ${name} 為必填。` } });
      return;
    }
    if (error instanceof Error && error.message.startsWith("PARAMETER_")) {
      res.status(400).json({ error: { code: error.message.split(":")[0], message: "查詢參數格式不正確。" } });
      return;
    }
    next(error);
  }
});
