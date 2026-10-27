/** Only called AFTER the existing empty-instance/nonce-database witness. Never opens a connection. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import sql from "mssql";
import { createIsolatedUserRevocationWriter } from "../modules/auth/workstationUserRevocation.js";
import type { WorkstationSqlRequest,WorkstationSqlTransaction } from "../modules/auth/workstationSessionSql.repository.js";
import { workstationUserRevocationSql } from "../modules/auth/workstationUserRevocationSql.js";
import { userSqlCases } from "./workstationUserRevocationSqlAcceptanceCases.js";
type CaseName=typeof userSqlCases[number];
type Fixture=(mode:number,user:string)=>Promise<{scope:{workstationId:string;deviceSessionId?:string};legacyId:string}>;
export async function acceptUserRevocation(root:sql.ConnectionPool,app:sql.ConnectionPool,fixture:Fixture,
 runCase:(name:CaseName,work:()=>Promise<void>)=>Promise<void>){
 const witness=(await root.request().query(`SELECT CONVERT(INT,SERVERPROPERTY(N'ProductMajorVersion')) Engine,
  CONVERT(NVARCHAR(128),SERVERPROPERTY(N'MachineName')) Machine,CONVERT(NVARCHAR(128),@@SERVERNAME) ServerName,
  DB_NAME() DatabaseName,(SELECT COUNT(*) FROM sys.databases WHERE database_id>4) UserDatabases;`)).recordset[0];
 assert.equal(witness.Engine,15);assert.equal(witness.Machine,"uqp-h0-926-isolated");assert.equal(witness.ServerName,"uqp-h0-926-isolated");
 assert.match(witness.DatabaseName,/^UQP926_[0-9a-f]{32}$/);assert.equal(witness.UserDatabases,1);
 const seedUser=async()=>{
  const r=await root.request().input("name",sql.NVarChar(100),"SYNTHETIC_"+randomUUID()).query(`
   INSERT uqp.AppUser(Username,DisplayName,AuthProvider) OUTPUT CONVERT(VARCHAR(20),INSERTED.Id) AS Id
   VALUES(@name,N'SYNTHETIC',N'LOCAL');`);return r.recordset[0].Id as string;
 };
 const actor=await seedUser();
 await root.request().input("u",sql.VarChar(20),actor).query(`INSERT uqp.UserRole(UserId,RoleId)
 SELECT CONVERT(BIGINT,@u),Id FROM uqp.Role WHERE Code=N'SYSTEM_ADMIN';`);
 const command=async(device=true)=>{
  const target=await seedUser();if(device)await fixture(1,target);
  const scopes=(await root.request().input("u",sql.VarChar(20),target).query(`
   SELECT CONVERT(VARCHAR(20),WorkstationId) workstationId,LOWER(CONVERT(VARCHAR(36),DeviceSessionId)) deviceSessionId,
   LOWER(CONVERT(VARCHAR(16),RowVersion,2)) revision,CONVERT(VARCHAR(20),Generation) generation,
   LOWER(CONVERT(VARCHAR(36),Incarnation)) incarnation
   FROM uqp.SharedWorkstationOperatorState WHERE OperatorUserId=CONVERT(BIGINT,@u);`)).recordset
   .map(r=>({...r,requestId:randomUUID(),correlationId:randomUUID()}));
  return {operation:"REVOKE_AUTHORIZATION",actorUserId:actor,actorTokenVersion:1,targetUserId:target,expectedTokenVersion:1,
   scopes,account:{requestId:randomUUID(),correlationId:randomUUID()}};
 };
 const writer=(unknownCommit=false)=>createIsolatedUserRevocationWriter({getPool:async()=>app,newUuid:randomUUID,
  transaction:p=>{
   const real=new sql.Transaction(p as sql.ConnectionPool);
   return {real,begin:l=>real.begin(l).then(()=>undefined),rollback:()=>real.rollback(),async commit(){
    await real.commit();if(unknownCommit)throw Error("SYNTHETIC_ACK_LOSS");
   }} as WorkstationSqlTransaction;
  },request:tx=>new sql.Request((tx as WorkstationSqlTransaction&{real:sql.Transaction}).real) as unknown as WorkstationSqlRequest});
 const snapshot=async(u:string)=>(await root.request().input("u",sql.VarChar(20),u).query(`SELECT
  (SELECT TokenVersion FROM uqp.AppUser WHERE Id=CONVERT(BIGINT,@u)) TokenVersion,
  (SELECT COUNT(*) FROM uqp.SharedWorkstationSession WHERE UserId=CONVERT(BIGINT,@u) AND RevokedAtUtc IS NULL) Legacy,
  (SELECT COUNT(*) FROM uqp.SharedWorkstationOperatorState WHERE OperatorUserId=CONVERT(BIGINT,@u)) Operators,
  (SELECT COUNT(*) FROM uqp.AccountRevocationRequest WHERE TargetUserId=CONVERT(BIGINT,@u)) Requests,
  (SELECT COUNT(*) FROM uqp.AccountRevocationDecision WHERE TargetUserId=CONVERT(BIGINT,@u)) Decisions,
  (SELECT COUNT(*) FROM uqp.SharedWorkstationSessionDecision WHERE TargetUserId=CONVERT(BIGINT,@u)) DeviceDecisions,
  (SELECT COUNT(*) FROM uqp.AuditLog WHERE EventType=N'ACCOUNT_AUTHORIZATION_REVOKED') Audits;`)).recordset[0];
 const assertSuccess=async(c:Awaited<ReturnType<typeof command>>)=>{
  const r=await writer().execute(c);assert.equal(r.status,"COMMIT_ACKNOWLEDGED");assert.equal(r.runtimeEnabled,false);
  const next=await snapshot(c.targetUserId);assert.equal(next.TokenVersion,2);assert.equal(next.Legacy,0);
  assert.equal(next.Operators,0);assert.equal(next.Decisions,1);assert.equal(next.Requests,1);
  for(const receipt of r.receipts)assert.equal(typeof receipt.auditLogId,"string");
 };
 await runCase("account-no-device",async()=>assertSuccess(await command(false)));
 for(const [name,operation] of [["user-disable","DISABLE"],["user-token-revoke","REVOKE_AUTHORIZATION"],
  ["user-local-password","CHANGE_PASSWORD"],["user-role-assignment","REPLACE_ROLES"]] as const)
  await runCase(name,async()=>{
   const c=await command();c.operation=operation;
   const extra=operation==="CHANGE_PASSWORD"?{passwordHash:"$2b$12$"+"a".repeat(53)}:operation==="REPLACE_ROLES"?
    {roleIds:[(await root.request().query("SELECT CONVERT(VARCHAR(20),Id) Id FROM uqp.Role WHERE Code=N'REPORT_USER'")).recordset[0].Id]}:{};
   const r=await writer().execute({...c,...extra});assert.equal(r.status,"COMMIT_ACKNOWLEDGED");
   assert.equal((await snapshot(c.targetUserId)).TokenVersion,2);
  });
 await runCase("user-shared-workstation-preserved",async()=>{
  const c=await command(),other=await seedUser(),f=await fixture(1,other);
  // A's historical revoked session on B's current workstation must not be touched.
  await root.request().input("id",sql.UniqueIdentifier,randomUUID()).input("w",sql.VarChar(20),f.scope.workstationId)
   .input("u",sql.VarChar(20),c.targetUserId).query(`INSERT uqp.SharedWorkstationSession
   (Id,WorkstationId,UserId,SessionSecretHash,AuthMethod,AuthenticatedAtUtc,LastActivityAtUtc,ExpiresAtUtc,RevokedAtUtc,TokenVersion)
   VALUES(@id,CONVERT(BIGINT,@w),CONVERT(BIGINT,@u),HASHBYTES('SHA2_256',0x01),N'PASSWORD',
   SYSUTCDATETIME(),SYSUTCDATETIME(),DATEADD(MINUTE,10,SYSUTCDATETIME()),SYSUTCDATETIME(),1);`);
  const deviceState=async()=>(await root.request().input("w",sql.VarChar(20),f.scope.workstationId).query(`
   SELECT LOWER(CONVERT(VARCHAR(16),o.RowVersion,2)) Revision,CONVERT(VARCHAR(20),o.Generation) Generation,
   CONVERT(VARCHAR(36),o.Incarnation) Incarnation,ds.RevokedAtUtc DeviceRevoked,c.IsRevoked CredentialRevoked,
   LOWER(CONVERT(VARCHAR(16),ds.RowVersion,2)) DeviceRevision
   FROM uqp.SharedWorkstationOperatorState o JOIN uqp.SharedWorkstationDeviceSession ds ON ds.Id=o.DeviceSessionId
   JOIN uqp.SharedWorkstationCredential c ON c.Id=ds.CredentialId WHERE o.WorkstationId=CONVERT(BIGINT,@w);`)).recordset;
  const before=await deviceState();await assertSuccess(c);assert.deepEqual(await deviceState(),before);
  const s=await snapshot(other);assert.equal(s.TokenVersion,1);assert.equal(s.Legacy,1);assert.equal(s.Operators,1);
 });
 await runCase("user-pin-binding-invalidated",async()=>{
  const c=await command();await root.request().input("u",sql.VarChar(20),c.targetUserId).query(`
   INSERT uqp.UserQuickPin(UserId,PinHash,PinVersion,IsEnabled) VALUES(CONVERT(BIGINT,@u),N'SYNTHETIC_NOT_A_PIN_HASH',1,1);
   INSERT uqp.UserQuickPinSecurityBinding(UserId,PinVersion,BoundTokenVersion,BoundPolicyRevision)
   SELECT CONVERT(BIGINT,@u),1,1,PolicyRevision FROM uqp.QuickPinPolicy WHERE Id=1;`);
  await assertSuccess(c);
  const row=(await root.request().input("u",sql.VarChar(20),c.targetUserId).query(`SELECT u.TokenVersion,b.BoundTokenVersion
   FROM uqp.AppUser u JOIN uqp.UserQuickPinSecurityBinding b ON b.UserId=u.Id WHERE u.Id=CONVERT(BIGINT,@u);`)).recordset[0];
  assert.notEqual(row.TokenVersion,row.BoundTokenVersion);
 });
 await runCase("account-request-replay",async()=>{
  const c=await command(false);await assertSuccess(c);const before=await snapshot(c.targetUserId);
  assert.equal((await writer().execute({...c,expectedTokenVersion:2})).code,"ACCOUNT_REQUEST_REPLAY");
  assert.deepEqual(await snapshot(c.targetUserId),before);
 });
 for(const [name,key,value] of [["user-rowversion-conflict","revision","0000000000000000"],
  ["user-generation-conflict","generation","9007199254740994"]] as const)
  await runCase(name,async()=>{
   const c=await command(),before=await snapshot(c.targetUserId);c.scopes[0]![key]=value;
   assert.equal((await writer().execute(c)).code,"OPERATOR_CAS_CONFLICT");assert.deepEqual(await snapshot(c.targetUserId),before);
  });
 for(const [name,table] of [["account-audit-rollback","AuditLog"],["account-decision-rollback","AccountRevocationDecision"]] as const)
  await runCase(name,async()=>{
   const c=await command(),before=await snapshot(c.targetUserId);
   await root.request().batch(`CREATE TRIGGER uqp.H0_AccountFail ON uqp.${table} AFTER INSERT AS
    BEGIN THROW 52927,'SYNTHETIC_ACCEPTANCE_FAILURE',1; END;`);
   try{const r=await writer().execute(c);assert.ok(["REJECTED","ROLLBACK_UNKNOWN"].includes(r.status));}
   finally{await root.request().batch("DROP TRIGGER uqp.H0_AccountFail");}
   assert.deepEqual(await snapshot(c.targetUserId),before);
  });
 await runCase("account-commit-unknown",async()=>{
  const c=await command();assert.equal((await writer(true).execute(c)).status,"COMMIT_UNKNOWN");
  assert.equal((await snapshot(c.targetUserId)).Decisions,1);
 });
 await runCase("concurrent-user-revoke",async()=>{
  const c=await command();let entered!:()=>void,release!:()=>void;
  const locked=new Promise<void>(r=>entered=r),barrier=new Promise<void>(r=>release=r);
  // Separate SQL transactions/connections; pause A after it holds the shared Gate.
  const a=createIsolatedUserRevocationWriter({getPool:async()=>app,newUuid:randomUUID,
   transaction:p=>{const real=new sql.Transaction(p as sql.ConnectionPool);return {real,begin:l=>real.begin(l).then(()=>undefined),
    commit:()=>real.commit(),rollback:()=>real.rollback()} as WorkstationSqlTransaction;},
   request:tx=>{const req=new sql.Request((tx as WorkstationSqlTransaction&{real:sql.Transaction}).real);
    const wrapped:WorkstationSqlRequest={input(n,t,v){req.input(n,t as sql.ISqlType,v);return wrapped;},async query(text){
     const result=await req.query(text);if(text===workstationUserRevocationSql.operators){entered();await barrier;}return result;
    }};return wrapped;}}).execute(c);
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{
   await Promise.race([locked,a.then(()=>{throw Error("BARRIER_NOT_REACHED");}),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error("BARRIER_TIMEOUT")),10000);})]);
   const b=writer().execute({...c,account:{requestId:randomUUID(),correlationId:randomUUID()},
    scopes:c.scopes.map(s=>({...s,requestId:randomUUID(),correlationId:randomUUID()}))});release();
   const r=await Promise.all([a,b]);assert.deepEqual(r.map(v=>v.status).sort(),["COMMIT_ACKNOWLEDGED","REJECTED"]);
   assert.equal((await snapshot(c.targetUserId)).Decisions,1);
  }finally{if(timer)clearTimeout(timer);release();await a;}
 });
}
