import { useState } from "react";
import {DashboardChartProjection} from "./DashboardChartProjection";
import {
  newChartDraft,clampChartPlacement,chartDraftErrors,syntheticChartPoints,
  chartDraftPersistenceEnabled,type ChartDraft,type ChartDraftConfig,type DraftChartType,
} from "../dashboard/chartDraft";
import "./DashboardChartDraftEditor.css";

const labels:Record<DraftChartType,string>={BAR:"長條圖",LINE:"折線圖",PIE:"圓餅圖"};
export function DashboardChartDraftEditor({canvasWidth,canvasHeight,sourceKeys}:{
 canvasWidth:number;canvasHeight:number;sourceKeys:readonly string[];
}){
 const [expanded,setExpanded]=useState(false);
 const [draft,setDraft]=useState<ChartDraft>(newChartDraft);
 const config=draft.config;
 const placement=clampChartPlacement(draft.placement,canvasWidth,canvasHeight);
 const current={...draft,placement};
 const sources=["PRIMARY",...sourceKeys.filter(s=>s!=="PRIMARY")];
 const problems=chartDraftErrors(current,canvasWidth,canvasHeight,sources);
 const configPatch=(patch:Partial<ChartDraftConfig>)=>setDraft(v=>({...v,config:{...v.config,...patch}}));
 const move=(patch:Partial<ChartDraft["placement"]>)=>setDraft(v=>({...v,
   placement:clampChartPlacement({...v.placement,...patch},canvasWidth,canvasHeight)}));
 const numberInput=(key:keyof ChartDraft["placement"],name:string)=><label key={key}>{name}
   <input type="number" value={placement[key]} step={1} min={key==="width"?160:key==="height"?120:0}
     onChange={e=>move({[key]:Number(e.target.value)})}/>
 </label>;
 return <section className="chart-draft" aria-label="圖表設計草稿">
   <button type="button" className="chart-draft-toggle" aria-expanded={expanded}
     onClick={()=>setExpanded(v=>!v)}>＋ 圖表設計草稿（僅示意）</button>
   {expanded&&<div className="chart-draft-body">
     <p className="chart-draft-warning" role="status">
       2B-14 隔離草稿：只使用合成資料。此處設定不會儲存、傳送 API、寫入 Widget 或出現在播放頁。
     </p>
     <label>圖表類型
       <select value={config.chartType} onChange={e=>configPatch({chartType:e.target.value as DraftChartType})}>
         {Object.entries(labels).map(([key,label])=><option key={key} value={key}>{label}</option>)}
       </select>
     </label>
     <label>預計使用的 Query Source
       <select value={config.dataSourceKey} onChange={e=>configPatch({dataSourceKey:e.target.value})}>
         {sources.map(key=><option key={key} value={key}>{key}</option>)}
       </select>
     </label>
     <label>分類欄位（僅填欄位名稱）
       <input maxLength={128} value={config.categoryColumn} onChange={e=>configPatch({categoryColumn:e.target.value})}/>
     </label>
     <label>數值欄位（已由 Query 彙總）
       <input maxLength={128} value={config.valueColumn} onChange={e=>configPatch({valueColumn:e.target.value})}/>
     </label>
     <label>最大資料點數（1–50）
       <input type="number" min={1} max={50} step={1} value={config.maxPoints}
         onChange={e=>configPatch({maxPoints:Number(e.target.value)})}/>
     </label>
     <label className="chart-draft-check">
       <input type="checkbox" checked={config.showLegend} onChange={e=>configPatch({showLegend:e.target.checked})}/>
       顯示圖例
     </label>
     <div className="chart-draft-subtitle">畫布位置（像素）</div>
     <div className="chart-draft-grid">
       {numberInput("x","X")}
       {numberInput("y","Y")}
       {numberInput("width","寬")}
       {numberInput("height","高")}
     </div>
     <div className="chart-draft-subtitle">圖表位置示意</div>
     <div className="chart-draft-position" style={{aspectRatio:`${Math.max(1,canvasWidth)} / ${Math.max(1,canvasHeight)}`}}>
       <div className="chart-draft-position-frame" style={{
          left:`${placement.x/canvasWidth*100}%`, top:`${placement.y/canvasHeight*100}%`,
          width:`${placement.width/canvasWidth*100}%`,
          height:`${placement.height/canvasHeight*100}%`,
       }}>CHART · 草稿</div>
     </div>
     <div className="chart-draft-sample">
       <p>合成資料示意（非 Query 查詢結果）</p>
       <DashboardChartProjection
         projection={{chartType:config.chartType,showLegend:config.showLegend,
           points:syntheticChartPoints.slice(0,config.maxPoints)}}
         ariaLabel={labels[config.chartType]+"，僅合成資料示意"}/>
     </div>
     {problems.length>0&&<p role="alert">{problems.join("；")}</p>}
     <p className="chart-draft-notice">圖表存檔／真實資料預覽／全螢幕播放，仍須完成 2B-15 的後端授權與安全交付。此草稿不在「儲存版面」範圍內。</p>
     <button type="button" className="chart-draft-reset" onClick={()=>setDraft(newChartDraft())}>重設示意設定</button>
     <span className="chart-draft-hidden-gate" data-chart-persistence={String(chartDraftPersistenceEnabled)} />
   </div>}
 </section>;
}
