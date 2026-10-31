// Invoked only by the existing disposable SQL harness after its machine/database guards.
import sql from "mssql";
import assert from "node:assert/strict";
import {deviceListQuery,readDeviceList,createDeviceListReader,type DeviceListQuery} from "../modules/dashboard/dashboardDeviceList.js";
import {deviceLifecycleState,type DeviceLifecycleRecord} from "../modules/dashboard/dashboardDeviceLifecycle.js";
import type {DeviceManagementStore,DeviceManagementTransaction} from "../modules/dashboard/dashboardDeviceManagement.service.js";
export async function verifyDeviceList(pool:sql.ConnectionPool,config:sql.config){
 const query=(s:string)=>pool.request().query(s);
 // Separate dashboard, no impact on earlier D1/D3 assertions or their fixtures.
 await query("INSERT uqp.Dashboard(Id) VALUES(99)");
 await query(`DECLARE @i int=0; WHILE @i<31 BEGIN
 INSERT uqp.DashboardDisplayDevice(DashboardId,DeviceName,TokenHash,IsActive,CreatedByUserId)
 VALUES(99,CASE WHEN @i=0 THEN N'特殊%_[\\中文' ELSE N'裝置'+CONVERT(nvarchar(20),@i) END,CONVERT(char(64),HASHBYTES('SHA2_256',CRYPT_GEN_RANDOM(32)),2),1,1);
 SET @i+=1; END;
 INSERT uqp.DashboardDisplayDevice(DashboardId,DeviceName,TokenHash,IsActive,CreatedByUserId,SuspendedAtUtc,ReenrollmentRequired,ExpiresAtUtc,RevokedAtUtc,ArchivedAtUtc) VALUES
 (99,N'暫停',REPLICATE('1',64),0,1,'2026-01-01',1,NULL,NULL,NULL),
 (99,N'待註冊',REPLICATE('2',64),1,1,NULL,1,NULL,NULL,NULL),
 (99,N'過期',REPLICATE('3',64),1,1,NULL,NULL,'2020-01-01',NULL,NULL),
 (99,N'撤銷',REPLICATE('4',64),0,1,NULL,NULL,NULL,'2020-01-01',NULL),
 (99,N'封存',REPLICATE('5',64),0,1,NULL,NULL,NULL,'2020-01-01','2020-01-01');`);
 const store:DeviceManagementStore={transaction:async work=>{
  const tx=new sql.Transaction(pool);await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  try{const value=await work({schemaReady:async()=>true,securityReady:async()=>{},actor:async()=>{},lifecycleReady:async()=>{},
   readState:async()=>{const r=await new sql.Request(tx).query("SELECT Id,QueryMode FROM uqp.Dashboard WITH(UPDLOCK,HOLDLOCK) WHERE Id=99");return {dashboard:{mode:r.recordset[0].QueryMode}};},
   listDevices:(id:number,q:DeviceListQuery,asOf:string|null)=>readDeviceList(new sql.Request(tx),id,q,asOf),
  } as unknown as DeviceManagementTransaction);await tx.commit();return value;}catch(e){await tx.rollback();throw e;}
 }};
 const read=createDeviceListReader(store,()=>true),actor={userId:1,tokenVersion:1};
 const first=await read(99,actor,{pageSize:"10"});assert.equal(first.total,36);assert.equal(first.items.length,10);
 const ids=[...first.items.map(d=>d.id)];
 for(const page of [2,3,4]){const result=await read(99,actor,{pageSize:"10",page:String(page),snapshot:first.snapshot});assert.equal(result.total,36);ids.push(...result.items.map(d=>d.id));}
 assert.equal(new Set(ids).size,36);assert.deepEqual(ids,[...ids].sort((a,b)=>a-b));
 assert.equal((await read(99,actor,{pageSize:"10",page:"5",snapshot:first.snapshot})).items.length,0);
 for(const size of ["10","20","50","100"]){const r=await read(99,actor,{pageSize:size});assert.equal(r.items.length,Math.min(Number(size),36));}
 await query(`UPDATE uqp.DashboardDisplayDevice SET QueryModeGrantVersion=1,DelegatorTokenVersion=1 WHERE Id=${ids[0]}`);
 const rows=(await query("SELECT * FROM uqp.DashboardDisplayDevice WHERE DashboardId=99 ORDER BY Id")).recordset;
 const projected=await read(99,actor,{pageSize:"100"});
 for(const row of rows){const date=(d:any)=>d==null?null:new Date(d).toISOString();const expected=deviceLifecycleState({id:Number(row.Id),dashboardId:99,isActive:row.IsActive,tokenHash:row.TokenHash,expiresAtUtc:date(row.ExpiresAtUtc),suspendedAtUtc:date(row.SuspendedAtUtc),revokedAtUtc:date(row.RevokedAtUtc),archivedAtUtc:date(row.ArchivedAtUtc),reenrollmentRequired:row.ReenrollmentRequired,queryModeGrantVersion:row.QueryModeGrantVersion==null?null:Number(row.QueryModeGrantVersion),delegatorTokenVersion:row.DelegatorTokenVersion==null?null:Number(row.DelegatorTokenVersion)} as DeviceLifecycleRecord,Date.parse(projected.asOfUtc));assert.equal(projected.items.find(d=>d.id===Number(row.Id))!.status,expected);}
 for(const status of ["ACTIVE","SUSPENDED","PENDING_REENROLLMENT","REVOKED","ARCHIVED","EXPIRED","UNVERIFIED"]){const r=await read(99,actor,{status,pageSize:"100"});assert.equal(r.total,projected.items.filter(d=>d.status===status).length);assert(r.items.every(d=>d.status===status));}
 assert.equal((await read(99,actor,{search:"特殊%_[\\中文"})).total,1);
 const exact=await read(99,actor,{search:String(ids[0])});assert(exact.items.some(d=>d.id===ids[0]));
 assert.equal((await read(99,actor,{search:"%' OR 1=1; DROP TABLE x;--"})).total,0);
 assert.equal((await read(99,actor,{search:"does-not-exist"})).items.length,0);
 const changed=async(mutation:string)=>{const before=await read(99,actor,{pageSize:"10"});await query(mutation);await assert.rejects(read(99,actor,{page:"2",pageSize:"10",snapshot:before.snapshot}),{code:"DASHBOARD_DEVICE_LIST_CHANGED"});};
 await changed(`UPDATE uqp.DashboardDisplayDevice SET DeviceName=N'changed' WHERE Id=${ids[0]}`);
 await changed("INSERT uqp.DashboardDisplayDevice(DashboardId,DeviceName,TokenHash,IsActive,CreatedByUserId) VALUES(99,N'新增',REPLICATE('6',64),1,1)");
 await changed(`UPDATE uqp.DashboardDisplayDevice SET IsActive=0,RevokedAtUtc=SYSUTCDATETIME(),TokenHash=REPLICATE('7',64) WHERE Id=${ids[1]}`);
 await changed(`DELETE FROM uqp.DashboardDisplayDevice WHERE Id=${ids[2]}`);
 await query(`UPDATE uqp.DashboardDisplayDevice SET ExpiresAtUtc=DATEADD(second,2,SYSUTCDATETIME()) WHERE Id=${ids[0]}`);
 const timed=await read(99,actor,{pageSize:"10"});await new Promise(resolve=>setTimeout(resolve,3000));
 await assert.rejects(read(99,actor,{page:"2",pageSize:"10",snapshot:timed.snapshot}),{code:"DASHBOARD_DEVICE_LIST_CHANGED"});
 // Writer on another connection must wait while the serializable list holds its range.
 const other=await new sql.ConnectionPool({...config,pool:{max:1,min:0}}).connect();
 try { for(const mutation of [
  `UPDATE uqp.DashboardDisplayDevice SET DeviceName=N'concurrent' WHERE Id=${ids[0]}`,
  "INSERT uqp.DashboardDisplayDevice(DashboardId,DeviceName,TokenHash,IsActive,CreatedByUserId) VALUES(99,N'並行新增',CONVERT(char(64),HASHBYTES('SHA2_256',CRYPT_GEN_RANDOM(32)),2),1,1)",
  `UPDATE uqp.DashboardDisplayDevice SET IsActive=0,RevokedAtUtc=SYSUTCDATETIME(),TokenHash=REPLICATE('8',64) WHERE Id=${ids[3]}`,
 ]) {
  const before=await read(99,actor,{pageSize:"10"});
  const tx=new sql.Transaction(pool);await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  try {await readDeviceList(new sql.Request(tx),99,deviceListQuery.parse({}),null);
   let done=false;const writing=other.request().query(mutation).then(()=>{done=true;});
   await new Promise(resolve=>setTimeout(resolve,100));assert.equal(done,false);await tx.commit();await writing;
   await assert.rejects(read(99,actor,{page:"2",pageSize:"10",snapshot:before.snapshot}),{code:"DASHBOARD_DEVICE_LIST_CHANGED"});
  }catch(e){await tx.rollback().catch(()=>{});throw e;}
 }}finally{await other.close();}

 console.log("D4-C1 SQL: states, literal search, count/pages/order, mutations, expiry and serializable writer PASS");
}
