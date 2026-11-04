// 2B-12 non-scanned Schema 928 proof: disposable SQL Server 2019/2022 ONLY.
// Never reads platform configuration, ledger, patient data or the real UQP DB.
// The standalone draft intentionally keeps CHART unavailable until 2B-13.
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {randomBytes} from "node:crypto";
import sql from "mssql";

const sqlPath=new URL("../../../database/drafts/928_dashboard_chart_trust_schema.sql",import.meta.url);
export async function verifyChart928DraftSql(
 admin:sql.ConnectionPool,config:sql.config,machine:string,
):Promise<void>{
 if(process.env.UQP_D1_SCOPE!=="DISPOSABLE_ONLY" ||
    !/^uqp-d1-[a-f0-9]{12}$/.test(process.env.UQP_D1_CONTAINER_NAME??"") ||
    process.env.UQP_D1_CONTAINER_NAME!==machine ||
    Object.keys(process.env).some(k=>k.startsWith("PLATFORM_DB_")||k==="DOTENV_CONFIG_PATH"))
  throw Error("CHART_928_DISPOSABLE_ONLY");
 const master=(await admin.request().query(
   "SELECT DB_NAME() AS Db,CONVERT(nvarchar(128),SERVERPROPERTY('MachineName')) AS Machine"
 )).recordset[0];
 if(master?.Db!=="master"||String(master.Machine)!==machine)
  throw Error("CHART_928_TARGET_IDENTITY_MISMATCH");
 const name="UQP_CH_"+randomBytes(6).toString("hex");
 const script=await readFile(sqlPath,"utf8");
 let db:sql.ConnectionPool|undefined,created=false,stage="CREATE_DB";
 const check=async()=>{const x=(await db!.request().query(
  "SELECT (SELECT COUNT_BIG(*) FROM uqp.DashboardWidget WHERE WidgetType=N'CHART') AS Charts, " +
  "(SELECT COUNT_BIG(*) FROM uqp.DashboardWidget WHERE WidgetType=N'TEXT') AS Texts"
 )).recordset[0];assert.equal(Number(x?.Charts),0);assert(Number(x?.Texts)>=1);};
 const rejects=async(statement:string)=>{
  await assert.rejects(db!.request().query(statement),
   (err:unknown)=>err instanceof Error);
 };
 try{
  await admin.request().query("CREATE DATABASE ["+name+"]");
  created=true;
  db=await new sql.ConnectionPool({...config,database:name,pool:{max:2,min:0}}).connect();
  const q=(statement:string)=>db!.request().query(statement);
  stage="CREATE_SCHEMA";
  await q("CREATE SCHEMA uqp");
  stage="CREATE_FIXTURE_TABLES";
  await q("CREATE TABLE uqp.AppUser(Id BIGINT NOT NULL PRIMARY KEY); " +
   "CREATE TABLE uqp.QueryDefinition(Id BIGINT NOT NULL PRIMARY KEY); " +
   "CREATE TABLE uqp.Dataset(Id BIGINT NOT NULL PRIMARY KEY); " +
   "CREATE TABLE uqp.Dashboard(Id BIGINT NOT NULL PRIMARY KEY); " +
   "CREATE TABLE uqp.DashboardDisplayProfile(Id BIGINT NOT NULL PRIMARY KEY," +
   " DashboardId BIGINT NOT NULL REFERENCES uqp.Dashboard(Id) ON DELETE CASCADE); " +
   "CREATE TABLE uqp.DashboardWidget(Id BIGINT NOT NULL PRIMARY KEY," +
   " ProfileId BIGINT NOT NULL REFERENCES uqp.DashboardDisplayProfile(Id) ON DELETE CASCADE," +
   " WidgetType NVARCHAR(30) NOT NULL,SourceKey NVARCHAR(256) NULL," +
   " ConfigJson NVARCHAR(MAX) NOT NULL DEFAULT N'{}'," +
   " CONSTRAINT CK_DashboardWidget_Type CHECK(WidgetType IN" +
   " (N'TEXT',N'PARAMETER',N'FIELD',N'CLOCK',N'PAGE_INFO',N'COUNTDOWN',N'TABLE',N'CONTAINER'))," +
   " CONSTRAINT CK_DashboardWidget_ConfigJson CHECK(ISJSON(ConfigJson)=1)); " +
   "CREATE TABLE uqp.AuditLog(Id BIGINT NOT NULL PRIMARY KEY," +
   " EventCategory NVARCHAR(20) NOT NULL,IsImportant BIT NOT NULL); " +
   "CREATE TABLE uqp.DatasetPublicDisplayPolicy(DatasetId BIGINT NOT NULL PRIMARY KEY); ");
  stage="SEED_FIXTURE";
  await q("INSERT uqp.AppUser(Id) VALUES(8),(77); " +
   "INSERT uqp.QueryDefinition(Id) VALUES(9); INSERT uqp.Dataset(Id) VALUES(10); " +
   "INSERT uqp.Dashboard(Id) VALUES(7); INSERT uqp.DashboardDisplayProfile(Id,DashboardId) VALUES(22,7);" +
   "INSERT uqp.DashboardWidget(Id,ProfileId,WidgetType,SourceKey,ConfigJson) VALUES(88,22,N'TEXT',N'PRIMARY',N'{}'); " +
   "INSERT uqp.AuditLog(Id,EventCategory,IsImportant) VALUES(1,N'CONFIG',1); " +
   "INSERT uqp.DatasetPublicDisplayPolicy(DatasetId) VALUES(10);");
  stage="OUTER_ROLLBACK";
  const outer=new sql.Transaction(db);
  await outer.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  try{
   await new sql.Request(outer).batch(script);
  }finally{
   await outer.rollback().catch(()=>undefined);
  }
  assert.equal((await q("SELECT OBJECT_ID(N'uqp.DashboardChartWidgetSeal',N'U') AS Seal")).recordset[0]?.Seal,null);
  assert.equal(Number((await q("SELECT COUNT_BIG(*) AS Total FROM sys.check_constraints " +
    "WHERE parent_object_id=OBJECT_ID(N'uqp.DashboardWidget') AND definition LIKE N'%CHART%'")).recordset[0]?.Total),0);
  stage="FIRST_INSTALL";
  await db.request().batch(script);
  await check();
  stage="IDEMPOTENT_RERUN";
  await db.request().batch(script);
  await check();
  stage="LEGACY_WRITE";
  await q("INSERT uqp.DashboardWidget(Id,ProfileId,WidgetType,SourceKey,ConfigJson) " +
    "VALUES(89,22,N'TEXT',N'PRIMARY',N'{}'); " +
    "UPDATE uqp.DashboardWidget SET ConfigJson=N'{\"safe\":1}' WHERE Id=89; " +
    "DELETE FROM uqp.DashboardWidget WHERE Id=89;");
  stage="CHART_INSERT_FREEZE";
  await rejects("INSERT uqp.DashboardWidget(Id,ProfileId,WidgetType,SourceKey,ConfigJson) " +
    "VALUES(90,22,N'CHART',N'PRIMARY',N'{}')");
  await check();
  stage="SEALED_LEGACY_FREEZE";
  await q("INSERT uqp.DashboardChartWidgetSeal(WidgetId,ConfigDigest,IsActive,SealedBy,AuditLogId)" +
    " VALUES(88,REPLICATE('a',64),0,8,1)");
  await rejects("UPDATE uqp.DashboardWidget SET ConfigJson=N'{\"tamper\":true}' WHERE Id=88");
  await rejects("DELETE FROM uqp.DashboardWidget WHERE Id=88");
  await rejects("DELETE FROM uqp.DashboardChartWidgetSeal WHERE WidgetId=88");
  await rejects("DELETE FROM uqp.DashboardDisplayProfile WHERE Id=22");
  await rejects("INSERT uqp.DashboardChartWidgetSeal(WidgetId,ConfigDigest,IsActive,SealedBy,AuditLogId)" +
    " VALUES(9999,REPLICATE('a',64),0,8,1)");
  stage="REVIEW_STATE";
  const request="INSERT uqp.DashboardChartPrivacyReview("+
   "DashboardId,QueryId,DatasetId,SourceKey,CategoryColumn,ValueColumn," +
   "QueryRevision,DatasetRevision,PolicyRevision,Status,RequestedByUserId,AuditLogId) " +
   "VALUES(7,9,10,N'PRIMARY',N'ROOM',N'TOTAL',0x0102030405060708," +
   "0x0807060504030201,REPLICATE('b',64),'REQUESTED',8,1)";
  await q(request);
  await rejects(request); // filtered index protects active scope
  await rejects("UPDATE uqp.DashboardChartPrivacyReview SET Status='APPROVED'," +
    "MinimumCellCount=5,CategoryPrivacyReviewed=1,DifferencingRiskReviewed=1," +
    "ReviewerUserId=8,ReviewedAtUtc=SYSUTCDATETIME()," +
    "ValidUntilUtc=DATEADD(day,30,SYSUTCDATETIME()) WHERE Id=1");
  await rejects("UPDATE uqp.DashboardChartPrivacyReview SET Status='APPROVED'," +
    "MinimumCellCount=5,CategoryPrivacyReviewed=1,DifferencingRiskReviewed=1," +
    "ReviewerUserId=77,ReviewedAtUtc=SYSUTCDATETIME()," +
    "ValidUntilUtc=DATEADD(day,91,SYSUTCDATETIME()) WHERE Id=1");
  await q("DECLARE @instant DATETIME2(3)=SYSUTCDATETIME(); " +
    "UPDATE uqp.DashboardChartPrivacyReview SET Status='APPROVED'," +
    "MinimumCellCount=5,CategoryPrivacyReviewed=1,DifferencingRiskReviewed=1," +
    "ReviewerUserId=77,ReviewedAtUtc=@instant," +
    "ValidUntilUtc=DATEADD(day,90,@instant) WHERE Id=1");
  await rejects("UPDATE uqp.DashboardChartPrivacyReview SET Status='REQUESTED' WHERE Id=1");
  await rejects("UPDATE uqp.DashboardChartPrivacyReview SET " +
    "Status='REVOKED',QueryId=99,ValidUntilUtc=SYSUTCDATETIME() WHERE Id=1");
  await q("UPDATE uqp.DashboardChartPrivacyReview SET " +
    "Status='REVOKED',ValidUntilUtc=SYSUTCDATETIME() WHERE Id=1");
  await rejects("UPDATE uqp.DashboardChartPrivacyReview SET Status='APPROVED' WHERE Id=1");
  await rejects("DELETE FROM uqp.DashboardChartPrivacyReview WHERE Id=1");
  stage="REQUEST_LEDGER";
  const reqid="'00000000-0000-4000-8000-000000000111'";
  await q("INSERT uqp.DashboardChartTrustRequest(RequestId,Action,ActorId) " +
    "VALUES("+reqid+",N'SEAL_WIDGET',8)");
  await q("UPDATE uqp.DashboardChartTrustRequest SET AuditLogId=1 WHERE RequestId="+reqid);
  await rejects("UPDATE uqp.DashboardChartTrustRequest SET AuditLogId=1 WHERE RequestId="+reqid);
  await rejects("DELETE FROM uqp.DashboardChartTrustRequest WHERE RequestId="+reqid);
  await rejects("INSERT uqp.DashboardChartTrustRequest(RequestId,Action,ActorId,AuditLogId) " +
    "VALUES("+reqid+",N'SEAL_WIDGET',8,1)");
  stage="DRIFT_REJECT";
  await q("DISABLE TRIGGER uqp.TR_DashboardWidget_ChartFreeze ON uqp.DashboardWidget");
  await assert.rejects(db.request().batch(script), (err:unknown)=>err instanceof Error);
  await q("ENABLE TRIGGER uqp.TR_DashboardWidget_ChartFreeze ON uqp.DashboardWidget");
  stage="FINAL";
  await check();
  assert.equal(Number((await q("SELECT COUNT_BIG(*) AS Total FROM uqp.DashboardChartWidgetSeal")).recordset[0]?.Total),1);
  assert.equal(String((await q("SELECT Status FROM uqp.DashboardChartPrivacyReview WHERE Id=1")).recordset[0]?.Status),"REVOKED");
  console.log("CHART_928_DRAFT_SQL_2019_2022_INSTALL_RERUN_ROLLBACK_FREEZE_AUDIT_FK_PASS");
 }catch{
  console.error("CHART_928_DRAFT_FAIL_STAGE:"+stage);
  throw Error("CHART_928_DRAFT_SQL_ACCEPTANCE_FAILED");
 }finally{
  await db?.close().catch(()=>undefined);
  if(created)await admin.request().query(
    "ALTER DATABASE ["+name+"] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE ["+name+"]");
 }
}
