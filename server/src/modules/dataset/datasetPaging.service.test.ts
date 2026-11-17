import test from "node:test";
import assert from "node:assert/strict";
import {compileSavedPage,createSavedDatasetPager,savedPageDependencies,type SavedPagePlan} from "./datasetPaging.service.js";
const plan:SavedPagePlan={page:2,pageSize:10,orderBy:["ID"],search:{column:"姓名",text:"王%_[~' OR 1=1"},sort:{column:"姓名",direction:"DESC"}};
for(const type of ["SQLSERVER","ORACLE"] as const)test(`${type}: DB COUNT/OFFSET, Unicode, saved binds and literal wildcard search`,()=>{
 const c=compileSavedPage("SELECT ID, 姓名 FROM Visits WHERE CLINIC={{CLINIC}};",type,{CLINIC:"SYNTHETIC"},plan);
 assert.match(c.countSql,/COUNT(?:_BIG)?\(\*\)/);if(type==="SQLSERVER")assert.match(c.pageSql,/OFFSET .* ROWS FETCH NEXT .* ROWS ONLY/);else{assert.match(c.pageSql,/ROW_NUMBER\(\) OVER\(ORDER BY/);assert.match(c.pageSql,/UQP_HP_ROW_NUMBER>:/);assert(!c.pageSql.includes("FETCH NEXT"));}
 assert(!c.pageSql.includes(plan.search!.text));assert(!c.pageSql.includes("SYNTHETIC"));assert.equal(c.binds.CLINIC,"SYNTHETIC");
 assert.match(String(c.binds.UQP_HP_SEARCH),/~%~_/);assert.match(c.pageSql,/姓名/);
});
for(const source of ["WITH x AS(SELECT 1 a) SELECT a FROM x","SELECT 1 a ORDER BY a","SELECT 1;SELECT 2","SELECT * INTO t FROM q","DELETE FROM q","SELECT * FROM OPENQUERY(x,'SELECT 1')"])
 test("non-composable/read-write SQL is refused before any execution: "+source.slice(0,22),()=>assert.throws(()=>compileSavedPage(source,"SQLSERVER",{},plan)));
test("dialect, field injection, invalid sort and bind namespace collisions are refused",()=>{
 for(const p of [{...plan,orderBy:["ID];DROP TABLE t--"]},{...plan,sort:{column:"ID",direction:"DESC;DELETE"}},{...plan,page:0},{...plan,pageSize:101}])
  assert.throws(()=>compileSavedPage("SELECT ID FROM t","SQLSERVER",{},p as SavedPagePlan));
 assert.throws(()=>compileSavedPage("SELECT ID FROM t","MYSQL",{},plan));
 assert.throws(()=>compileSavedPage("SELECT 1 AS UQP_HP_ROW_NUMBER FROM t","ORACLE",{},plan));
 assert.throws(()=>compileSavedPage("SELECT {{UQP_HP_SEARCH}} ID FROM t","SQLSERVER",{UQP_HP_SEARCH:"x"},plan));
});
async function fixture(countValue:unknown=45,cap=100,type:"SQLSERVER"|"ORACLE"="SQLSERVER"){
 const calls:{sql:string;binds:Record<string,unknown>;maxRows:number}[]=[];let invalid=false;
 const pager=createSavedDatasetPager({...savedPageDependencies,
  getDataset:async()=>({id:1,dataSourceId:2,sqlText:"SELECT ID, NAME FROM Visits",isActive:true,isArchived:false,maxRows:cap,queryTimeoutSec:5}) as any,
  getDataSourceConfig:async()=>({type,isActive:true,queryTimeoutSec:5}) as any,listDatasetParameters:async()=>[],
  createAdapter:async()=>({testConnection:async()=>({ok:true,message:"synthetic"}),executeQuery:async(_config,input)=>{calls.push(input);
   const isCount=input.sql.includes(" AS UQP_HP_TOTAL");
   return {columns:[{name:"ID"},{name:"NAME"},...(type==="ORACLE"?[{name:"UQP_HP_ROW_NUMBER"}]:[])],rows:isCount?[{UQP_HP_TOTAL:countValue}]:countValue===0?[]:invalid?Array.from({length:11},()=>({ID:1,NAME:"x"})):[{ID:11,NAME:"合成",...(type==="ORACLE"?{UQP_HP_ROW_NUMBER:11}:{})}],truncated:invalid&&!isCount,rowCount:1,elapsedMs:1};}}),
 });
 return {calls,pager,invalid:()=>{invalid=true;}};
}
test("only requested DB page is fetched; never materializes the complete dataset",async()=>{
 const f=await fixture();const result=await f.pager(1,{}, {...plan,search:null,sort:null});
 assert.deepEqual(result.pagination,{page:2,pageSize:10,totalRows:45,totalPages:5,capped:false});assert.equal(f.calls.length,2);
 assert.equal(f.calls[1]!.binds.UQP_HP_OFFSET,10);assert.equal(f.calls[1]!.binds.UQP_HP_LIMIT,10);assert.equal(f.calls[1]!.maxRows,10);
});
test("Oracle internal paging ordinal is stripped from both metadata and delivered values",async()=>{
 const f=await fixture("45",100,"ORACLE"),r=await f.pager(1,{}, {...plan,search:null,sort:null});
 assert.match(f.calls[1]!.sql,/ROW_NUMBER\(\)/);assert.equal(f.calls[1]!.binds.UQP_HP_OFFSET,10);
 assert.deepEqual(r.result.columns,[{name:"ID"},{name:"NAME"}]);assert.deepEqual(r.result.rows,[{ID:11,NAME:"合成"}]);
 assert(!JSON.stringify(r).includes("UQP_HP_ROW_NUMBER"));
});
test("Dataset maxRows is preserved, large COUNT stays exact and empty results still have column metadata",async()=>{
 const f=await fixture("9007199254740993",15),r=await f.pager(1,{}, {...plan,search:null,sort:null});
 assert.equal(r.pagination.capped,true);assert.equal(r.pagination.totalRows,15);assert.equal(f.calls[1]!.maxRows,5);
 const empty=await fixture(0);const z=await empty.pager(1,{}, {...plan,page:1,search:null,sort:null});assert.equal(z.pagination.totalPages,1);assert.equal(z.result.columns.length,2);
});
test("unsafe COUNT Number, unknown parameters, out-of-range page and truncated DB page fail closed",async()=>{
 const bad=await fixture(9007199254740992);await assert.rejects(bad.pager(1,{},plan),/HIERARCHY_COUNT_INVALID/);
 const f=await fixture();await assert.rejects(f.pager(1,{SQL:"DROP"},plan),/HIERARCHY_PARAMETERS_INVALID/);assert.equal(f.calls.length,0);
 await assert.rejects(f.pager(1,{}, {...plan,page:100}),/HIERARCHY_PAGE_OUT_OF_RANGE/);assert.equal(f.calls.length,1);
 const truncated=await fixture();truncated.invalid();await assert.rejects(truncated.pager(1,{},plan),/HIERARCHY_PAGE_INVALID/);
});
