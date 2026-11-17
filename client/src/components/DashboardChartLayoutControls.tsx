import {useState} from "react";
import {ChartPlacementNumberInput} from "./ChartPlacementNumberInput";
export type ChartLayoutGeometry={
 x:number;y:number;width:number;height:number;sortOrder:number;
};
export function DashboardChartLayoutControls({placement,version,canvasWidth,canvasHeight,enabled,disabledReason,onCommit}:{
 placement:ChartLayoutGeometry;version:string;
 canvasWidth:number;canvasHeight:number;enabled:boolean;disabledReason?:string;
 onCommit:(action:"MOVE"|"HIDE",geometry:ChartLayoutGeometry,version:string)=>Promise<void>;
}){
 const [draft,setDraft]=useState<ChartLayoutGeometry>(placement);
 const [busy,setBusy]=useState(false);
 const [blocked,setBlocked]=useState(false);
 const valid=[draft.x,draft.y,draft.width,draft.height,draft.sortOrder].every(Number.isSafeInteger)&&
  draft.x>=0&&draft.y>=0&&draft.width>=160&&draft.height>=120&&
  draft.x+draft.width<=canvasWidth&&draft.y+draft.height<=canvasHeight&&
  draft.sortOrder>=0&&draft.sortOrder<=1000000;
 const submit=async(action:"MOVE"|"HIDE")=>{
  if(busy||blocked||!enabled||(action==="MOVE"&&!valid))return;
  if(action==="HIDE"&&!window.confirm(
    "確定從目前版型移除這張 CHART？將保留原始 Seal 與稽核紀錄，不能透過舊版儲存功能恢復。"))return;
  setBusy(true);
  try{await onCommit(action,action==="HIDE"?placement:draft,version);}catch{setBlocked(true);}
  finally{setBusy(false);}
 };
 return <section className="notice" aria-label="受控圖表位置與移除">
  <h3>CHART 版面設定</h3>
  <p>此圖表的啟用、停用與播放由 Dashboard 統一管理；以下只修改版面位置，不修改圖表資料與 Seal。</p>
  <div className="dashboard-editor-form">
   {([["x","X"],["y","Y"],["width","寬"],["height","高"],["sortOrder","圖層順序"]] as const).map(([key,label])=>
    <ChartPlacementNumberInput key={key} label={label}
      value={draft[key]} min={key==="width"?160:key==="height"?120:0}
      onCommit={value=>setDraft(cur=>({...cur,[key]:value}))}/>)}
  </div>
  {!valid&&<p role="alert">圖表位置或大小超出目前版型畫布，請調整。</p>}
  <button type="button" disabled={!enabled||!valid||busy||blocked}
   onClick={()=>void submit("MOVE")}>儲存 CHART 位置與尺寸</button>
  <button type="button" className="danger-button" disabled={!enabled||busy||blocked}
   onClick={()=>void submit("HIDE")}>從此版型移除 CHART</button>
  {blocked&&<p role="alert">操作結果尚未確認；請重新載入版型後再執行，避免重複操作。</p>}
  {!enabled&&<p role="status">{disabledReason??"目前 CHART 版面操作條件尚未通過，請重新載入確認。"}</p>}
 </section>;
}
