export type DrillGraph = { version:1; root:string; nodes:{id:string;queryId:number}[]; edges:{id:string;from:string;to:string;trigger:"ROW"|"COLUMN";column?:string;display:"PAGE"|"PANEL"|"MODAL";bindings:{field:string;parameter:string;type:string}[]}[] };
export type DrillPage = {contextId:string;expiresAtUtc:string;depth:number;node:string;result:{columns:{name:string}[];rows:Record<string,unknown>[];rowCount:number};rowRefs:string[];actions:{id:string;trigger:"ROW"|"COLUMN";column?:string;display:"PAGE"|"PANEL"|"MODAL"}[]};
export function validDrillPage(v:DrillPage):boolean {
  return Boolean(v && /^[A-Za-z0-9_-]{43}$/.test(v.contextId) && Number.isFinite(Date.parse(v.expiresAtUtc)) && Date.parse(v.expiresAtUtc)>Date.now()
    && Number.isInteger(v.depth)&&v.depth>=1&&v.depth<=5&&typeof v.node==="string"&&Array.isArray(v.result?.columns)&&v.result.columns.every(c=>typeof c.name==="string")
    && Array.isArray(v.result.rows)&&v.result.rows.length<=1000&&v.result.rows.every(r=>r&&typeof r==="object"&&!Array.isArray(r))
    && Array.isArray(v.rowRefs)&&v.rowRefs.length===v.result.rows.length&&v.rowRefs.every(r=>/^[A-Za-z0-9_-]{43}$/.test(r))
    &&new Set(v.rowRefs).size===v.rowRefs.length&&Array.isArray(v.actions)&&v.actions.every(a=>typeof a.id==="string"&&["ROW","COLUMN"].includes(a.trigger)
      &&["PAGE","PANEL","MODAL"].includes(a.display)&&(a.trigger!=="COLUMN"||v.result.columns.some(c=>c.name===a.column))));
}
export function jwtDeadline(token:string):number {
  try { const payload=JSON.parse(atob(token.split(".")[1]!.replace(/-/g,"+").replace(/_/g,"/")));return typeof payload.exp==="number"?payload.exp*1000:0; } catch {return 0;}
}
/** Only a conservative editor check. Authorization/type provenance is always validated by the saved-layout API. */
export function graphIssue(g:DrillGraph):string|null {
  try { return inspectGraph(g); } catch { return "Graph 格式不完整"; }
}
function inspectGraph(g:DrillGraph):string|null {
  if(!g||g.version!==1||!Array.isArray(g.nodes)||!Array.isArray(g.edges)||g.nodes.length>32||g.edges.length>64||!g.nodes.length)return "Graph 格式不完整";
  const key=(v:unknown)=>typeof v==="string"&&/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(v);
  if(!key(g.root)||g.nodes.some(n=>!n||!key(n.id))||g.edges.some(e=>!e||!key(e.id)||!key(e.from)||!key(e.to)))return "節點識別不正確";
  const ids=new Set(g.nodes.map(n=>n.id));
  if(ids.size!==g.nodes.length||!ids.has(g.root)||g.nodes.some(n=>!Number.isSafeInteger(n.queryId)||n.queryId<=0)||new Set(g.edges.map(e=>e.id)).size!==g.edges.length)return "節點或引用不正確";
  for(const e of g.edges)if(!ids.has(e.from)||!ids.has(e.to)||!["ROW","COLUMN"].includes(e.trigger)||!["PAGE","PANEL","MODAL"].includes(e.display)||(e.trigger==="COLUMN"&&!e.column)||!Array.isArray(e.bindings)||e.bindings.some(b=>!b.field||!b.parameter||!["STRING","NUMBER","DATE","DATETIME","BOOLEAN"].includes(b.type))||new Set(e.bindings.map(b=>b.parameter)).size!==e.bindings.length)return "觸發與參數對應尚未完成";
  const visited=new Set<string>();
  const walk=(id:string,path:string[]):boolean=>{if(path.includes(id)||path.length>=5)return false;visited.add(id);return g.edges.filter(e=>e.from===id).every(e=>walk(e.to,[...path,id]));};
  if(!walk(g.root,[])||visited.size!==ids.size)return "不允許循環、超過五層或無法到達的節點";
  return null;
}
