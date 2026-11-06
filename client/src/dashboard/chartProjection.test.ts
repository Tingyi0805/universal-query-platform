import test from "node:test";
import assert from "node:assert/strict";
import {parseChartProjection,chartXY,chartPie,pieSlicePath} from "./chartProjection.js";
const bar={chartType:"BAR",showLegend:true,points:[{label:"A",value:8},{label:"B",value:5}]};
test("2B-15 accepts exactly the server projected-only DTO, not Query rows or Widget flags",()=>{
 assert.deepEqual(parseChartProjection(bar),bar);
 for(const extra of [{rows:[{PATIENT_ID:"secret"}]},{authorized:true},{configJson:"{}"},{querySql:"SELECT *"}]){
   assert.equal(parseChartProjection({...bar,...extra}),null);
 }
 assert.equal(parseChartProjection({chartType:"BAR",showLegend:true,points:[{label:"A",value:1,PATIENT_ID:"secret"}]}),null);
 assert.equal(parseChartProjection({chartType:"BAR",showLegend:true,points:[{label:"A",value:1,details:{NAME:"secret"}}]}),null);
 assert.equal(parseChartProjection({chartType:{toString:()=>"BAR"},showLegend:true,points:[]}),null);
 assert.equal(parseChartProjection({chartType:"BAR",showLegend:1,points:[]}),null);
 assert.equal(parseChartProjection({chartType:"BAR",showLegend:true,points:[{label:"A",value:"8"}]}),null);
 assert.equal(parseChartProjection({chartType:"BAR",showLegend:true,points:Array.from({length:51},(_,i)=>({label:String(i),value:i}))}),null);
});
test("2B-15 no invalid numbers, duplicate categories or negative pie are rendered",()=>{
 for(const points of [
   [{label:"a",value:Number.NaN}],[{label:"a",value:Infinity}],
   [{label:"a",value:1e13}],[{label:"a",value:1},{label:"a",value:2}],
   [{label:"",value:2}],
 ])assert.equal(parseChartProjection({...bar,points}),null);
 assert.equal(parseChartProjection({...bar,chartType:"PIE",points:[{label:"A",value:-1}]}),null);
 assert.equal(parseChartProjection({...bar,chartType:"PIE",points:[{label:"A",value:0}]}),null);
 assert.deepEqual(parseChartProjection({...bar,points:[]}),{...bar,points:[]});
});
test("2B-15 negative bars and lines stay bounded in the fullscreen viewBox",()=>{
 const shapes=chartXY([{label:"minus",value:-7},{label:"plus",value:9}]);
 assert(shapes.zeroY>46&&shapes.zeroY<260);
 for(const b of shapes.bars){
   assert(b.x>=62&&b.x+b.width<=746);
   assert(b.y>=45&&b.y+b.height<=261);
   assert(b.height>=0&&b.width>0);
 }
 for(const p of shapes.line)assert(p.x>=62&&p.x<=746&&p.y>=45&&p.y<=261);
});
test("2B-15 pie geometry supports single, zero and multiple categories",()=>{
 const slices=chartPie([{label:"A",value:8},{label:"B",value:0},{label:"C",value:12}]);
 assert.equal(slices.length,2);
 assert(Math.abs(slices.reduce((sum,p)=>sum+p.fraction,0)-1)<1e-12);
 assert.match(pieSlicePath(0,0.75),/A 106 106 0 1 1/);
 assert.equal(chartPie([{label:"A",value:0}]).length,0);
});
