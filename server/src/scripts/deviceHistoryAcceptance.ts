// Existing disposable harness invokes this only after machine/database target guards.
import sql from "mssql";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {writeAuditEvent} from "../modules/audit/audit.repository.js";
import {deviceAuditEvents,deviceHistoryQuery,readDeviceAuditHistory} from "../modules/audit/deviceAuditHistory.js";
export async function verifyDeviceHistory(pool:sql.ConnectionPool){
 let phase="SCHEMA";try{
 const query=(text:string)=>pool.request().query(text);
 await query(`CREATE TABLE uqp.AppUser(Id bigint PRIMARY KEY,Username nvarchar(100),DisplayName nvarchar(200));
 INSERT uqp.AppUser VALUES(1,N'admin%_[',N'管理員'),(2,N'operator',N'操作員');
 CREATE TABLE uqp.QueryDefinition(Id bigint PRIMARY KEY,Code nvarchar(100),Name nvarchar(200));
 CREATE TABLE uqp.Dataset(Id bigint PRIMARY KEY,Code nvarchar(100),Name nvarchar(200));
 CREATE TABLE uqp.SystemSetting(SettingKey nvarchar(100) PRIMARY KEY,SettingValue nvarchar(max),Description nvarchar(max));`);
 for(const file of ["006_audit_log.sql","016_audit_retention.sql"]){
  const ddl=await readFile(new URL(`../../../database/migrations/${file}`,import.meta.url),"utf8");
  for(const batch of ddl.split(/^GO\s*$/mi))if(batch.trim())await pool.request().batch(batch);
 }
 phase="SEED";
 const target=Number((await query("SELECT MIN(Id) Id FROM uqp.DashboardDisplayDevice WHERE DashboardId=99")).recordset[0].Id);
 const other=Number((await query("SELECT MAX(Id) Id FROM uqp.DashboardDisplayDevice WHERE DashboardId=99")).recordset[0].Id);assert.notEqual(target,other);
 const ids:number[]=[];
 const tx=new sql.Transaction(pool);await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
 try{
  phase="SEED_EVENTS";for(const eventType of deviceAuditEvents)ids.push(await writeAuditEvent({eventType,userId:1,parameters:{dashboardId:99,deviceId:target,token:"NEVER_RETURN"}},tx));
  ids.push(await writeAuditEvent({eventType:"DASHBOARD_DEVICE_SUSPENDED",userId:1,status:"FAILED",errorCode:"FORBIDDEN",parameters:{dashboardId:99,deviceId:target}},tx));
  ids.push(await writeAuditEvent({eventType:"DASHBOARD_DEVICE_SUSPENDED",userId:1,status:"FAILED",errorCode:"SECRET_TOKEN_CODE",parameters:{dashboardId:99,deviceId:target}},tx));
  for(let i=0;i<25;i++)ids.push(await writeAuditEvent({eventType:"DASHBOARD_DEVICE_SUSPENDED",userId:i%2?1:2,parameters:{dashboardId:99,deviceId:target}},tx));
  for(const parameters of [{dashboardId:1,deviceId:target},{dashboardId:99,deviceId:other},{deviceId:target},{dashboardId:99,deviceId:String(target)},{nested:{dashboardId:99,deviceId:target}},{"dashboardId ":99,deviceId:target},{dashboardId:"99",deviceId:target}])await writeAuditEvent({eventType:"DASHBOARD_DEVICE_SUSPENDED",userId:1,parameters},tx);
  await writeAuditEvent({eventType:"LOGIN_FAILED",userId:1,parameters:{dashboardId:99,deviceId:target}},tx);
  await tx.commit();
 }catch(e){await tx.rollback();throw e;}
 const poison=(await query("SELECT MAX(Id) Id FROM uqp.AuditLog")).recordset[0].Id;
 await pool.request().input("id",sql.BigInt,poison).input("json",sql.NVarChar(sql.MAX),`{"dashboardId":99,"deviceId":${target},"deviceId":${other}}`).query("UPDATE uqp.AuditLog SET EventType='DASHBOARD_DEVICE_SUSPENDED',ParametersJson=@json WHERE Id=@id");
 await pool.request().input("badJson",sql.NVarChar(sql.MAX),'{"dashboardId":99,').query("INSERT uqp.AuditLog(EventType,EventCategory,IsImportant,UserId,Status,ParametersJson) VALUES('DASHBOARD_DEVICE_SUSPENDED','CONFIG',1,1,'SUCCESS',@badJson)");
 await query("UPDATE uqp.AuditLog SET CreatedAtUtc='2020-03-01T00:00:00',CompletedAtUtc='2020-03-01T00:00:00'");
 for(const [id,at] of [[ids[0],"2020-02-29T16:00:00Z"],[ids[1],"2020-03-01T15:59:59Z"],[ids[2],"2020-03-01T16:00:00Z"]] as const)await pool.request().input("id",sql.BigInt,id).input("at",sql.DateTime2(0),new Date(at)).query("UPDATE uqp.AuditLog SET CreatedAtUtc=@at WHERE Id=@id");
 const eventTime=(id:number)=>Date.parse(id===ids[0]?"2020-02-29T16:00:00Z":id===ids[1]?"2020-03-01T15:59:59Z":id===ids[2]?"2020-03-01T16:00:00Z":"2020-03-01T00:00:00Z");
 const ordered=[...ids].sort((a,b)=>eventTime(b)-eventTime(a)||b-a).map(String);
 const read=async(source:"LIVE"|"ARCHIVE",input:Record<string,string>={},id=99,deviceId=target)=>{
  const tx=new sql.Transaction(pool);await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  try{const r=await readDeviceAuditHistory(new sql.Request(tx),id,deviceId,deviceHistoryQuery.parse({source,...input}));await tx.commit();return r;}
  catch(e){await tx.rollback();throw e;}
 };
 const assertSource=async(source:"LIVE"|"ARCHIVE")=>{
  phase=`${source}_COUNT`;const all=await read(source,{pageSize:"100"});assert.equal(all.total,37);assert.equal(all.items.length,37);
  phase=`${source}_ORDER`;assert.deepEqual(all.items.map(d=>d.id),ordered);assert.doesNotMatch(JSON.stringify(all),/NEVER_RETURN|ParametersJson|TokenHash|SECRET_TOKEN_CODE|IpAddress/);
  phase=`${source}_ERRORS`;assert.equal(all.items.find(d=>d.id===String(ids[10]))!.errorCode,"FORBIDDEN");assert.equal(all.items.find(d=>d.id===String(ids[11]))!.errorCode,null);
  phase=`${source}_EVENTS`;for(const eventType of deviceAuditEvents){const r=await read(source,{eventType,pageSize:"100"});assert(r.total>0);assert(r.items.every(d=>d.eventType===eventType));}
  phase=`${source}_PAGES`;const pages:string[]=[];for(const page of [1,2,3,4]){const r=await read(source,{page:String(page),pageSize:"10"});assert.equal(r.total,37);pages.push(...r.items.map(d=>d.id));}assert.deepEqual(pages,all.items.map(d=>d.id));
  for(const pageSize of ["10","20","50","100"])assert.equal((await read(source,{pageSize})).items.length,Math.min(Number(pageSize),37));
  assert.equal((await read(source,{page:"5",pageSize:"10"})).items.length,0);
  phase=`${source}_USERNAME`;const user=await read(source,{username:"admin%_[",pageSize:"100"});assert(user.items.length>0);assert(user.items.every(d=>d.username==="admin%_["));
  assert.equal((await read(source,{username:"' OR 1=1;--"})).total,0);
  phase=`${source}_DATES`;assert.equal((await read(source,{startDate:"2020-03-01",endDate:"2020-03-01"})).total,36);
  assert.equal((await read(source,{endDate:"2020-02-29"})).total,0);
  assert.equal((await read(source,{startDate:"2020-03-02"})).total,1);
  phase=`${source}_SCOPE`;await assert.rejects(read(source,{},1,target),e=>Number((e as {number?:number}).number)===51032);
  const otherRecords=await read(source,{},99,other);assert.equal(otherRecords.total,1); // Only its explicitly attributed record.
 };
 await assertSource("LIVE");assert.equal((await read("ARCHIVE")).total,0);
 // Execute the exact existing archive INSERT/SELECT/DELETE batch with its real schema.
 phase="ARCHIVE_COPY";const repository=await readFile(new URL("../modules/audit/audit.repository.ts",import.meta.url),"utf8");
 const archiveSql=repository.split("export async function archiveOldAuditLogs()")[1]!.split("export async function cleanupAuditArchive")[0]!.match(/\.query\(`([\s\S]*?)`\)/)![1]!;
 const archiving=new sql.Transaction(pool);await archiving.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
 try{await new sql.Request(archiving).input("onlineDays",sql.Int,365).query(archiveSql);await archiving.commit();}catch(e){await archiving.rollback();throw e;}
 await assertSource("ARCHIVE");assert.equal((await read("LIVE")).total,0);
 console.log("D4D_SQL_LIVE_ARCHIVE_SCOPE_DATES_EVENTS_USERNAME_PAGES_REDACTION_RETENTION_COPY_PASS");
 }catch(error){console.error(`D4D_SQL_FAILED:${phase}:${Number((error as {number?:number}).number)||0}`);throw error;}
}
