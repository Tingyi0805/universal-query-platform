import { useState } from "react";
import {
  newChartDraft,clampChartPlacement,chartDraftErrors,syntheticChartPoints,
  chartDraftPersistenceEnabled,type ChartDraft,type ChartDraftConfig,type DraftChartType,
} from "../dashboard/chartDraft";
import "./DashboardChartDraftEditor.css";

const labels:Record<DraftChartType,string>={BAR:"長條圖",LINE:"折線圖",PIE:"圓餅圖"};
const tones=["#2563eb","#0d9488","#f59e0b"] as const;
function SampleChart({draft}:{draft:ChartDraft}){
 const points=syntheticChartPoints.slice(0,draft.config.maxPoints);
 const max=Math.max(1,...points.map(p=>p.value));
 const total=points.reduce((s,p)=>s+p.value,0);
 const coords=points.map((p,i)=>({x:50+i*82,y:140-p.value/max*100}));
 return <div className="chart-draft-sample">
   <p>合成資料示意（非 Query 查詢結果）</p>
   <svg viewBox="0 0 320 174" role="img" aria-label={labels[draft.config.chartType]+"，僅合成資料示意"}>
     {draft.config.chartType==="BAR"&&points.map((p,i)=>
       <g key={p.label}>
         <rect x={coords[i]!.x-18} y={coords[i]!.y} width="36" height={140-coords[i]!.y} rx="3" fill={tones[i%tones.length]}/>
         <text x={coords[i]!.x} y="157" textAnchor="middle" fontSize="12" fill="currentColor">{p.label}</text>
       </g>)}
     {draft.config.chartType==="LINE"&&<>
       <path d={coords.map((p,i)=>`${i?"L":"M"} ${p.x} ${p.y}`).join(" ")}
         fill="none" stroke={tones[0]} strokeWidth="4" strokeLinejoin="round"/>
       {coords.map((p,i)=><g key={i}>
         <circle cx={p.x} cy={p.y} r="5" fill={tones[i%tones.length]}/>
         <text x={p.x} y="157" textAnchor="middle" fontSize="12" fill="currentColor">{points[i]!.label}</text>
       </g>)}
     </>}
     {draft.config.chartType==="PIE"&&points.map((p,i)=>{
       const offset=points.slice(0,i).reduce((s,row)=>s+row.value,0)/total*100;
       return <circle key={p.label} cx="152" cy="82" r="58" fill="none" stroke={tones[i%tones.length]}
         strokeWidth="65" strokeDasharray={`${p.value/total*100} ${100-p.value/total*100}`}
         strokeDashoffset={-offset} pathLength="100" transform="rotate(-90 152 82)"/>;
     })}
   </svg>
   {draft.config.showLegend&&<div className="chart-draft-legend" aria-label="合成資料圖例">
     {points.map((p,i)=><span key={p.label}><i style={{background:tones[i%tones.length]}}/>{p.label} · {p.value}</span>)}
   </div>}
 </div>;
}
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
     <SampleChart draft={current}/>
     {problems.length>0&&<p role="alert">{problems.join("；")}</p>}
     <p className="chart-draft-notice">圖表存檔／真實資料預覽／全螢幕播放，仍須完成 2B-15 的後端授權與安全交付。此草稿不在「儲存版面」範圍內。</p>
     <button type="button" className="chart-draft-reset" onClick={()=>setDraft(newChartDraft())}>重設示意設定</button>
     <span className="chart-draft-hidden-gate" data-chart-persistence={String(chartDraftPersistenceEnabled)} />
   </div>}
 </section>;
}
