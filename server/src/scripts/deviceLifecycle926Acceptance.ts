// Dedicated disposable SQL Server only. Never imports app config, dotenv or migrate.ts.
import sql from "mssql";
import assert from "node:assert/strict";
import {randomBytes} from "node:crypto";
import {readFile} from "node:fs/promises";
import {deviceLifecycleSchemaSql} from "../modules/dashboard/dashboardDeviceLifecycleSchema.js";
import {deviceLifecycleBlocksPlayback} from "../modules/dashboard/dashboardDeviceLifecycle.js";
let stage="target-guard";
async function main(){
 const machine=process.env.UQP_D1_CONTAINER_NAME,password=process.env.UQP_D1_SQL_PASSWORD;
 if(process.env.UQP_D1_SCOPE!=="DISPOSABLE_ONLY"||!machine||!/^uqp-d1-[a-f0-9]{12}$/.test(machine)||!password)throw new Error("DISPOSABLE_TARGET_REQUIRED");
 const config={server:"127.0.0.1",port:14336,user:"sa",password,database:"master",connectionTimeout:2000,requestTimeout:15000,
  options:{encrypt:true,trustServerCertificate:true},pool:{max:1,min:0}};
 const admin=new sql.ConnectionPool(config);let connected=false;
 for(let i=0;i<60;i++){try{await admin.connect();connected=true;break;}catch{await new Promise(resolve=>setTimeout(resolve,2000));}}
 assert(connected);let db:sql.ConnectionPool|undefined;const name="UQP_D1_"+randomBytes(6).toString("hex");let created=false;
 try{
  const identity=(await admin.request().query("SELECT CONVERT(nvarchar(128),SERVERPROPERTY('MachineName')) AS Machine,DB_NAME() AS Db")).recordset[0];
  assert.equal(identity.Machine,machine);assert.equal(identity.Db,"master");
  stage="create-disposable-fixture";await admin.request().query(`CREATE DATABASE [${name}]`);created=true;
  db=await new sql.ConnectionPool({...config,database:name}).connect();const query=(text:string)=>db!.request().query(text);
  await query(`CREATE SCHEMA uqp`);
  await query(`CREATE TABLE uqp.DashboardDisplayDevice(
   Id bigint IDENTITY(1,1) PRIMARY KEY,DashboardId bigint NOT NULL DEFAULT 1,TokenHash char(64) NOT NULL UNIQUE,
   IsActive bit NOT NULL,ExpiresAtUtc datetime2(0) NULL,RevokedAtUtc datetime2(0) NULL,ArchivedAtUtc datetime2(0) NULL,
   QueryModeGrantVersion bigint NULL,DelegatorTokenVersion bigint NULL,
   CONSTRAINT CK_DashboardDevice_QueryModeGrant CHECK((QueryModeGrantVersion IS NULL AND DelegatorTokenVersion IS NULL) OR
    (QueryModeGrantVersion IS NOT NULL AND DelegatorTokenVersion IS NOT NULL AND QueryModeGrantVersion>0 AND DelegatorTokenVersion>0)))`);
  await query(`INSERT uqp.DashboardDisplayDevice(TokenHash,IsActive,ExpiresAtUtc,RevokedAtUtc,ArchivedAtUtc,QueryModeGrantVersion,DelegatorTokenVersion) VALUES
   (CONVERT(char(64),HASHBYTES('SHA2_256','one'),2),1,DATEADD(DAY,30,SYSUTCDATETIME()),NULL,NULL,1,1),
   (CONVERT(char(64),HASHBYTES('SHA2_256','two'),2),0,NULL,'2020-01-01',NULL,NULL,NULL),
   (CONVERT(char(64),HASHBYTES('SHA2_256','three'),2),0,NULL,NULL,'2020-01-01',NULL,NULL),
   (CONVERT(char(64),HASHBYTES('SHA2_256','four'),2),0,NULL,NULL,NULL,NULL,NULL),
   (CONVERT(char(64),HASHBYTES('SHA2_256','five'),2),1,NULL,NULL,NULL,NULL,NULL),
   (CONVERT(char(64),HASHBYTES('SHA2_256','six'),2),1,'2020-01-01',NULL,NULL,1,1)`);
  const before=(await query("SELECT * FROM uqp.DashboardDisplayDevice ORDER BY Id")).recordset;
  const ddl=await readFile(new URL("../../../database/migrations/926_dashboard_device_lifecycle.sql",import.meta.url),"utf8");
  stage="fresh-926-and-catalog";await db.request().batch(ddl);await query(deviceLifecycleSchemaSql);
  const after=(await query("SELECT * FROM uqp.DashboardDisplayDevice ORDER BY Id")).recordset;
  assert.deepEqual(after.map(({SuspendedAtUtc,ReenrollmentRequired,...row})=>{assert.equal(SuspendedAtUtc,null);assert.equal(ReenrollmentRequired,null);return row;}),before);
  stage="repeat-926-no-state-change";await db.request().batch(ddl);assert.deepEqual((await query("SELECT * FROM uqp.DashboardDisplayDevice ORDER BY Id")).recordset,after);
  stage="existing-update-output-into-compatible";
  const returned=await query("DECLARE @ChangedDevice TABLE(Id bigint); UPDATE uqp.DashboardDisplayDevice SET ExpiresAtUtc=ExpiresAtUtc OUTPUT INSERTED.Id INTO @ChangedDevice WHERE Id=1; SELECT d.* FROM uqp.DashboardDisplayDevice d INNER JOIN @ChangedDevice c ON c.Id=d.Id");
  assert.equal(String(returned.recordset[0].Id),"1");
  stage="existing-insert-output-compatible";
  assert.equal(String((await query("INSERT uqp.DashboardDisplayDevice(TokenHash,IsActive) OUTPUT INSERTED.Id VALUES(CONVERT(char(64),HASHBYTES('SHA2_256','insert-output'),2),1)")).recordset[0].Id),"7");
  stage="production-renew-sql-with-update-trigger";
  const repository=await readFile(new URL("../modules/dashboard/dashboardDevice.repository.ts",import.meta.url),"utf8");
  const renewSql=repository.split("export async function renewDashboardDisplayDevice(")[1]!.split("export async function revokeDashboardDisplayDevice")[0]!.match(/\.query\(`([\s\S]*?)`\)/)![1]!;
  const renewed=await db.request().input("dashboardId",sql.BigInt,1).input("deviceId",sql.BigInt,1).input("extendDays",sql.Int,1).query(renewSql);
  assert.equal(String(renewed.recordset[0].Id),"1");assert.equal(new Date(renewed.recordset[0].ExpiresAtUtc).getTime(),new Date(before[0].ExpiresAtUtc).getTime()+86400000);
  async function denied(text:string){await assert.rejects(query(text),error=>[547,51926].includes(Number((error as {number?:number}).number)));}
  stage="static-invalid-combinations";
  await denied("UPDATE uqp.DashboardDisplayDevice SET SuspendedAtUtc=SYSUTCDATETIME() WHERE Id=1");
  await denied("UPDATE uqp.DashboardDisplayDevice SET IsActive=0,SuspendedAtUtc=SYSUTCDATETIME(),QueryModeGrantVersion=NULL,DelegatorTokenVersion=NULL WHERE Id=1");
  await denied("UPDATE uqp.DashboardDisplayDevice SET IsActive=1 WHERE Id=2");
  await denied("UPDATE uqp.DashboardDisplayDevice SET RevokedAtUtc=NULL WHERE Id=2");
  await denied("UPDATE uqp.DashboardDisplayDevice SET ArchivedAtUtc=NULL WHERE Id=3");
  stage="suspend-requires-hash-rotation";
  await denied("UPDATE uqp.DashboardDisplayDevice SET IsActive=0,SuspendedAtUtc=SYSUTCDATETIME(),ReenrollmentRequired=1,QueryModeGrantVersion=NULL,DelegatorTokenVersion=NULL WHERE Id=1");
  await query("UPDATE uqp.DashboardDisplayDevice SET IsActive=0,SuspendedAtUtc=SYSUTCDATETIME(),ReenrollmentRequired=1,TokenHash=CONVERT(char(64),HASHBYTES('SHA2_256','suspend'),2),QueryModeGrantVersion=NULL,DelegatorTokenVersion=NULL WHERE Id=1");
  stage="suspended-not-archivable";await denied("UPDATE uqp.DashboardDisplayDevice SET SuspendedAtUtc=NULL,ReenrollmentRequired=NULL,ArchivedAtUtc=SYSUTCDATETIME() WHERE Id=1");
  stage="restore-old-token-and-direct-active-denied";
  await denied("UPDATE uqp.DashboardDisplayDevice SET IsActive=1,SuspendedAtUtc=NULL WHERE Id=1");
  await denied("UPDATE uqp.DashboardDisplayDevice SET IsActive=1,SuspendedAtUtc=NULL,ReenrollmentRequired=0,TokenHash=CONVERT(char(64),HASHBYTES('SHA2_256','direct'),2),QueryModeGrantVersion=1,DelegatorTokenVersion=1 WHERE Id=1");
  await query("UPDATE uqp.DashboardDisplayDevice SET IsActive=1,SuspendedAtUtc=NULL,TokenHash=CONVERT(char(64),HASHBYTES('SHA2_256','restore'),2) WHERE Id=1");
  assert(deviceLifecycleBlocksPlayback((await query("SELECT * FROM uqp.DashboardDisplayDevice WHERE Id=1")).recordset[0]));
  stage="pending-issue-then-enroll-boundary";
  await denied("UPDATE uqp.DashboardDisplayDevice SET ReenrollmentRequired=NULL WHERE Id=1");
  await denied("UPDATE uqp.DashboardDisplayDevice SET ReenrollmentRequired=0 WHERE Id=1");
  await query("UPDATE uqp.DashboardDisplayDevice SET TokenHash=CONVERT(char(64),HASHBYTES('SHA2_256','issued'),2),QueryModeGrantVersion=1,DelegatorTokenVersion=1 WHERE Id=1");
  await denied("UPDATE uqp.DashboardDisplayDevice SET ReenrollmentRequired=0,TokenHash=CONVERT(char(64),HASHBYTES('SHA2_256','changed'),2) WHERE Id=1");
  await query("UPDATE uqp.DashboardDisplayDevice SET ReenrollmentRequired=0 WHERE Id=1");
  assert.equal(deviceLifecycleBlocksPlayback((await query("SELECT * FROM uqp.DashboardDisplayDevice WHERE Id=1")).recordset[0]),false);
  assert.notEqual((await query("SELECT TokenHash FROM uqp.DashboardDisplayDevice WHERE Id=1")).recordset[0].TokenHash,before[0].TokenHash);
  stage="revoke-and-policy-archive";
  await query("UPDATE uqp.DashboardDisplayDevice SET IsActive=0,ReenrollmentRequired=NULL,RevokedAtUtc=SYSUTCDATETIME(),TokenHash=CONVERT(char(64),HASHBYTES('SHA2_256','revoke'),2),QueryModeGrantVersion=NULL,DelegatorTokenVersion=NULL WHERE Id=1");
  await denied("UPDATE uqp.DashboardDisplayDevice SET RevokedAtUtc=NULL,IsActive=1 WHERE Id=1");
  await query("UPDATE uqp.DashboardDisplayDevice SET ArchivedAtUtc=SYSUTCDATETIME() WHERE Id IN(1,2) AND IsActive=0 AND RevokedAtUtc IS NOT NULL");
  stage="D3-production-writers";await (await import("./deviceLifecycleD3Acceptance.js")).verifyD3(db);
  stage="disabled-check-not-repaired";
  await query("ALTER TABLE uqp.DashboardDisplayDevice NOCHECK CONSTRAINT CK_DashboardDevice_LifecycleTerminal");
  await assert.rejects(query(deviceLifecycleSchemaSql));await assert.rejects(db.request().batch(ddl));
  assert.equal((await query("SELECT is_disabled FROM sys.check_constraints WHERE name='CK_DashboardDevice_LifecycleTerminal'")).recordset[0].is_disabled,true);
  await query("ALTER TABLE uqp.DashboardDisplayDevice WITH CHECK CHECK CONSTRAINT CK_DashboardDevice_LifecycleTerminal");
  stage="disabled-trigger-not-repaired";await query("DISABLE TRIGGER uqp.TR_DashboardDevice_Lifecycle ON uqp.DashboardDisplayDevice");
  await assert.rejects(query(deviceLifecycleSchemaSql));await assert.rejects(db.request().batch(ddl));
  await query("ENABLE TRIGGER uqp.TR_DashboardDevice_Lifecycle ON uqp.DashboardDisplayDevice");await query(deviceLifecycleSchemaSql);
  stage="partial-and-wrong-schema-refused";
  await query("DROP TRIGGER uqp.TR_DashboardDevice_Lifecycle; ALTER TABLE uqp.DashboardDisplayDevice DROP CONSTRAINT CK_DashboardDevice_LifecycleTerminal,CK_DashboardDevice_LifecycleSuspended,CK_DashboardDevice_LifecycleEnrollment; ALTER TABLE uqp.DashboardDisplayDevice DROP COLUMN SuspendedAtUtc,ReenrollmentRequired");
  await query("ALTER TABLE uqp.DashboardDisplayDevice ADD SuspendedAtUtc datetime2(0) NULL");await assert.rejects(db.request().batch(ddl));
  await query("ALTER TABLE uqp.DashboardDisplayDevice ADD ReenrollmentRequired int NULL");await assert.rejects(db.request().batch(ddl));
  assert.equal((await query("SELECT TYPE_NAME(system_type_id) AS T FROM sys.columns WHERE object_id=OBJECT_ID('uqp.DashboardDisplayDevice') AND name='ReenrollmentRequired'")).recordset[0].T,"int");
  stage="invalid-legacy-row-rolls-back-without-repair";
  await query("ALTER TABLE uqp.DashboardDisplayDevice DROP COLUMN SuspendedAtUtc,ReenrollmentRequired");
  await query("INSERT uqp.DashboardDisplayDevice(TokenHash,IsActive,RevokedAtUtc) VALUES(CONVERT(char(64),HASHBYTES('SHA2_256','invalid-legacy'),2),1,'2020-01-01')");
  await assert.rejects(db.request().batch(ddl));
  const unchanged=(await query("SELECT COL_LENGTH('uqp.DashboardDisplayDevice','SuspendedAtUtc') AS NewColumn,(SELECT IsActive FROM uqp.DashboardDisplayDevice WHERE TokenHash=CONVERT(char(64),HASHBYTES('SHA2_256','invalid-legacy'),2)) AS OriginalActive")).recordset[0];
  assert.equal(unchanged.NewColumn,null);assert.equal(unchanged.OriginalActive,true);
  console.log("D1_SQL_926_FRESH_REPEAT_LEGACY_CONSTRAINT_TRANSITION_HASH_REVOCATION_ARCHIVE_CATALOG_PASS (disposable synthetic DB only)");
 }finally{
  await db?.close();if(created)await admin.request().query(`ALTER DATABASE [${name}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${name}]`);await admin.close();
 }
}
void main().catch(error=>{const code=Number(error?.number)||0;const reason=/^DEVICE_LIFECYCLE_[A-Z_]+$/.test(error?.message??"")?error.message:"no details logged";
 console.error(`D1_SQL_ACCEPTANCE_FAILED:${stage}:${code}:${reason}`);process.exitCode=1;});
