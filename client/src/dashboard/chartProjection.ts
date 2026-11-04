// 2B-15 presentation contract, NOT an authorization check.
// The backend must independently verify CHART seal, Query access, PUBLIC review,
// patient disclosure audit and all revisions before returning this projection.
// Never convert arbitrary Query rows or Widget ConfigJson to chart data here.
export type ChartProjection = Readonly<{
  chartType: "BAR" | "LINE" | "PIE";
  showLegend: boolean;
  points: readonly Readonly<{label:string;value:number}>[];
}>;
export type ChartBar = Readonly<{x:number;y:number;width:number;height:number;label:string;value:number}>;
export type ChartPointXY = Readonly<{x:number;y:number;label:string;value:number}>;
export type ChartSlice = Readonly<{label:string;value:number;start:number;end:number;fraction:number}>;

export function parseChartProjection(raw:unknown):ChartProjection|null {
  if(!raw||typeof raw!=="object"||Array.isArray(raw)) return null;
  const obj=raw as Record<string,unknown>;
  const keys=Object.keys(obj).sort();
  if(keys.join("|")!=="chartType|points|showLegend"||
      !["BAR","LINE","PIE"].includes(String(obj.chartType))||
      typeof obj.showLegend!=="boolean"||
      !Array.isArray(obj.points)||obj.points.length>50) return null;
  const seen=new Set<string>();
  const points:{label:string;value:number}[]=[];
  for(const point of obj.points){
    if(!point||typeof point!=="object"||Array.isArray(point))return null;
    const p=point as Record<string,unknown>;
    if(Object.keys(p).sort().join("|")!=="label|value"||
       typeof p.label!=="string"||p.label.length<1||p.label.length>100||
       typeof p.value!=="number"||!Number.isFinite(p.value)||
       Math.abs(p.value)>1_000_000_000_000||
       (Number.isInteger(p.value)&&!Number.isSafeInteger(p.value))||
       seen.has(p.label))return null;
    if(obj.chartType==="PIE"&&p.value<0)return null;
    seen.add(p.label);points.push({label:p.label,value:p.value});
  }
  if(obj.chartType==="PIE"&&points.length>0&&
      !points.some(p=>p.value>0))return null;
  return {chartType:obj.chartType as ChartProjection["chartType"],
    showLegend:obj.showLegend,points};
}

/** Numeric geometry only. SVG text is rendered by React, never interpolated
 * into SVG paths. Fullscreen rendering can scale this fixed viewBox safely.
 */
export function chartXY(points:ChartProjection["points"]):{
  bars:ChartBar[];line:ChartPointXY[];zeroY:number;
}{
  const minimum=Math.min(0,...points.map(p=>p.value));
  const maximum=Math.max(0,...points.map(p=>p.value));
  const spread=maximum-minimum||1;
  const y=(value:number)=>260-(value-minimum)/spread*214;
  const zeroY=y(0),n=Math.max(points.length,1),band=684/n;
  return {
    zeroY,
    bars:points.map((p,i)=>{
      const yValue=y(p.value);
      return {x:62+i*band+band*0.16,y:Math.min(zeroY,yValue),
        width:band*0.68,height:Math.abs(zeroY-yValue),label:p.label,value:p.value};
    }),
    line:points.map((p,i)=>({
      x:62+(i+0.5)*band,y:y(p.value),label:p.label,value:p.value,
    })),
  };
}
export function chartPie(points:ChartProjection["points"]):ChartSlice[] {
  const total=points.reduce((sum,p)=>sum+p.value,0);
  if(!Number.isFinite(total)||total<=0)return [];
  let pos=0;
  return points.map(p=>{
    const fraction=p.value/total;
    const start=pos;
    pos+=fraction;
    return {label:p.label,value:p.value,fraction,start,end:pos};
  }).filter(p=>p.fraction>0);
}
export function pieSlicePath(start:number,end:number):string {
  const centerX=400,centerY=150,radius=106;
  const locate=(n:number)=>({
    x:centerX+radius*Math.cos(n*2*Math.PI-Math.PI/2),
    y:centerY+radius*Math.sin(n*2*Math.PI-Math.PI/2),
  });
  const a=locate(start),b=locate(end);
  const large=end-start>0.5?1:0;
  return `M ${centerX} ${centerY} L ${a.x} ${a.y} A ${radius} ${radius} 0 ${large} 1 ${b.x} ${b.y} Z`;
}
