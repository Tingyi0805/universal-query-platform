import { createHash, randomBytes } from "node:crypto";
import { createQueryDelivery, QueryDeliveryError } from "../queryDefinition/queryDelivery.js";
import { runtimeParameterDefinitions } from "../dataset/parameterSync.js";
import { listDatasetParameters } from "../dataset/parameter.repository.js";
import { dashboardQueryParameters } from "./dashboardDeviceMasking.js";
import { getDashboard } from "./dashboard.repository.js";
import { getDashboardLayout } from "./dashboardLayout.repository.js";
import { startAudit, completeAuditFailure } from "../audit/audit.repository.js";
import { finalizeDeliveryAudit } from "../audit/deliveryAudit.repository.js";
import { parseDrillGraph, typedDrillValue, type DrillGraph } from "./dashboardDrilldown.schema.js";
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype)
    return Object.fromEntries(Object.entries(value).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => [k,canonical(v)]));
  return value;
}
const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(canonical(v))).digest("hex");
const opaque = () => randomBytes(32).toString("base64url");
export const drilldownDependencies = {
  delivery: createQueryDelivery(), parameters: listDatasetParameters,
  load: async (id: number, profileId: number) => {
    const dashboard = await getDashboard(id);
    const layout = await getDashboardLayout(id, true);
    const profile = layout.profiles.find(p => p.id === profileId);
    if (!dashboard?.isActive || !profile) throw new QueryDeliveryError("DRILL_NOT_AVAILABLE", 404);
    return { revision: hash([dashboard, layout]), rootQueryId: dashboard.queryDefinitionId, graph: profile.config.interactiveDrilldown, rootValues: dashboardQueryParameters(dashboard.parameters) };
  }, startAudit, finalizeDeliveryAudit, completeAuditFailure,
  enabled: () => process.env.DASHBOARD_DRILLDOWN_CONTEXT_MODE === "SINGLE_PROCESS"
    && !process.env.NODE_UNIQUE_ID && !process.env.pm_id && (!process.env.WEB_CONCURRENCY || process.env.WEB_CONCURRENCY === "1"),
  now: Date.now,
};
type Identity = Parameters<ReturnType<typeof createQueryDelivery>["open"]>[2];
type Open = Awaited<ReturnType<ReturnType<typeof createQueryDelivery>["open"]>>;
type Frame = { node: string; values: Record<string, unknown> };
type Context = { owner: string; dashboard: number; profile: number; revision: string; graph: DrillGraph;
  expires: number; evidence: string; stack: Frame[]; rows: Map<string, Record<string, unknown>>; busy: boolean; bytes: number };
