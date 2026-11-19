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
export type SavedPagePlan={page:number;pageSize:number;orderBy:string[];search:{column:string;text:string}|null;sort:{column:string;direction:"ASC"|"DESC"}|null;expectedWitness?:string};
const fail=():never=>{throw new Error("HIERARCHY_PAGING_UNSUPPORTED");};
export function compileSavedPage(sqlText:string,type:DataSourceType,values:Record<string,unknown>,plan:SavedPagePlan){
 assertSelectOnlySql(sqlText);
 // Only safely composable SELECT. Reject unsupported shapes instead of rewriting their meaning.
 const clean=sqlText.trim().replace(/;\s*$/,"");
 const words=clean.replace(/'(?:''|[^'])*'/g,"''");
 if(/\bUQP_HP_[A-Z_]+\b/i.test(words))return fail();
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
 // A bounded ordered-key witness detects membership/order drift between pages.
 // One source transaction protects count, uniqueness, witness and page together.
 // It is not a source DDL fence or a snapshot held across HTTP requests.
 const consistentSql=type!=="SQLSERVER"?null:`SET XACT_ABORT ON; SET ROWCOUNT 0; SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
 BEGIN TRY BEGIN TRAN;
 DECLARE @uqp_total bigint,@uqp_witness varbinary(32);
 SELECT @uqp_total=COUNT_BIG(*)${from};
 IF EXISTS(SELECT 1${from} GROUP BY ${plan.orderBy.map(n=>`uqp_page.${quote(n)}`).join(",")} HAVING COUNT_BIG(*)>1)
 THROW 51929,'HIERARCHY_NON_UNIQUE_ORDER',1;
 SELECT @uqp_witness=HASHBYTES('SHA2_256',CONVERT(nvarchar(max),COALESCE((SELECT TOP (${bind("CAPPLUS")}) uqp_page.*${from} ORDER BY ${order} FOR JSON PATH,INCLUDE_NULL_VALUES),N'[]')));
 SELECT CONVERT(varchar(20),@uqp_total) UQP_HP_TOTAL,CONVERT(varchar(64),@uqp_witness,2) UQP_HP_WITNESS,uqp_rows.*
 FROM (SELECT 1 placeholder) uqp_count OUTER APPLY(SELECT 1 UQP_HP_HAS_ROW,uqp_page.*${from} ORDER BY ${order} OFFSET ${bind("OFFSET")} ROWS FETCH NEXT ${bind("LIMIT")} ROWS ONLY) uqp_rows
 ORDER BY ${keys.map((n,i)=>`uqp_rows.${quote(n)} ${i===0&&plan.sort?plan.sort.direction:"ASC"}`).join(",")};
 COMMIT; SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
 END TRY BEGIN CATCH IF XACT_STATE()<>0 ROLLBACK; SET TRANSACTION ISOLATION LEVEL READ COMMITTED; THROW; END CATCH;`;
 return {consistentSql,countSql:`SELECT ${type==="SQLSERVER"?"COUNT_BIG":"COUNT"}(*) AS UQP_HP_TOTAL${from}`,
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
 if(compiled.consistentSql){
  if(!Number.isSafeInteger(ds.maxRows)||ds.maxRows<1||ds.maxRows>1000000)throw new Error("HIERARCHY_LIMIT_INVALID");
  const offset=(plan.page-1)*plan.pageSize,limit=Math.min(plan.pageSize,Math.max(1,ds.maxRows-offset));
  const raw=await adapter.executeQuery(source,{sql:compiled.consistentSql,binds:{...compiled.binds,UQP_HP_OFFSET:offset,UQP_HP_LIMIT:limit,UQP_HP_CAPPLUS:ds.maxRows+1},maxRows:limit,timeoutSec:ds.queryTimeoutSec??source.queryTimeoutSec});
  if(raw.truncated)throw new Error("HIERARCHY_PAGE_INVALID");
  const first=raw.rows[0],text=first?.UQP_HP_TOTAL,witness=typeof first?.UQP_HP_WITNESS==="string"?first.UQP_HP_WITNESS.toLowerCase():"";
  if(typeof text!=="string"||!/^(0|[1-9][0-9]*)$/.test(text)||!/^[a-f0-9]{64}$/.test(witness)||raw.rows.some(r=>r.UQP_HP_TOTAL!==text||String(r.UQP_HP_WITNESS).toLowerCase()!==witness))throw new Error("HIERARCHY_COUNT_INVALID");
  const sourceWitness=`${text}:${witness}`;
  if(plan.expectedWitness&&plan.expectedWitness!==sourceWitness)throw new Error("HIERARCHY_SOURCE_PAGE_CHANGED");
  const exact=BigInt(text),totalRows=Number(exact>BigInt(ds.maxRows)?BigInt(ds.maxRows):exact),totalPages=Math.max(1,Math.ceil(totalRows/plan.pageSize));
  if(plan.page>totalPages)throw new Error("HIERARCHY_PAGE_OUT_OF_RANGE");
  const rows=raw.rows.filter(r=>r.UQP_HP_HAS_ROW===1).map(r=>Object.fromEntries(Object.entries(r).filter(([n])=>!n.startsWith("UQP_HP_"))));
  if(rows.length!==Math.min(limit,Math.max(0,totalRows-offset))||raw.rows.some(r=>r.UQP_HP_HAS_ROW!==1&&(r.UQP_HP_HAS_ROW!==null||totalRows>offset)))throw new Error("HIERARCHY_PAGE_INVALID");
  return {sourceWitness,result:{...raw,columns:raw.columns.filter(c=>!c.name.startsWith("UQP_HP_")),rows,rowCount:rows.length,elapsedMs:Date.now()-started},pagination:{page:plan.page,pageSize:plan.pageSize,totalRows,totalPages,capped:exact>BigInt(ds.maxRows)}};
 }
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
