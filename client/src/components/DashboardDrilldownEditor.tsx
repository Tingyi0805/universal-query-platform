import { useEffect, useState } from "react";
import { apiRequest } from "../api/client";
import { graphIssue, type DrillGraph } from "../dashboard/drilldown";
import "./DashboardDrilldown.css";
type Metadata={reportColumns:{columnName:string}[];parameters:{name:string;dataType:string}[]};
function metadata(value:Metadata):Metadata {
  if(!Array.isArray(value?.reportColumns)||!Array.isArray(value?.parameters)||value.reportColumns.some(c=>typeof c?.columnName!=="string")||value.parameters.some(p=>typeof p?.name!=="string"||!["STRING","NUMBER","DATE","DATETIME","BOOLEAN"].includes(p.dataType)))throw Error();
  return {reportColumns:value.reportColumns.map(({columnName})=>({columnName})),parameters:value.parameters.map(({name,dataType})=>({name,dataType}))};
}
export function DashboardDrilldownEditor({value,rootQueryId,token,onChange,onPending}:{value:unknown;rootQueryId:number;token:string|null;onChange:(g:DrillGraph|undefined)=>void;onPending:(p:boolean)=>void}) {
  const invalid=!!value&&!!graphIssue(value as DrillGraph);
  const graph=invalid?undefined:value as DrillGraph|undefined;
  const [queries,setQueries]=useState<{id:number;name:string;canExecute:boolean}[]>([]),[from,setFrom]=useState(graph?.root??"root"),[query,setQuery]=useState(0);
  const [parent,setParent]=useState<Metadata|null>(null),[target,setTarget]=useState<Metadata|null>(null),[error,setError]=useState("");
  const [trigger,setTrigger]=useState<"ROW"|"COLUMN">("ROW"),[column,setColumn]=useState(""),[display,setDisplay]=useState<"PAGE"|"PANEL"|"MODAL">("PANEL");
  const [bindings,setBindings]=useState<Record<string,string>>({});
  const parentQuery=graph?.nodes?.find(n=>n.id===from)?.queryId??rootQueryId;
  useEffect(()=>{let live=true;void apiRequest<{queries:typeof queries}>("/queries",{},token).then(v=>{if(live)setQueries(v.queries.filter(q=>q.canExecute));}).catch(()=>{if(live)setError("無法取得已授權 Query，禁止新增下鑽。")});return()=>{live=false;};},[token]);
  useEffect(()=>{let live=true;setParent(null);void apiRequest<Metadata>(`/queries/${parentQuery}`,{},token).then(v=>{if(live)setParent(metadata(v));}).catch(()=>{if(live)setError("父層欄位授權或設定不可用。")});return()=>{live=false;};},[token,parentQuery]);
  useEffect(()=>{let live=true;setTarget(null);setBindings({});if(query)void apiRequest<Metadata>(`/queries/${query}`,{},token).then(v=>{if(live)setTarget(metadata(v));}).catch(()=>{if(live)setError("下一層參數授權或設定不可用。")});return()=>{live=false;};},[token,query]);
  useEffect(()=>{onPending(query!==0);return()=>onPending(false);},[query,onPending]);
  const fields=parent?.reportColumns?.map(c=>c.columnName)??[];
  const complete=!!target&&!!parent&&query>0&&(trigger==="ROW"||fields.includes(column))&&target.parameters.every(p=>fields.includes(bindings[p.name]??"")&&["STRING","NUMBER","DATE","DATETIME","BOOLEAN"].includes(p.dataType));
  function add() {
    if(!complete||!target)return;
    const g:DrillGraph=graph??{version:1,root:"root",nodes:[{id:"root",queryId:rootQueryId}],edges:[]};
    let i=1;while(g.nodes.some(n=>n.id===`node_${i}`)||g.edges.some(e=>e.id===`edge_${i}`))i++;
    const next:DrillGraph={...g,nodes:[...g.nodes,{id:`node_${i}`,queryId:query}],edges:[...g.edges,{id:`edge_${i}`,from,to:`node_${i}`,trigger,...(trigger==="COLUMN"?{column}:{}),display,bindings:target.parameters.map(p=>({field:bindings[p.name]!,parameter:p.name,type:p.dataType}))}]};
    const issue=graphIssue(next);if(issue){setError(issue);return;}onChange(next);setQuery(0);setError("");
  }
  return <section className="drill-editor" aria-label="TABLE 下鑽設定"><strong>JWT 下鑽設定</strong>
    <p>使用已保存 Graph 與個人登入。欄位必須未遮蔽，完整參數型別與授權由後端儲存驗證；未儲存不啟用。公共裝置不可互動。</p>
    {error&&<p role="alert">{error}</p>}
    {invalid?<p role="alert">既有 Graph 格式不可編輯，請保留設定並由管理者確認。</p>:<>
    {(graph?.edges??[]).map(e=><div className="drill-edge" key={e.id}>{e.id}：{e.from} → {e.to}（{e.trigger}／{e.display}）</div>)}
    <label>父層節點<select value={from} onChange={e=>{setFrom(e.target.value);setQuery(0);setColumn("");}}>{(graph?.nodes??[{id:"root",queryId:rootQueryId}]).map(n=><option key={n.id} value={n.id}>{n.id}</option>)}</select></label>
    <label>下一層已授權 Query<select value={query} onChange={e=>{setError("");setQuery(Number(e.target.value));}}><option value={0}>選擇 Query</option>{queries.map(q=><option key={q.id} value={q.id}>{q.name}</option>)}</select></label>
    <label>下鑽觸發<select value={trigger} onChange={e=>setTrigger(e.target.value as typeof trigger)}><option value="ROW">整列</option><option value="COLUMN">指定欄位</option></select></label>
    {trigger==="COLUMN"&&<label>觸發欄位<select aria-label="觸發欄位" value={column} onChange={e=>setColumn(e.target.value)}><option value="">選擇欄位</option>{fields.map(f=><option key={f}>{f}</option>)}</select></label>}
    <label>明細顯示方式<select value={display} onChange={e=>setDisplay(e.target.value as typeof display)}><option value="PAGE">整頁</option><option value="PANEL">側邊面板</option><option value="MODAL">彈出視窗</option></select></label>
    {target?.parameters.map(p=><label key={p.name}>父層欄位 → {p.name}（{p.dataType}）<select aria-label={`對應參數 ${p.name}`} value={bindings[p.name]??""} onChange={e=>setBindings({...bindings,[p.name]:e.target.value})}><option value="">選擇父層欄位</option>{fields.map(f=><option key={f}>{f}</option>)}</select></label>)}
    {parent&&!fields.length&&<p role="status">缺少可用欄位 metadata，禁止推測欄位；請確認 Query 報表欄位設定。</p>}
    <button type="button" disabled={!complete} onClick={add}>加入下鑽層級</button>
    {query!==0&&<button type="button" onClick={()=>setQuery(0)}>取消新增層級</button>}
    {graph&&<button type="button" onClick={()=>{if(window.confirm("清除這個 TABLE 的全部下鑽設定？儲存後生效。")){onChange(undefined);setFrom("root");setQuery(0);}}}>清除下鑽設定</button>}
    </>}
  </section>;
}
