// D5-C-5A extension of the existing D1 disposable harness. No app config, dotenv or migration scanner.
import assert from "node:assert/strict";
import {createHash,randomBytes} from "node:crypto";
import {readFile} from "node:fs/promises";
import sql from "mssql";
import {deviceLifecycleSchemaSql} from "../modules/dashboard/dashboardDeviceLifecycleSchema.js";

const migration="926_dashboard_device_lifecycle.sql";
const pinned926="f2d17b2a24963860e646a620f9548b22ff6a1a296e077071e8fb50237c8cfd43";
const hash=(text:string)=>createHash("sha256").update(text).digest("hex");
const safeName=(name:string)=>{assert.match(name,/^UQP_D1_UPGRADE_[a-f0-9]{12}$/);return name;};
const numbers=(e:unknown):number[]=>{if(!e||typeof e!=="object")return [];const x=e as {number?:number;precedingErrors?:unknown[];originalError?:{info?:{number?:number}}};return [Number(x.number),Number(x.originalError?.info?.number),...(x.precedingErrors??[]).flatMap(numbers)];};

export async function verify926Upgrade(admin:sql.ConnectionPool,config:sql.config,machine:string){
 assert.equal(config.server,"127.0.0.1");assert.equal(config.port,14336);assert.equal(config.database,"master");
 assert.match(machine,/^uqp-d1-[a-f0-9]{12}$/);
 const identity=(await admin.request().query("SELECT CONVERT(nvarchar(128),SERVERPROPERTY('MachineName')) Machine,CONVERT(int,SERVERPROPERTY('ProductMajorVersion')) Major,DB_NAME() Db")).recordset[0];
 assert.equal(identity.Machine,machine);assert.equal(identity.Db,"master");assert([15,16].includes(identity.Major));
 assert(!Object.keys(process.env).some(k=>k.startsWith("PLATFORM_DB_")||k==="DOTENV_CONFIG_PATH"),"Application DB configuration must not enter disposable acceptance");
 const sourceFiles=["025_dashboard_display_device.sql","900_dashboard_device_archive.sql","918_dashboard_query_playback_mode.sql",migration];
 const inventory=JSON.parse(await readFile(new URL("../../../database/acceptance/migration-inventory.json",import.meta.url),"utf8")) as {file:string;sha256:string;requires:number[]}[];
 const sources=new Map<string,string>();
 for(const file of sourceFiles){const raw=await readFile(new URL("../../../database/migrations/"+file,import.meta.url),"utf8");assert.equal(hash(raw),inventory.find(x=>x.file===file)?.sha256);sources.set(file,raw);}
 assert.equal(hash(sources.get(migration)!),pinned926);assert.deepEqual(inventory.find(x=>x.file===migration)?.requires,[25,900,918]);
 const executed=new Set<string>();let count=0;
 async function check(name:string,work:()=>Promise<void>){try{await work();}catch(error){console.error(`D5_C5A_CASE_FAILED:${name}:${numbers(error).filter(Number.isFinite).join(",")}`);throw error;}count++;console.log(`D5_C5A_CASE_PASS:${name}`);}
 const pools=new Map<string,sql.ConnectionPool|null>();
 async function newDb(){const name=safeName("UQP_D1_UPGRADE_"+randomBytes(6).toString("hex"));await admin.request().query(`CREATE DATABASE [${name}]`);pools.set(name,null);const pool=await new sql.ConnectionPool({...config,database:name}).connect();pools.set(name,pool);return {name,pool};}
 const q=(p:sql.ConnectionPool,text:string)=>p.request().query(text);
 async function runSource(p:sql.ConnectionPool,file:string){assert(sourceFiles.includes(file));executed.add(file);for(const batch of sources.get(file)!.split(/^\s*GO\s*$/gim))if(batch.trim())await p.request().batch(batch);}
 async function fixture(omit:"none"|"025"|"900"|"918"="none"){
  const db=await newDb();const p=db.pool;
  // Minimal foundations for the REAL 025/900/918 files. No other historical migration is executed.
  await q(p,`CREATE SCHEMA uqp`);
  await q(p,`CREATE TABLE uqp.AppUser(Id bigint PRIMARY KEY); INSERT uqp.AppUser VALUES(1);
   CREATE TABLE uqp.Dashboard(Id bigint PRIMARY KEY,Name nvarchar(100) NOT NULL,QuerySourceMaxRows int NULL,UpdatedAtUtc datetime2(0) NOT NULL);
   INSERT uqp.Dashboard VALUES(1,N'synthetic target',100,'2020-01-01'),(2,N'unrelated synthetic dashboard',50,'2020-02-01');
   CREATE TABLE uqp.DashboardDataSource(Id bigint PRIMARY KEY,QueryDefinitionId bigint NULL);
   CREATE TABLE uqp.AuditLog(Id bigint PRIMARY KEY,EventType nvarchar(100),ParametersJson nvarchar(max));
   INSERT uqp.AuditLog VALUES(101,N'SYNTHETIC_BEFORE_UPGRADE',N'{"fixture":"not-production"}');
   CREATE TABLE uqp.SchemaMigration(FileName nvarchar(255) NOT NULL PRIMARY KEY,AppliedAtUtc datetime2(0) NOT NULL DEFAULT SYSUTCDATETIME());`);
  if(omit==="025")return db;
  for(const file of sourceFiles.slice(0,3)){
   if(file.startsWith(omit+"_"))continue;
   await runSource(p,file);await p.request().input("file",sql.NVarChar(255),file).query("INSERT uqp.SchemaMigration(FileName) VALUES(@file)");
  }
  const grant=omit==="918"?"":",QueryModeGrantVersion,DelegatorTokenVersion";
  await q(p,`INSERT uqp.DashboardDisplayDevice(DashboardId,DeviceName,TokenHash,IsActive,ExpiresAtUtc,CreatedByUserId,RevokedAtUtc${omit==="900"?"":",ArchivedAtUtc"}${grant}) VALUES
   (1,N'active', '${hash("synthetic-active")}',1,'2099-01-01',1,NULL${omit==="900"?"":",NULL"}${grant?",7,9":""}),
   (1,N'revoked','${hash("synthetic-revoked")}',0,NULL,1,'2020-01-01'${omit==="900"?"":",NULL"}${grant?",NULL,NULL":""}),
   (2,N'archived','${hash("synthetic-archived")}',0,NULL,1,'2020-01-02'${omit==="900"?"":",'2020-01-03'"}${grant?",NULL,NULL":""}),
   (1,N'legacy inactive','${hash("synthetic-inactive")}',0,NULL,1,NULL${omit==="900"?"":",NULL"}${grant?",NULL,NULL":""}),
   (2,N'legacy unversioned','${hash("synthetic-unversioned")}',1,NULL,1,NULL${omit==="900"?"":",NULL"}${grant?",NULL,NULL":""});`);
  return db;
 }
 async function snapshot(p:sql.ConnectionPool){
  const exists=(await q(p,"SELECT OBJECT_ID(N'uqp.DashboardDisplayDevice',N'U') Id")).recordset[0].Id;
  const devices=exists?(await q(p,"SELECT * FROM uqp.DashboardDisplayDevice ORDER BY Id")).recordset:[];
  const result=await q(p,`SELECT * FROM uqp.Dashboard ORDER BY Id;
   SELECT * FROM uqp.AuditLog ORDER BY Id; SELECT * FROM uqp.SchemaMigration ORDER BY FileName;
   SELECT name,type,OBJECT_NAME(parent_object_id) ParentName FROM sys.objects WHERE schema_id=SCHEMA_ID('uqp') ORDER BY name,type;
   SELECT OBJECT_NAME(object_id) TableName,name,system_type_id,max_length,scale,is_nullable,is_computed FROM sys.columns WHERE OBJECT_SCHEMA_NAME(object_id)='uqp' ORDER BY TableName,column_id;`);
  return {devices,other:result.recordsets as unknown as Record<string,unknown>[][]};
 }
 async function ready(p:sql.ConnectionPool){try{await q(p,deviceLifecycleSchemaSql);return true;}catch{return false;}}
 // Acceptance preflight; deliberately NOT described as a new behavior of migrate.ts.
 async function ledgerGate(p:sql.ConnectionPool){
  const recorded=(await p.request().input("file",sql.NVarChar(255),migration).query("SELECT FileName FROM uqp.SchemaMigration WHERE FileName=@file")).recordset.length===1;
  const complete=await ready(p);if(recorded!==complete)throw new Error("D5_C5A_LEDGER_SCHEMA_MISMATCH");return recorded;
 }
 async function applyOwned(p:sql.ConnectionPool){
  if(await ledgerGate(p))return;
  const tx=new sql.Transaction(p);let aborted=false;tx.on("rollback",()=>{aborted=true;});await tx.begin();
  try{
   // Same owned outer transaction + exact batch + ledger insert as migrate.ts, without its unrestricted scanner/bootstrap.
   executed.add(migration);await new sql.Request(tx).batch(sources.get(migration)!);
   await new sql.Request(tx).input("file",sql.NVarChar(255),migration).query("INSERT uqp.SchemaMigration(FileName) VALUES(@file)");
   await tx.commit();
  }catch(error){if(!aborted)try{await tx.rollback();}catch{/* preserve original SQL failure */}throw error;}
 }
 async function unchangedFailure(p:sql.ConnectionPool,work:()=>Promise<unknown>,codes?:number[]){
  const before=await snapshot(p);await assert.rejects(work,error=>!codes||numbers(error).some(n=>codes.includes(n)));assert.deepEqual(await snapshot(p),before);
  assert.equal((await q(p,"SELECT @@TRANCOUNT T")).recordset[0].T,0);
 }
 const raw=(p:sql.ConnectionPool)=>runSource(p,migration);
 let baselineName="",backupPath="";
 try{
  const baseline=await fixture();const p=baseline.pool;baselineName=baseline.name;
  console.log(`D5_C5A_ISOLATION:machine=${machine};major=${identity.Major};database=${baseline.name};host=127.0.0.1;port=14336;synthetic-only`);
  const before=await snapshot(p);
  const files=(await q(p,"SELECT name,type FROM sys.database_files ORDER BY file_id")).recordset;
  backupPath=`/var/opt/mssql/data/${baseline.name}.bak`;
  await check("verified-preupgrade-backup",async()=>{
   await admin.request().query(`BACKUP DATABASE [${baseline.name}] TO DISK=N'${backupPath}' WITH COPY_ONLY,INIT,CHECKSUM`);
   await admin.request().query(`RESTORE VERIFYONLY FROM DISK=N'${backupPath}' WITH CHECKSUM`);
  });
  await check("025-900-918-to-926-owned-ledger-and-preserved-data",async()=>{
   await applyOwned(p);assert(await ready(p));assert(await ledgerGate(p));const after=await snapshot(p);
   assert.deepEqual(after.devices.map(({SuspendedAtUtc,ReenrollmentRequired,...row})=>{assert.equal(SuspendedAtUtc,null);assert.equal(ReenrollmentRequired,null);return row;}),before.devices);
   assert.deepEqual(after.other[0],before.other[0]);assert.deepEqual(after.other[1],before.other[1]);
   assert.equal(after.other[2]!.length,before.other[2]!.length+1);
  });
  await check("repeat-exact-926-and-recorded-run-are-idempotent",async()=>{const before=await snapshot(p);await raw(p);await applyOwned(p);assert.deepEqual(await snapshot(p),before);});
  for(const [name,text] of [
   ["invalid-suspension","UPDATE uqp.DashboardDisplayDevice SET SuspendedAtUtc=SYSUTCDATETIME() WHERE Id=1"],
   ["revoked-reactivation","UPDATE uqp.DashboardDisplayDevice SET IsActive=1 WHERE Id=2"],
   ["archived-reactivation","UPDATE uqp.DashboardDisplayDevice SET IsActive=1 WHERE Id=3"],
   ["invalid-reenrollment","UPDATE uqp.DashboardDisplayDevice SET ReenrollmentRequired=1 WHERE Id=4"],
   ["irreversible-revoked-trigger","UPDATE uqp.DashboardDisplayDevice SET RevokedAtUtc=NULL WHERE Id=2"],
   ["irreversible-archived-trigger","UPDATE uqp.DashboardDisplayDevice SET ArchivedAtUtc=NULL WHERE Id=3"],
  ])await check(name!,()=>unchangedFailure(p,()=>q(p,text!),[547,51926]));
  // SQL text from pre-926 commit 707655ea6e69536e7c85456bf70b5ef33649a4b2, renewDashboardDisplayDevice.
  const oldRenew=`UPDATE uqp.DashboardDisplayDevice SET ExpiresAtUtc=DATEADD(DAY,@extendDays,CASE WHEN ExpiresAtUtc IS NOT NULL AND ExpiresAtUtc>SYSUTCDATETIME() THEN ExpiresAtUtc ELSE SYSUTCDATETIME() END)
   OUTPUT INSERTED.* WHERE Id=@deviceId AND DashboardId=@dashboardId AND IsActive=1 AND RevokedAtUtc IS NULL AND ArchivedAtUtc IS NULL AND ExpiresAtUtc IS NOT NULL AND ExpiresAtUtc>SYSUTCDATETIME() AND DATEADD(DAY,@extendDays,ExpiresAtUtc)<=DATEADD(DAY,365,SYSUTCDATETIME())`;
  // Use a near-future expiry to satisfy the real 365-day renewal ceiling.
  await q(p,"UPDATE uqp.DashboardDisplayDevice SET ExpiresAtUtc=DATEADD(DAY,30,SYSUTCDATETIME()) WHERE Id=1");
  const renew=(target:sql.ConnectionPool,text:string)=>target.request().input("dashboardId",sql.BigInt,1).input("deviceId",sql.BigInt,1).input("extendDays",sql.Int,1).query(text);
  await check("old-server-output-without-into-is-not-a-safe-code-only-downgrade",()=>unchangedFailure(p,()=>renew(p,oldRenew),[334]));
  await check("retain-new-schema-and-compatible-writer",async()=>{
   const source=await readFile(new URL("../modules/dashboard/dashboardDevice.repository.ts",import.meta.url),"utf8");
   const text=source.split("export async function renewDashboardDisplayDevice(")[1]!.split("export async function revokeDashboardDisplayDevice")[0]!.match(/\.query\(`([\s\S]*?)`\)/)![1]!;
   const prior=(await q(p,"SELECT * FROM uqp.DashboardDisplayDevice ORDER BY Id")).recordset;
   assert.equal((await renew(p,text)).recordset.length,1);const next=(await q(p,"SELECT * FROM uqp.DashboardDisplayDevice ORDER BY Id")).recordset;
   assert.equal(new Date(next[0].ExpiresAtUtc).getTime()-new Date(prior[0].ExpiresAtUtc).getTime(),86400000);
   for(let i=0;i<prior.length;i++)for(const col of ["Id","DashboardId","TokenHash","RevokedAtUtc","ArchivedAtUtc"])assert.deepEqual(next[i][col],prior[i][col]);
   assert.deepEqual((await snapshot(p)).other[1],before.other[1]);assert(await ready(p));
  });
  await check("restore-verified-backup-to-separate-db-and-old-writer",async()=>{
   const name=safeName("UQP_D1_UPGRADE_"+randomBytes(6).toString("hex"));
   const moves=files.map((f:any,i:number)=>`MOVE N'${String(f.name).replaceAll("'","''")}' TO N'/var/opt/mssql/data/${name}_${i}.${f.type===1?"ldf":"mdf"}'`).join(",");
   await admin.request().query(`RESTORE DATABASE [${name}] FROM DISK=N'${backupPath}' WITH ${moves},CHECKSUM`);
   pools.set(name,null);const restored=await new sql.ConnectionPool({...config,database:name}).connect();pools.set(name,restored);
   assert.deepEqual(await snapshot(restored),before);assert.equal(await ready(restored),false);
   await q(restored,"UPDATE uqp.DashboardDisplayDevice SET ExpiresAtUtc=DATEADD(DAY,30,SYSUTCDATETIME()) WHERE Id=1");
   assert.equal((await renew(restored,oldRenew)).recordset.length,1);
   assert(await ready(p)); // Restoring the separate DB never removes the committed schema from the upgraded DB.
  });
  for(const omit of ["025","900","918"] as const)await check(`missing-prerequisite-${omit}`,async()=>{const d=await fixture(omit);await unchangedFailure(d.pool,()=>raw(d.pool),[51926]);});
  await check("missing-single-grant-prerequisite",async()=>{const d=await fixture();await q(d.pool,"ALTER TABLE uqp.DashboardDisplayDevice DROP CONSTRAINT CK_DashboardDevice_QueryModeGrant; ALTER TABLE uqp.DashboardDisplayDevice DROP COLUMN DelegatorTokenVersion");await unchangedFailure(d.pool,()=>raw(d.pool),[51926]);});
  await check("preexisting-partial-marker-is-refused-not-repaired",async()=>{const d=await fixture();await q(d.pool,"ALTER TABLE uqp.DashboardDisplayDevice ADD SuspendedAtUtc datetime2(0) NULL");await unchangedFailure(d.pool,()=>raw(d.pool),[51926]);});
  await check("invalid-legacy-row-rolls-back-added-schema",async()=>{const d=await fixture();await q(d.pool,"UPDATE uqp.DashboardDisplayDevice SET IsActive=1 WHERE Id=2");await unchangedFailure(d.pool,()=>applyOwned(d.pool),[547]);assert.equal(await ready(d.pool),false);});
  await check("late-ddl-failure-rolls-back-columns-checks-and-ledger",async()=>{
   const d=await fixture();await q(d.pool,`CREATE TRIGGER D5C5_RejectEnrollmentCheck ON DATABASE FOR ALTER_TABLE AS
    IF EVENTDATA().value('(/EVENT_INSTANCE/TSQLCommand/CommandText)[1]','nvarchar(max)') LIKE '%ADD CONSTRAINT CK_DashboardDevice_LifecycleEnrollment%'
     THROW 51965,'D5_C5A_INJECTED_DDL_FAILURE',1;`);
   await unchangedFailure(d.pool,()=>applyOwned(d.pool),[51965,3609]);assert.equal(await ready(d.pool),false);
  });
  await check("ledger-insert-failure-rolls-back-successful-inner-ddl",async()=>{const d=await fixture();await q(d.pool,`ALTER TABLE uqp.SchemaMigration ADD CONSTRAINT CK_D5C5_Reject926 CHECK(FileName<>N'${migration}')`);await unchangedFailure(d.pool,()=>applyOwned(d.pool),[547]);assert.equal(await ready(d.pool),false);});
  await check("recorded-ledger-missing-schema-blocked-by-acceptance-preflight",async()=>{const d=await fixture();await q(d.pool,`INSERT uqp.SchemaMigration(FileName) VALUES(N'${migration}')`);await unchangedFailure(d.pool,()=>applyOwned(d.pool));});
  await check("manual-schema-missing-ledger-blocked-without-auto-adoption",async()=>{const d=await fixture();await raw(d.pool);await unchangedFailure(d.pool,()=>applyOwned(d.pool));});
  assert.deepEqual([...executed].sort(),sourceFiles.slice().sort());
  console.log(`D5_C5A_SQL_UPGRADE_RECOVERY_PASS:cases=${count};major=${identity.Major};926sha=${pinned926};executed=025,900,918,926;baseline=${baselineName};synthetic-only`);
 }finally{
  for(const [name,pool] of pools){safeName(name);await pool?.close();await admin.request().query(`ALTER DATABASE [${name}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${name}]`);}
  // Backup belongs only to the disposable container; the workflow destroys that entire labeled instance.
 }
}
