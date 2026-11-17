import {z} from "zod";
import {QueryDeliveryError} from "./queryDelivery.js";
const key=z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,39}$/);
const field=z.string().regex(/^[\p{L}_][\p{L}\p{N}_ ]{0,127}$/u);
export const hierarchyGraphSchema=z.object({version:z.literal(1),root:key,
 nodes:z.array(z.object({id:key,queryId:z.number().int().positive().safe(),layout:z.enum(["TABLE","CARDS"]),
  pageSize:z.number().int().min(1).max(100),orderBy:z.array(field).min(1).max(8)}).strict()).min(1).max(32),
 edges:z.array(z.object({id:key,from:key,to:key,label:z.string().trim().min(1).max(80),trigger:z.enum(["ROW","COLUMN","MORE"]),
  column:field.optional(),display:z.enum(["PAGE","PANEL","MODAL"]),
  bindings:z.array(z.object({field,parameter:z.string().regex(/^[A-Z][A-Z0-9_]{0,99}$/),type:z.enum(["STRING","NUMBER","BOOLEAN","DATE","DATETIME"])}).strict()).max(100)
 }).strict()).max(64)}).strict();
export type HierarchyGraph=z.infer<typeof hierarchyGraphSchema>;
export function parseHierarchyGraph(value:unknown):HierarchyGraph{
 const p=hierarchyGraphSchema.safeParse(value);if(!p.success)throw new QueryDeliveryError("HIERARCHY_GRAPH_INVALID",400);
 const g=p.data,names=new Set(g.nodes.map(n=>n.id));
 if(names.size!==g.nodes.length||!names.has(g.root)||new Set(g.edges.map(e=>e.id)).size!==g.edges.length)throw new QueryDeliveryError("HIERARCHY_GRAPH_INVALID",400);
 for(const n of g.nodes)if(new Set(n.orderBy).size!==n.orderBy.length)throw new QueryDeliveryError("HIERARCHY_GRAPH_INVALID",400);
 for(const e of g.edges)if(!names.has(e.from)||!names.has(e.to)||(e.trigger==="COLUMN")!==(e.column!==undefined)||new Set(e.bindings.map(b=>b.parameter)).size!==e.bindings.length)
  throw new QueryDeliveryError("HIERARCHY_GRAPH_INVALID",400);
 const seen=new Set<string>();let walks=0;
 function walk(n:string,path:string[]){if(++walks>512||path.includes(n)||path.length>=5)throw new QueryDeliveryError("HIERARCHY_GRAPH_CYCLE_OR_BUDGET",400);
  seen.add(n);for(const e of g.edges.filter(e=>e.from===n))walk(e.to,[...path,n]);}
 walk(g.root,[]);if(seen.size!==names.size)throw new QueryDeliveryError("HIERARCHY_GRAPH_UNREACHABLE",400);
 // At most one whole-row default; column and MORE actions remain explicit.
 for(const n of g.nodes)if(g.edges.filter(e=>e.from===n.id&&e.trigger==="ROW").length>1||new Set(g.edges.filter(e=>e.from===n.id&&e.trigger==="COLUMN").map(e=>e.column)).size!==g.edges.filter(e=>e.from===n.id&&e.trigger==="COLUMN").length)throw new QueryDeliveryError("HIERARCHY_GRAPH_INVALID",400);
 return g;
}
export const hierarchyPageSchema=z.object({page:z.number().int().min(1).max(1000000).default(1),
 search:z.object({column:z.string().regex(/^c[0-9]{1,3}$/),text:z.string().max(200)}).strict().nullable().default(null),
 sort:z.object({column:z.string().regex(/^c[0-9]{1,3}$/),direction:z.enum(["ASC","DESC"])}).strict().nullable().default(null)}).strict();
export type HierarchyPage=z.infer<typeof hierarchyPageSchema>;
