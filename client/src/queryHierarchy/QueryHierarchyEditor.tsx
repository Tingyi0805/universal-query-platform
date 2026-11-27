import {useEffect,useRef,useState} from "react";
import {apiRequest} from "../api/client";
import {useAuth} from "../auth/AuthContext";
import "./hierarchy.css";
type Node={id:string;queryId:number;layout:"TABLE"|"CARDS";pageSize:number;orderBy:string[]};
type Edge={id:string;from:string;to:string;label:string;trigger:"ROW"|"COLUMN"|"MORE";column?:string;display:"PAGE"|"PANEL"|"MODAL";bindings:{field:string;parameter:string;type:string}[]};
type Graph={version:1;root:string;nodes:Node[];edges:Edge[]};
type Options={columns:{name:string;label:string;canBind:boolean}[];parameters:{name:string;dataType:string;controlType:string}[]};
export function QueryHierarchyEditor({queryId}:{queryId:number}){
 const {accessToken}=useAuth(),[graph,setGraph]=useState<Graph|null>(null),[revision,setRevision]=useState<string|null>(null),[queries,setQueries]=useState<{id:number;name:string}[]>([]);
 const [options,setOptions]=useState<Record<number,Options>>({}),[parent,setParent]=useState("root"),[child,setChild]=useState(""),[message,setMessage]=useState(""),[busy,setBusy]=useState(false);
 const base=`/queries/${queryId}/hierarchy`;
 const [reload,setReload]=useState(0),live=useRef("");const identity=`${queryId}|${accessToken}|${reload}`;live.current=identity;
 useEffect(()=>{const controller=new AbortController();setGraph(null);setRevision(null);setMessage("");setOptions({});
  void Promise.all([apiRequest<{graph:Graph|null;revision:string}>(base+"/configuration",{signal:controller.signal},accessToken),apiRequest<{queries:{id:number;name:string}[]}>("/queries",{signal:controller.signal},accessToken)]).then(async([saved,list])=>{
   if(controller.signal.aborted)return;
   const g=saved.graph??{version:1 as const,root:"root",nodes:[{id:"root",queryId,layout:"TABLE" as const,pageSize:20,orderBy:[]}],edges:[]};
   const entries=await Promise.all(g.nodes.map(async n=>[n.queryId,await apiRequest<Options>(`/queries/${n.queryId}/hierarchy/options`,{signal:controller.signal},accessToken)] as const));
   if(controller.signal.aborted)return;setOptions(Object.fromEntries(entries));setGraph(g);setRevision(saved.revision);setQueries(list.queries);setParent(g.root);
  }).catch(()=>{if(!controller.signal.aborted)setMessage("需由有效 SYSTEM_ADMIN 配置已發布且已確認欄位政策的 Query。929 尚未安裝或授權／版本不可驗證時停用；本頁不會執行 SQL 安裝。");});
  return()=>controller.abort();
 },[base,accessToken,queryId,reload]);
 async function add(){if(!graph||!child)return;setBusy(true);try{
  const query=Number(child),meta=options[query]??await apiRequest<Options>(`/queries/${query}/hierarchy/options`,{},accessToken);
  if(live.current!==identity)return;
  if(meta.parameters.some(p=>p.controlType==="MULTISELECT"))throw Error("多選映射尚不支援");setOptions(old=>({...old,[query]:meta}));
  const nodeId=graph.nodes.find(n=>n.queryId===query)?.id??`q${query}`;
  setGraph({...graph,nodes:graph.nodes.some(n=>n.id===nodeId)?graph.nodes:[...graph.nodes,{id:nodeId,queryId:query,layout:"TABLE",pageSize:20,orderBy:[]}],
   edges:[...graph.edges,{id:`edge${Date.now().toString(36)}`,from:parent,to:nodeId,label:"查看明細",trigger:"MORE",display:"PAGE",bindings:meta.parameters.map(p=>({field:"",parameter:p.name,type:p.dataType}))}]});
  setMessage("請選擇每層排序鍵及完整映射；只能綁定已明確允許原始顯示的欄位。");
 }catch{if(live.current!==identity)return;setMessage("子層不可用，請確認已發布、執行權限、平面 Report 欄位與既有參數型別；不支援 MULTISELECT 映射。");}finally{if(live.current===identity)setBusy(false);}}
 const patchNode=(id:string,p:Partial<Node>)=>graph&&setGraph({...graph,nodes:graph.nodes.map(n=>n.id===id?{...n,...p}:n)});
 const patchEdge=(id:string,p:Partial<Edge>)=>graph&&setGraph({...graph,edges:graph.edges.map(e=>e.id===id?{...e,...p}:e)});
 async function save(){if(!graph||!revision)return;setBusy(true);setMessage("");try{
  const result=await apiRequest<{revision:string}>(base+"/configuration",{method:"PUT",body:JSON.stringify({graph,expectedRevision:revision})},accessToken);if(live.current!==identity)return;setRevision(result.revision);setMessage("多層設定與稽核已儲存；Runtime 每層仍會重新驗權。");
 }catch{if(live.current!==identity)return;setRevision(null);setMessage("未確認儲存成功。可能為 CAS／權限／政策／映射衝突，請重新選取 Query 載入；不會自動重送。");}finally{if(live.current===identity)setBusy(false);}}
 const nameOf=(id:string)=>{const node=graph?.nodes.find(n=>n.id===id);return node?(queries.find(q=>q.id===node.queryId)?.name??`Query ${node.queryId}`):id;};
 return <section className="hierarchy-editor">
  <div className="hierarchy-heading section-title">
   <div><h2>第二階段：多層查詢設定</h2><p>設定各層查詢版型、分頁方式與父子參數關聯。每層 Query 皆須已發佈並通過權限與稽核驗證。</p></div>
   <button className="secondary-button" type="button" disabled={busy} onClick={()=>setReload(n=>n+1)}>重新載入多層設定</button>
  </div>
  {message&&<p className="notice hierarchy-notice" role="status">{message}</p>}
  {graph&&<>
   <div className="hierarchy-config-section">
    <h3>查詢層級</h3>
    <div className="hierarchy-config-grid">{graph.nodes.map(n=><fieldset className="hierarchy-config-card" key={n.id}>
     <legend>{n.id===graph.root?"主層":"子層"} · {nameOf(n.id)}</legend>
     <div className="hierarchy-fields hierarchy-node-fields">
      <label>版型<select aria-label={`${n.id} 版型`} value={n.layout} onChange={e=>patchNode(n.id,{layout:e.target.value as Node['layout']})}><option value="TABLE">表格</option><option value="CARDS">行動卡片</option></select></label>
      <label>每頁筆數<input aria-label={`${n.id} 每頁筆數`} type="number" min={1} max={100} value={n.pageSize} onChange={e=>patchNode(n.id,{pageSize:Number(e.target.value)})}/></label>
      <label className="hierarchy-wide">伺服器排序鍵<select aria-label={`${n.id} 排序鍵`} value={n.orderBy[0]??""} onChange={e=>patchNode(n.id,{orderBy:e.target.value?[e.target.value]:[]})}><option value="">請選擇穩定鍵</option>{options[n.queryId]?.columns.filter(c=>c.canBind).map(c=><option key={c.name} value={c.name}>{c.label}</option>)}</select><small className="field-hint">必須能唯一識別查詢結果中的每筆紀錄。</small></label>
     </div>
    </fieldset>)}</div>
   </div>
   <div className="hierarchy-config-section">
    <h3>新增父子關聯</h3>
    <div className="hierarchy-fields hierarchy-add-fields">
     <label>父層 Query<select aria-label="父層 Query" value={parent} onChange={e=>setParent(e.target.value)}>{graph.nodes.map(n=><option key={n.id} value={n.id}>{nameOf(n.id)}</option>)}</select></label>
     <label>子層 Query<select aria-label="子層 Query" value={child} onChange={e=>setChild(e.target.value)}><option value="">請選擇已發布 Query</option>{queries.map(q=><option key={q.id} value={q.id}>{q.name}</option>)}</select></label>
     <button className="secondary-button" type="button" disabled={busy||!child} onClick={()=>void add()}>新增父子關聯</button>
    </div>
   </div>
   <div className="hierarchy-config-section">
    <h3>父子關聯與參數映射</h3>
    {!graph.edges.length&&<p className="hierarchy-hint">尚未建立父子關聯，請先從上方新增。</p>}
    <div className="hierarchy-edge-list">{graph.edges.map(edge=>{const n=graph.nodes.find(n=>n.id===edge.from)!;const fields=options[n.queryId]?.columns.filter(c=>c.canBind)??[];return <fieldset className="hierarchy-config-card hierarchy-edge-card" key={edge.id}>
     <legend>{nameOf(edge.from)} → {nameOf(edge.to)}</legend>
     <div className="hierarchy-fields hierarchy-edge-fields">
      <label>操作名稱<input aria-label={`${edge.id} 操作名稱`} value={edge.label} onChange={e=>patchEdge(edge.id,{label:e.target.value})}/></label>
      <label>觸發方式<select aria-label={`${edge.id} 觸發`} value={edge.trigger} onChange={e=>{const trigger=e.target.value as Edge['trigger'];const {column,...rest}=edge;patchEdge(edge.id,trigger==="COLUMN"?{trigger,column:fields[0]?.name??""}:{...rest,trigger,column:undefined});}}><option value="ROW">整列</option><option value="COLUMN">指定欄位</option><option value="MORE">每列更多操作</option></select></label>
      {edge.trigger==="COLUMN"&&<label>觸發欄位<select value={edge.column??""} onChange={e=>patchEdge(edge.id,{column:e.target.value})}>{fields.map(f=><option key={f.name}>{f.name}</option>)}</select></label>}
      <label>明細顯示<select aria-label={`${edge.id} 明細顯示`} value={edge.display} onChange={e=>patchEdge(edge.id,{display:e.target.value as Edge['display']})}><option value="PAGE">整頁</option><option value="PANEL">右側面板</option><option value="MODAL">彈出視窗</option></select></label>
     </div>
     {edge.bindings.length>0&&<div className="hierarchy-mapping">
      <h4>參數映射</h4>
      <div className="hierarchy-fields hierarchy-mapping-fields">{edge.bindings.map((b,i)=><label key={b.parameter}><span>父欄位 → {b.parameter} <small className="field-hint">（{b.type}）</small></span><select aria-label={`映射 ${edge.id} ${b.parameter}`} value={b.field} onChange={e=>patchEdge(edge.id,{bindings:edge.bindings.map((v,j)=>i===j?{...v,field:e.target.value}:v)})}><option value="">請選擇</option>{fields.map(f=><option key={f.name} value={f.name}>{f.label}</option>)}</select></label>)}</div>
     </div>}
     <div className="hierarchy-edge-actions"><button className="secondary-button hierarchy-remove-button" type="button" onClick={()=>{const edges=graph.edges.filter(e=>e.id!==edge.id),keep=new Set([graph.root]);let previous=0;while(keep.size!==previous){previous=keep.size;for(const e of edges)if(keep.has(e.from))keep.add(e.to);}setGraph({...graph,nodes:graph.nodes.filter(n=>keep.has(n.id)),edges:edges.filter(e=>keep.has(e.from)&&keep.has(e.to))});setParent(graph.root);}}>移除此關聯</button></div>
    </fieldset>;})}</div>
   </div>
   <div className="hierarchy-save-bar"><p className="hierarchy-hint">儲存設定後，每層查詢仍會依目前的權限與版本重新驗證。</p><button className="primary-button" type="button" disabled={busy||revision===null} onClick={()=>void save()}>儲存多層查詢設定</button></div>
  </>}
 </section>;
}
