import { z } from "zod";
export const supplementalSourceSchema = z.object({
  sourceKey: z.string().trim().min(1).max(64).regex(/^[A-Za-z][A-Za-z0-9_]*$/)
    .refine(key => key.toUpperCase() !== "PRIMARY", "PRIMARY 為保留的主要查詢代碼"),
  datasetId: z.number().int().positive(),
  refreshSeconds: z.number().int().min(5).max(3600).default(30),
  pageSize: z.number().int().min(1).max(100).default(10),
  pageSeconds: z.number().int().min(5).max(3600).default(15),
  parameters: z.record(z.unknown()).default({}),
  isEnabled: z.boolean().default(true),
});
export const dashboardSourcesSchema = z.object({ sources: z.array(supplementalSourceSchema).max(8) }).refine(value => {
  const keys = value.sources.map(source => source.sourceKey.toUpperCase());
  return new Set(keys).size === keys.length;
}, "同一看板的資料來源代碼不可重複");
