import { Router } from "express";
import { z } from "zod";
import { authenticateJwt, requirePermission } from "../auth/auth.middleware.js";
import {
  createQueryCategory,
  deleteQueryCategory,
  getQueryCategoryDeleteImpact,
  listQueryCategories,
  updateQueryCategory,
} from "./queryCategory.repository.js";

const idSchema = z.coerce.number().int().positive();
const inputSchema = z.object({
  code: z.string().trim().min(2).max(100).regex(/^[A-Z0-9_]+$/),
  name: z.string().trim().min(1).max(100),
  sortOrder: z.coerce.number().int().min(-10000).max(10000).default(0),
  isActive: z.boolean().default(true),
});

export const queryCategoryRouter = Router();
queryCategoryRouter.use(authenticateJwt, requirePermission("DESIGN_QUERY"));

queryCategoryRouter.get("/", async (_req, res, next) => {
  try {
    res.json({ categories: await listQueryCategories() });
  } catch (error) {
    next(error);
  }
});

queryCategoryRouter.post("/", async (req, res, next) => {
  try {
    const parsed = inputSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "分類資料格式不正確。" } });
      return;
    }
    const id = await createQueryCategory(parsed.data);
    res.status(201).json({ id });
  } catch (error) {
    const number = (error as { number?: number })?.number;
    if (number === 2627 || number === 2601) {
      res.status(409).json({ error: { code: "QUERY_CATEGORY_EXISTS", message: "分類代碼或名稱已存在。" } });
      return;
    }
    next(error);
  }
});

queryCategoryRouter.put("/:id", async (req, res, next) => {
  try {
    const id = idSchema.safeParse(req.params.id);
    const parsed = inputSchema.safeParse(req.body);
    if (!id.success || !parsed.success) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "分類資料格式不正確。" } });
      return;
    }
    await updateQueryCategory(id.data, parsed.data);
    res.json({ status: "OK" });
  } catch (error) {
    if (error instanceof Error && error.message === "QUERY_CATEGORY_NOT_FOUND") {
      res.status(404).json({ error: { code: error.message, message: "找不到分類。" } });
      return;
    }
    const number = (error as { number?: number })?.number;
    if (number === 2627 || number === 2601) {
      res.status(409).json({ error: { code: "QUERY_CATEGORY_EXISTS", message: "分類代碼或名稱已存在。" } });
      return;
    }
    next(error);
  }
});

queryCategoryRouter.get("/:id/delete-impact", async (req, res, next) => {
  try {
    const id = idSchema.safeParse(req.params.id);
    if (!id.success) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "分類 ID 不正確。" } });
      return;
    }
    res.json(await getQueryCategoryDeleteImpact(id.data));
  } catch (error) {
    if (error instanceof Error && error.message === "QUERY_CATEGORY_NOT_FOUND") {
      res.status(404).json({ error: { code: error.message, message: "找不到分類。" } });
      return;
    }
    next(error);
  }
});

queryCategoryRouter.delete("/:id", async (req, res, next) => {
  try {
    const id = idSchema.safeParse(req.params.id);
    if (!id.success) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "分類 ID 不正確。" } });
      return;
    }
    await deleteQueryCategory(id.data);
    res.json({ status: "OK" });
  } catch (error) {
    if (error instanceof Error && error.message === "QUERY_CATEGORY_IN_USE") {
      res.status(409).json({
        error: {
          code: error.message,
          message: "此分類仍有 Query 使用，請先將 Query 移到其他分類後再刪除。",
        },
      });
      return;
    }
    if (error instanceof Error && error.message === "QUERY_CATEGORY_NOT_FOUND") {
      res.status(404).json({ error: { code: error.message, message: "找不到分類。" } });
      return;
    }
    next(error);
  }
});
