import { useState } from "react";
import {DashboardChartProjection, type ChartPreviewTypography} from "./DashboardChartProjection";
import {ChartPlacementNumberInput} from "./ChartPlacementNumberInput";
import {
  newChartDraft,clampChartPlacement,chartDraftErrors,syntheticChartPoints,
  chartDraftPersistenceEnabled,type ChartDraft,type ChartDraftConfig,type DraftChartType,
} from "../dashboard/chartDraft";
import "./DashboardChartDraftEditor.css";

const labels:Record<DraftChartType,string>={BAR:"長條圖",LINE:"折線圖",PIE:"圓餅圖"};
const defaultTypography:ChartPreviewTypography={
 fontFamily:'"Microsoft JhengHei", sans-serif',
 fontWeight:700,titleSize:20,legendSize:13,axisSize:13,textColor:"#172033",
};
const previewFonts=[
 {label:"微軟正黑體",value:'"Microsoft JhengHei", sans-serif'},
 {label:"Noto Sans TC",value:'"Noto Sans TC", sans-serif'},
 {label:"標楷體",value:'DFKai-SB, serif'},
 {label:"Arial",value:"Arial, sans-serif"},
 {label:"系統預設",value:"system-ui"},
];
export function DashboardChartDraftEditor({canvasWidth,canvasHeight,sourceKeys}:{
 canvasWidth:number;canvasHeight:number;sourceKeys:readonly string[];
}){
 const [expanded,setExpanded]=useState(false);
 const [draft,setDraft]=useState<ChartDraft>(newChartDraft);
 const [typography,setTypography]=useState<ChartPreviewTypography>(defaultTypography);
 const config=draft.config;
 const placement=clampChartPlacement(draft.placement,canvasWidth,canvasHeight);
 const current={...draft,placement};
 const sources=["PRIMARY",...sourceKeys.filter(s=>s!=="PRIMARY")];
 const problems=chartDraftErrors(current,canvasWidth,canvasHeight,sources);
 const configPatch=(patch:Partial<ChartDraftConfig>)=>setDraft(v=>({...v,config:{...v.config,...patch}}));
 const move=(patch:Partial<ChartDraft["placement"]>)=>setDraft(v=>({...v,
   placement:clampChartPlacement({...v.placement,...patch},canvasWidth,canvasHeight)}));
 const numberInput=(key:keyof ChartDraft["placement"],name:string)=>
   <ChartPlacementNumberInput key={key} label={name}
     value={placement[key]} min={key==="width"?160:key==="height"?120:0}
     onCommit={value=>move({[key]:value})}/>;
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
     <div className="chart-draft-subtitle">圖表字體（僅合成資料預覽）</div>
     <div className="chart-draft-grid">
       <label>字型
         <select value={typography.fontFamily}
           onChange={e=>setTypography(v=>({...v,fontFamily:e.target.value}))}>
           {previewFonts.map(font=><option key={font.value} value={font.value}>{font.label}</option>)}
         </select>
       </label>
       <label>字重
         <select value={typography.fontWeight}
           onChange={e=>setTypography(v=>({...v,fontWeight:Number(e.target.value) as ChartPreviewTypography["fontWeight"]}))}>
           {[400,500,600,700,800].map(weight=><option key={weight} value={weight}>{weight}</option>)}
         </select>
       </label>
       <ChartPlacementNumberInput label="標題字體（px）" value={typography.titleSize} min={8}
         onCommit={value=>{if(value>=8&&value<=72)setTypography(v=>({...v,titleSize:value}));}}/>
       <ChartPlacementNumberInput label="圖例字體（px）" value={typography.legendSize} min={8}
         onCommit={value=>{if(value>=8&&value<=48)setTypography(v=>({...v,legendSize:value}));}}/>
       <ChartPlacementNumberInput label="座標標籤字體（px）" value={typography.axisSize} min={8}
         onCommit={value=>{if(value>=8&&value<=48)setTypography(v=>({...v,axisSize:value}));}}/>
       <label>文字顏色
         <input type="color" value={typography.textColor}
           onChange={e=>setTypography(v=>({...v,textColor:e.target.value}))}/>
       </label>
     </div>
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
         ariaLabel={labels[config.chartType]+"，僅合成資料示意"} typography={typography}/>
     </div>
     {problems.length>0&&<p role="alert">{problems.join("；")}</p>}
     <p className="chart-draft-notice">圖表存檔／真實資料預覽／全螢幕播放，仍須完成 2B-15 的後端授權與安全交付。此草稿不在「儲存版面」範圍內。</p>
     <button type="button" className="chart-draft-reset" onClick={()=>{setDraft(newChartDraft());setTypography(defaultTypography);}}>重設示意設定</button>
     <span className="chart-draft-hidden-gate" data-chart-persistence={String(chartDraftPersistenceEnabled)} />
   </div>}
 </section>;
}
