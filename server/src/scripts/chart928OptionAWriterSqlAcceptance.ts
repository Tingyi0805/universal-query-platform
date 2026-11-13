// Option A: REAL SQL Server 2019/2022 CHART Writer acceptance on a
// second, disposable UQP_CH_ DB inside the existing D1 CI container.
// The production review SQL remains non-executable and unmodified ON DISK.
// For isolated acceptance ONLY, hard guard and NULL evidence pins are
// substituted IN MEMORY after exact machine and target checks.
import assert from "node:assert/strict";
import {createServer} from "node:http";
import express from "express";
import jwt from "jsonwebtoken";
import {env} from "../config/env.js";
import {createAuthenticateJwt} from "../modules/auth/auth.middleware.js";
import {createChartCreateRouter} from "../modules/dashboard/dashboardChartCreate.routes.js";
import {createChartSavedReadbackRouter} from "../modules/dashboard/dashboardChartSavedReadback.routes.js";
import {createDormantChartTrustReaders} from "../modules/dashboard/dashboardChartTrust.repository.js";
import {chartLocalJwtWriterCreateSql} from "../modules/dashboard/dashboardChartLocalJwtSqlCreate.js";
import {randomBytes} from "node:crypto";
import {readFile} from "node:fs/promises";
import sql from "mssql";
import {attestChartWriterBaseSqlCatalog} from "./chart928WriterBaseSchema.js";
import {canonicalChartConfig} from "../modules/dashboard/dashboardChartAtomicCreate.contract.js";
const candidate=new URL("../../../database/review/928_chart_local_jwt_writer.production-review.sql.txt",import.meta.url);
const frozen=new URL("../../../database/drafts/928_dashboard_chart_trust_schema.sql.draft",import.meta.url);
const reviewedFrozen=new URL("../../../database/review/928_dashboard_chart_trust_base.production-review.sql.txt",import.meta.url);
const replaceOnce=(s:string,a:string,b:string)=>{
 assert.equal(s.split(a).length,2,"CHART_A_REVIEW_SOURCE_DRIFT");return s.replace(a,b);
};
const requestId=(n:number)=>"00000000-0000-4000-8000-"+n.toString(16).padStart(12,"0");
export async function verifyChartOptionAWriterSql(
 admin:sql.ConnectionPool,config:sql.config,machine:string,
):Promise<void>{
 if(process.env.UQP_D1_SCOPE!=="DISPOSABLE_ONLY"||
  process.env.UQP_D1_CONTAINER_NAME!==machine||
  !/^uqp-d1-[a-f0-9]{12}$/.test(machine)||
  Object.keys(process.env).some(k=>k.startsWith("PLATFORM_DB_")||k==="DOTENV_CONFIG_PATH"))
  throw Error("CHART_A_DISPOSABLE_ONLY");
 const target=(await admin.request().query(
  "SELECT DB_NAME() AS Db,CONVERT(nvarchar(128),SERVERPROPERTY('MachineName')) AS Machine")).recordset[0];
 assert.equal(target?.Db,"master");assert.equal(target?.Machine,machine);
 const source=await readFile(candidate,"utf8");
 const base=await readFile(frozen,"utf8");
 const reviewedBase=await readFile(reviewedFrozen,"utf8");
 const frozenReviewGuard="THROW 51928,'CHART_928_PRODUCTION_REVIEW_NOT_APPROVED',1;";
 const filterWitness="DECLARE @approvedActiveFilterSha256 varbinary(32)=NULL;";
 assert.equal(reviewedBase.split(frozenReviewGuard).length,2);
 assert.equal(reviewedBase.split(filterWitness).length,2);
 const first="THROW 51928,'CHART_A_WRITER_PRODUCTION_REVIEW_NOT_APPROVED',1;";
 const frozenPin="DECLARE @approvedFrozenTriggerDefinitionSha256 VARBINARY(32)=NULL;";
 const writerPin="DECLARE @approvedWriterOriginalSid VARBINARY(85)=NULL;";
 for(const s of [first,frozenPin,writerPin])assert.equal(source.split(s).length,2);
 await assert.rejects(admin.request().batch(source),(e:unknown)=>
  Number((e as {number?:number}).number)===51928);
 let db:sql.ConnectionPool|undefined,writer:sql.ConnectionPool|undefined;
 let created=false,loginCreated=false,stage="CREATE_DATABASE";
 const name="UQP_CH_"+randomBytes(6).toString("hex");
 // These credentials are ephemeral random CI-only and never logged.
 const writerName="UQP_CHW_"+randomBytes(6).toString("hex");
 const writerPassword="D1!"+randomBytes(20).toString("hex")+"q";
 try{
  stage="CREATE_TEST_WRITER_LOGIN";
  await admin.request().query("CREATE LOGIN ["+writerName+
    "] WITH PASSWORD='"+writerPassword+"', CHECK_POLICY=OFF");
  loginCreated=true;
  await admin.request().query("CREATE DATABASE ["+name+"]");created=true;
  db=await new sql.ConnectionPool({...config,database:name,pool:{max:3,min:0}}).connect();
  const q=(s:string)=>db!.request().query(s);
  stage="CREATE_SCHEMA";await q("CREATE SCHEMA uqp");
  // Copied from the established 928 disposable acceptance ONLY:
  stage="CREATE_FIXTURE_TABLES";
  await q("CREATE TABLE uqp.AppUser(Id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY, " +
   "IsActive BIT NOT NULL DEFAULT(1),TokenVersion INT NOT NULL DEFAULT(1)); " +
   "CREATE TABLE uqp.Role(Id BIGINT NOT NULL PRIMARY KEY,IsActive BIT NOT NULL); " +
   "CREATE TABLE uqp.Permission(Id BIGINT NOT NULL PRIMARY KEY,Code NVARCHAR(100) NOT NULL); " +
   "CREATE TABLE uqp.UserRole(UserId BIGINT NOT NULL,RoleId BIGINT NOT NULL); " +
   "CREATE TABLE uqp.RolePermission(RoleId BIGINT NOT NULL,PermissionId BIGINT NOT NULL); " +
   "CREATE TABLE uqp.DataSource(Id BIGINT NOT NULL PRIMARY KEY,IsActive BIT NOT NULL DEFAULT(1)); " +
   "CREATE TABLE uqp.QueryDefinition(Id BIGINT NOT NULL PRIMARY KEY,DatasetId BIGINT NOT NULL DEFAULT(10),IsActive BIT NOT NULL DEFAULT(1),IsPublished BIT NOT NULL DEFAULT(1),IsArchived BIT NOT NULL DEFAULT(0)); " +
   "CREATE TABLE uqp.Dataset(Id BIGINT NOT NULL PRIMARY KEY,DataSourceId BIGINT NOT NULL DEFAULT(11),IsActive BIT NOT NULL DEFAULT(1),IsArchived BIT NOT NULL DEFAULT(0)); " +
   "CREATE TABLE uqp.Dashboard(Id BIGINT NOT NULL PRIMARY KEY,QueryDefinitionId BIGINT NOT NULL DEFAULT(9),IsActive BIT NOT NULL DEFAULT(1),QueryMode NVARCHAR(30) NOT NULL DEFAULT(N'QUERY_ONLY'),QueryModeVersion INT NOT NULL DEFAULT(1),QuerySourceMaxRows INT NULL DEFAULT(3000)); " +
   "CREATE TABLE uqp.DashboardDataSource(DashboardId BIGINT NOT NULL,SourceKey NVARCHAR(64) NOT NULL,DatasetId BIGINT NOT NULL,QueryDefinitionId BIGINT NULL,IsEnabled BIT NOT NULL,QueryBindingRevision INT NULL,MaxRows INT NULL); " +
   "CREATE TABLE uqp.UserQueryAccess(UserId BIGINT NOT NULL,QueryDefinitionId BIGINT NOT NULL,CanView BIT NOT NULL,CanExecute BIT NOT NULL); " +
   "CREATE TABLE uqp.RoleQueryAccess(RoleId BIGINT NOT NULL,QueryDefinitionId BIGINT NOT NULL,CanView BIT NOT NULL,CanExecute BIT NOT NULL); " +
   "CREATE TABLE uqp.DatasetParameter(DatasetId BIGINT NOT NULL,LookupDatasetId BIGINT NULL); " +
   "CREATE TABLE uqp.DashboardDisplayProfile(Id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY," +
   " DashboardId BIGINT NOT NULL," +
   " CONSTRAINT FK_DashboardDisplayProfile_Dashboard FOREIGN KEY(DashboardId)" +
   " REFERENCES uqp.Dashboard(Id) ON DELETE CASCADE); " +
   "CREATE TABLE uqp.DashboardWidget(Id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY," +
   " ProfileId BIGINT NOT NULL," +
   " CONSTRAINT FK_DashboardWidget_Profile FOREIGN KEY(ProfileId)" +
   " REFERENCES uqp.DashboardDisplayProfile(Id) ON DELETE CASCADE," +
   " WidgetType NVARCHAR(30) NOT NULL,SourceKey NVARCHAR(256) NULL," +
   " ConfigJson NVARCHAR(MAX) NOT NULL DEFAULT N'{}'," +
   " Title NVARCHAR(200) NULL,X INT NOT NULL DEFAULT(0),Y INT NOT NULL DEFAULT(0)," +
   " Width INT NOT NULL DEFAULT(600),Height INT NOT NULL DEFAULT(360)," +
   " FontSize INT NOT NULL DEFAULT(36),Alignment NVARCHAR(10) NOT NULL DEFAULT(N'CENTER')," +
   " SortOrder INT NOT NULL DEFAULT(0)," +
   " CONSTRAINT CK_DashboardWidget_Type CHECK(WidgetType IN" +
   " (N'TEXT',N'PARAMETER',N'FIELD',N'CLOCK',N'PAGE_INFO',N'COUNTDOWN',N'TABLE',N'CONTAINER'))," +
   " CONSTRAINT CK_DashboardWidget_ConfigJson CHECK(ISJSON(ConfigJson)=1)); " +
   "CREATE TABLE uqp.AuditLog(Id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY," +
   " EventType NVARCHAR(50) NOT NULL,EventCategory NVARCHAR(20) NOT NULL," +
   " Status NVARCHAR(20) NOT NULL,UserId BIGINT NULL,IsImportant BIT NOT NULL," +
   " ParametersJson NVARCHAR(MAX) NULL,CompletedAtUtc DATETIME2(0) NULL," +
   " CONSTRAINT FK_AuditLog_User FOREIGN KEY(UserId) REFERENCES uqp.AppUser(Id)); " +
   "CREATE TABLE uqp.AuditLogArchive(Id BIGINT NOT NULL PRIMARY KEY," +
   " EventType NVARCHAR(100) NOT NULL,Status NVARCHAR(20) NOT NULL," +
   " UserId BIGINT NOT NULL,IsImportant BIT NOT NULL); " +
   "CREATE TABLE uqp.DatasetPublicDisplayPolicy(DatasetId BIGINT NOT NULL PRIMARY KEY); ");
  stage="SEED_FIXTURE";
  await q("SET IDENTITY_INSERT uqp.AppUser ON; " +
   "INSERT uqp.AppUser(Id) VALUES(8),(77); " +
   "SET IDENTITY_INSERT uqp.AppUser OFF; " +
   "INSERT uqp.DataSource(Id) VALUES(11); INSERT uqp.Dataset(Id) VALUES(10); " +
   "INSERT uqp.QueryDefinition(Id) VALUES(9); " +
   "INSERT uqp.Dashboard(Id) VALUES(7); " +
   "SET IDENTITY_INSERT uqp.DashboardDisplayProfile ON; " +
   "INSERT uqp.DashboardDisplayProfile(Id,DashboardId) VALUES(22,7); " +
   "SET IDENTITY_INSERT uqp.DashboardDisplayProfile OFF; " +
   "SET IDENTITY_INSERT uqp.DashboardWidget ON; " +
    "INSERT uqp.DashboardWidget(Id,ProfileId,WidgetType,SourceKey,ConfigJson) VALUES(88,22,N'TEXT',N'PRIMARY',N'{}'); " +
    "SET IDENTITY_INSERT uqp.DashboardWidget OFF; " +
   "INSERT uqp.AuditLog(EventType,EventCategory,Status,UserId,IsImportant) VALUES" +
   "(N'CHART_SEAL_WIDGET',N'CONFIG',N'SUCCESS',8,1)," +
   "(N'CHART_REQUEST_REVIEW',N'CONFIG',N'SUCCESS',8,1)," +
   "(N'CHART_APPROVE_REVIEW',N'CONFIG',N'SUCCESS',77,1)," +
   "(N'CHART_REVOKE_REVIEW',N'CONFIG',N'SUCCESS',77,1); " +
   "INSERT uqp.DatasetPublicDisplayPolicy(DatasetId) VALUES(10);");
  stage="BASE_SCHEMA_IDENTITY_AND_COLUMN_PARITY";
  await attestChartWriterBaseSqlCatalog(db);
  console.log("CHART_2B15C_BASE_SCHEMA_COLUMNS_FK_2019_2022_PASS");
  stage="ATOMIC_CREATE_ROLE_FIXTURE";
  await q("INSERT uqp.Role(Id,IsActive) VALUES(1,1);" +
    "INSERT uqp.Permission(Id,Code) VALUES(4,N'DESIGN_QUERY'),(5,N'EXECUTE_QUERY');" +
    "INSERT uqp.UserRole(UserId,RoleId) VALUES(8,1);" +
    "INSERT uqp.RolePermission(RoleId,PermissionId) VALUES(1,4),(1,5);" +
     "INSERT uqp.RoleQueryAccess(RoleId,QueryDefinitionId,CanView,CanExecute) VALUES(1,9,1,1);");

  // Use the previously accepted disposable 928 draft ONLY as a disposable
  // witness factory. Roll it back, then install BOTH actual reviewed SQL
  // sources in ONE transaction rather than mixing base draft and new Writer.
  stage="FROZEN_928_WITNESSES_FROM_ROLLBACK_ONLY";
  const probe=new sql.Transaction(db);
  await probe.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  let checks:Record<string,unknown>[]=[];
  let filterHash="",frozenHash="";
  try{
   await new sql.Request(probe).batch(base);
   // SQL Server stores CK_DashboardWidget_Type on WidgetType's ColumnId
   // (not as a table-level CHECK). Verify the precise scope in both 2019/2022.
   const typed=(await new sql.Request(probe).query(
    "SELECT c.parent_column_id AS ActualColumnId,"+
    "COLUMNPROPERTY(OBJECT_ID(N'uqp.DashboardWidget'),"+
    "N'WidgetType',N'ColumnId') AS WidgetTypeColumnId "+
    "FROM sys.check_constraints c WHERE c.name=N'CK_DashboardWidget_Type' "+
    "AND c.parent_object_id=OBJECT_ID(N'uqp.DashboardWidget')"
   )).recordset;
   assert.equal(typed.length,1);
   assert(Number(typed[0]?.ActualColumnId)>0);
   assert.equal(Number(typed[0]?.ActualColumnId),
    Number(typed[0]?.WidgetTypeColumnId));
   checks=(await new sql.Request(probe).query(
    "SELECT OBJECT_NAME(parent_object_id) AS TableName,name AS ConstraintName,"+
    "parent_column_id AS ParentColumnId,is_disabled AS Disabled,"+
    "is_not_trusted AS NotTrusted,is_system_named AS SystemNamed,"+
    "CONVERT(varchar(64),HASHBYTES('SHA2_256',CONVERT(varbinary(max),definition)),2) AS Hash "+
    "FROM sys.check_constraints WHERE name IN ("+
    "N'CK_DashboardWidget_Type',N'CK_ChartSeal_Digest',"+
    "N'CK_ChartTrustRequest_Action',N'CK_ChartReview_State',N'CK_ChartReview_Scope')"
   )).recordset;
   const witnesses=(await new sql.Request(probe).query(
    "SELECT CONVERT(varchar(64),HASHBYTES('SHA2_256',CONVERT(varbinary(max),"+
    "(SELECT filter_definition FROM sys.indexes WHERE object_id="+
    "OBJECT_ID(N'uqp.DashboardChartPrivacyReview') "+
    "AND name=N'UX_ChartReview_Active'))),2) AS FilterHash,"+
    "CONVERT(varchar(64),HASHBYTES('SHA2_256',CONVERT(varbinary(max),"+
    "(SELECT definition FROM sys.sql_modules WHERE object_id="+
    "OBJECT_ID(N'uqp.TR_DashboardWidget_ChartFreeze',N'TR')))),2) AS FrozenHash"
   )).recordset;
   assert.equal(witnesses.length,1);
   filterHash=String(witnesses[0]?.FilterHash);
   frozenHash=String(witnesses[0]?.FrozenHash);
  }finally{
   await probe.rollback();
  }
  assert.equal(checks.length,5);
  // One disposable-only structural inventory for all five witnesses.
  // No clinical rows, connection settings, passwords or source SQL logged.
  console.log("CHART_A_FIVE_CHECK_SCOPE_WITNESS:"+
   checks.map(c=>String(c.TableName)+"."+String(c.ConstraintName)+
    ":col="+String(c.ParentColumnId)+":disabled="+String(c.Disabled)+
    ":notTrusted="+String(c.NotTrusted)+":systemNamed="+String(c.SystemNamed))
    .sort().join("|"));
  assert.match(filterHash,/^[0-9a-f]{64}$/i);
  assert.match(frozenHash,/^[0-9a-f]{64}$/i);
  assert.equal((await q("SELECT OBJECT_ID(N'uqp.DashboardChartWidgetSeal',N'U') AS ObjectId")).recordset[0]?.ObjectId,null);
  stage="ORIGINAL_REVIEW_SOURCES_MUST_BLOCK";
  await assert.rejects(db.request().batch(source),(e:unknown)=>
   Number((e as {number?:number}).number)===51928);
  await assert.rejects(db.request().batch(reviewedBase),(e:unknown)=>
   Number((e as {number?:number}).number)===51928);
  await q("CREATE USER [UQP_Chart_A_WriterTest] FOR LOGIN ["+writerName+"]");
  // Pins are calculated ONLY from this short-lived synthetic CI DB.
  // Neither source file is changed, and no synthetic pin is published as
  // an authorized or reusable hospital production value.
  const sidRow=(await q("SELECT CONVERT(varchar(170),SUSER_SID(N'"+
    writerName+"'),2) AS Sid")).recordset[0];
  const sid=String(sidRow?.Sid);
  assert.match(sid,/^(?:[0-9a-f]{2}){1,85}$/i);
  let testBase=replaceOnce(reviewedBase,frozenReviewGuard,
   "IF LEFT(DB_NAME(),7)<>N'UQP_CH_' OR LEN(DB_NAME())<>19 "+
   "OR SUBSTRING(DB_NAME(),8,12) COLLATE Latin1_General_100_BIN2 "+
   "LIKE N'%[^0-9a-f]%' THROW 51928,'CHART_928_DISPOSABLE_ONLY',1;");
  const expectedChecks=[
   ["DashboardWidget","CK_DashboardWidget_Type"],
   ["DashboardChartWidgetSeal","CK_ChartSeal_Digest"],
   ["DashboardChartTrustRequest","CK_ChartTrustRequest_Action"],
   ["DashboardChartPrivacyReview","CK_ChartReview_State"],
   ["DashboardChartPrivacyReview","CK_ChartReview_Scope"],
  ];
  for(const [table,constraint] of expectedChecks){
   const hits=checks.filter(x=>x.TableName===table&&x.ConstraintName===constraint);
   assert.equal(hits.length,1,"CHART_A_CATALOG_WITNESS_NOT_UNIQUE");
   const hash=String(hits[0]?.Hash);
   assert.match(hash,/^[0-9a-f]{64}$/i);
   testBase=replaceOnce(testBase,
    "(N'"+table+"',N'"+constraint+"',NULL)",
    "(N'"+table+"',N'"+constraint+"',0x"+hash+")");
  }
  testBase=replaceOnce(testBase,filterWitness,
   "DECLARE @approvedActiveFilterSha256 varbinary(32)=0x"+filterHash+";");
  let testSql=replaceOnce(source,first,
   "IF LEFT(DB_NAME(),7)<>N'UQP_CH_' OR LEN(DB_NAME())<>19 "+
   "OR SUBSTRING(DB_NAME(),8,12) COLLATE Latin1_General_100_BIN2 "+
   "LIKE N'%[^0-9a-f]%' THROW 51928,'CHART_A_DISPOSABLE_ONLY',1;");
  testSql=replaceOnce(testSql,frozenPin,
   "DECLARE @approvedFrozenTriggerDefinitionSha256 VARBINARY(32)=0x"+frozenHash+";");
  testSql=replaceOnce(testSql,writerPin,
   "DECLARE @approvedWriterOriginalSid VARBINARY(85)=0x"+sid+";");
  stage="ATOMIC_REVIEWED_BASE_AND_WRITER_INSTALL";
  const tx=new sql.Transaction(db);
  await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  try{
   await new sql.Request(tx).batch(testBase);
   await new sql.Request(tx).batch(testSql);
   await tx.commit();
  }catch(e){await tx.rollback().catch(()=>undefined);throw e;}
  stage="WRITER_INSTALLED";
  const objs=(await q("SELECT OBJECT_ID(N'uqp.usp_DashboardChartCreate',N'P') AS P,"+
   "OBJECT_ID(N'uqp.DashboardChartCreatePermit',N'U') AS T")).recordset[0];
  assert(Number(objs?.P)>0);assert(Number(objs?.T)>0);
  stage="GRANT_TEST_ONLY_EXECUTE";
  await q("GRANT EXECUTE ON OBJECT::uqp.usp_DashboardChartCreate "+
    "TO [UQP_Chart_A_WriterTest]");
  writer=await new sql.ConnectionPool({...config,database:name,
    user:writerName,password:writerPassword,
    pool:{min:0,max:2}}).connect();
  const actual=(await writer.request().query(
    "SELECT CONVERT(varchar(170),SUSER_SID(ORIGINAL_LOGIN()),2) AS Sid,"+
    "IS_MEMBER(N'db_owner') AS Owner,"+
    "HAS_PERMS_BY_NAME(N'uqp.DashboardWidget',N'OBJECT',N'INSERT') AS DirectInsert,"+
    "HAS_PERMS_BY_NAME(N'uqp.usp_DashboardChartCreate',N'OBJECT',N'EXECUTE') AS CanExec"
  )).recordset[0];
  assert.equal(String(actual?.Sid).toLowerCase(),sid.toLowerCase());
  assert.equal(actual?.Owner,0);
  assert.equal(actual?.DirectInsert,0);
  assert.equal(actual?.CanExec,1);
  const configJson=canonicalChartConfig({version:1,chartType:"BAR",
   dataSourceKey:"PRIMARY",categoryColumn:"ROOM",valueColumn:"TOTAL",
   valueMode:"QUERY_RESULT",maxPoints:20,showLegend:true});
  assert(configJson);
  const exec=async(n:number,actor=8,token=1)=>writer!.request()
   .input("dashboard",sql.BigInt,7).input("profile",sql.BigInt,22)
   .input("actor",sql.BigInt,actor).input("token",sql.Int,token)
   .input("request",sql.UniqueIdentifier,requestId(n))
   .input("source",sql.NVarChar(64),"PRIMARY")
   .input("config",sql.NVarChar(sql.MAX),configJson.json)
   .input("x",sql.Int,80).input("y",sql.Int,80)
   .input("width",sql.Int,600).input("height",sql.Int,360)
   .query("EXEC uqp.usp_DashboardChartCreate "+
    "@DashboardId=@dashboard,@ProfileId=@profile,@ActorId=@actor,"+
    "@TokenVersion=@token,@RequestId=@request,"+
    "@SourceKey=@source,@ConfigJson=@config,@X=@x,@Y=@y,"+
    "@Width=@width,@Height=@height");
  const denied=(fn:()=>Promise<unknown>)=>assert.rejects(fn(),
   (e:unknown)=>[229,51928,2601,2627].includes(Number((e as {number?:number}).number)));
  const counts=async()=> (await q("SELECT "+
   "(SELECT COUNT_BIG(*) FROM uqp.DashboardWidget WHERE WidgetType=N'CHART') AS Widgets,"+
   "(SELECT COUNT_BIG(*) FROM uqp.DashboardChartWidgetSeal) AS Seals,"+
   "(SELECT COUNT_BIG(*) FROM uqp.DashboardChartTrustRequest) AS Requests,"+
   "(SELECT COUNT_BIG(*) FROM uqp.DashboardChartCreatePermit) AS Permits")).recordset[0];
  const expectCounts=async(w:number)=>assert.deepEqual(
   [Number((await counts()).Widgets),Number((await counts()).Seals),
    Number((await counts()).Requests),Number((await counts()).Permits)],
   [w,w,w,0]);
  stage="DEDICATED_WRITER_DIRECT_INSERT_DENIED";
  await denied(()=>writer!.request().query("INSERT uqp.DashboardWidget(ProfileId,WidgetType,SourceKey,"+
   "X,Y,Width,Height,ConfigJson) VALUES(22,N'CHART',N'PRIMARY',"+
   "0,0,600,360,N'{}')"));
  stage="DEDICATED_WRITER_DIRECT_PERMIT_SEAL_LEDGER_DML_DENIED";
  // Explicit SQL permission rejection for each security-sensitive table.
  // Widget denial alone cannot prove Permit/Seal/Audit ledger isolation.
  await denied(()=>writer!.request().query(
   "INSERT uqp.DashboardChartCreatePermit "+
   "(SessionId,TransactionId,ProfileId,SourceKey,ConfigJson) VALUES "+
   "(@@SPID,CURRENT_TRANSACTION_ID(),22,N'PRIMARY',N'{}')"));
  await denied(()=>writer!.request().query(
   "INSERT uqp.DashboardChartWidgetSeal "+
   "(WidgetId,ConfigDigest,IsActive,SealedBy,AuditLogId) VALUES "+
   "(88,REPLICATE('a',64),1,8,1)"));
  await denied(()=>writer!.request().query(
   "INSERT uqp.DashboardChartTrustRequest(RequestId,Action,ActorId) "+
   "VALUES(NEWID(),N'SEAL_WIDGET',8)"));
  await denied(()=>writer!.request().query(
   "UPDATE uqp.DashboardWidget SET Title=N'FORGED' WHERE Id=88"));
  stage="CREATE_ATOMIC_SUCCESS";
  const firstResult=(await exec(1)).recordset;assert.equal(firstResult.length,1);
  assert.deepEqual(Object.keys(firstResult[0]).sort(),
   ["AuditLogId","Digest","SealRevision","WidgetId"]);
  assert.equal(firstResult[0].Digest,configJson.sha256);
  assert.match(String(firstResult[0].AuditLogId),/^[1-9][0-9]*$/);
  assert.match(String(firstResult[0].SealRevision),/^[0-9a-f]{16}$/);
  await expectCounts(1);
  stage="REPLAY_DENIED";await denied(()=>exec(1));
  stage="TOKEN_VERSION_REVOKED";
  await q("UPDATE uqp.AppUser SET TokenVersion=2 WHERE Id=8");
  await denied(()=>exec(2));await expectCounts(1);
  await q("UPDATE uqp.AppUser SET TokenVersion=1 WHERE Id=8");
  stage="QUERY_EXECUTION_REVOKED";
  await q("UPDATE uqp.RoleQueryAccess SET CanExecute=0 WHERE RoleId=1");
  await denied(()=>exec(3));await expectCounts(1);
  await q("UPDATE uqp.RoleQueryAccess SET CanExecute=1 WHERE RoleId=1");
  stage="LATE_SEAL_FAILURE";
  await q("EXEC(N'CREATE TRIGGER uqp.TR_Chart_A_SyntheticFail "+
   "ON uqp.DashboardChartWidgetSeal AFTER INSERT AS "+
   "BEGIN THROW 51928,''CHART_A_SYNTHETIC_LATE_FAIL'',1; END')");
  try{await denied(()=>exec(4));}
  finally{await q("DROP TRIGGER uqp.TR_Chart_A_SyntheticFail");}
  await expectCounts(1);
  stage="RETRY_AFTER_ROLLBACK";
  assert.equal((await exec(4)).recordset.length,1);await expectCounts(2);
  // Actual HTTP JWT -> canonical plan -> dedicated SQL Writer -> audited SQL
  // receipt, using ONLY the existing disposable D1 database and login.
  // The normal UQP production create release constant remains false.
  stage="HTTP_LOCAL_JWT_REAL_WRITER_CREATE";
  const previousJwtSecret=env.JWT_SECRET;
  env.JWT_SECRET="chart-option-a-disposable-"+randomBytes(24).toString("hex");
  const app=express();
  const httpServer=createServer(app);
  try{
   app.use(express.json({limit:"4kb"}));
   const readSession=async()=>({
    isActive:true,tokenVersion:1,
    permissions:["DESIGN_QUERY","EXECUTE_QUERY"],
   });
   app.use(createAuthenticateJwt(readSession));
   app.use(createChartCreateRouter({
    approved:()=>true, // isolated dependency injection, not release flag
    create:async plan=>(await writer!.request()
     .input("dashboard",sql.BigInt,plan.dashboardId)
     .input("profile",sql.BigInt,plan.profileId)
     .input("actor",sql.BigInt,plan.actorId)
     .input("token",sql.Int,plan.tokenVersion)
     .input("requestId",sql.UniqueIdentifier,plan.requestId)
     .input("source",sql.NVarChar(64),plan.sourceKey)
     .input("config",sql.NVarChar(sql.MAX),plan.config.json)
     .input("x",sql.Int,plan.placement.x)
     .input("y",sql.Int,plan.placement.y)
     .input("width",sql.Int,plan.placement.width)
     .input("height",sql.Int,plan.placement.height)
     .query(chartLocalJwtWriterCreateSql)).recordset[0],
   }));
   // Same author-only readback route and audited SQL repository used by
   // Dashboard runtime; dependency injection is confined to disposable CI.
   app.use(createChartSavedReadbackRouter({
    approved:()=>true,
    readSavedWidget:createDormantChartTrustReaders(async()=>db!).readSavedWidget,
    readSession,
   }));
   await new Promise<void>(resolve=>httpServer.listen(0,"127.0.0.1",resolve));
   const addr=httpServer.address();
   assert(addr&&typeof addr!=="string");
   const bearer=jwt.sign({sub:"8",tokenVersion:1},env.JWT_SECRET!,{expiresIn:"5m"});
   const endpoint="http://127.0.0.1:"+addr.port+"/7/charts/v1";
   const body={profileId:22,requestId:requestId(5),
    config:configJson.data,placement:{x:80,y:80,width:600,height:360}};
   const send=(value:unknown)=>fetch(endpoint,{method:"POST",headers:{
    Authorization:"Bearer "+bearer,"Content-Type":"application/json",
   },body:JSON.stringify(value)});
   const deniedActor=await send({...body,actorId:77});
   assert.equal(deniedActor.status,400);
   const response=await send(body);
   assert.equal(response.status,201);
   const saved=await response.json() as Record<string,unknown>;
   assert.deepEqual(Object.keys(saved).sort(),
    ["auditLogId","sealRevision","widgetId"]);
   assert.match(String(saved.sealRevision),/^[0-9a-f]{16}$/);
   await expectCounts(3);
   // Read persisted bytes through a fresh SQL query, not the POST response.
   // This is the SQL persistence boundary; designer seal/readback HTTP and
   // public playback remain independent future integration checks.
   stage="HTTP_CREATED_CHART_SQL_PERSISTENCE_READBACK";
   const persisted=(await db!.request().input("widgetId",sql.BigInt,saved.widgetId)
    .query("SELECT w.Id AS WidgetId,w.ProfileId,w.WidgetType,w.SourceKey,"+
     "w.ConfigJson,w.X,w.Y,w.Width,w.Height,s.ConfigDigest,"+
     "s.IsActive,s.SealedBy,s.AuditLogId,"+
     "s.SealRowVersion,"+
     "a.EventType,a.Status FROM uqp.DashboardWidget w "+
     "JOIN uqp.DashboardChartWidgetSeal s ON s.WidgetId=w.Id "+
     "JOIN uqp.AuditLog a ON a.Id=s.AuditLogId "+
     "WHERE w.Id=@widgetId")).recordset;
   stage="HTTP_PERSISTENCE_JOIN_ROW_COUNT";
   assert.equal(persisted.length,1);
   const row=persisted[0]!;
   stage="HTTP_PERSISTENCE_WIDGET_IDENTITY";
   assert.equal(String(row.ProfileId),"22");
   assert.equal(row.WidgetType,"CHART");
   assert.equal(row.SourceKey,"PRIMARY");
   stage="HTTP_PERSISTENCE_CANONICAL_CONFIG";
   assert.equal(row.ConfigJson,configJson.json);
   assert.deepEqual([row.X,row.Y,row.Width,row.Height],[80,80,600,360]);
   stage="HTTP_PERSISTENCE_SEAL_DIGEST";
   assert.equal(row.ConfigDigest,configJson.sha256);
   stage="HTTP_PERSISTENCE_SEAL_ACTIVE";
   assert.equal(row.IsActive,true);
   assert.equal(String(row.SealedBy),"8");
   stage="HTTP_PERSISTENCE_RECEIPT_IDS";
   assert.equal(String(row.WidgetId),String(saved.widgetId));
   assert.equal(String(row.AuditLogId),saved.auditLogId);
   stage="HTTP_PERSISTENCE_RECEIPT_SEAL_REVISION";
   // Read rowversion as the raw SQL binary(8), exactly as the application's
   // trusted saved-widget repository does. TDS returns an 8-byte Buffer;
   // VARCHAR conversion can return raw bytes rather than 16 hex characters.
   assert(Buffer.isBuffer(row.SealRowVersion));
   assert.equal(row.SealRowVersion.length,8);
   assert.equal(row.SealRowVersion.toString("hex"),saved.sealRevision);

   stage="HTTP_PERSISTENCE_AUDIT_STATUS";
   assert.equal(row.Status,"SUCCESS");
   // Round-trip over the real author-only HTTP readback endpoint, backed by
   // the real seal, audit and config DB join (not a mocked readback receipt).
   stage="HTTP_SAVED_CHART_TRUSTED_READBACK";
   const readbackEndpoint=endpoint+"/"+String(saved.widgetId)+"/readback";
   const readback=await fetch(readbackEndpoint,{
    headers:{Authorization:"Bearer "+bearer},
   });
   assert.equal(readback.status,200);
   assert.deepEqual(await readback.json(),{
    widgetId:saved.widgetId,sealRevision:saved.sealRevision,
    config:configJson.data,
   });
   const anotherAuthor=jwt.sign({sub:"77",tokenVersion:1},env.JWT_SECRET!,
    {expiresIn:"5m"});
   const crossAuthor=await fetch(readbackEndpoint,{
    headers:{Authorization:"Bearer "+anotherAuthor},
   });
   assert.equal(crossAuthor.status,503);
   assert.deepEqual(await crossAuthor.json(),{
    error:{code:"CHART_SAVED_READBACK_REQUIRED"},
   });
   const replay=await send(body);
   assert.equal(replay.status,503);
   await expectCounts(3);
   console.log("CHART_A_DISPOSABLE_HTTP_JWT_SQL_CREATE_PASS");
  }finally{
   await new Promise<void>(resolve=>httpServer.close(()=>resolve()));
   env.JWT_SECRET=previousJwtSecret;
  }
  console.log("CHART_928_OPTION_A_REAL_SQL_2019_2022_WRITER_PASS");
 }catch(error){
  const e=error as {number?:unknown;lineNumber?:unknown;code?:unknown};
  console.error("CHART_A_SQL_FAIL_STAGE:"+stage);
  console.error("CHART_A_SQL_ERROR_META:"+String(e?.number??"NA")+":"+
   String(e?.lineNumber??"NA")+":"+String(e?.code??"NA"));
  throw Error("CHART_A_REAL_SQL_DISPOSABLE_ACCEPTANCE_FAILED");
 }finally{
  await writer?.close().catch(()=>undefined);
  await db?.close().catch(()=>undefined);
  try{
    if(created)await admin.request().query("ALTER DATABASE ["+name+
      "] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE ["+name+"]");
  }finally{
    if(loginCreated)await admin.request().query("DROP LOGIN ["+writerName+"]");
  }
 }
}
