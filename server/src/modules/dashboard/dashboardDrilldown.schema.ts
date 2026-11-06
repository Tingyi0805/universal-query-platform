import { z } from "zod";
import { QueryDeliveryError } from "../queryDefinition/queryDelivery.js";
const key = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/);
export const drillGraphSchema = z.object({
  version: z.literal(1), root: key,
  nodes: z.array(z.object({ id: key, queryId: z.number().int().positive().safe() }).strict()).min(1).max(32),
  edges: z.array(z.object({ id: key, from: key, to: key,
    trigger: z.enum(["ROW", "COLUMN"]), column: z.string().min(1).max(256).optional(),
    display: z.enum(["PAGE", "PANEL", "MODAL"]),
    bindings: z.array(z.object({ field: z.string().min(1).max(256), parameter: z.string().regex(/^[A-Z][A-Z0-9_]{0,99}$/),
      type: z.enum(["STRING", "NUMBER", "BOOLEAN", "DATE", "DATETIME"]) }).strict()).max(100),
  }).strict()).max(64),
}).strict();
export type DrillGraph = z.infer<typeof drillGraphSchema>;
export function parseDrillGraph(value: unknown): DrillGraph {
  const parsed = drillGraphSchema.safeParse(value);
  if (!parsed.success) throw new QueryDeliveryError("DRILL_GRAPH_INVALID", 400);
  const g = parsed.data, nodes = new Set(g.nodes.map(n => n.id));
  if (nodes.size !== g.nodes.length || !nodes.has(g.root) || new Set(g.edges.map(e => e.id)).size !== g.edges.length)
    throw new QueryDeliveryError("DRILL_GRAPH_INVALID", 400);
  for (const e of g.edges) if (!nodes.has(e.from) || !nodes.has(e.to) || (e.trigger === "COLUMN") !== (e.column !== undefined)
    || new Set(e.bindings.map(b => b.parameter)).size !== e.bindings.length)
    throw new QueryDeliveryError("DRILL_GRAPH_INVALID", 400);
  const visited = new Set<string>();
  function walk(id: string, path: string[]) {
    if (path.includes(id) || path.length >= 5) throw new QueryDeliveryError("DRILL_GRAPH_CYCLE_OR_DEPTH", 400);
    visited.add(id);
    for (const e of g.edges.filter(e => e.from === id)) walk(e.to, [...path, id]);
  }
  walk(g.root, []);
  if (visited.size !== nodes.size) throw new QueryDeliveryError("DRILL_GRAPH_UNREACHABLE", 400);
  return g;
}
/** No coercion of masked, ambiguous or user supplied values into trusted keys. */
export function typedDrillValue(value: unknown, type: string): string | number | boolean {
  if ((type === "DATE" || type === "DATETIME") && value instanceof Date && Number.isFinite(+value))
    value = type === "DATE" ? value.toISOString().slice(0,10) : value.toISOString();
  if (type === "STRING" && typeof value === "string" && value.length <= 4000) return value;
  if (type === "NUMBER" && typeof value === "number" && Number.isFinite(value)) return value;
  if (type === "BOOLEAN" && typeof value === "boolean") return value;
  if ((type === "DATE" || type === "DATETIME") && typeof value === "string") {
    const pattern = type === "DATE" ? /^\d{4}-\d{2}-\d{2}$/ : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
    const d = new Date(type === "DATE" ? value + "T00:00:00Z" : value);
    if (pattern.test(value) && Number.isFinite(+d) && d.toISOString().slice(0,10) === value.slice(0,10)) return value;
  }
  throw new QueryDeliveryError("DRILL_BINDING_TYPE_INVALID", 400);
}
