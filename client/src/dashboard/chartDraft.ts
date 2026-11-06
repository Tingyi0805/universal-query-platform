// 2B-14 UI-only, session-local preview draft. No persistence or privileged
// claims can originate here. Server remains sole authority for any CHART.
export type DraftChartType = "BAR" | "LINE" | "PIE";
export type ChartDraftConfig = Readonly<{
  version: 1;
  chartType: DraftChartType;
  dataSourceKey: string;
  categoryColumn: string;
  valueColumn: string;
  valueMode: "QUERY_RESULT";
  maxPoints: number;
  showLegend: boolean;
}>;
export type ChartDraftPlacement = Readonly<{x:number;y:number;width:number;height:number}>;
export type ChartDraft = Readonly<{ config:ChartDraftConfig; placement:ChartDraftPlacement }>;
export const syntheticChartPoints: readonly {label:string;value:number}[] = Object.freeze([
  Object.freeze({label:"區域 A",value:8}),
  Object.freeze({label:"區域 B",value:5}),
  Object.freeze({label:"區域 C",value:11}),
]);

export function newChartDraft(): ChartDraft {
  return {
    config:{version:1,chartType:"BAR",dataSourceKey:"PRIMARY",categoryColumn:"ROOM",
      valueColumn:"TOTAL",valueMode:"QUERY_RESULT",maxPoints:20,showLegend:true},
    placement:{x:80,y:80,width:600,height:360},
  };
}
const finiteInt=(v:number)=>Number.isSafeInteger(v);
const field=(v:string)=>typeof v==="string" && v.length>=1 && v.length<=128 &&
  !/[\u0000-\u001f\u007f]/u.test(v);
const source=(v:string)=>typeof v==="string" && /^(?:PRIMARY|[A-Za-z][A-Za-z0-9_]{0,63})$/.test(v);
export function clampChartPlacement(p:ChartDraftPlacement,canvasWidth:number,canvasHeight:number):ChartDraftPlacement {
  const widthBound=finiteInt(canvasWidth)&&canvasWidth>=320?canvasWidth:1280;
  const heightBound=finiteInt(canvasHeight)&&canvasHeight>=240?canvasHeight:720;
  const clamp=(n:number,min:number,max:number)=>Math.max(min,Math.min(max,Number.isFinite(n)?Math.trunc(n):min));
  const width=clamp(p.width,160,widthBound);
  const height=clamp(p.height,120,heightBound);
  return { width,height,x:clamp(p.x,0,widthBound-width),y:clamp(p.y,0,heightBound-height) };
}
export function chartDraftErrors(
 draft:ChartDraft,canvasWidth:number,canvasHeight:number,
 allowedSources:readonly string[],
):string[] {
 const c=draft.config,p=draft.placement, errors:string[]=[];
 if(c.version!==1||!["BAR","LINE","PIE"].includes(c.chartType)||
   c.valueMode!=="QUERY_RESULT"||typeof c.showLegend!=="boolean" ||
   !finiteInt(c.maxPoints)||c.maxPoints<1||c.maxPoints>50) errors.push("圖表契約不符合 V1");
 if(!source(c.dataSourceKey)||!allowedSources.includes(c.dataSourceKey)) errors.push("資料來源未啟用或不存在");
 if(!field(c.categoryColumn)||!field(c.valueColumn)||
   c.categoryColumn===c.valueColumn) errors.push("分類與數值欄位必須不同且為有效名稱");
 if(!finiteInt(canvasWidth)||!finiteInt(canvasHeight)||canvasWidth<320||canvasHeight<240 ||
    ![p.x,p.y,p.width,p.height].every(finiteInt)||
    p.x<0||p.y<0||p.width<160||p.height<120||
    p.x+p.width>canvasWidth||p.y+p.height>canvasHeight)errors.push("圖表位置或尺寸超出畫布");
 return errors;
}
// By design this file exports NO persistence function, API request, review
// assertion or real-data projection. This condition must never be toggled
// in UI code; 2B-15 requires independently reviewed server integration.
export const chartDraftPersistenceEnabled = false as const;
