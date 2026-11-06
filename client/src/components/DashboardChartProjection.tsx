import type { ReactNode } from "react";
import {chartXY,chartPie,pieSlicePath,parseChartProjection} from "../dashboard/chartProjection";
import "./DashboardChartProjection.css";
const colors=["#2563eb","#0f766e","#d97706","#7c3aed","#b91c1c","#0369a1"] as const;
export type ChartPreviewTypography = Readonly<{
  fontFamily: string;
  fontWeight: 400 | 500 | 600 | 700 | 800;
  titleSize: number;
  legendSize: number;
  axisSize: number;
  textColor: string;
}>;
type Props={projection:unknown;ariaLabel?:string;emptyMessage?:string;typography?:ChartPreviewTypography};
export function DashboardChartProjection({projection,ariaLabel="統計圖表",emptyMessage="沒有可顯示的圖表資料",typography}:Props){
 const parsed=parseChartProjection(projection);
 if(!parsed)return <div className="dashboard-chart-empty" role="status">圖表資料未通過驗證，停止顯示。</div>;
 if(parsed.points.length===0)return <div className="dashboard-chart-empty" role="status">{emptyMessage}</div>;
 const shape=chartXY(parsed.points);
 const slices=parsed.chartType==="PIE"?chartPie(parsed.points):[];
 const labels=parsed.points.length<=8;
 const title=parsed.chartType==="BAR"?"長條圖":parsed.chartType==="LINE"?"折線圖":"圓餅圖";
 let graphic:ReactNode=null;
 if(parsed.chartType==="BAR"){
   graphic=<>
     <line x1="62" y1={shape.zeroY} x2="746" y2={shape.zeroY} stroke="currentColor" strokeOpacity=".45"/>
     {shape.bars.map((bar,i)=><g key={bar.label}>
       <rect x={bar.x} y={bar.y} width={bar.width} height={Math.max(0,bar.height)}
         rx="2" fill={colors[i%colors.length]}><title>{bar.label}：{bar.value}</title></rect>
       {labels&&<text x={bar.x+bar.width/2} y="292" textAnchor="middle" fontSize={typography?.axisSize??13} fill="currentColor">{bar.label}</text>}
     </g>)}
   </>;
 }else if(parsed.chartType==="LINE"){
   const line=shape.line.map((p,i)=>`${i===0?"M":"L"} ${p.x} ${p.y}`).join(" ");
   graphic=<>
     <line x1="62" y1={shape.zeroY} x2="746" y2={shape.zeroY} stroke="currentColor" strokeOpacity=".45"/>
     <path d={line} fill="none" stroke="#2563eb" strokeWidth="3" strokeLinejoin="round"/>
     {shape.line.map((p,i)=><g key={p.label}>
       <circle cx={p.x} cy={p.y} r="5" fill={colors[i%colors.length]}><title>{p.label}：{p.value}</title></circle>
       {labels&&<text x={p.x} y="292" textAnchor="middle" fontSize="13" fill="currentColor">{p.label}</text>}
     </g>)}
   </>;
 }else{
   graphic=slices.map((s,i)=>{
     const color=colors[parsed.points.findIndex(p=>p.label===s.label)%colors.length];
     return s.fraction>=1-1e-12
       ? <circle key={s.label} cx="400" cy="150" r="106" fill={color}><title>{s.label}：{s.value}</title></circle>
       : <path key={s.label} d={pieSlicePath(s.start,s.end)} fill={color}>
           <title>{s.label}：{s.value}</title>
         </path>;
   });
 }
 return <div className="dashboard-chart-projection" style={typography?{
   fontFamily:typography.fontFamily,
   fontWeight:typography.fontWeight,
   color:typography.textColor,
 }:undefined}>
   {typography&&<div className="dashboard-chart-preview-title" style={{fontSize:typography.titleSize,textAlign:"center",lineHeight:1.4}}>{title}</div>}
   <svg viewBox="0 0 800 310" preserveAspectRatio="xMidYMid meet" role="img"
     aria-label={ariaLabel}>
     <title>{title}</title>{graphic}
   </svg>
   {parsed.showLegend&&<div className="dashboard-chart-legend" style={typography?{fontSize:typography.legendSize}:undefined} aria-label="圖表圖例">
     {parsed.points.map((p,i)=><span key={p.label}>
       <i aria-hidden="true" style={{backgroundColor:colors[i%colors.length]}}/>
       {p.label} · {p.value}
     </span>)}
   </div>}
   <table className="dashboard-chart-a11y" aria-label={title+"數值明細"}>
     <thead><tr><th scope="col">分類</th><th scope="col">數值</th></tr></thead>
     <tbody>{parsed.points.map(p=><tr key={p.label}><th scope="row">{p.label}</th><td>{p.value}</td></tr>)}</tbody>
   </table>
 </div>;
}
