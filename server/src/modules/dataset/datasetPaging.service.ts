/** Saved SQL only. Browser column keys are resolved to policy-approved columns by the caller. */
import {getDataset} from "./dataset.repository.js";
import {listDatasetParameters} from "./parameter.repository.js";
import {getDataSourceConfig} from "../datasource/datasource.repository.js";
import {runtimeParameterDefinitions} from "./parameterSync.js";
import {coerceRuntimeParameters} from "./parameter.service.js";
import {assertSelectOnlySql} from "../../query/selectOnlySql.js";
import {compileQuery} from "../../query/queryCompiler.js";
import type {DataSourceAdapter} from "../datasource/adapters/datasourceAdapter.js";
import type {DataSourceType} from "../datasource/datasource.types.js";
export type SavedPagePlan={page:number;pageSize:number;orderBy:string[];search:{column:string;text:string}|null;sort:{column:string;direction:"ASC"|"DESC"}|null};
const fail=():never=>{throw new Error("HIERARCHY_PAGING_UNSUPPORTED");};
export function compileSavedPage(sqlText:string,type:DataSourceType,values:Record<string,unknown>,plan:SavedPagePlan){
 assertSelectOnlySql(sqlText);
 // Only safely composable SELECT. Reject unsupported shapes instead of rewriting their meaning.
 const clean=sqlText.trim().replace(/;\s*$/,"");
 const words=clean.replace(/'(?:''|[^'])*'/g,"''");
 if(/\bUQP_HP_ROW_NUMBER\b/i.test(words))return fail();
 if(!["SQLSERVER","ORACLE"].includes(type)||!/^SELECT\b/i.test(clean)||/;|--|\/\*|\b(?:ORDER\s+BY|OFFSET|FETCH|FOR\s+XML|FOR\s+JSON|OPTION|OPENQUERY|OPENROWSET|OPENDATASOURCE)\b/i.test(words))return fail();
 const identifiers=[...plan.orderBy,...(plan.search?[plan.search.column]:[]),...(plan.sort?[plan.sort.column]:[])];
 if(!plan.orderBy.length||identifiers.some(n=>!/^[\p{L}_][\p{L}\p{N}_ ]{0,127}$/u.test(n))||!Number.isSafeInteger(plan.page)||plan.page<1||!Number.isInteger(plan.pageSize)||plan.pageSize<1||plan.pageSize>100||plan.sort&&!['ASC','DESC'].includes(plan.sort.direction))return fail();
 const compiled=compileQuery(clean,type,values),prefix="UQP_HP_";
 if(Object.keys(compiled.binds).some(n=>n.toUpperCase().startsWith(prefix)))return fail();
 const quote=(n:string)=>type==="SQLSERVER"?`[${n}]`:`"${n}"`,bind=(n:string)=>type==="SQLSERVER"?`@${prefix}${n}`:`:${prefix}${n}`;
 const binds={...compiled.binds} as Record<string,unknown>;
 let where="";
 if(plan.search?.text){
  const escaped=plan.search.text.replace(type==="SQLSERVER"?/[~%_\[]/g:/[~%_]/g,c=>"~"+c);
  binds[prefix+"SEARCH"]="%"+escaped+"%";
  where=` WHERE CAST(uqp_page.${quote(plan.search.column)} AS ${type==="SQLSERVER"?"nvarchar(4000)":"varchar2(4000)"}) LIKE ${bind("SEARCH")} ESCAPE '~'`;
 }
 const keys=[...(plan.sort?[plan.sort.column]:[]),...plan.orderBy.filter(n=>n!==plan.sort?.column)];
 const order=keys.map((n,i)=>`uqp_page.${quote(n)} ${i===0&&plan.sort?plan.sort.direction:"ASC"}`).join(",");
 const from=` FROM (${compiled.sql}) uqp_page${where}`;
 return {countSql:`SELECT ${type==="SQLSERVER"?"COUNT_BIG":"COUNT"}(*) AS UQP_HP_TOTAL${from}`,
  pageSql:type==="SQLSERVER"?`SELECT uqp_page.*${from} ORDER BY ${order} OFFSET ${bind("OFFSET")} ROWS FETCH NEXT ${bind("LIMIT")} ROWS ONLY`:
   `SELECT * FROM (SELECT uqp_page.*,ROW_NUMBER() OVER(ORDER BY ${order}) AS UQP_HP_ROW_NUMBER${from}) uqp_ranked WHERE UQP_HP_ROW_NUMBER>${bind("OFFSET")} AND UQP_HP_ROW_NUMBER<=(${bind("OFFSET")}+${bind("LIMIT")}) ORDER BY UQP_HP_ROW_NUMBER`,binds};
}
export const savedPageDependencies={getDataset,listDatasetParameters,getDataSourceConfig,
 createAdapter:async(type:DataSourceType):Promise<DataSourceAdapter>=>(await import("../datasource/adapters/adapterFactory.js")).createDataSourceAdapter(type)};
