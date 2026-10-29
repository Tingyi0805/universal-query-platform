import { z } from "zod";

const key = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/).refine(k => k.toUpperCase() !== "PRIMARY");
const identity = { sourceKey: key, id: z.number().int().positive().safe().nullable() };
export const querySourcePatchSchema = z.object({
  expectedVersion: z.string().regex(/^[a-f0-9]{64}$/),
  upserts: z.array(z.object({
    ...identity,
    queryDefinitionId: z.number().int().positive().safe(),
    refreshSeconds: z.number().int().min(5).max(3600),
    pageSize: z.number().int().min(1).max(100),
    pageSeconds: z.number().int().min(5).max(3600),
    maxRows: z.number().int().min(1).max(10000),
    parameters: z.record(z.string(), z.unknown()),
    isEnabled: z.boolean(),
  }).strict()).max(7),
  removals: z.array(z.object({ sourceKey: key, id: z.number().int().positive().safe() }).strict()).max(8),
}).strict().refine(value => {
  const keys = [...value.upserts, ...value.removals].map(s => s.sourceKey.toUpperCase());
  return keys.length > 0 && new Set(keys).size === keys.length;
});
export type QuerySourcePatch = z.infer<typeof querySourcePatchSchema>;