/** Process local ONLY. No sticky routing or cross-worker consistency is claimed. */
export function createDrilldownService(deps = drilldownDependencies) {
  const contexts = new Map<string, Context>();
  function sweep() { for (const [id,c] of contexts) if (c.expires <= deps.now()) contexts.delete(id); }
  const expiryTimer = setInterval(sweep, 10_000);
  expiryTimer.unref();
  function enabled() { if (!deps.enabled()) throw new QueryDeliveryError("DRILL_SINGLE_PROCESS_REQUIRED", 503); sweep(); }
  async function inspect(graph: DrillGraph, identity: Identity) {
    const opened = new Map<string, Open>();
    const definitions = new Map<string, Awaited<ReturnType<typeof deps.parameters>>>();
    for (const n of graph.nodes) {
      const c = await deps.delivery.open(n.queryId, "EXECUTE", identity);
      opened.set(n.id, c);
      definitions.set(n.id, runtimeParameterDefinitions(c.dataset.sqlText, await deps.parameters(c.query.datasetId)));
    }
    for (const e of graph.edges) {
      const parent = opened.get(e.from)!;
      for (const field of [...e.bindings.map(b => b.field), ...(e.column ? [e.column] : [])])
        if (!parent.snapshot.policy.rules.some(r => r.columnName === field && r.mode === "NONE"))
          throw new QueryDeliveryError("DRILL_MASKED_BINDING_FORBIDDEN", 403);
      const params = definitions.get(e.to)!;
      if (params.some(p => !e.bindings.some(b => b.parameter === p.name)) || e.bindings.some(b => !params.some(p => p.name === b.parameter && p.dataType === b.type && p.controlType !== "MULTISELECT")))
        throw new QueryDeliveryError("DRILL_PARAMETERS_INVALID", 400);
    }
    return { opened, evidence: hash([...opened].map(([id,c]) => [id,c.fingerprint,definitions.get(id)])) };
  }
  async function validate(graph: unknown, identity: Identity) { const g = parseDrillGraph(graph); await inspect(g, identity); return g; }
  async function check(c: Context, identity: Identity) {
    enabled();
    if (c.expires <= deps.now()) throw new QueryDeliveryError("DRILL_CONTEXT_EXPIRED", 410);
    const saved = await deps.load(c.dashboard, c.profile);
    if (saved.revision !== c.revision || hash(saved.graph) !== hash(c.graph)) throw new QueryDeliveryError("DRILL_CONFIGURATION_CHANGED");
    const state = await inspect(c.graph, identity);
    if (state.evidence !== c.evidence) throw new QueryDeliveryError("DRILL_AUTHORIZATION_CHANGED", 403);
    return state;
  }
  async function deliver(id: string, c: Context, stack: Frame[], identity: Identity, meta: { ipAddress: string | null; userAgent: string | null }) {
    let auditId: number | null = null;
    const started = deps.now();
    try {
      const state = await check(c, identity), frame = stack.at(-1)!, query = state.opened.get(frame.node)!;
      auditId = await deps.startAudit({ eventType: "QUERY_EXECUTE", userId: query.actor.userId, queryDefinitionId: query.query.id,
        datasetId: query.query.datasetId, parameters: null, ...meta });
      if (!auditId || !Number.isSafeInteger(auditId) || auditId <= 0) throw new QueryDeliveryError("QUERY_AUDIT_REQUIRED", 503);
      const output = await deps.delivery.execute(query, frame.values);
      if (output.result.rows.length > 1000) throw new QueryDeliveryError("DRILL_RESULT_LIMIT", 413);
      const rows = new Map<string, Record<string, unknown>>();
      const fields = new Set(c.graph.edges.filter(e => e.from === frame.node).flatMap(e => e.bindings.map(b => b.field)));
      const rowRefs = output.result.rows.map(row => {
        const ref = opaque(), values: Record<string, unknown> = Object.create(null);
        for (const field of fields) {
          if (!Object.hasOwn(row,field)) throw new QueryDeliveryError("DRILL_SOURCE_FIELD_MISSING");
          values[field] = row[field];
        }
        rows.set(ref, values); return ref;
      });
      const bytes = Buffer.byteLength(JSON.stringify([stack,[...rows]]));
      if (bytes > 2_000_000 || [...contexts.values()].reduce((n,v) => n+v.bytes,bytes) > 20_000_000)
        throw new QueryDeliveryError("DRILL_CONTEXT_CAPACITY", 503);
      const revalidate = async (tx?: import("mssql").Transaction) => {
        for (const open of state.opened.values()) await open.revalidate(tx);
        await check(c,identity);
        if (contexts.get(id) !== c) throw new QueryDeliveryError("DRILL_CONTEXT_EXPIRED", 410); };
      await deps.finalizeDeliveryAudit(auditId, {rowCount: output.result.rowCount, durationMs: deps.now()-started}, revalidate);
      await revalidate();
      c.stack = stack; c.rows = rows; c.bytes = bytes;
      return { contextId: id, expiresAtUtc: new Date(c.expires).toISOString(), depth: stack.length,
        node: frame.node, result: output.result, reportColumns: output.reportColumns, disclosureId: output.disclosureId,
        rowRefs, actions: c.graph.edges.filter(e => e.from === frame.node).map(({id,trigger,column,display}) => ({id,trigger,column,display})) };
    } catch(error) {
      contexts.delete(id);
      if (auditId) await deps.completeAuditFailure(auditId, { errorCode: "DRILL_DELIVERY_REJECTED" }).catch(() => undefined);
      throw error;
    }
  }
  return { validate,
    async create(dashboard: number, profile: number, owner: string, identity: Identity, meta: { ipAddress: string | null; userAgent: string | null }) {
      enabled(); if (contexts.size >= 100) throw new QueryDeliveryError("DRILL_CONTEXT_CAPACITY", 503);
      const saved = await deps.load(dashboard,profile), graph = parseDrillGraph(saved.graph);
      if (graph.nodes.find(n => n.id === graph.root)!.queryId !== saved.rootQueryId) throw new QueryDeliveryError("DRILL_ROOT_QUERY_MISMATCH");
      const state = await inspect(graph,identity);
      // Reserve before awaits; concurrent creates cannot exceed the capacity.
      if (contexts.size >= 100) throw new QueryDeliveryError("DRILL_CONTEXT_CAPACITY", 503);
      const id = opaque(), c: Context = {owner,dashboard,profile,revision:saved.revision,graph,evidence:state.evidence,
        expires:deps.now()+120_000,stack:[],rows:new Map(),busy:true,bytes:0};
      contexts.set(id,c);
      try { return await deliver(id,c,[{node:graph.root,values:saved.rootValues}],identity,meta); } finally { c.busy=false; }
    },
    async act(dashboard: number, id: string, owner: string, identity: Identity, action: {kind: "DELETE" | "BACK" | "NAVIGATE"; edge?: string; rowRef?: string}, meta: { ipAddress: string | null; userAgent: string | null }) {
      enabled(); const c = contexts.get(id);
      if (!c || c.owner !== owner || c.dashboard !== dashboard) throw new QueryDeliveryError("DRILL_CONTEXT_NOT_FOUND", 404);
      // DELETE tombstones even an in-flight operation. No response can resurrect it.
      if (action.kind === "DELETE") { await identity(); contexts.delete(id); return {status:"OK"}; }
      if (c.busy) throw new QueryDeliveryError("DRILL_CONTEXT_BUSY");
      c.busy=true;
      try {
        await check(c,identity);
        let stack = c.stack.slice();
        if (action.kind === "BACK") { if (stack.length <= 1) throw new QueryDeliveryError("DRILL_NO_PARENT",400); stack.pop(); }
        else {
          const edge = c.graph.edges.find(e => e.id === action.edge && e.from === stack.at(-1)!.node), row = c.rows.get(action.rowRef ?? "");
          if (!edge || !row) throw new QueryDeliveryError("DRILL_ROW_REFERENCE_INVALID",403);
          const values: Record<string, unknown> = Object.create(null);
          for (const b of edge.bindings) values[b.parameter] = typedDrillValue(row[b.field],b.type);
          stack.push({node:edge.to,values});
        }
        return await deliver(id,c,stack,identity,meta);
      } catch(error) { contexts.delete(id); throw error; } finally { c.busy=false; }
    },
  };
}
