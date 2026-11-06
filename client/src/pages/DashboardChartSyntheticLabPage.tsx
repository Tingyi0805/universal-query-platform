// Stage 18: isolated, browser-only CHART usability lab. No API, PHI,
// storage, Widget writes, permission grants, signer, or production CHART.
import {useEffect,useRef,useState,type PointerEvent as ReactPointerEvent} from "react";
import {flushSync} from "react-dom";
import {Link} from "react-router-dom";
import {DashboardChartProjection} from "../components/DashboardChartProjection";
import {ChartPlacementNumberInput} from "../components/ChartPlacementNumberInput";
import {
 chartDraftErrors,clampChartPlacement,newChartDraft,
 type ChartDraft,type ChartDraftConfig,type DraftChartType,
} from "../dashboard/chartDraft";
import "./DashboardChartSyntheticLabPage.css";

type Scenario="waiting"|"rooms"|"capacity";
type LabItem={id:number;title:string;scenario:Scenario;draft:ChartDraft};
const TYPES:Record<DraftChartType,string>={BAR:"長條圖",LINE:"折線圖",PIE:"圓餅圖"};
const SCENARIOS:Record<Scenario,{name:string;points:readonly {label:string;value:number}[]}>={
 waiting:{name:"合成候診數量",points:[
  {label:"區域 A",value:8},{label:"區域 B",value:5},{label:"區域 C",value:11}]},
 rooms:{name:"合成檢查室進度",points:[
  {label:"檢查室 1",value:3},{label:"檢查室 2",value:6},{label:"檢查室 3",value:2}]},
 capacity:{name:"合成空間使用量",points:[
  {label:"空間 A",value:12},{label:"空間 B",value:9},{label:"空間 C",value:15}]},
};
const SOURCES=["PRIMARY","WARD","OR"] as const;
const SCREENS={
 "1920x1080":{width:1920,height:1080,label:"1920 × 1080（橫向）"},
 "1080x1920":{width:1080,height:1920,label:"1080 × 1920（直向）"},
 "1366x768":{width:1366,height:768,label:"1366 × 768"},
} as const;
type Screen=keyof typeof SCREENS;
type ScreenChoice=Screen|"custom";
const first=():LabItem=>({
 id:1,title:"候診統計（合成資料）",scenario:"waiting",draft:newChartDraft(),
});
const withPlacement=(item:LabItem,width:number,height:number):LabItem=>({
 ...item,draft:{...item.draft,
  placement:clampChartPlacement(item.draft.placement,width,height)},
});

