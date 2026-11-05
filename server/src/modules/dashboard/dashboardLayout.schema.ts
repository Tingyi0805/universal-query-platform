import { z } from "zod";
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

export const layoutSchema = z.object({
  profiles: z.array(profileSchema).min(1).max(20),
});
