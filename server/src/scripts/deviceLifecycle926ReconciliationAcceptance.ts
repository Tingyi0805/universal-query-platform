// Invoked only by D5-C5A's guarded disposable fixture; no app config or production target.
import sql from "mssql";
import assert from "node:assert/strict";
import {randomBytes} from "node:crypto";
import {reconcile926,sha926,ledger926,Reconcile926Error,parse926Approval,resolve926Tls} from "./deviceLifecycle926Reconciliation.js";
type Fixture=()=>Promise<{name:string;pool:sql.ConnectionPool}>;
export async function verify926Reconciliation(fixture:Fixture,raw:(pool:sql.ConnectionPool)=>Promise<void>,snapshot:(pool:sql.ConnectionPool)=>Promise<unknown>,config:sql.config,machine:string){
 assert.equal(config.server,"127.0.0.1");assert.equal(config.port,14336);assert.match(machine,/^uqp-d1-[a-f0-9]{12}$/);
 let count=0;const q=(p:sql.ConnectionPool,s:string)=>p.request().query(s);
 const prepare=async()=>{const f=await fixture();await q(f.pool,`ALTER DATABASE [${f.name}] SET COMPATIBILITY_LEVEL=150`);await raw(f.pool);return f;};
 const approved=async(p:sql.ConnectionPool)=>{const r=(await q(p,"SELECT CONVERT(nvarchar(128),SERVERPROPERTY('ServerName')) S,CONVERT(nvarchar(128),SERVERPROPERTY('MachineName')) M,DB_NAME() D,ORIGINAL_LOGIN() L,USER_NAME() U,CONVERT(int,SERVERPROPERTY('ProductMajorVersion')) V")).recordset[0];assert.equal(r.M,machine);return {format:"UQP_926_LEDGER_APPROVAL_V1",approved:true,scope:"DISPOSABLE_ONLY",connectionMode:"ENCRYPT_TRUST_CERT",tlsTrustApprovalReference:"CI-self-signed-disposable-only",applicationSourceSha:"1".repeat(40),packageManifestSha256:"2".repeat(64),migrationSha256:sha926,serverName:r.S,machineName:r.M,databaseName:r.D,loginName:r.L,databaseUser:r.U,engineMajor:r.V,approvedAtUtc:new Date(Date.now()-1000).toISOString(),expiresAtUtc:new Date(Date.now()+600000).toISOString(),approvalReference:"CI-synthetic-review",maintenanceReference:"CI-no-production-writers",existingBackupReference:"CI-synthetic-checkpoint"};};
 const check=async(name:string,work:()=>Promise<void>)=>{try{await work();}catch(e){console.error(`D6_RECONCILE_CASE_FAILED:${name}:${e instanceof Reconcile926Error?e.code:"assertion-or-sql"}`);throw e;}count++;console.log(`D6_RECONCILE_CASE_PASS:${name}`);};
 const denyUnchanged=async(p:sql.ConnectionPool,work:()=>Promise<unknown>)=>{const before=await snapshot(p);await assert.rejects(work);assert.deepEqual(await snapshot(p),before);};
 await check("strict-tls-untrusted-cert-fails-without-fallback",async()=>{const f=await prepare(),a=parse926Approval({...await approved(f.pool),connectionMode:"STRICT_TLS",tlsTrustApprovalReference:undefined});
  const tls=resolve926Tls(a),strict=new sql.ConnectionPool({...config,database:f.name,options:{...config.options,...tls.options}});
  const before=await snapshot(f.pool);
  try{await assert.rejects(()=>strict.connect(),/certificate|self.signed|issuer|verify|altname/i);assert.deepEqual(await snapshot(f.pool),before);}
  finally{await strict.close();}
 });
 await check("approved-trust-cert-encrypted-session-and-receipt",async()=>{const f=await prepare(),a=parse926Approval(await approved(f.pool));
  const tls=resolve926Tls(a,"ENCRYPT_TRUST_CERT");assert.equal(tls.options.encrypt,true);assert.equal(tls.options.trustServerCertificate,true);
  const encrypted=(await q(f.pool,"SELECT encrypt_option E FROM sys.dm_exec_connections WHERE session_id=@@SPID")).recordset[0]?.E;assert.equal(encrypted,"TRUE");
  const before=await snapshot(f.pool),r=await reconcile926(f.pool,a,"preflight");assert.equal(r.connectionMode,"ENCRYPT_TRUST_CERT");assert.equal(r.encrypt,true);assert.equal(r.trustServerCertificate,true);assert.equal(r.tlsTrustApprovalReference,a.tlsTrustApprovalReference);assert.deepEqual(await snapshot(f.pool),before);
 });
 await check("missing-ledger-preflight-no-write",async()=>{const f=await prepare(),a=await approved(f.pool),before=await snapshot(f.pool);assert.equal((await reconcile926(f.pool,a,"preflight")).status,"READY_LEDGER_ONLY");assert.deepEqual(await snapshot(f.pool),before);});
 await check("exact-schema-ledger-only-adopt-and-repeat",async()=>{const f=await prepare(),a=await approved(f.pool),before=await snapshot(f.pool) as any;
  const r=await reconcile926(f.pool,a,"adopt");assert.equal(r.status,"ADOPTED");assert.equal(r.historicalExecutionTimeBackdated,false);
  const after=await snapshot(f.pool) as any;assert.deepEqual(after.devices,before.devices);assert.deepEqual(after.other[0],before.other[0]);assert.deepEqual(after.other[1],before.other[1]);assert.equal(after.other[2].length,before.other[2].length+1);
  assert.equal((await reconcile926(f.pool,a,"adopt")).status,"ALREADY_RECORDED");assert.deepEqual(await snapshot(f.pool),after);
 });
 for(const [name,change] of [
  ["unexpected-column-default","ALTER TABLE uqp.DashboardDisplayDevice ADD CONSTRAINT DF_D6_Unexpected DEFAULT SYSUTCDATETIME() FOR SuspendedAtUtc"],
  ["disabled-trigger","DISABLE TRIGGER uqp.TR_DashboardDevice_Lifecycle ON uqp.DashboardDisplayDevice"],
  ["wrong-check-definition","ALTER TABLE uqp.DashboardDisplayDevice DROP CONSTRAINT CK_DashboardDevice_LifecycleTerminal; ALTER TABLE uqp.DashboardDisplayDevice ADD CONSTRAINT CK_DashboardDevice_LifecycleTerminal CHECK(IsActive IN(0,1))"],
  ["wrong-trigger-sha","ALTER TRIGGER uqp.TR_DashboardDevice_Lifecycle ON uqp.DashboardDisplayDevice AFTER UPDATE AS RETURN"],
  ["untrusted-check","ALTER TABLE uqp.DashboardDisplayDevice NOCHECK CONSTRAINT CK_DashboardDevice_LifecycleTerminal; ALTER TABLE uqp.DashboardDisplayDevice CHECK CONSTRAINT CK_DashboardDevice_LifecycleTerminal"],
  ["missing-prerequisite-ledger","DELETE uqp.SchemaMigration WHERE FileName='918_dashboard_query_playback_mode.sql'"],
  ["unexpected-ledger-trigger","CREATE TRIGGER uqp.D6_Unexpected ON uqp.SchemaMigration AFTER INSERT AS RETURN"],
 ])await check(name!,async()=>{const f=await prepare();await f.pool.request().batch(change!);const a=await approved(f.pool);await denyUnchanged(f.pool,()=>reconcile926(f.pool,a,"adopt"));});
 await check("identity-mismatch",async()=>{const f=await prepare();const a=await approved(f.pool);await denyUnchanged(f.pool,()=>reconcile926(f.pool,{...a,loginName:"wrong-identity"},"adopt"));});
 await check("ledger-write-failure-transaction-rollback",async()=>{const f=await prepare();await q(f.pool,`ALTER TABLE uqp.SchemaMigration ADD CONSTRAINT CK_D6_Fault CHECK(FileName<>N'${ledger926}')`);const a=await approved(f.pool);await denyUnchanged(f.pool,()=>reconcile926(f.pool,a,"adopt"));assert.equal((await q(f.pool,"SELECT @@TRANCOUNT T")).recordset[0].T,0);});
 await check("concurrent-adoptions-single-row",async()=>{const f=await prepare(),a=await approved(f.pool),before=await snapshot(f.pool) as any;
  const second=await new sql.ConnectionPool({...config,database:f.name}).connect();try{const results=await Promise.all([reconcile926(f.pool,a,"adopt"),reconcile926(second,a,"adopt")]);assert.deepEqual(results.map(r=>r.status).sort(),["ADOPTED","ALREADY_RECORDED"]);
   const after=await snapshot(f.pool) as any;assert.deepEqual(after.devices,before.devices);assert.deepEqual(after.other[1],before.other[1]);assert.equal(after.other[2].length,before.other[2].length+1);
  }finally{await second.close();}
 });
 await check("insufficient-permission-no-ledger-write",async()=>{const f=await prepare(),name="d6_reader_"+randomBytes(6).toString("hex"),password="D6!"+randomBytes(20).toString("hex");assert.match(name,/^d6_reader_[a-f0-9]{12}$/);
  await q(f.pool,`CREATE LOGIN [${name}] WITH PASSWORD='${password}',CHECK_POLICY=OFF; CREATE USER [${name}] FOR LOGIN [${name}]; GRANT VIEW DEFINITION TO [${name}]; GRANT SELECT TO [${name}];`);
  const reader=await new sql.ConnectionPool({...config,user:name,password,database:f.name}).connect();
  try{const a=await approved(reader);await denyUnchanged(f.pool,()=>reconcile926(reader,a,"adopt"));}finally{await reader.close();await q(f.pool,`DROP USER [${name}]; DROP LOGIN [${name}]`);}
 });
 console.log(`D6_RECONCILIATION_SQL_PASS:cases=${count};machine=${machine};ledger-only;synthetic-only`);
}
