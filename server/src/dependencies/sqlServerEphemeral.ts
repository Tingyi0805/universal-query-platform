// Explicit CI-only SELECT smoke. Never reads platform/data-source settings or runs DDL.
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { SqlServerAdapter } from "../modules/datasource/adapters/sqlServerAdapter.js";
import { createQueryExcel } from "../modules/export/excelExport.service.js";
import type { DataSourceConfig } from "../modules/datasource/datasource.types.js";
let stage="guard";
async function main(){
 if(process.env.GITHUB_ACTIONS!=="true"||process.env.UQP75_SQL_SCOPE!=="EPHEMERAL_CI_ONLY"||!process.env.UQP75_SQL_PASSWORD)throw new Error("EPHEMERAL_CI_ONLY");
 stage="connect";
 const config:DataSourceConfig={code:"CI_SYNTHETIC_ONLY",name:"CI synthetic",type:"SQLSERVER",host:"127.0.0.1",port:14335,databaseName:"master",username:"sa",password:process.env.UQP75_SQL_PASSWORD,oracleServiceName:null,oracleConnectionMode:null,odbcConnectionMode:null,odbcDsn:null,odbcConnectionString:null,connectionTimeoutSec:2,queryTimeoutSec:5,encryptConnection:true,trustServerCertificate:true,isActive:true};
 const adapter=new SqlServerAdapter();let ready=false;
 for(let i=0;i<45;i++){try{assert.equal((await adapter.testConnection(config)).ok,true);ready=true;break;}catch{await new Promise(resolve=>setTimeout(resolve,2000));}}
 assert(ready,"EPHEMERAL_SQL_NOT_READY");
 stage="query-and-binds";
 const result=await adapter.executeQuery(config,{sql:"SELECT @AMOUNT AS AMOUNT, @LABEL AS LABEL, CONVERT(varchar(33),@EDATE,126) AS NATIVE_DATE, @LARGE_ID AS LARGE_ID",binds:{AMOUNT:12.5,LABEL:"合成資料",EDATE:new Date("2026-10-29T23:59:59.999Z"),LARGE_ID:9007199254740993n},maxRows:10,timeoutSec:5});
 assert.equal(result.rowCount,1);assert.equal(result.rows[0]!.AMOUNT,12.5);assert.equal(result.rows[0]!.LABEL,"合成資料");assert.match(String(result.rows[0]!.NATIVE_DATE),/^2026-10-29T23:59:59\.999/);assert.equal(result.rows[0]!.LARGE_ID,"9007199254740993");
 stage="excel-roundtrip";
 const bytes=await createQueryExcel("CI SQL export",result),workbook=new ExcelJS.Workbook();await workbook.xlsx.load(bytes as any);assert.equal(workbook.worksheets[0]!.getCell("B2").value,"合成資料");assert.equal(workbook.worksheets[0]!.getCell("D2").value,"9007199254740993");
 console.log("DEPENDENCY_SQL_SELECT_BIND_EXCEL_PASS (disposable SQL Server; no migrations)");
}
void main().catch(()=>{console.error(`DEPENDENCY_SQL_SMOKE_FAILED:${stage} (no connection details logged)`);process.exitCode=1;});