export function DashboardChartSyntheticLabPage({standalone=false}:{standalone?:boolean}={}){
 const [items,setItems]=useState<LabItem[]>(()=>[first()]);
 const [selected,setSelected]=useState(1);
 const [screen,setScreen]=useState<ScreenChoice>("1920x1080");
 const [canvasSize,setCanvasSize]=useState<{width:number;height:number}>({width:1920,height:1080});
 const [customSize,setCustomSize]=useState({width:"1600",height:"900"});
 const [screenError,setScreenError]=useState("");
 const [preview,setPreview]=useState(false);
 const idRef=useRef(2);
 const canvasRef=useRef<HTMLDivElement>(null);
 const fullscreenRef=useRef<HTMLDivElement>(null);
 const dragRef=useRef<{id:number;pointer:number;x:number;y:number;startX:number;startY:number}|null>(null);
 const {width,height}=canvasSize;
 const active=items.find(i=>i.id===selected)??items[0]!;
 const update=(fn:(item:LabItem)=>LabItem)=>
   setItems(list=>list.map(item=>item.id===selected?fn(item):item));
 const updateConfig=(v:Partial<ChartDraftConfig>)=>update(i=>({
   ...i,draft:{...i.draft,config:{...i.draft.config,...v}},
 }));
 const updatePlacement=(v:Partial<ChartDraft["placement"]>)=>update(i=>({
   ...i,draft:{...i.draft,placement:clampChartPlacement(
    {...i.draft.placement,...v},width,height)},
 }));
 const create=()=>{
   const id=idRef.current++;
   const draft=newChartDraft();
   const placement=clampChartPlacement({
     ...draft.placement,x:80+(items.length%4)*60,
     y:80+(items.length%4)*50},width,height);
   setItems(old=>[...old,{id,title:"合成圖表 "+id,scenario:"waiting",
     draft:{...draft,placement}}]);
   setSelected(id);
 };
 const duplicate=()=>{
   const id=idRef.current++;
   const placement=clampChartPlacement({
     ...active.draft.placement,x:active.draft.placement.x+60,
     y:active.draft.placement.y+60},width,height);
   setItems(old=>[...old,{...active,id,title:active.title+"（副本）",
     draft:{...active.draft,placement}}]);
   setSelected(id);
 };
 const remove=()=>{
   if(items.length===1){setItems([first()]);setSelected(1);return;}
   setItems(old=>old.filter(item=>item.id!==selected));
   setSelected(items.find(item=>item.id!==selected)!.id);
 };
 const applyCanvasSize=(w:number,h:number)=>{
   setCanvasSize({width:w,height:h});
   setItems(old=>old.map(i=>withPlacement(i,w,h)));
 };
 const resize=(next:ScreenChoice)=>{
   setScreen(next);
   setScreenError("");
   if(next==="custom"){
     setCustomSize({width:String(width),height:String(height)});
     return;
   }
   applyCanvasSize(SCREENS[next].width,SCREENS[next].height);
 };
 const applyCustomSize=()=>{
   const rawWidth=customSize.width.trim(),rawHeight=customSize.height.trim();
   const w=Number(rawWidth),h=Number(rawHeight);
   if(!/^\d+$/.test(rawWidth)||!/^\d+$/.test(rawHeight)||
     !Number.isSafeInteger(w)||!Number.isSafeInteger(h)||
     w<320||w>7680||h<240||h>4320){
     setScreenError("自訂尺寸須為整數：寬度 320～7680，高度 240～4320 像素。");
     return;
   }
   setScreenError("");
   applyCanvasSize(w,h);
 };
 const reset=()=>{
   setItems([first()]);setSelected(1);idRef.current=2;
   setScreen("1920x1080");
   setCanvasSize({width:1920,height:1080});
   setCustomSize({width:"1600",height:"900"});
   setScreenError("");
 };
 const beginDrag=(e:ReactPointerEvent<HTMLButtonElement>,item:LabItem)=>{
   if(preview||e.button!==0)return;
   setSelected(item.id);
   dragRef.current={id:item.id,pointer:e.pointerId,x:e.clientX,y:e.clientY,
     startX:item.draft.placement.x,startY:item.draft.placement.y};
   e.currentTarget.setPointerCapture(e.pointerId);
 };
 const duringDrag=(e:ReactPointerEvent<HTMLButtonElement>)=>{
   const drag=dragRef.current;
   const rect=canvasRef.current?.getBoundingClientRect();
   if(!drag||drag.pointer!==e.pointerId||!rect||!rect.width||!rect.height)return;
   const newX=drag.startX+Math.round((e.clientX-drag.x)/rect.width*width);
   const newY=drag.startY+Math.round((e.clientY-drag.y)/rect.height*height);
   setItems(old=>old.map(i=>i.id!==drag.id?i:{
     ...i,draft:{...i.draft,placement:clampChartPlacement(
       {...i.draft.placement,x:newX,y:newY},width,height)},
   }));
 };
 const finishDrag=()=>{dragRef.current=null;};
 const closePreview=()=>{
   if(document.fullscreenElement===fullscreenRef.current){
     void document.exitFullscreen().catch(()=>undefined);
   }
   setPreview(false);
 };
 const openPreview=()=>{
   flushSync(()=>setPreview(true));
   // Browser Fullscreen API when available; fixed viewport fallback otherwise.
   void fullscreenRef.current?.requestFullscreen?.().catch(()=>undefined);
 };
 useEffect(()=>{
   if(!preview)return;
   const key=(e:KeyboardEvent)=>{if(e.key==="Escape")setPreview(false);};
   const full=()=>{if(!document.fullscreenElement)setPreview(false);};
   document.addEventListener("keydown",key);
   document.addEventListener("fullscreenchange",full);
   return ()=>{document.removeEventListener("keydown",key);
     document.removeEventListener("fullscreenchange",full);};
 },[preview]);
 const chartView=(item:LabItem)=><DashboardChartProjection
    ariaLabel={item.title+"，僅合成資料"}
    projection={{chartType:item.draft.config.chartType,
      showLegend:item.draft.config.showLegend,
      points:SCENARIOS[item.scenario].points.slice(0,item.draft.config.maxPoints)}}/>;
 const chartCanvas=(readonly:boolean)=><div
   ref={readonly?undefined:canvasRef}
   className={"chart-lab-canvas"+(readonly?" chart-lab-playback":"")}
   style={{aspectRatio:width+" / "+height}}
   aria-label={readonly?"合成圖表播放畫布":"合成圖表編排畫布"}>
   {items.map(item=>{
     const p=clampChartPlacement(item.draft.placement,width,height);
     return <article key={item.id}
       className={"chart-lab-item"+(!readonly&&selected===item.id?" selected":"")}
       style={{left:(p.x/width*100)+"%",top:(p.y/height*100)+"%",
         width:(p.width/width*100)+"%",height:(p.height/height*100)+"%"}}>
       {readonly?<strong className="chart-lab-item-heading">{item.title}</strong>:
         <button type="button" className="chart-lab-item-heading chart-lab-drag"
           aria-label={"拖曳或選取 "+item.title}
           onPointerDown={e=>beginDrag(e,item)}
           onPointerMove={duringDrag}
           onPointerUp={finishDrag} onPointerCancel={finishDrag}
           onClick={()=>setSelected(item.id)}>{item.title}</button>}
       <div className="chart-lab-graphic">{chartView(item)}</div>
     </article>;
   })}
 </div>;
 return <main className="page-shell chart-lab" aria-label="合成資料圖表實測區">
   <header className="chart-lab-header">
     <div>
       <p className="eyebrow">Dashboard Chart · Stage 18</p>
       <h1>Dashboard 圖表功能實測區</h1>
       <p className="subtitle">可新增多張圖表、調整圖形與位置、模擬不同螢幕並全螢幕預覽。</p>
     </div>
     {!standalone&&<Link to="/designer/dashboards" className="secondary-button link-button">返回 Dashboard 設計</Link>}
   </header>
   <p className="chart-lab-warning" role="status">
     <strong>合成資料測試模式</strong>：所有圖表均為虛構數據，沒有查詢 API、
     患者資料、正式 Widget 儲存或 SQL 寫入。離開／重新整理後不保留本頁設定；
     正式 CHART 仍未啟用。
   </p>
   <div className="chart-lab-toolbar">
     <label>螢幕版型
       <select aria-label="螢幕版型" value={screen}
         onChange={e=>resize(e.target.value as ScreenChoice)}>
         {Object.entries(SCREENS).map(([key,s])=><option value={key} key={key}>{s.label}</option>)}
         <option value="custom">自訂寬度 × 高度</option>
       </select>
     </label>
     {screen==="custom"&&<div className="chart-lab-custom-size" role="group" aria-label="自訂螢幕尺寸">
       <label>寬度（px）
         <input aria-label="自訂畫布寬度" inputMode="numeric" value={customSize.width}
           onChange={e=>setCustomSize(v=>({...v,width:e.target.value}))}/>
       </label>
       <span aria-hidden="true">×</span>
       <label>高度（px）
         <input aria-label="自訂畫布高度" inputMode="numeric" value={customSize.height}
           onChange={e=>setCustomSize(v=>({...v,height:e.target.value}))}/>
       </label>
       <button type="button" onClick={applyCustomSize}>套用自訂尺寸</button>
     </div> 
     <button type="button" onClick={create}>＋新增圖表</button>
     <button type="button" onClick={duplicate}>複製選取圖表</button>
     <button type="button" onClick={remove}>移除選取圖表</button>
     <button type="button" onClick={openPreview}>開啟合成全螢幕預覽</button>
     <button type="button" onClick={reset}>重設所有合成設定</button>
   </div>
   {screenError&&<p role="alert" className="chart-lab-screen-error">{screenError}</p>}
   <div className="chart-lab-layout">
     <aside className="chart-lab-editor" aria-label="合成圖表編輯器">
       <h2>圖表編輯</h2>
       <label>選取圖表
         <select aria-label="選取圖表" value={selected}
           onChange={e=>setSelected(Number(e.target.value))}>
           {items.map(item=><option key={item.id} value={item.id}>{item.title}</option>)}
         </select>
       </label>
       <label>圖表標題
         <input aria-label="圖表標題" maxLength={60} value={active.title}
           onChange={e=>update(i=>({...i,title:e.target.value}))}/>
       </label>
       <label>圖表類型
         <select aria-label="圖表類型" value={active.draft.config.chartType}
           onChange={e=>updateConfig({chartType:e.target.value as DraftChartType})}>
           {Object.entries(TYPES).map(([kind,label])=>
             <option key={kind} value={kind}>{label}</option>)}
         </select>
       </label>
       <label>合成資料情境
         <select aria-label="合成資料情境" value={active.scenario}
           onChange={e=>update(i=>({...i,scenario:e.target.value as Scenario}))}>
           {Object.entries(SCENARIOS).map(([key,scenario])=>
             <option key={key} value={key}>{scenario.name}</option>)}
         </select>
       </label>
       <label>資料來源標籤（不執行 Query）
         <select aria-label="資料來源標籤" value={active.draft.config.dataSourceKey}
           onChange={e=>updateConfig({dataSourceKey:e.target.value})}>
           {SOURCES.map(key=><option key={key} value={key}>{key}</option>)}
         </select>
       </label>
       <label>分類欄位名稱
         <input aria-label="分類欄位名稱" value={active.draft.config.categoryColumn}
           maxLength={128} onChange={e=>updateConfig({categoryColumn:e.target.value})}/>
       </label>
       <label>數值欄位名稱
         <input aria-label="數值欄位名稱" value={active.draft.config.valueColumn}
           maxLength={128} onChange={e=>updateConfig({valueColumn:e.target.value})}/>
       </label>
       <label>顯示資料點數（1～50）
         <input aria-label="顯示資料點數" type="number" min={1} max={50}
           value={active.draft.config.maxPoints}
           onChange={e=>updateConfig({maxPoints:Number(e.target.value)})}/>
       </label>
       <label className="chart-lab-check">
         <input type="checkbox" checked={active.draft.config.showLegend}
           onChange={e=>updateConfig({showLegend:e.target.checked})}/><span>顯示圖例</span>
       </label>
       <h3>位置與尺寸（像素）</h3>
       <div className="chart-lab-coordinates">
         {(["x","y","width","height"] as const).map(key=>
           <ChartPlacementNumberInput key={selected+":"+screen+":"+key}
             label={key.toUpperCase()} ariaLabel={"位置 "+key.toUpperCase()}
             value={active.draft.placement[key]}
             min={key==="width"?160:key==="height"?120:0}
             onCommit={value=>updatePlacement({[key]:value})}/>
         )}
       </div>
       {chartDraftErrors(active.draft,width,height,SOURCES).length>0&&
        <p role="alert" className="chart-lab-errors">
         {chartDraftErrors(active.draft,width,height,SOURCES).join("；")}
        </p>}
       <p className="chart-lab-helper">
         亦可在畫布拖曳圖表標題移動。測試不會更動既有 Dashboard 版型。
       </p>
     </aside>
     <section className="chart-lab-stage" aria-label="合成資料圖表預覽">
       <h2>合成畫布 · {width} × {height}</h2>
       {chartCanvas(false)}
       <p className="chart-lab-helper">這是模擬播放效果，不是正式 Dashboard 播放頁。</p>
     </section>
   </div>
   {preview&&<div ref={fullscreenRef} className="chart-lab-fullscreen"
       role="dialog" aria-modal="true" aria-label="合成圖表全螢幕預覽">
     <div className="chart-lab-fullscreen-toolbar">
       <strong>合成資料 · 全螢幕預覽 · {width} × {height}</strong>
       <button type="button" onClick={closePreview}>退出全螢幕</button>
     </div>
     <div className="chart-lab-fullscreen-canvas">{chartCanvas(true)}</div>
     <p>僅合成測試，非正式 CHART 播放；按 Esc 或上方按鈕退出。</p>
   </div>}
 </main>;
}
