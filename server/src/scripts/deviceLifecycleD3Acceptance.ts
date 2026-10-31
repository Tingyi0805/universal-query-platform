// Synthetic disposable DB only; called after the existing target/machine guards.
import sql from "mssql";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import type { DeviceManagementStore } from "../modules/dashboard/dashboardDeviceManagement.service.js";
export async function verifyD3(pool:sql.ConnectionPool) {
 const query=(s:string)=>pool.request().query(s);
 // Production app dependencies must never select a configured application DB here.
 assert.equal(process.env.PLATFORM_DB_SERVER,undefined);
 const {createDeviceManagementStore,defaultDeviceManagementDependencies:defaults}=await import("../modules/dashboard/dashboardDeviceManagement.repository.js");
 const {createDeviceManagementService}=await import("../modules/dashboard/dashboardDeviceManagement.service.js");
 await query(`CREATE TABLE uqp.Dashboard(Id bigint PRIMARY KEY,UpdatedAtUtc datetime2(7) NOT NULL DEFAULT SYSUTCDATETIME());
 INSERT uqp.Dashboard(Id) VALUES(1);
 ALTER TABLE uqp.DashboardDisplayDevice ADD DeviceName nvarchar(200) NOT NULL DEFAULT 'synthetic',CreatedByUserId bigint NOT NULL DEFAULT 1,
 SharedWorkstationId bigint NULL,EnforceIpRestriction bit NOT NULL DEFAULT 0,AllowedIp nvarchar(64) NULL,AllowedCidr nvarchar(64) NULL;
 CREATE TABLE uqp.DashboardDevicePlaybackSettings(DeviceId bigint,DashboardId bigint,Browser nvarchar(10),ScreenNumber int,Fullscreen bit,WindowX int,WindowY int,WindowWidth int,WindowHeight int);
 CREATE TABLE uqp.D3Audit(Id bigint IDENTITY PRIMARY KEY,EventType nvarchar(100));`);
 // Use the existing 900 history/policy definitions, including its CHECK constraints.
 const ddl=await readFile(new URL("../../../database/migrations/900_dashboard_device_archive.sql",import.meta.url),"utf8");
 for(const batch of ddl.split(/^GO\s*$/mi))if(batch.trim())await pool.request().batch(batch);
 let failAudit=false,invalidAudit=false;
 const production=createDeviceManagementStore({...defaults,getPool:async()=>pool,
   securitySchema:async()=>{},modeSchema:async()=>true,deviceSchema:async()=>true,
   session:async()=>({isActive:true,tokenVersion:1,permissions:["DESIGN_QUERY"]}) as any,
   writeAuditEvent:async(event,tx)=>{
    if(failAudit)throw new Error("D3_AUDIT_FAILURE");
    const r=await new sql.Request(tx!).input("event",sql.NVarChar(100),event.eventType).query("INSERT uqp.D3Audit(EventType) OUTPUT INSERTED.Id VALUES(@event)");
    return invalidAudit?NaN:Number(r.recordset[0].Id);
   }});
 // Only unrelated source/ACL schema is synthetic. Device locks, writers, 926
 // catalog attestation, transition validation, audit and commit are production code.
 const serviceStore:DeviceManagementStore={transaction:work=>production.transaction(async tx=>{
  tx.schemaReady=async()=>true;tx.evidence=async()=>"a".repeat(64);
  // readState keeps the production parent lock and parsing with synthetic empty source tables below.
  return work(tx);
 })};
 await query(`ALTER TABLE uqp.Dashboard ADD QueryDefinitionId bigint NOT NULL DEFAULT 1,IsActive bit NOT NULL DEFAULT 1,QueryMode nvarchar(30) NOT NULL DEFAULT 'QUERY_ONLY',QueryModeVersion bigint NOT NULL DEFAULT 1,
 ParametersJson nvarchar(max) NOT NULL DEFAULT '{}',QuerySourceMaxRows int NOT NULL DEFAULT 100,RefreshSeconds int NOT NULL DEFAULT 30,PageSize int NOT NULL DEFAULT 10,PageSeconds int NOT NULL DEFAULT 15,
 Name nvarchar(50) NOT NULL DEFAULT 'synthetic',Description nvarchar(50) NULL,DisplayMode nvarchar(20) NOT NULL DEFAULT 'TABLE',DisplayTitle nvarchar(50) NULL,ShowClock bit NOT NULL DEFAULT 0,ShowPageNumber bit NOT NULL DEFAULT 0,ShowCountdown bit NOT NULL DEFAULT 0;
 CREATE TABLE uqp.DashboardDataSource(Id bigint,DashboardId bigint);
 CREATE TABLE uqp.DashboardDisplayProfile(Id bigint,DashboardId bigint,Name nvarchar(50),CanvasWidth int,CanvasHeight int,IsDefault bit,SortOrder int,ConfigJson nvarchar(max));
 CREATE TABLE uqp.DashboardWidget(Id bigint,ProfileId bigint,ConfigJson nvarchar(max),WidgetType nvarchar(30),Title nvarchar(50),SourceKey nvarchar(50),StaticText nvarchar(50),X int,Y int,Width int,Height int,FontSize int,Alignment nvarchar(20),SortOrder int);`);
 const service=createDeviceManagementService(serviceStore,()=>true),actor={userId:1,tokenVersion:1};
 const input=async()=>({expectedVersion:(await service.safetyRead(1,actor)).version,confirmed:true as const});
 const insert=async(suspended=false,pending=false)=>Number((await query(`INSERT uqp.DashboardDisplayDevice(TokenHash,IsActive,SuspendedAtUtc,ReenrollmentRequired,QueryModeGrantVersion,DelegatorTokenVersion)
 OUTPUT INSERTED.Id VALUES(CONVERT(char(64),HASHBYTES('SHA2_256',CRYPT_GEN_RANDOM(32)),2),${suspended?0:1},${suspended?'SYSUTCDATETIME()':'NULL'},${suspended||pending?1:0},${suspended?'NULL':'1'},${suspended?'NULL':'1'})`)).recordset[0].Id);
 // Exercise the existing D2-A / D2-B SQL against the same 926 trigger.
 const enrollmentId=await insert();
 await production.transaction(async tx=>{
  await tx.lifecycleReady();await tx.records(1);
  await tx.lifecycleDevice(1,enrollmentId,"SUSPEND");
  await tx.lifecycleDevice(1,enrollmentId,"RESTORE");
  await tx.writeCredential(1,enrollmentId,"ISSUE","b".repeat(64),1,1);
  await assert.rejects(tx.writeCredential(1,enrollmentId,"ENROLL","a".repeat(64),1,1));
  await tx.writeCredential(1,enrollmentId,"ENROLL","b".repeat(64),1,1);
 });
 for(const state of ["ACTIVE","SUSPENDED","PENDING"]){
  const id=await insert(state==="SUSPENDED",state==="PENDING"),before=(await query(`SELECT * FROM uqp.DashboardDisplayDevice WHERE Id=${id}`)).recordset[0];
  await assert.rejects(service.archive(1,id,actor,await input()));
  const i=await input();await service.revoke(1,id,actor,i);
  await assert.rejects(service.revoke(1,id,actor,i),/VERSION_CONFLICT/);
  const r=(await query(`SELECT * FROM uqp.DashboardDisplayDevice WHERE Id=${id}`)).recordset[0];
  assert.notEqual(r.TokenHash,before.TokenHash);assert.equal(r.QueryModeGrantVersion,null);assert.equal(r.DelegatorTokenVersion,null);assert.equal(r.SuspendedAtUtc,null);assert.equal(r.ReenrollmentRequired,null);
  await production.transaction(async tx=>{
   await assert.rejects(tx.writeCredential(1,id,"ENROLL",before.TokenHash,1,1));
   await assert.rejects(tx.writeCredential(1,id,"ISSUE","c".repeat(64),1,1));
  });
  await service.archive(1,id,actor,await input());await assert.rejects(service.archive(1,id,actor,await input()));
  assert.equal((await query(`SELECT COUNT(*) N FROM uqp.DashboardDeviceArchiveHistory WHERE DeviceId=${id}`)).recordset[0].N,1);
 }
 for(const op of ["revoke","archive"] as const){
  const id=await insert();if(op==="archive")await service.revoke(1,id,actor,await input());
  const before=(await query(`SELECT * FROM uqp.DashboardDisplayDevice WHERE Id=${id};SELECT * FROM uqp.DashboardDeviceArchiveHistory;SELECT * FROM uqp.D3Audit`)).recordsets;
  for(const kind of ["throw","invalid"]){
   failAudit=kind==="throw";invalidAudit=kind==="invalid";
   await assert.rejects(service[op](1,id,actor,await input()));failAudit=false;invalidAudit=false;
   assert.deepEqual((await query(`SELECT * FROM uqp.DashboardDisplayDevice WHERE Id=${id};SELECT * FROM uqp.DashboardDeviceArchiveHistory;SELECT * FROM uqp.D3Audit`)).recordsets,before);
  }
  const i=await input(),results=await Promise.allSettled([service[op](1,id,actor,i),service[op](1,id,actor,i)]);
  assert.equal(results.filter(r=>r.status==="fulfilled").length,1);
  assert.match(String((results.find(r=>r.status==="rejected") as PromiseRejectedResult).reason),/VERSION_CONFLICT/);
 }
 // Execute the exact production AUTO SQL without invoking configured app pools.
 const repo=await readFile(new URL("../modules/dashboard/dashboardDevice.repository.ts",import.meta.url),"utf8");
 const auto=repo.split("export async function autoArchiveDashboardDevices")[1]!.match(/\.query\(`([\s\S]*?)`\)/)![1]!;
 const old=await insert(),recent=await insert(),suspended=await insert(true);
 await service.revoke(1,old,actor,await input());await service.revoke(1,recent,actor,await input());
 // Insert an already revoked aged fixture; never rewrite terminal timestamps.
 const aged=Number((await query("INSERT uqp.DashboardDisplayDevice(TokenHash,IsActive,RevokedAtUtc) OUTPUT INSERTED.Id VALUES(CONVERT(char(64),HASHBYTES('SHA2_256',CRYPT_GEN_RANDOM(32)),2),0,'2020-01-01')")).recordset[0].Id);
 await query("INSERT uqp.DashboardDeviceArchivePolicy(DashboardId,AutoArchiveEnabled,RetentionDays) VALUES(1,0,90)");
 assert.equal((await query(auto)).recordset[0].Archived,0);
 await query("UPDATE uqp.DashboardDeviceArchivePolicy SET AutoArchiveEnabled=1");
 const raceInput=await input();
 await Promise.allSettled([service.archive(1,aged,actor,raceInput),query(auto)]);assert.equal((await query(`SELECT COUNT(*) N FROM uqp.DashboardDeviceArchiveHistory WHERE DeviceId=${aged}`)).recordset[0].N,1);
 assert.equal((await query(`SELECT COUNT(*) N FROM uqp.DashboardDisplayDevice WHERE Id IN(${recent},${suspended}) AND ArchivedAtUtc IS NULL`)).recordset[0].N,2);
 const autoOnly=Number((await query("INSERT uqp.DashboardDisplayDevice(TokenHash,IsActive,RevokedAtUtc) OUTPUT INSERTED.Id VALUES(CONVERT(char(64),HASHBYTES('SHA2_256',CRYPT_GEN_RANDOM(32)),2),0,'2020-01-01')")).recordset[0].Id);
 assert.equal((await query(auto)).recordset[0].Archived,1);
 assert.equal((await query(`SELECT COUNT(*) N FROM uqp.DashboardDeviceArchiveHistory WHERE DeviceId=${autoOnly} AND ArchiveMode='AUTO' AND ArchivedByUserId IS NULL`)).recordset[0].N,1);
 assert.equal((await query(auto)).recordset[0].Archived,0);
 console.log("D3_SQL_PRODUCTION_REVOKE_ARCHIVE_VERSION_RACE_AUDIT_ROLLBACK_AUTO_PASS");
}