export function createSavedDatasetPager(deps=savedPageDependencies){return async(datasetId:number,rawValues:Record<string,unknown>,plan:SavedPagePlan)=>{
 const ds=await deps.getDataset(datasetId);if(!ds?.isActive||ds.isArchived)throw new Error("DATASET_NOT_AVAILABLE");
 const source=await deps.getDataSourceConfig(ds.dataSourceId);if(!source?.isActive)throw new Error("DATASOURCE_DISABLED");
 const definitions=runtimeParameterDefinitions(ds.sqlText,await deps.listDatasetParameters(datasetId));
 if(Object.keys(rawValues).some(n=>!definitions.some(d=>d.name===n)))throw new Error("HIERARCHY_PARAMETERS_INVALID");
 const values=coerceRuntimeParameters(definitions,rawValues),compiled=compileSavedPage(ds.sqlText,source.type,values,plan);
 const adapter=await deps.createAdapter(source.type),started=Date.now();
 const count=await adapter.executeQuery(source,{sql:compiled.countSql,binds:compiled.binds,maxRows:1,timeoutSec:ds.queryTimeoutSec??source.queryTimeoutSec});
 const text=String(count.rows[0]?.UQP_HP_TOTAL??"");
 if(count.truncated||count.rows.length!==1||!/^(0|[1-9][0-9]*)$/.test(text)||typeof count.rows[0]?.UQP_HP_TOTAL==="number"&&!Number.isSafeInteger(count.rows[0].UQP_HP_TOTAL))throw new Error("HIERARCHY_COUNT_INVALID");
 const exact=BigInt(text);if(!Number.isSafeInteger(ds.maxRows)||ds.maxRows<1)throw new Error("HIERARCHY_LIMIT_INVALID");
 const totalRows=Number(exact>BigInt(ds.maxRows)?BigInt(ds.maxRows):exact),totalPages=Math.max(1,Math.ceil(totalRows/plan.pageSize));
 if(plan.page>totalPages)throw new Error("HIERARCHY_PAGE_OUT_OF_RANGE");
 const offset=(plan.page-1)*plan.pageSize,limit=Math.min(plan.pageSize,Math.max(1,totalRows-offset));
 const result=await adapter.executeQuery(source,{sql:compiled.pageSql,binds:{...compiled.binds,UQP_HP_OFFSET:offset,UQP_HP_LIMIT:limit},maxRows:limit,timeoutSec:ds.queryTimeoutSec??source.queryTimeoutSec});
 if(result.truncated||result.rows.length>limit||result.rows.length>Math.max(0,totalRows-offset))throw new Error("HIERARCHY_PAGE_INVALID");
 const pageResult=source.type==="ORACLE"?{...result,columns:result.columns.filter(c=>c.name!=="UQP_HP_ROW_NUMBER"),
  rows:result.rows.map(row=>Object.fromEntries(Object.entries(row).filter(([name])=>name!=="UQP_HP_ROW_NUMBER")))}:result;
 return {result:{...pageResult,elapsedMs:Date.now()-started},pagination:{page:plan.page,pageSize:plan.pageSize,totalRows,totalPages,capped:exact>BigInt(ds.maxRows)}};
};}
export const executeSavedDatasetPage=createSavedDatasetPager();
