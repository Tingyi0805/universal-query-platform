// Option A: REAL SQL Server 2019/2022 CHART Writer acceptance on a
// second, disposable UQP_CH_ DB inside the existing D1 CI container.
// The production review SQL remains non-executable and unmodified ON DISK.
// For isolated acceptance ONLY, hard guard and NULL evidence pins are
// substituted IN MEMORY after exact machine and target checks.
import assert from "node:assert/strict";
import {randomBytes} from "node:crypto";
import {readFile} from "node:fs/promises";
import sql from "mssql";
import {attestChartWriterBaseSqlCatalog} from "./chart928WriterBaseSchema.js";
import {canonicalChartConfig} from "../modules/dashboard/dashboardChartAtomicCreate.contract.js";
const candidate=new URL("../../../database/review/928_chart_local_jwt_writer.production-review.sql.txt",import.meta.url);
const frozen=new URL("../../../database/drafts/928_dashboard_chart_trust_schema.sql.draft",import.meta.url);
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
 const first="THROW 51928,'CHART_A_WRITER_PRODUCTION_REVIEW_NOT_APPROVED',1;";
 const frozenPin="DECLARE @approvedFrozenTriggerDefinitionSha256 VARBINARY(32)=NULL;";
 const writerPin="DECLARE @approvedWriterOriginalSid VARBINARY(85)=NULL;";
 for(const s of [first,frozenPin,writerPin])assert.equal(source.split(s).length,2);
 await assert.rejects(admin.request().batch(source),(e:unknown)=>
  Number((e as {number?:number}).number)===51928);
 let db:sql.ConnectionPool|undefined,created=false,stage="CREATE_DATABASE";
 const name="UQP_CH_"+randomBytes(6).toString("hex");
 try{
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

  stage="FROZEN_928_BASE";await db.request().batch(base);
  stage="UNMODIFIED_REVIEW_SQL_ALWAYS_DENIED";
  await assert.rejects(db.request().batch(source),(e:unknown)=>
   Number((e as {number?:number}).number)===51928);
  stage="READ_LOCAL_DISPOSABLE_HASH_AND_SID";
  const anchors=(await q("SELECT CONVERT(varchar(64),HASHBYTES('SHA2_256',"+
    "CONVERT(varbinary(max),m.definition)),2) AS FrozenHash,"+
    "CONVERT(varchar(170),SUSER_SID(ORIGINAL_LOGIN()),2) AS OriginalSid "+
    "FROM sys.sql_modules m WHERE m.object_id="+
    "OBJECT_ID(N'uqp.TR_DashboardWidget_ChartFreeze',N'TR')")).recordset;
  assert.equal(anchors.length,1);
  const hash=String(anchors[0]?.FrozenHash),sid=String(anchors[0]?.OriginalSid);
  assert.match(hash,/^[0-9a-f]{64}$/i);
  assert.match(sid,/^(?:[0-9a-f]{2}){1,85}$/i);
  let testSql=replaceOnce(source,first,
   "IF LEFT(DB_NAME(),7)<>N'UQP_CH_' OR LEN(DB_NAME())<>19 "+
   "OR SUBSTRING(DB_NAME(),8,12) COLLATE Latin1_General_100_BIN2 "+
   "LIKE N'%[^0-9a-f]%' THROW 51928,'CHART_A_DISPOSABLE_ONLY',1;");
  testSql=replaceOnce(testSql,frozenPin,
   "DECLARE @approvedFrozenTriggerDefinitionSha256 VARBINARY(32)=0x"+hash+";");
  testSql=replaceOnce(testSql,writerPin,
   "DECLARE @approvedWriterOriginalSid VARBINARY(85)=0x"+sid+";");
  stage="DISPOSABLE_WRITER_INSTALL";
  const tx=new sql.Transaction(db);
  await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  try{await new sql.Request(tx).batch(testSql);await tx.commit();}
  catch(e){await tx.rollback().catch(()=>undefined);throw e;}
  stage="WRITER_INSTALLED";
  const objs=(await q("SELECT OBJECT_ID(N'uqp.usp_DashboardChartCreate',N'P') AS P,"+
   "OBJECT_ID(N'uqp.DashboardChartCreatePermit',N'U') AS T")).recordset[0];
  assert(Number(objs?.P)>0);assert(Number(objs?.T)>0);
  const configJson=canonicalChartConfig({version:1,chartType:"BAR",
   dataSourceKey:"PRIMARY",categoryColumn:"ROOM",valueColumn:"TOTAL",
   valueMode:"QUERY_RESULT",maxPoints:20,showLegend:true});
  assert(configJson);
  const exec=async(n:number,actor=8,token=1)=>db!.request()
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
   (e:unknown)=>[51928,2601,2627].includes(Number((e as {number?:number}).number)));
  const counts=async()=> (await q("SELECT "+
   "(SELECT COUNT_BIG(*) FROM uqp.DashboardWidget WHERE WidgetType=N'CHART') AS Widgets,"+
   "(SELECT COUNT_BIG(*) FROM uqp.DashboardChartWidgetSeal) AS Seals,"+
   "(SELECT COUNT_BIG(*) FROM uqp.DashboardChartTrustRequest) AS Requests,"+
   "(SELECT COUNT_BIG(*) FROM uqp.DashboardChartCreatePermit) AS Permits")).recordset[0];
  const expectCounts=async(w:number)=>assert.deepEqual(
   [Number((await counts()).Widgets),Number((await counts()).Seals),
    Number((await counts()).Requests),Number((await counts()).Permits)],
   [w,w,w,0]);
  stage="DIRECT_INSERT_DENIED";
  await denied(()=>q("INSERT uqp.DashboardWidget(ProfileId,WidgetType,SourceKey,"+
   "X,Y,Width,Height,ConfigJson) VALUES(22,N'CHART',N'PRIMARY',"+
   "0,0,600,360,N'{}')"));
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
  console.log("CHART_928_OPTION_A_REAL_SQL_2019_2022_WRITER_PASS");
 }catch(error){
  const e=error as {number?:unknown;lineNumber?:unknown;code?:unknown};
  console.error("CHART_A_SQL_FAIL_STAGE:"+stage);
  console.error("CHART_A_SQL_ERROR_META:"+String(e?.number??"NA")+":"+
   String(e?.lineNumber??"NA")+":"+String(e?.code??"NA"));
  throw Error("CHART_A_REAL_SQL_DISPOSABLE_ACCEPTANCE_FAILED");
 }finally{
  await db?.close().catch(()=>undefined);
  if(created)await admin.request().query("ALTER DATABASE ["+name+
    "] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE ["+name+"]");
 }
}
