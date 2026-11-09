// 2B-12 non-scanned Schema 928 proof: disposable SQL Server 2019/2022 ONLY.
// Never reads platform configuration, ledger, patient data or the real UQP DB.
// The standalone draft intentionally keeps CHART unavailable until 2B-13.
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {randomBytes,createHash} from "node:crypto";
import sql from "mssql";
import {
  attestChart928TriggerCatalog,Chart928CatalogError,
} from "./chart928TriggerAttestation.js";
import {
  chartWriterIdentitySql,CHART_WRITER_DB_ACTOR_BINDING_APPROVED,
  CHART_WRITER_APPROVED_PROCEDURE_SHA256,
} from "../modules/dashboard/dashboardChartWriterBoundary.js";
import {CHART_ATOMIC_CREATE_RUNTIME_ENABLED} from "../modules/dashboard/dashboardChartAtomicCreate.contract.js";
import {attestChartWriterBaseSqlCatalog} from "./chart928WriterBaseSchema.js";

const sqlPath=new URL("../../../database/drafts/928_dashboard_chart_trust_schema.sql.draft",import.meta.url);
const readinessPath=new URL("../../../database/acceptance/chart-928-adoption-preflight-readonly.sql",import.meta.url);
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
 const readinessScript=await readFile(readinessPath,"utf8");
 // This tool must remain a SELECT-only catalog report, not a migration.
 assert(!/^\s*(?:CREATE|ALTER|DROP|MERGE|INSERT|UPDATE|DELETE|TRUNCATE|EXEC(?:UTE)?|GRANT|REVOKE|DENY)\b/im.test(readinessScript));
 assert(!/\bFROM\s+uqp\./i.test(readinessScript));
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
  await q("CREATE TABLE uqp.AppUser(Id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY, " +
   "IsActive BIT NOT NULL DEFAULT(1),TokenVersion INT NOT NULL DEFAULT(1)); " +
   "CREATE TABLE uqp.Role(Id BIGINT NOT NULL PRIMARY KEY,IsActive BIT NOT NULL); " +
   "CREATE TABLE uqp.Permission(Id BIGINT NOT NULL PRIMARY KEY,Code NVARCHAR(100) NOT NULL); " +
   "CREATE TABLE uqp.UserRole(UserId BIGINT NOT NULL,RoleId BIGINT NOT NULL); " +
   "CREATE TABLE uqp.RolePermission(RoleId BIGINT NOT NULL,PermissionId BIGINT NOT NULL); " +
   "CREATE TABLE uqp.QueryDefinition(Id BIGINT NOT NULL PRIMARY KEY); " +
   "CREATE TABLE uqp.Dataset(Id BIGINT NOT NULL PRIMARY KEY); " +
   "CREATE TABLE uqp.Dashboard(Id BIGINT NOT NULL PRIMARY KEY); " +
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
   "INSERT uqp.QueryDefinition(Id) VALUES(9); INSERT uqp.Dataset(Id) VALUES(10); " +
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
    "INSERT uqp.Permission(Id,Code) VALUES(4,N'DESIGN_QUERY');" +
    "INSERT uqp.UserRole(UserId,RoleId) VALUES(8,1);" +
    "INSERT uqp.RolePermission(RoleId,PermissionId) VALUES(1,4);");
  stage="IDENTITY_SCHEMA_PARITY";
  const identity=(await q(
    "SELECT COLUMNPROPERTY(OBJECT_ID(N'uqp.DashboardWidget'),N'Id','IsIdentity') AS WidgetIdentity, " +
    "COLUMNPROPERTY(OBJECT_ID(N'uqp.AuditLog'),N'Id','IsIdentity') AS AuditIdentity"
  )).recordset[0];
  assert.equal(Number(identity?.WidgetIdentity),1);
  assert.equal(Number(identity?.AuditIdentity),1);
  stage="READONLY_928_ADOPTION_PREFLIGHT_ABSENT";
  const beforeCatalog=(await q("SELECT COUNT_BIG(*) AS Total "+
    "FROM sys.objects WHERE schema_id=SCHEMA_ID(N'uqp')")).recordset[0];
  const absentPreflight=await db!.request().batch(readinessScript);
  const absentSets=absentPreflight.recordsets;
  assert(Array.isArray(absentSets) && absentSets.length===9);
  assert.equal(absentSets[0]?.[0]?.MayInstall928,false);
  assert.equal(absentSets[0]?.[0]?.Assessment,"BLOCKED_INDEPENDENT_APPROVAL_REQUIRED");
  assert.equal(absentSets[2]?.[0]?.Assessment,"BLOCKED_925_TABLES_MISSING");
  assert.equal(absentSets[4]?.[0]?.Assessment,"ABSENT_NOT_AUTHORIZED");
  assert.equal(Number(absentSets[4]?.[0]?.Present),0);
  assert.equal(Number((await q("SELECT COUNT_BIG(*) AS Total "+
    "FROM sys.objects WHERE schema_id=SCHEMA_ID(N'uqp')")).recordset[0]?.Total),
    Number(beforeCatalog?.Total));
  console.log("CHART_928_READONLY_PREFLIGHT_ABSENT_BLOCKED_PASS");
  stage="READONLY_928_ADOPTION_PREFLIGHT_PARTIAL";
  // Only the DISPOSABLE CI database is modified by the test fixture.
  // The preflight itself is still SELECT-only.
  await q("CREATE TABLE uqp.DashboardChartTrustRequest(PreflightOnly int NOT NULL)");
  try{
    const partialPreflight=await db!.request().batch(readinessScript);
    const partialSets=partialPreflight.recordsets;
    assert(Array.isArray(partialSets) && partialSets.length===9);
    assert.equal(partialSets[0]?.[0]?.MayInstall928,false);
    assert.equal(partialSets[4]?.[0]?.Assessment,
      "BLOCKED_PARTIAL_OR_CONFLICT");
    assert.equal(Number(partialSets[4]?.[0]?.Present),1);
    const count=(await q("SELECT COUNT_BIG(*) AS Total FROM sys.columns "+
      "WHERE object_id=OBJECT_ID(N'uqp.DashboardChartTrustRequest')"))
      .recordset[0]?.Total;
    assert.equal(Number(count),1);
    console.log("CHART_928_READONLY_PREFLIGHT_PARTIAL_BLOCKED_PASS");
  }finally{
    await q("DROP TABLE uqp.DashboardChartTrustRequest");
  }

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
  stage="READONLY_928_ADOPTION_PREFLIGHT_PRESENT";
  const installedCatalog=(await q("SELECT COUNT_BIG(*) AS Total "+
    "FROM sys.objects WHERE schema_id=SCHEMA_ID(N'uqp')")).recordset[0];
  const installedPreflight=await db!.request().batch(readinessScript);
  const installedSets=installedPreflight.recordsets;
  assert(Array.isArray(installedSets) && installedSets.length===9);
  assert.equal(installedSets[0]?.[0]?.MayInstall928,false);
  assert.equal(installedSets[0]?.[0]?.Assessment,"BLOCKED_INDEPENDENT_APPROVAL_REQUIRED");
  assert.equal(installedSets[4]?.[0]?.Assessment,
    "PRESENT_REQUIRES_EXACT_ATTESTATION");
  assert.equal(Number(installedSets[4]?.[0]?.Present),3);
  assert.equal(installedSets[2]?.[0]?.Exact925IndependentlyAttested,false);
  assert.equal(Number((await q("SELECT COUNT_BIG(*) AS Total "+
    "FROM sys.objects WHERE schema_id=SCHEMA_ID(N'uqp')")).recordset[0]?.Total),
    Number(installedCatalog?.Total));
  console.log("CHART_928_READONLY_PREFLIGHT_PRESENT_UNATTESTED_BLOCKED_PASS");
  stage="IDEMPOTENT_RERUN";
  await db.request().batch(script);
  await check();
  stage="EXACT_928_TRIGGER_ATTEST";
  await attestChart928TriggerCatalog(db,script);
  stage="LEGACY_WRITE";
  await q("SET IDENTITY_INSERT uqp.DashboardWidget ON; " +
    "INSERT uqp.DashboardWidget(Id,ProfileId,WidgetType,SourceKey,ConfigJson) " +
    "VALUES(89,22,N'TEXT',N'PRIMARY',N'{}'); " +
    "SET IDENTITY_INSERT uqp.DashboardWidget OFF; " +
    "UPDATE uqp.DashboardWidget SET ConfigJson=N'{\"safe\":1}' WHERE Id=89; " +
    "DELETE FROM uqp.DashboardWidget WHERE Id=89;");
  stage="CHART_INSERT_FREEZE";
  // Use true IDENTITY insertion, not a caller-provided WidgetId.
  await rejects("INSERT uqp.DashboardWidget(ProfileId,WidgetType,SourceKey,ConfigJson) " +
    "VALUES(22,N'CHART',N'PRIMARY',N'{}')");
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
  // A missing or wrong-event live audit must not establish any new trust.
  stage="AUDIT_RECEIPT_ENFORCEMENT";
  await q("SET IDENTITY_INSERT uqp.DashboardWidget ON; " +
    "INSERT uqp.DashboardWidget(Id,ProfileId,WidgetType,SourceKey,ConfigJson) " +
    "VALUES(91,22,N'TEXT',N'PRIMARY',N'{}'); " +
    "SET IDENTITY_INSERT uqp.DashboardWidget OFF");
  await rejects("INSERT uqp.DashboardChartWidgetSeal(WidgetId,ConfigDigest,IsActive,SealedBy,AuditLogId)" +
    " VALUES(91,REPLICATE('a',64),0,8,999)");
  await rejects("INSERT uqp.DashboardChartWidgetSeal(WidgetId,ConfigDigest,IsActive,SealedBy,AuditLogId)" +
    " VALUES(91,REPLICATE('a',64),0,77,1)");
  await q("DELETE FROM uqp.DashboardWidget WHERE Id=91");
  stage="REVIEW_STATE";
  const request="INSERT uqp.DashboardChartPrivacyReview("+
   "DashboardId,QueryId,DatasetId,SourceKey,CategoryColumn,ValueColumn," +
   "QueryRevision,DatasetRevision,PolicyRevision,Status,RequestedByUserId,AuditLogId) " +
   "VALUES(7,9,10,N'PRIMARY',N'ROOM',N'TOTAL',0x0102030405060708," +
   "0x0807060504030201,REPLICATE('b',64),'REQUESTED',8,2)";
  await q(request);
  await rejects(request); // filtered index protects active scope
  await rejects("UPDATE uqp.DashboardChartPrivacyReview SET Status='APPROVED'," +
    "MinimumCellCount=5,CategoryPrivacyReviewed=1,DifferencingRiskReviewed=1," +
    "ReviewerUserId=8,ReviewedAtUtc=SYSUTCDATETIME()," +
    "ValidUntilUtc=DATEADD(day,30,SYSUTCDATETIME()),AuditLogId=3 WHERE Id=1");
  await rejects("UPDATE uqp.DashboardChartPrivacyReview SET Status='APPROVED'," +
    "MinimumCellCount=5,CategoryPrivacyReviewed=1,DifferencingRiskReviewed=1," +
    "ReviewerUserId=77,ReviewedAtUtc=SYSUTCDATETIME()," +
    "ValidUntilUtc=DATEADD(day,91,SYSUTCDATETIME()),AuditLogId=3 WHERE Id=1");
  await q("DECLARE @instant DATETIME2(3)=SYSUTCDATETIME(); " +
    "UPDATE uqp.DashboardChartPrivacyReview SET Status='APPROVED'," +
    "MinimumCellCount=5,CategoryPrivacyReviewed=1,DifferencingRiskReviewed=1," +
    "ReviewerUserId=77,ReviewedAtUtc=@instant," +
    "ValidUntilUtc=DATEADD(day,90,@instant),AuditLogId=3 WHERE Id=1");
  await rejects("UPDATE uqp.DashboardChartPrivacyReview SET Status='REQUESTED' WHERE Id=1");
  await rejects("UPDATE uqp.DashboardChartPrivacyReview SET " +
    "Status='REVOKED',QueryId=99,ValidUntilUtc=SYSUTCDATETIME(),AuditLogId=4 WHERE Id=1");
  await q("UPDATE uqp.DashboardChartPrivacyReview SET " +
    "Status='REVOKED',ValidUntilUtc=SYSUTCDATETIME(),AuditLogId=4 WHERE Id=1");
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
  stage="RETENTION_ARCHIVE_COMPAT";
  // A trusted Audit ID must survive online retention without a live-table FK.
  await q("INSERT uqp.AuditLogArchive(Id,EventType,UserId,Status,IsImportant) " +
    "SELECT Id,EventType,UserId,Status,IsImportant FROM uqp.AuditLog WHERE Id IN(1,4); " +
    "DELETE FROM uqp.AuditLog WHERE Id IN(1,4)");
  assert.equal(Number((await q("SELECT COUNT_BIG(*) AS Total FROM uqp.AuditLog WHERE Id IN(1,4)")
    ).recordset[0]?.Total),0);
  assert.equal(Number((await q("SELECT COUNT_BIG(*) AS Total FROM uqp.AuditLogArchive WHERE Id IN(1,4)")
    ).recordset[0]?.Total),2);
  assert.equal(Number((await q("SELECT COUNT_BIG(*) AS Total FROM uqp.DashboardChartWidgetSeal")
    ).recordset[0]?.Total),1);
  // 2B-15B: the *real* SQL Server engine, not a mock, must reject direct
  // DML from an impersonated least-privilege caller. SESSION_CONTEXT cannot
  // serve as a chart writer credential, even when the caller sets it.
  stage="UNTRUSTED_SQL_PRINCIPAL";
  await q("CREATE USER [UQP_Chart_Untrusted] WITHOUT LOGIN");
  await q("GRANT SELECT,INSERT,UPDATE,DELETE ON uqp.DashboardWidget TO [UQP_Chart_Untrusted]; " +
    "GRANT SELECT ON uqp.DashboardChartWidgetSeal TO [UQP_Chart_Untrusted]; " +
    "DENY INSERT,UPDATE,DELETE ON uqp.DashboardChartWidgetSeal TO [UQP_Chart_Untrusted]; " +
    "DENY INSERT,UPDATE,DELETE ON uqp.DashboardChartPrivacyReview TO [UQP_Chart_Untrusted]; " +
    "DENY INSERT,UPDATE,DELETE ON uqp.DashboardChartTrustRequest TO [UQP_Chart_Untrusted];");
  // A single batch guarantees REVERT on normal SQL errors. Return an error
  // code from CATCH and require the expected trigger or permission denial,
  // never merely an arbitrary assertion/driver error.
  const untrusted = async (statement:string, expected:number[]):Promise<void>=>{
    const rows=(await db!.request().batch(
      "EXECUTE AS USER=N'UQP_Chart_Untrusted'; " +
      "BEGIN TRY " +
      "EXEC sys.sp_set_session_context @key=N'UQP_CHART_WRITER_AUTHORIZED',@value=1; " +
      statement + "; SELECT CAST(0 AS int) AS RejectedNumber; " +
      "END TRY BEGIN CATCH SELECT ERROR_NUMBER() AS RejectedNumber; END CATCH; " +
      "REVERT;"
    )).recordset;
    const number=Number(rows?.[0]?.RejectedNumber);
    if(!expected.includes(number)) {
      // Only the SQL error number and finite stage identifier are emitted.
      console.error("CHART_928_EXPECTED_REJECTION_MISMATCH:"+stage+":"+number);
    }
    assert(expected.includes(number),
      "CHART untrusted DML did not fail with an expected SQL error");
  };
  stage="UNTRUSTED_CHART_INSERT";
  await untrusted("INSERT uqp.DashboardWidget(ProfileId,WidgetType,SourceKey,ConfigJson)" +
    " VALUES(22,N'CHART',N'PRIMARY',N'{}')",[51928]);
  stage="UNTRUSTED_CHART_TYPE_CHANGE";
  await untrusted("UPDATE uqp.DashboardWidget SET WidgetType=N'CHART' WHERE Id=88",[51928]);
  stage="UNTRUSTED_SEALED_WIDGET_UPDATE";
  await untrusted("UPDATE uqp.DashboardWidget SET ConfigJson=N'{\"tampered\":true}' WHERE Id=88",[51928]);
  stage="UNTRUSTED_SEALED_WIDGET_DELETE";
  // SQL Server checks the trusted widget/seal FK before AFTER triggers:
  // FK error 547 is the expected denial for deleting the sealed parent.
  await untrusted("DELETE FROM uqp.DashboardWidget WHERE Id=88",[547]);
  stage="UNTRUSTED_SEAL_DELETE";
  await untrusted("DELETE FROM uqp.DashboardChartWidgetSeal WHERE WidgetId=88",[229]);
  stage="UNTRUSTED_REVIEW_WRITE";
  await untrusted("UPDATE uqp.DashboardChartPrivacyReview SET Status='APPROVED' WHERE Id=1",[229]);
  stage="UNTRUSTED_LEDGER_WRITE";
  await untrusted("DELETE FROM uqp.DashboardChartTrustRequest",[229]);
  stage="UNTRUSTED_TRIGGER_DISABLE";
  // Metadata/DDL permission denials can be SQL 15151 ("not found or no
  // permission") or SQL 229, depending on the server/catalog path.
  // SQL 1088 also covers the hidden-object/no-permission outcome.
  await untrusted("DISABLE TRIGGER uqp.TR_DashboardWidget_ChartFreeze ON uqp.DashboardWidget",[229,15151,1088]);
  // Do not infer safety from the error number: inspect the actual metadata.
  const freeze=(await q("SELECT is_disabled FROM sys.triggers WHERE " +
    "object_id=OBJECT_ID(N'uqp.TR_DashboardWidget_ChartFreeze',N'TR') " +
    "AND parent_id=OBJECT_ID(N'uqp.DashboardWidget')")).recordset;
  assert.equal(freeze.length,1);
  assert.equal(Number(freeze[0].is_disabled),0);
  assert.equal(Number((await q("SELECT COUNT_BIG(*) AS Total FROM uqp.DashboardWidget WHERE Id=88 AND WidgetType=N'TEXT'")).recordset[0]?.Total),1);
  assert.equal(Number((await q("SELECT COUNT_BIG(*) AS Total FROM uqp.DashboardChartWidgetSeal WHERE WidgetId=88")).recordset[0]?.Total),1);
  assert.equal(Number((await q("SELECT COUNT_BIG(*) AS Total FROM uqp.DashboardWidget WHERE Id=990")).recordset[0]?.Total),0);
  console.log("CHART_2B15B_UNTRUSTED_SQL_FREEZE_SESSION_FLAG_PRIVILEGE_PASS");
  stage="ENABLED_BUT_CHANGED_TRIGGER_REJECT";
  // Changing an enabled Trigger body is not detected by a simple count or
  // is_disabled=0 check; exact definition attestation MUST reject it.
  // DDL changes are rolled back inside the disposable DB transaction.
  const drift=new sql.Transaction(db);
  await drift.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  try {
    await new sql.Request(drift).batch(
      "ALTER TRIGGER uqp.TR_DashboardWidget_ChartFreeze " +
      "ON uqp.DashboardWidget AFTER INSERT,UPDATE,DELETE AS " +
      "BEGIN SET NOCOUNT ON; END"
    );
    await assert.rejects(
      attestChart928TriggerCatalog(drift,script),
      (error:unknown)=>error instanceof Chart928CatalogError &&
        error.code==="CHART_928_CATALOG_TRIGGER_DEFINITION"
    );
  } finally {
    await drift.rollback().catch(()=>undefined);
  }
  await attestChart928TriggerCatalog(db,script);
  console.log("CHART_2B15C_TRIGGER_DEFINITION_DRIFT_FAIL_CLOSED_PASS");
  stage="DRIFT_REJECT";
  await q("DISABLE TRIGGER uqp.TR_DashboardWidget_ChartFreeze ON uqp.DashboardWidget");
  await assert.rejects(db.request().batch(script), (err:unknown)=>err instanceof Error);
  await q("ENABLE TRIGGER uqp.TR_DashboardWidget_ChartFreeze ON uqp.DashboardWidget");
  await attestChart928TriggerCatalog(db,script);
  stage="FINAL";
  await check();
  await attestChartWriterBaseSqlCatalog(db);
  stage="BASE_SCHEMA_FK_DISABLE_DRIFT_REJECT";
  const fkDrift=new sql.Transaction(db);
  await fkDrift.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  try{
    await new sql.Request(fkDrift).query(
      "ALTER TABLE uqp.DashboardWidget NOCHECK CONSTRAINT FK_DashboardWidget_Profile"
    );
    await assert.rejects(
      attestChartWriterBaseSqlCatalog(fkDrift),
      (err:unknown)=>err instanceof Error &&
        err.message==="CHART_BASE_SCHEMA_FK_MISMATCH"
    );
  }finally{
    await fkDrift.rollback().catch(()=>undefined);
  }
  await attestChartWriterBaseSqlCatalog(db);
  console.log("CHART_2B15C_BASE_SCHEMA_FK_DISABLE_ROLLBACK_PASS");
  assert.equal(Number((await q("SELECT COUNT_BIG(*) AS Total FROM uqp.DashboardChartWidgetSeal")).recordset[0]?.Total),1);
  assert.equal(String((await q("SELECT Status FROM uqp.DashboardChartPrivacyReview WHERE Id=1")).recordset[0]?.Status),"REVOKED");
  console.log("CHART_928_DRAFT_SQL_2019_2022_INSTALL_RERUN_ROLLBACK_FREEZE_AUDIT_FK_PASS");
  stage="ATOMIC_CREATE_DRAFT_INSTALL";
  const atom=await readFile(new URL("../../../database/drafts/928_chart_atomic_create_prototype.sql.draft",import.meta.url),"utf8");
  await db.request().batch(atom);
  // Read-only real engine proof. The future approved proc does not yet
  // exist: its digest must be NULL. The isolated draft proc has a real
  // NVARCHAR definition whose SHA256 matches SQL Server's UTF-16 bytes.
  stage="ATOMIC_CREATE_SQL_MODULE_HASH";
  const absentModule=(await q(chartWriterIdentitySql)).recordset[0];
  assert.equal(absentModule?.ProcedureId,null);
  assert.equal(absentModule?.ProcedureSha256,null);
  const draftModuleSql=chartWriterIdentitySql.replaceAll(
    "usp_DashboardChartCreate","usp_ChartCreate_IsolatedDraft");
  const draftModule=(await q(draftModuleSql)).recordset[0];
  const actualDefinition=(await q(
    "SELECT definition AS Body FROM sys.sql_modules " +
    "WHERE object_id=OBJECT_ID(N'uqp.usp_ChartCreate_IsolatedDraft',N'P')"
  )).recordset[0]?.Body;
  assert.equal(typeof actualDefinition,"string");
  assert.match(String(draftModule?.ProcedureSha256),/^[a-f0-9]{64}$/);
  assert.equal(draftModule?.ProcedureSha256,
    createHash("sha256").update(Buffer.from(actualDefinition,"utf16le")).digest("hex"));
  console.log("CHART_2B15C_SQL_MODULE_SHA256_ENGINE_2019_2022_PASS");
  // No automatic permissions; explicitly impersonated low-rights principal
  // cannot call a privileged atomic writer just by passing an actor ID.
  // 2B-15C: prove two distinct SQL principals. The normal platform DB
  // connection is not the writer login; public/app SQL users cannot EXECUTE,
  // alter modules, mutate the transaction permit, or impersonate the writer.
  // Grants below exist ONLY inside this disposable UQP_CH_ database.
  stage="ATOMIC_CREATE_TWO_PRINCIPAL_PERMISSIONS";
  await q("CREATE USER [UQP_Chart_Writer] WITHOUT LOGIN; " +
    "CREATE ROLE [UQP_Chart_DraftExecutor]; " +
    "ALTER ROLE [UQP_Chart_DraftExecutor] ADD MEMBER [UQP_Chart_Writer]; " +
    "GRANT EXECUTE ON OBJECT::uqp.usp_ChartCreate_IsolatedDraft " +
    "TO [UQP_Chart_DraftExecutor]; " +
    "DENY EXECUTE ON OBJECT::uqp.usp_ChartCreate_IsolatedDraft TO [UQP_Chart_Untrusted]; " +
    "DENY INSERT,UPDATE,DELETE ON OBJECT::uqp.DashboardChartCreatePermit " +
    "TO [UQP_Chart_Untrusted]; " +
    "DENY INSERT,UPDATE,DELETE ON OBJECT::uqp.DashboardChartCreatePermit " +
    "TO [UQP_Chart_Writer]; " +
    "DENY INSERT,UPDATE,DELETE ON OBJECT::uqp.DashboardWidget " +
    "TO [UQP_Chart_Writer]; " +
    "DENY INSERT,UPDATE,DELETE ON OBJECT::uqp.DashboardChartWidgetSeal " +
    "TO [UQP_Chart_Writer]; " +
    "DENY INSERT,UPDATE,DELETE ON OBJECT::uqp.DashboardChartTrustRequest " +
    "TO [UQP_Chart_Writer];");
  const rights=await q(
    "EXECUTE AS USER=N'UQP_Chart_Untrusted'; " +
    "SELECT HAS_PERMS_BY_NAME(N'uqp.usp_ChartCreate_IsolatedDraft',N'OBJECT',N'EXECUTE') AS AppExecute, " +
    "HAS_PERMS_BY_NAME(N'uqp.DashboardChartCreatePermit',N'OBJECT',N'INSERT') AS AppPermitInsert, " +
    "HAS_PERMS_BY_NAME(N'uqp.usp_ChartCreate_IsolatedDraft',N'OBJECT',N'ALTER') AS AppAlter, " +
    "HAS_PERMS_BY_NAME(N'UQP_Chart_Writer',N'USER',N'IMPERSONATE') AS AppImpersonate; " +
    "REVERT; " +
    "EXECUTE AS USER=N'UQP_Chart_Writer'; " +
    "SELECT HAS_PERMS_BY_NAME(N'uqp.usp_ChartCreate_IsolatedDraft',N'OBJECT',N'EXECUTE') AS WriterExecute, " +
    "HAS_PERMS_BY_NAME(N'uqp.DashboardChartCreatePermit',N'OBJECT',N'INSERT') AS WriterPermitInsert, " +
    "HAS_PERMS_BY_NAME(N'uqp.DashboardChartWidgetSeal',N'OBJECT',N'INSERT') AS WriterSealInsert, " +
    "HAS_PERMS_BY_NAME(N'uqp.DashboardWidget',N'OBJECT',N'INSERT') AS WriterWidgetInsert, " +
    "HAS_PERMS_BY_NAME(N'uqp.DashboardWidget',N'OBJECT',N'UPDATE') AS WriterWidgetUpdate, " +
    "HAS_PERMS_BY_NAME(N'uqp.DashboardWidget',N'OBJECT',N'DELETE') AS WriterWidgetDelete; " +
    "REVERT"
  );
  const sets=Array.isArray(rights.recordsets)
    ? rights.recordsets : Object.values(rights.recordsets);
  assert.equal(sets.length,2);
  assert.equal(Number(sets[0]?.[0]?.AppExecute??0),0);
  assert.equal(Number(sets[0]?.[0]?.AppPermitInsert??0),0);
  assert.equal(Number(sets[0]?.[0]?.AppAlter??0),0);
  assert.equal(Number(sets[0]?.[0]?.AppImpersonate??0),0);
  assert.equal(Number(sets[1]?.[0]?.WriterExecute),1);
  assert.equal(Number(sets[1]?.[0]?.WriterPermitInsert??0),0);
  assert.equal(Number(sets[1]?.[0]?.WriterSealInsert??0),0);
  for(const flag of ["WriterWidgetInsert","WriterWidgetUpdate","WriterWidgetDelete"])
    assert.equal(Number(sets[1]?.[0]?.[flag]),0);
  const permissions=(await q(
    "SELECT (SELECT COUNT_BIG(*) FROM sys.database_role_members m " +
    "JOIN sys.database_principals roleName ON roleName.principal_id=m.role_principal_id " +
    "JOIN sys.database_principals userName ON userName.principal_id=m.member_principal_id " +
    "WHERE roleName.name=N'UQP_Chart_DraftExecutor' AND userName.name=N'UQP_Chart_Writer') AS Member, " +
    "(SELECT COUNT_BIG(*) FROM sys.database_role_members m " +
    "JOIN sys.database_principals roleName ON roleName.principal_id=m.role_principal_id " +
    "JOIN sys.database_principals userName ON userName.principal_id=m.member_principal_id " +
    "WHERE roleName.name=N'UQP_Chart_DraftExecutor' AND userName.name=N'UQP_Chart_Untrusted') AS AppMember"
  )).recordset[0];
  assert.equal(Number(permissions?.Member),1);
  assert.equal(Number(permissions?.AppMember),0);
  // EXECUTE AS USER changes effective database permissions, not the
  // ORIGINAL_LOGIN identity. It MUST NOT satisfy two-login attestation.
  stage="ATOMIC_CREATE_ORIGINAL_LOGIN_IMPERSONATION";
  const original=(await q(
    "SELECT CONVERT(varchar(256),SUSER_SID(ORIGINAL_LOGIN()),2) AS OriginalSid, " +
    "USER_NAME() AS EffectiveUser"
  )).recordset[0];
  const assumed=(await q(
    "EXECUTE AS USER=N'UQP_Chart_Writer'; " +
    "SELECT CONVERT(varchar(256),SUSER_SID(ORIGINAL_LOGIN()),2) AS OriginalSid, " +
    "USER_NAME() AS EffectiveUser; REVERT"
  )).recordset[0];
  assert.equal(String(assumed?.OriginalSid),String(original?.OriginalSid));
  assert.notEqual(String(assumed?.EffectiveUser),String(original?.EffectiveUser));
  console.log("CHART_2B15C_ORIGINAL_LOGIN_IMPERSONATION_CANNOT_ISOLATE_PASS");
  console.log("CHART_2B15C_DISPOSABLE_PRINCIPAL_SEPARATION_PASS");
  // Exercise the actual SQL Server 2019/2022 metadata query, not only mocked
  // JavaScript rows. This admin connection is NOT proof of least privilege;
  // it validates all permission names and result types are supported.
  stage="ATOMIC_CREATE_SERVER_PERMISSION_METADATA";
  const privilegeProof=(await q(chartWriterIdentitySql)).recordset[0];
  assert(privilegeProof);
  for(const flag of [
    "ServerControl","ServerImpersonateAny","ServerAlterLogins",
    "ServerAlterRoles","ServerSelectAllUserData","DbAccessAdmin",
    "DbAlterAnyUser","DbAlterAnyRole","DbAlterAnySchema",
  ]){
    assert(privilegeProof[flag]===0||privilegeProof[flag]===1,
      "Unexpected SQL 2019/2022 effective permission result");
  }
  console.log("CHART_2B15C_SQL_PERMISSION_METADATA_2019_2022_PASS");
  stage="ATOMIC_CREATE_UNGRANTED_EXEC";
  const unauthorized=(await db.request().batch(
    "EXECUTE AS USER=N'UQP_Chart_Untrusted'; " +
    "BEGIN TRY EXEC uqp.usp_ChartCreate_IsolatedDraft " +
    "@DashboardId=7,@ProfileId=22,@ActorId=8,@TokenVersion=1, " +
    "@RequestId='00000000-0000-4000-8000-000000005001'," +
    "@SourceKey=N'PRIMARY',@ConfigJson=N'{}',@X=10,@Y=10,@Width=600,@Height=360;" +
    "SELECT 0 AS RejectedNumber; END TRY " +
    "BEGIN CATCH SELECT ERROR_NUMBER() AS RejectedNumber; END CATCH; REVERT"
  )).recordset[0];
  assert([229,15151,2812].includes(Number(unauthorized?.RejectedNumber)));
  stage="ATOMIC_CREATE_TRUSTED_TRANSACTION";
  const canonical=JSON.stringify({version:1,chartType:"BAR",dataSourceKey:"PRIMARY",
    categoryColumn:"ROOM",valueColumn:"TOTAL",
    valueMode:"QUERY_RESULT",maxPoints:20,showLegend:true});
  const req="00000000-0000-4000-8000-000000005002";
  const params=()=>db!.request()
    .input("requestId",sql.UniqueIdentifier,req)
    .input("config",sql.NVarChar(sql.MAX),canonical);
  const execCreate="EXEC uqp.usp_ChartCreate_IsolatedDraft " +
    "@DashboardId=7,@ProfileId=22,@ActorId=8,@TokenVersion=1," +
    "@RequestId=@requestId,@SourceKey=N'PRIMARY',@ConfigJson=@config," +
    "@X=10,@Y=10,@Width=600,@Height=360";
  // 2B-15D-3: late failure AFTER the draft Writer has already inserted
  // RequestId, AuditLog and IDENTITY Widget. A synthetic Seal AFTER trigger
  // aborts the last step; the entire SERIALIZABLE transaction must roll back.
  // This trigger exists ONLY in the isolated disposable UQP_CH_ database.
  stage="ATOMIC_CREATE_LATE_SEAL_FAILURE_SETUP";
  const atomicCounts=async()=> (await db!.request().query(
    "SELECT (SELECT COUNT_BIG(*) FROM uqp.DashboardChartTrustRequest) AS Ledger," +
    "(SELECT COUNT_BIG(*) FROM uqp.AuditLog) AS Audit," +
    "(SELECT COUNT_BIG(*) FROM uqp.DashboardWidget WHERE WidgetType=N'CHART') AS Charts," +
    "(SELECT COUNT_BIG(*) FROM uqp.DashboardChartWidgetSeal) AS Seals," +
    "(SELECT COUNT_BIG(*) FROM uqp.DashboardChartCreatePermit) AS Permits"
  )).recordset[0];
  const beforeLateFailure=await atomicCounts();
  await db!.request().batch(
    "CREATE TRIGGER uqp.TR_ChartSeal_DisposableLateFailure " +
    "ON uqp.DashboardChartWidgetSeal AFTER INSERT AS BEGIN " +
    "SET NOCOUNT ON; THROW 51928,N'CHART_DISPOSABLE_LATE_SEAL_FAILURE',1; END"
  );
  try{
    stage="ATOMIC_CREATE_LATE_SEAL_FAILURE";
    await assert.rejects(params().query(execCreate),(e:unknown)=>
      e instanceof Error && Number((e as {number?:unknown}).number)===51928);
  }finally{
    // Drop the synthetic trigger even when the assertion fails. Never
    // change any migration-owned trigger or production database object.
    await db!.request().batch(
      "DROP TRIGGER IF EXISTS uqp.TR_ChartSeal_DisposableLateFailure");
  }
  stage="ATOMIC_CREATE_LATE_SEAL_ROLLBACK_COUNTS";
  assert.deepEqual(await atomicCounts(),beforeLateFailure);
  const rolledRequest=(await db!.request()
    .input("requestId",sql.UniqueIdentifier,req)
    .query("SELECT COUNT_BIG(*) AS Total FROM uqp.DashboardChartTrustRequest " +
      "WHERE RequestId=@requestId")).recordset[0];
  assert.equal(Number(rolledRequest?.Total),0);
  console.log("CHART_2B15D3_LATE_SEAL_ATOMIC_ROLLBACK_PASS");

  // The same RequestId must be reusable only because the aborted attempt
  // left NO persistent Ledger/Audit/Widget/Seal/Permit record.
  stage="ATOMIC_CREATE_RETRY_AFTER_LATE_ROLLBACK";
  const createdRow=(await params().query(execCreate)).recordset[0];
  const widgetId=Number(createdRow?.WidgetId);
  const auditId=Number(createdRow?.AuditLogId);
  assert(Number.isSafeInteger(widgetId)&&widgetId>91);
  assert(Number.isSafeInteger(auditId)&&auditId>4);
  const expected=createHash("sha256").update(canonical,"utf8").digest("hex");
  assert.equal(String(createdRow?.Digest),expected);
  const proof=(await db.request().input("id",sql.BigInt,widgetId)
   .query("SELECT w.WidgetType,w.SourceKey,w.ConfigJson,s.ConfigDigest,s.AuditLogId " +
   "FROM uqp.DashboardWidget w JOIN uqp.DashboardChartWidgetSeal s ON s.WidgetId=w.Id " +
   "WHERE w.Id=@id AND s.IsActive=1")).recordset;
  assert.equal(proof.length,1);
  assert.equal(proof[0]?.WidgetType,"CHART");
  assert.equal(proof[0]?.ConfigDigest,expected);
  assert.equal(Number(proof[0]?.AuditLogId),auditId);
  const receipt=(await db!.request()
    .input("requestId",sql.UniqueIdentifier,req)
    .query("SELECT r.ActorId,r.Action,r.AuditLogId AS LedgerAuditId," +
      "a.EventType,a.UserId,a.Status FROM uqp.DashboardChartTrustRequest r " +
      "JOIN uqp.AuditLog a ON a.Id=r.AuditLogId WHERE r.RequestId=@requestId")
  ).recordset;
  assert.equal(receipt.length,1);
  assert.equal(Number(receipt[0]?.ActorId),8);
  assert.equal(receipt[0]?.Action,"SEAL_WIDGET");
  assert.equal(Number(receipt[0]?.LedgerAuditId),auditId);
  assert.equal(receipt[0]?.EventType,"CHART_SEAL_WIDGET");
  assert.equal(Number(receipt[0]?.UserId),8);
  assert.equal(receipt[0]?.Status,"SUCCESS");
  assert.equal(Number((await q("SELECT COUNT_BIG(*) AS Total FROM uqp.DashboardChartCreatePermit")).recordset[0]?.Total),0);
  const beforeReplay=(await q(
    "SELECT (SELECT COUNT_BIG(*) FROM uqp.DashboardChartTrustRequest) AS Ledger, " +
    "(SELECT COUNT_BIG(*) FROM uqp.AuditLog) AS Audit"
  )).recordset[0];
  stage="ATOMIC_CREATE_REPLAY_ROLLBACK";
  await assert.rejects(params().query(execCreate),(e:unknown)=>e instanceof Error);
  const afterReplay=(await q(
    "SELECT (SELECT COUNT_BIG(*) FROM uqp.DashboardChartTrustRequest) AS Ledger, " +
    "(SELECT COUNT_BIG(*) FROM uqp.AuditLog) AS Audit"
  )).recordset[0];
  assert.equal(Number(afterReplay?.Ledger),Number(beforeReplay?.Ledger));
  assert.equal(Number(afterReplay?.Audit),Number(beforeReplay?.Audit));
  assert.equal(Number((await q("SELECT COUNT_BIG(*) AS Total FROM uqp.DashboardWidget WHERE WidgetType=N'CHART'")).recordset[0]?.Total),1);
  stage="ATOMIC_CREATE_BAD_ACTOR_ROLLBACK";
  await assert.rejects(db.request().input("config",sql.NVarChar(sql.MAX),canonical)
    .query("EXEC uqp.usp_ChartCreate_IsolatedDraft @DashboardId=7,@ProfileId=22," +
      "@ActorId=77,@TokenVersion=1,@RequestId='00000000-0000-4000-8000-000000005003'," +
      "@SourceKey=N'PRIMARY',@ConfigJson=@config,@X=10,@Y=10,@Width=600,@Height=360"),
    (e:unknown)=>e instanceof Error);
  assert.equal(Number((await q("SELECT COUNT_BIG(*) AS Total FROM uqp.DashboardChartCreatePermit")).recordset[0]?.Total),0);
  stage="ATOMIC_CREATE_DIRECT_DML_NO_PERMIT";
  const rejectFrozen=async(query:string)=>{
    await assert.rejects(db!.request().batch(query),(err:unknown)=>
      err && typeof err==="object" && Number((err as {number?:number}).number)===51928);
  };
  await rejectFrozen("INSERT uqp.DashboardWidget(ProfileId,WidgetType,SourceKey,ConfigJson) " +
    "VALUES(22,N'CHART',N'PRIMARY',N'{}')");
  // The exact request and the forged flag run in one batch; there is still
  // no durable database-owned permit outside usp_ChartCreate_IsolatedDraft.
  await rejectFrozen("EXEC sys.sp_set_session_context " +
    "@key=N'UQP_CHART_WRITER_AUTHORIZED',@value=1; " +
    "INSERT uqp.DashboardWidget(ProfileId,WidgetType,SourceKey,ConfigJson) " +
    "VALUES(22,N'CHART',N'PRIMARY',N'{}')");
  assert.equal(Number((await q("SELECT COUNT_BIG(*) AS Total FROM uqp.DashboardWidget WHERE WidgetType=N'CHART'")).recordset[0]?.Total),1);
  await rejects("UPDATE uqp.DashboardWidget SET ConfigJson=N'{}' WHERE Id="+widgetId);
  await rejects("DELETE FROM uqp.DashboardWidget WHERE Id="+widgetId);
  console.log("CHART_2B15C_ATOMIC_CREATE_IDENTITY_SEAL_AUDIT_REPLAY_DRAFT_PASS");

  // 2B-15D-5: VULNERABILITY WITNESS, not an authorization PASS.
  // The draft procedure accepts caller-owned @ActorId. Grant a second valid
  // synthetic user the SAME DESIGN_QUERY role; a single SQL writer principal
  // can then attribute a successful write to that other authorized user.
  // No HTTP/JWT identity or DB-owned actor delegation is presented here.
  // This MUST remain impossible to deploy: all three release gates are off.
  stage="ATOMIC_CREATE_VALID_OTHER_ACTOR_IMPERSONATION_WITNESS";
  assert.equal(CHART_ATOMIC_CREATE_RUNTIME_ENABLED,false);
  assert.equal(CHART_WRITER_APPROVED_PROCEDURE_SHA256,null);
  assert.equal(CHART_WRITER_DB_ACTOR_BINDING_APPROVED,false);
  await q("INSERT uqp.UserRole(UserId,RoleId) VALUES(77,1)");
  const otherRequest="00000000-0000-4000-8000-000000005077";
  await db!.request()
    .input("config",sql.NVarChar(sql.MAX),canonical)
    .input("requestId",sql.UniqueIdentifier,otherRequest)
    .query(
      "EXECUTE AS USER=N'UQP_Chart_Writer'; " +
      "BEGIN TRY " +
      "EXEC uqp.usp_ChartCreate_IsolatedDraft " +
      "@DashboardId=7,@ProfileId=22,@ActorId=77,@TokenVersion=1," +
      "@RequestId=@requestId,@SourceKey=N'PRIMARY',@ConfigJson=@config," +
      "@X=10,@Y=10,@Width=600,@Height=360; " +
      "END TRY BEGIN CATCH REVERT; THROW; END CATCH; REVERT;"
    );
  const otherWitness=(await db!.request()
    .input("requestId",sql.UniqueIdentifier,otherRequest)
    .query("SELECT r.ActorId,a.UserId,a.EventType,a.Status," +
      "s.SealedBy,s.WidgetId FROM uqp.DashboardChartTrustRequest r " +
      "JOIN uqp.AuditLog a ON a.Id=r.AuditLogId " +
      "JOIN uqp.DashboardChartWidgetSeal s ON s.AuditLogId=a.Id " +
      "WHERE r.RequestId=@requestId")).recordset;
  // This evidence must be treated as an explicit deploy BLOCKER, not proof
  // of a secure identity flow. No records survive disposable DB teardown.
  assert.equal(otherWitness.length,1);
  assert.equal(Number(otherWitness[0]?.ActorId),77);
  assert.equal(Number(otherWitness[0]?.UserId),77);
  assert.equal(Number(otherWitness[0]?.SealedBy),77);
  assert(Number.isSafeInteger(Number(otherWitness[0]?.WidgetId)));
  assert.equal(otherWitness[0]?.EventType,"CHART_SEAL_WIDGET");
  assert.equal(otherWitness[0]?.Status,"SUCCESS");
  assert.equal(Number((await q(
    "SELECT COUNT_BIG(*) AS Total FROM uqp.DashboardChartCreatePermit"
  )).recordset[0]?.Total),0);
  console.log("CHART_2B15D5_DRAFT_ACTOR_SPOOFING_REPRODUCED_RELEASE_BLOCKED");

  // 2B-15D-7: disposable-only issuer / consumer procedures. This tests
  // one-time SQL grant consumption; it DOES NOT prove a trusted HTTP actor,
  // cannot authorize Chart writes and must not remove any production gate.
  stage="DELEGATION_DISPOSABLE_INSTALL";
  const delegationSql=await readFile(new URL(
    "../../../database/drafts/928_chart_actor_delegation_disposable.sql.draft",
    import.meta.url),"utf8");
  await db!.request().batch(delegationSql);
  stage="DELEGATION_PRIVILEGE_SEPARATION";
  const grants=(await q(
    "EXECUTE AS USER=N'UQP_Chart_ConsumerSynthetic';" +
    "SELECT HAS_PERMS_BY_NAME(N'uqp.usp_ChartDelegationIssue_IsolatedDraft',N'OBJECT',N'EXECUTE') AS CanIssue," +
    "HAS_PERMS_BY_NAME(N'uqp.usp_ChartDelegationConsume_IsolatedDraft',N'OBJECT',N'EXECUTE') AS CanConsume," +
    "HAS_PERMS_BY_NAME(N'uqp.ChartActorDelegationDisposable',N'OBJECT',N'UPDATE') AS CanUpdate," +
    "HAS_PERMS_BY_NAME(N'uqp.ChartActorDelegationDisposable',N'OBJECT',N'SELECT') AS CanRead;" +
    "REVERT"
  )).recordset[0];
  assert.equal(Number(grants?.CanIssue),0);
  assert.equal(Number(grants?.CanConsume),1);
  assert.equal(Number(grants?.CanUpdate),0);
  assert.equal(Number(grants?.CanRead),0);
  const issuerGrants=(await q(
    "EXECUTE AS USER=N'UQP_Chart_IssuerSynthetic';" +
    "SELECT HAS_PERMS_BY_NAME(N'uqp.usp_ChartDelegationIssue_IsolatedDraft',N'OBJECT',N'EXECUTE') AS CanIssue," +
    "HAS_PERMS_BY_NAME(N'uqp.usp_ChartDelegationConsume_IsolatedDraft',N'OBJECT',N'EXECUTE') AS CanConsume," +
    "HAS_PERMS_BY_NAME(N'uqp.ChartActorDelegationDisposable',N'OBJECT',N'INSERT') AS CanInsert;" +
    "REVERT"
  )).recordset[0];
  assert.equal(Number(issuerGrants?.CanIssue),1);
  assert.equal(Number(issuerGrants?.CanConsume),0);
  assert.equal(Number(issuerGrants?.CanInsert),0);

  const issue=async(requestId:string,actorId=8)=>{
    const issued=(await db!.request()
      .input("requestId",sql.UniqueIdentifier,requestId)
      .input("actorId",sql.BigInt,actorId)
      .input("digest",sql.Char(64),expected)
      .query(
        "DECLARE @grant UNIQUEIDENTIFIER,@secret VARBINARY(32);" +
        "EXECUTE AS USER=N'UQP_Chart_IssuerSynthetic';" +
        "BEGIN TRY EXEC uqp.usp_ChartDelegationIssue_IsolatedDraft " +
        "@ActorId=@actorId,@TokenVersion=1,@DashboardId=7,@ProfileId=22," +
        "@RequestId=@requestId,@SourceKey=N'PRIMARY',@ConfigSha256=@digest," +
        "@X=10,@Y=10,@Width=600,@Height=360," +
        "@GrantId=@grant OUTPUT,@Secret=@secret OUTPUT;" +
        "END TRY BEGIN CATCH REVERT; THROW; END CATCH;" +
        "REVERT; SELECT @grant AS GrantId,@secret AS Secret;"
      )).recordset[0];
    assert.match(String(issued?.GrantId),
      /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i);
    assert(Buffer.isBuffer(issued?.Secret));
    assert.equal(issued.Secret.length,32);
    return {grantId:String(issued.GrantId),secret:issued.Secret as Buffer,requestId};
  };
  type SyntheticGrant=Awaited<ReturnType<typeof issue>>;
  const consume=(g:SyntheticGrant,overrides:Readonly<{
    actor?:number;token?:number;requestId?:string;digest?:string;
    secret?:Buffer;dashboard?:number;profile?:number;
  }>={})=>db!.request()
    .input("grantId",sql.UniqueIdentifier,g.grantId)
    .input("secret",sql.VarBinary(sql.MAX),overrides.secret??g.secret)
    .input("requestId",sql.UniqueIdentifier,overrides.requestId??g.requestId)
    .input("digest",sql.Char(64),overrides.digest??expected)
    .input("actor",sql.BigInt,overrides.actor??8)
    .input("token",sql.Int,overrides.token??1)
    .input("dashboard",sql.BigInt,overrides.dashboard??7)
    .input("profile",sql.BigInt,overrides.profile??22)
    .query(
      "EXECUTE AS USER=N'UQP_Chart_ConsumerSynthetic';" +
      "BEGIN TRY EXEC uqp.usp_ChartDelegationConsume_IsolatedDraft " +
      "@GrantId=@grantId,@Secret=@secret," +
      "@ActorId=@actor,@TokenVersion=@token," +
      "@DashboardId=@dashboard,@ProfileId=@profile," +
      "@RequestId=@requestId,@SourceKey=N'PRIMARY',@ConfigSha256=@digest," +
      "@X=10,@Y=10,@Width=600,@Height=360;" +
      "END TRY BEGIN CATCH REVERT; THROW; END CATCH; REVERT;"
    );
  const denied=async(work:Promise<unknown>)=>
    assert.rejects(work,(e:unknown)=>e instanceof Error &&
      Number((e as {number?:unknown}).number)===51928);
  const consumed=async(id:string)=>Number((await db!.request()
    .input("id",sql.UniqueIdentifier,id)
    .query("SELECT COUNT_BIG(*) AS Total FROM uqp.ChartActorDelegationDisposable " +
       "WHERE GrantId=@id AND ConsumedAtUtc IS NOT NULL")).recordset[0]?.Total);

  stage="DELEGATION_SECRET_NOT_STORED_AS_PLAINTEXT";
  const first=await issue("00000000-0000-4000-8000-000000006001");
  const dbHash=(await db!.request().input("id",sql.UniqueIdentifier,first.grantId)
    .query("SELECT SecretSha256 FROM uqp.ChartActorDelegationDisposable WHERE GrantId=@id")
  ).recordset[0]?.SecretSha256;
  assert(Buffer.isBuffer(dbHash));
  assert.equal(Buffer.compare(dbHash,createHash("sha256").update(first.secret).digest()),0);
  stage="DELEGATION_DUPLICATE_REQUEST_ISSUANCE";
  await assert.rejects(issue(first.requestId),(e:unknown)=>e instanceof Error &&
    [2601,2627].includes(Number((e as {number?:unknown}).number)));
  stage="DELEGATION_SCOPE_AND_SECRET_DENIAL";
  await denied(consume(first,{actor:77})); // another valid DESIGN_QUERY actor
  await denied(consume(first,{token:2}));
  await denied(consume(first,{dashboard:8}));
  await denied(consume(first,{profile:23}));
  await denied(consume(first,{digest:"f".repeat(64)}));
  await denied(consume(first,{secret:Buffer.alloc(32,0x40)}));
  await denied(consume(first,{requestId:"00000000-0000-4000-8000-000000006099"}));
  assert.equal(await consumed(first.grantId),0);

  stage="DELEGATION_SUCCESS_AND_REPLAY";
  assert.equal((await consume(first)).recordset[0]?.Consumed,true);
  assert.equal(await consumed(first.grantId),1);
  await denied(consume(first));

  stage="DELEGATION_CONCURRENT_SINGLE_WINNER";
  const second=await issue("00000000-0000-4000-8000-000000006002");
  const races=await Promise.allSettled([consume(second),consume(second)]);
  assert.equal(races.filter(x=>x.status==="fulfilled").length,1);
  assert.equal(races.filter(x=>x.status==="rejected").length,1);
  const loser=races.find(x=>x.status==="rejected");
  assert(loser && loser.status==="rejected");
  assert.equal(Number((loser.reason as {number?:unknown}).number),51928);
  assert.equal(await consumed(second.grantId),1);
  console.log("CHART_2B15D7_DISPOSABLE_CONCURRENT_SINGLE_USE_PASS");

  stage="DELEGATION_EXPIRED_AND_REVOKED";
  const expired=await issue("00000000-0000-4000-8000-000000006003");
  await db!.request().input("id",sql.UniqueIdentifier,expired.grantId)
    .query("DECLARE @expired DATETIME2(3)=DATEADD(MINUTE,-4,SYSUTCDATETIME());" +
      "UPDATE uqp.ChartActorDelegationDisposable " +
      "SET IssuedAtUtc=DATEADD(SECOND,-60,@expired)," +
      "ExpiresAtUtc=@expired WHERE GrantId=@id");
  await denied(consume(expired));
  const revoked=await issue("00000000-0000-4000-8000-000000006004");
  await db!.request().input("id",sql.UniqueIdentifier,revoked.grantId)
    .query("UPDATE uqp.ChartActorDelegationDisposable SET IsRevoked=1 WHERE GrantId=@id");
  await denied(consume(revoked));
  stage="DELEGATION_LIVE_TOKEN_VERSION_RECHECK";
  const versionDrift=await issue("00000000-0000-4000-8000-000000006006");
  await q("UPDATE uqp.AppUser SET TokenVersion=2 WHERE Id=8");
  try{await denied(consume(versionDrift));}
  finally{await q("UPDATE uqp.AppUser SET TokenVersion=1 WHERE Id=8");}
  stage="DELEGATION_LIVE_RBAC_RECHECK";
  const roleDrift=await issue("00000000-0000-4000-8000-000000006007");
  await q("DELETE FROM uqp.UserRole WHERE UserId=8 AND RoleId=1");
  try{await denied(consume(roleDrift));}
  finally{await q("INSERT uqp.UserRole(UserId,RoleId) VALUES(8,1)");}

  // The failing AFTER UPDATE trigger occurs after SQL has marked the grant
  // consumed. The procedure must roll back that bit, permitting a retry.
  stage="DELEGATION_LATE_FAILURE_SETUP";
  const retry=await issue("00000000-0000-4000-8000-000000006005");
  await db!.request().batch(
    "CREATE TRIGGER uqp.TR_ChartDelegation_DisposableFailure " +
    "ON uqp.ChartActorDelegationDisposable AFTER UPDATE AS BEGIN " +
    "SET NOCOUNT ON; THROW 51928,N'CHART_DELEGATION_SYNTHETIC_LATE_FAIL',1; END"
  );
  try{
    stage="DELEGATION_LATE_CONSUME_FAILURE";
    await denied(consume(retry));
  }finally{
    await db!.request().batch(
      "DROP TRIGGER IF EXISTS uqp.TR_ChartDelegation_DisposableFailure");
  }
  assert.equal(await consumed(retry.grantId),0);
  stage="DELEGATION_RETRY_AFTER_ROLLBACK";
  assert.equal((await consume(retry)).recordset[0]?.Consumed,true);
  assert.equal(await consumed(retry.grantId),1);
  console.log("CHART_2B15D7_DISPOSABLE_ROLLBACK_RETRY_PASS");

  // 2B-15D-10: same DB-owned transaction contains Grant consume,
  // Request Ledger, AuditLog, IDENTITY Widget and Seal. No real HTTP
  // actor binding: this remains a disposable SQL proof, NOT deployable.
  stage="DELEGATED_CREATE_ISOLATED_INSTALL";
  const delegatedDraft=await readFile(new URL(
    "../../../database/drafts/928_chart_atomic_create_with_delegation.sql.draft",
    import.meta.url),"utf8");
  // Guard against a draft leaving pooled SQL sessions in SERIALIZABLE mode
  // or accidentally removing rollback cleanup. The engine assertions below
  // still verify all DB mutations in the disposable UQP_CH_ database.
  assert.match(delegatedDraft,/COMMIT TRANSACTION;\s+SET TRANSACTION ISOLATION LEVEL READ COMMITTED;/);
  assert.match(delegatedDraft,/IF XACT_STATE\(\)<>0 ROLLBACK TRANSACTION;\s+SET TRANSACTION ISOLATION LEVEL READ COMMITTED;/);
  // Contract regression guard: DB time MUST be sampled only AFTER the
  // GrantId row lock has been acquired (not ahead of a blocking SELECT).
  // A passing 5.5 s engine race test alone cannot prove this SQL ordering
  // remains safe when a refactor changes the procedure control flow.
  const grantLockStatement=
    "SELECT 1 FROM uqp.ChartActorDelegationDisposable WITH(UPDLOCK,HOLDLOCK)";
  const grantLockPosition=delegatedDraft.indexOf(grantLockStatement);
  const grantTimeStatement="DECLARE @consumeAt DATETIME2(3)=SYSUTCDATETIME();";
  const grantTimePosition=delegatedDraft.indexOf(grantTimeStatement);
  const grantScopeStatement=
    "SELECT 1 FROM uqp.ChartActorDelegationDisposable d WITH(UPDLOCK,HOLDLOCK)";
  const grantScopePosition=delegatedDraft.indexOf(grantScopeStatement);
  assert(grantLockPosition>=0&&
    grantTimePosition>grantLockPosition&&
    grantScopePosition>grantTimePosition);
  assert.equal(delegatedDraft.split(grantTimeStatement).length-1,1);
  // The pinned Issuer SID is checked under DB-owned transaction locks,
  // not through caller-provided actor/approval flags or a preflight SELECT.
  const issuerSidJoin=delegatedDraft.indexOf(
    "INNER JOIN uqp.ChartWriterApprovedIssuerDisposable a WITH(UPDLOCK,HOLDLOCK)");
  const issuerSidCompare=delegatedDraft.indexOf(
    "a.ApprovalId=1 AND a.IsEnabled=1 AND a.IssuerSid=d.IssuerSid");
  const grantConsume=delegatedDraft.indexOf(
    "UPDATE uqp.ChartActorDelegationDisposable SET ConsumedAtUtc=");
  assert(issuerSidJoin>grantTimePosition &&
    issuerSidCompare>issuerSidJoin && grantConsume>issuerSidCompare);
  assert.equal(delegatedDraft.split("a.IssuerSid=d.IssuerSid").length-1,1);
  await db!.request().batch(delegatedDraft);
  const disposablePinned=(await q(
    "SELECT COUNT_BIG(*) AS Total FROM uqp.ChartWriterApprovedIssuerDisposable "+
    "WHERE ApprovalId=1 AND IsEnabled=1 "+
    "AND IssuerSid=SUSER_SID(ORIGINAL_LOGIN())"
  )).recordset[0];
  assert.equal(Number(disposablePinned?.Total),1);
  stage="DELEGATED_CREATE_WRITER_PERMISSION";
  const delegatedRights=(await q(
    "EXECUTE AS USER=N'UQP_Chart_Writer';" +
    "SELECT " +
    "HAS_PERMS_BY_NAME(N'uqp.usp_ChartCreate_IsolatedDraft',N'OBJECT',N'EXECUTE') AS OldExecute," +
    "HAS_PERMS_BY_NAME(N'uqp.usp_ChartCreateWithDelegation_IsolatedDraft',N'OBJECT',N'EXECUTE') AS NewExecute," +
    "HAS_PERMS_BY_NAME(N'uqp.ChartActorDelegationDisposable',N'OBJECT',N'UPDATE') AS DirectGrantUpdate," +
    "HAS_PERMS_BY_NAME(N'uqp.ChartActorDelegationDisposable',N'OBJECT',N'SELECT') AS DirectGrantSelect," +
    "HAS_PERMS_BY_NAME(N'uqp.usp_ChartDelegationIssue_IsolatedDraft',N'OBJECT',N'EXECUTE') AS GrantIssueExecute;" +
    "REVERT"
  )).recordset[0];
  assert.equal(Number(delegatedRights?.OldExecute),0);
  assert.equal(Number(delegatedRights?.NewExecute),1);
  assert.equal(Number(delegatedRights?.DirectGrantUpdate),0);
  assert.equal(Number(delegatedRights?.DirectGrantSelect),0);
  assert.equal(Number(delegatedRights?.GrantIssueExecute),0);
  const delegatedCounts=async()=> {
    const totals=(await db!.request().query(
      "SELECT (SELECT COUNT_BIG(*) FROM uqp.DashboardChartTrustRequest) AS Ledger," +
      "(SELECT COUNT_BIG(*) FROM uqp.AuditLog) AS Audit," +
      "(SELECT COUNT_BIG(*) FROM uqp.DashboardWidget WHERE WidgetType=N'CHART') AS Charts," +
      "(SELECT COUNT_BIG(*) FROM uqp.DashboardChartWidgetSeal) AS Seals," +
      "(SELECT COUNT_BIG(*) FROM uqp.DashboardChartCreatePermit) AS Permits," +
      "(SELECT COUNT_BIG(*) FROM uqp.ChartActorDelegationDisposable WHERE ConsumedAtUtc IS NOT NULL) AS Consumed"
    )).recordset[0];
    return ["Ledger","Audit","Charts","Seals","Permits","Consumed"].map(
      key=>Number(totals?.[key]));
  };
  const runDelegated=(g:SyntheticGrant,overrides:Readonly<{
    actor?:number;token?:number;secret?:Buffer;configJson?:string;
    requestId?:string;grantId?:string;profile?:number;dashboard?:number;
  }>={})=>db!.request()
    .input("grantId",sql.UniqueIdentifier,overrides.grantId??g.grantId)
    .input("secret",sql.VarBinary(sql.MAX),overrides.secret??g.secret)
    .input("requestId",sql.UniqueIdentifier,overrides.requestId??g.requestId)
    .input("config",sql.NVarChar(sql.MAX),overrides.configJson??canonical)
    .input("actor",sql.BigInt,overrides.actor??8)
    .input("token",sql.Int,overrides.token??1)
    .input("dashboard",sql.BigInt,overrides.dashboard??7)
    .input("profile",sql.BigInt,overrides.profile??22)
    .query(
      "EXECUTE AS USER=N'UQP_Chart_Writer';" +
      "BEGIN TRY EXEC uqp.usp_ChartCreateWithDelegation_IsolatedDraft " +
      "@DashboardId=@dashboard,@ProfileId=@profile,@ActorId=@actor,@TokenVersion=@token," +
      "@RequestId=@requestId,@GrantId=@grantId,@Secret=@secret," +
      "@SourceKey=N'PRIMARY',@ConfigJson=@config," +
      "@X=10,@Y=10,@Width=600,@Height=360;" +
      "END TRY BEGIN CATCH REVERT; THROW; END CATCH; REVERT;" +
      "SELECT @@TRANCOUNT AS OpenTransactions"
    );
  // Expected digest is recomputed inside SQL from canonical UTF-8 JSON.
  // An extra caller digest argument must NEVER be trusted by this Writer.
  const proveDelegatedReceipt=async(g:SyntheticGrant,created:{WidgetId?:unknown;AuditLogId?:unknown;Digest?:unknown;SealRevision?:unknown})=>{
    const widget=Number(created.WidgetId),audit=String(created.AuditLogId??"");
    stage="DELEGATED_RECEIPT_WIDGET_ID";
    assert(Number.isSafeInteger(widget)&&widget>0);
    stage="DELEGATED_RECEIPT_AUDIT_DECIMAL";
    assert.match(audit,/^[1-9][0-9]{0,19}$/);
    stage="DELEGATED_RECEIPT_AUDIT_STRING";
    assert.equal(typeof created.AuditLogId,"string");
    stage="DELEGATED_RECEIPT_REVISION_FORMAT";
    assert.match(String(created.SealRevision??""),/^[a-f0-9]{16}$/);
    stage="DELEGATED_RECEIPT_DIGEST";
    assert.equal(created.Digest,expected);
    const receipt=(await db!.request()
      .input("requestId",sql.UniqueIdentifier,g.requestId)
      .input("grantId",sql.UniqueIdentifier,g.grantId)
      .query("SELECT r.ActorId,r.AuditLogId AS LedgerAuditId," +
        "a.EventType,a.UserId AS AuditActor,a.Status," +
        "w.Id AS WidgetId,w.WidgetType,w.ConfigJson,w.SourceKey," +
        "s.ConfigDigest,s.SealedBy,s.AuditLogId AS SealAuditId," +
        "LOWER(CONVERT(varchar(16),s.SealRowVersion,2)) AS CurrentSealRevision," +
        "d.ConsumedAtUtc FROM uqp.DashboardChartTrustRequest r " +
        "JOIN uqp.AuditLog a ON a.Id=r.AuditLogId " +
        "JOIN uqp.DashboardChartWidgetSeal s ON s.AuditLogId=a.Id " +
        "JOIN uqp.DashboardWidget w ON w.Id=s.WidgetId " +
        "JOIN uqp.ChartActorDelegationDisposable d ON d.RequestId=r.RequestId " +
        "WHERE r.RequestId=@requestId AND d.GrantId=@grantId"
      )).recordset;
    stage="DELEGATED_RECEIPT_JOIN_COUNT";
    assert.equal(receipt.length,1);
    const item=receipt[0];
    stage="DELEGATED_RECEIPT_ACTOR";
    assert.equal(Number(item?.ActorId),8);
    assert.equal(Number(item?.AuditActor),8);
    assert.equal(Number(item?.SealedBy),8);
    stage="DELEGATED_RECEIPT_LEDGER_AUDIT";
    assert.equal(String(item?.LedgerAuditId),audit);
    stage="DELEGATED_RECEIPT_SEAL_AUDIT";
    assert.equal(String(item?.SealAuditId),audit);
    stage="DELEGATED_RECEIPT_SEAL_ROWVERSION";
    assert.equal(item?.CurrentSealRevision,created.SealRevision);
    stage="DELEGATED_RECEIPT_WIDGET_JOIN";
    assert.equal(Number(item?.WidgetId),widget);
    stage="DELEGATED_RECEIPT_AUDIT_FIELDS";
    assert.equal(item?.EventType,"CHART_SEAL_WIDGET");
    assert.equal(item?.Status,"SUCCESS");
    assert.equal(item?.WidgetType,"CHART");
    assert.equal(item?.SourceKey,"PRIMARY");
    assert.equal(item?.ConfigJson,canonical);
    assert.equal(item?.ConfigDigest,expected);
    assert(item?.ConsumedAtUtc instanceof Date);
  };
  stage="DELEGATED_CREATE_ATOMIC_SUCCESS";
  const successful=await issue("00000000-0000-4000-8000-000000007001");
  const preSuccess=await delegatedCounts();
  const createdResult=await runDelegated(successful);
  assert.equal(Number(Object.values(createdResult.recordsets).at(-1)?.[0]?.OpenTransactions),0);
  const createdWidget=createdResult.recordset[0];
  await proveDelegatedReceipt(successful,createdWidget);
  const postSuccess=await delegatedCounts();
  assert.deepEqual(postSuccess.slice(0,4),preSuccess.slice(0,4).map(v=>v+1));
  assert.equal(postSuccess[4],0); // permit is transaction-private
  assert.equal(postSuccess[5],preSuccess[5]!+1);
  stage="DELEGATED_CREATE_REPLAY_REJECT";
  await denied(runDelegated(successful));
  assert.deepEqual(await delegatedCounts(),postSuccess);

  // Same permission-bearing SQL writer cannot substitute a DIFFERENT
  // already-authorized ActorId into a grant issued for Actor 8.
  stage="DELEGATED_CREATE_OTHER_VALID_ACTOR_REJECT";
  const wrongActor=await issue("00000000-0000-4000-8000-000000007002");
  const beforeWrongActor=await delegatedCounts();
  await denied(runDelegated(wrongActor,{actor:77}));
  assert.deepEqual(await delegatedCounts(),beforeWrongActor);
  assert.equal(await consumed(wrongActor.grantId),0);
  await denied(runDelegated(wrongActor,{secret:Buffer.alloc(32,0x55)}));
  await denied(runDelegated(wrongActor,{grantId:"00000000-0000-4000-8000-000000007999"}));
  await denied(runDelegated(wrongActor,{configJson:JSON.stringify({
    ...JSON.parse(canonical),maxPoints:21,
  })}));
  await denied(runDelegated(wrongActor,{requestId:successful.requestId}));
  assert.deepEqual(await delegatedCounts(),beforeWrongActor);
  const validWrongActor=(await runDelegated(wrongActor)).recordset[0];
  await proveDelegatedReceipt(wrongActor,validWrongActor);

  stage="DELEGATED_CREATE_CONCURRENT_SINGLE_WINNER";
  const concurrent=await issue("00000000-0000-4000-8000-000000007003");
  const beforeRace=await delegatedCounts();
  const competing=await Promise.allSettled([runDelegated(concurrent),runDelegated(concurrent)]);
  const winners=competing.filter(x=>x.status==="fulfilled");
  const losers=competing.filter(x=>x.status==="rejected");
  assert.equal(winners.length,1);
  assert.equal(losers.length,1);
  const delegatedLoser=losers[0];
  assert(delegatedLoser?.status==="rejected");
  assert.equal(Number((delegatedLoser.reason as {number?:unknown}).number),51928);
  const winner=winners[0];
  assert(winner?.status==="fulfilled");
  await proveDelegatedReceipt(concurrent,winner.value.recordset[0]);
  const afterRace=await delegatedCounts();
  assert.deepEqual(afterRace.slice(0,4),beforeRace.slice(0,4).map(v=>v+1));
  assert.equal(afterRace[4],0);
  assert.equal(afterRace[5],beforeRace[5]!+1);

  // A late Seal failure must roll back the consumed Grant, Ledger, Audit,
  // Widget and temporary permit together. Retry is then safe with SAME
  // RequestId/GrantId/Secret because the failed transaction persisted none.
  stage="DELEGATED_CREATE_LATE_SEAL_FAILURE_SETUP";
  const late=await issue("00000000-0000-4000-8000-000000007004");
  const beforeLate=await delegatedCounts();
  await db!.request().batch(
    "CREATE TRIGGER uqp.TR_ChartDelegated_DisposableSealFailure " +
    "ON uqp.DashboardChartWidgetSeal AFTER INSERT AS BEGIN " +
    "SET NOCOUNT ON; THROW 51928,N'CHART_DELEGATED_LATE_SEAL_FAILURE',1; END"
  );
  try{
    stage="DELEGATED_CREATE_LATE_SEAL_ROLLBACK";
    await denied(runDelegated(late));
  }finally{
    await db!.request().batch(
      "DROP TRIGGER IF EXISTS uqp.TR_ChartDelegated_DisposableSealFailure");
  }
  assert.deepEqual(await delegatedCounts(),beforeLate);
  assert.equal(await consumed(late.grantId),0);
  stage="DELEGATED_CREATE_RETRY_AFTER_ROLLBACK";
  const retried=(await runDelegated(late)).recordset[0];
  await proveDelegatedReceipt(late,retried);
  const afterRetry=await delegatedCounts();
  assert.deepEqual(afterRetry.slice(0,4),beforeLate.slice(0,4).map(v=>v+1));
  assert.equal(afterRetry[4],0);
  assert.equal(afterRetry[5],beforeLate[5]!+1);
  console.log("CHART_2B15D10_DISPOSABLE_GRANT_WIDGET_SEAL_AUDIT_LEDGER_ATOMIC_DRAFT_PASS");

  // 2B-15D-11: revoke AFTER a valid grant was issued but BEFORE the Writer
  // commits. A read-time authorization snapshot is never sufficient.
  // All destructive fixture changes are restored in finally, so the test
  // still runs in the same disposable UQP_CH_ DB on SQL 2019 and SQL 2022.
  const assertNoDelegatedPartialWrite=async(g:SyntheticGrant,before:readonly number[])=>{
    assert.deepEqual(await delegatedCounts(),before);
    assert.equal(await consumed(g.grantId),0);
    const pending=(await db!.request()
      .input("requestId",sql.UniqueIdentifier,g.requestId)
      .query("SELECT COUNT_BIG(*) AS Total FROM uqp.DashboardChartTrustRequest " +
        "WHERE RequestId=@requestId")).recordset[0];
    assert.equal(Number(pending?.Total),0);
  };
  stage="DELEGATED_CREATE_ACTOR_DISABLED_AFTER_ISSUE";
  const disabled=await issue("00000000-0000-4000-8000-000000008001");
  const beforeDisabled=await delegatedCounts();
  await q("UPDATE uqp.AppUser SET IsActive=0 WHERE Id=8");
  try{
    await denied(runDelegated(disabled));
    await assertNoDelegatedPartialWrite(disabled,beforeDisabled);
  }finally{
    await q("UPDATE uqp.AppUser SET IsActive=1 WHERE Id=8");
  }
  // Invalid status was transient. The same unconsumed grant remains eligible
  // only while its TTL is still current; no failed attempt can consume it.
  stage="DELEGATED_CREATE_TOKEN_VERSION_REVOKED_AFTER_ISSUE";
  const versionRevoked=await issue("00000000-0000-4000-8000-000000008002");
  const beforeVersion=await delegatedCounts();
  await q("UPDATE uqp.AppUser SET TokenVersion=2 WHERE Id=8");
  try{
    await denied(runDelegated(versionRevoked));
    await assertNoDelegatedPartialWrite(versionRevoked,beforeVersion);
  }finally{
    await q("UPDATE uqp.AppUser SET TokenVersion=1 WHERE Id=8");
  }

  stage="DELEGATED_CREATE_RBAC_REMOVED_AFTER_ISSUE";
  const roleRevoked=await issue("00000000-0000-4000-8000-000000008003");
  const beforeRole=await delegatedCounts();
  await q("DELETE FROM uqp.UserRole WHERE UserId=8 AND RoleId=1");
  try{
    await denied(runDelegated(roleRevoked));
    await assertNoDelegatedPartialWrite(roleRevoked,beforeRole);
  }finally{
    await q("INSERT uqp.UserRole(UserId,RoleId) VALUES(8,1)");
  }

  stage="DELEGATED_CREATE_GRANT_REVOKED_AFTER_ISSUE";
  const grantRevoked=await issue("00000000-0000-4000-8000-000000008004");
  const beforeGrantRevoked=await delegatedCounts();
  await db!.request().input("id",sql.UniqueIdentifier,grantRevoked.grantId)
    .query("UPDATE uqp.ChartActorDelegationDisposable SET IsRevoked=1 WHERE GrantId=@id");
  await denied(runDelegated(grantRevoked));
  await assertNoDelegatedPartialWrite(grantRevoked,beforeGrantRevoked);

  stage="DELEGATED_CREATE_GRANT_EXPIRED_AFTER_ISSUE";
  const grantExpired=await issue("00000000-0000-4000-8000-000000008005");
  const beforeExpired=await delegatedCounts();
  await db!.request().input("id",sql.UniqueIdentifier,grantExpired.grantId)
    .query("DECLARE @t DATETIME2(3)=DATEADD(MINUTE,-4,SYSUTCDATETIME());" +
      "UPDATE uqp.ChartActorDelegationDisposable " +
      "SET IssuedAtUtc=DATEADD(SECOND,-60,@t),ExpiresAtUtc=@t " +
      "WHERE GrantId=@id");
  await denied(runDelegated(grantExpired));
  await assertNoDelegatedPartialWrite(grantExpired,beforeExpired);

  stage="DELEGATED_CREATE_SCOPE_AND_VERSION_NEGATIVES";
  const scope=await issue("00000000-0000-4000-8000-000000008006");
  const beforeScope=await delegatedCounts();
  for(const overrides of [
    {token:2},{dashboard:8},{profile:23},
    {requestId:"00000000-0000-4000-8000-000000008099"},
    {grantId:"00000000-0000-4000-8000-000000008098"},
    {secret:Buffer.alloc(32,0xa5)},
    {configJson:JSON.stringify({...JSON.parse(canonical),maxPoints:41})},
  ]) {
    await denied(runDelegated(scope,overrides));
    await assertNoDelegatedPartialWrite(scope,beforeScope);
  }
  const validScope=(await runDelegated(scope)).recordset[0];
  await proveDelegatedReceipt(scope,validScope);

  // 2B-15D-11: failure during Audit INSERT occurs after Grant is marked
  // consumed and Ledger is inserted, but before Widget/Seal. One rollback
  // must remove the entire attempted create and preserve grant retryability.
  stage="DELEGATED_CREATE_AUDIT_FAILURE_SETUP";
  const auditFailure=await issue("00000000-0000-4000-8000-000000008007");
  const beforeAuditFailure=await delegatedCounts();
  await db!.request().batch(
    "CREATE TRIGGER uqp.TR_ChartDelegated_DisposableAuditFailure " +
    "ON uqp.AuditLog AFTER INSERT AS BEGIN " +
    "SET NOCOUNT ON; THROW 51928,N'CHART_DELEGATED_SYNTHETIC_AUDIT_FAILURE',1; END"
  );
  try{
    stage="DELEGATED_CREATE_AUDIT_ROLLBACK";
    await denied(runDelegated(auditFailure));
  }finally{
    await db!.request().batch(
      "DROP TRIGGER IF EXISTS uqp.TR_ChartDelegated_DisposableAuditFailure");
  }
  await assertNoDelegatedPartialWrite(auditFailure,beforeAuditFailure);
  stage="DELEGATED_CREATE_AUDIT_RETRY_AFTER_ROLLBACK";
  const afterAuditRetryResult=await runDelegated(auditFailure);
  assert.equal(Number(Object.values(afterAuditRetryResult.recordsets).at(-1)?.[0]?.OpenTransactions),0);
  const afterAuditRetry=afterAuditRetryResult.recordset[0];
  await proveDelegatedReceipt(auditFailure,afterAuditRetry);
  const afterAudit=await delegatedCounts();
  assert.deepEqual(afterAudit.slice(0,4),
    beforeAuditFailure.slice(0,4).map(v=>v+1));
  assert.equal(afterAudit[4],0);
  assert.equal(afterAudit[5],beforeAuditFailure[5]!+1);
  console.log("CHART_2B15D11_DISPOSABLE_REVOKE_AUDIT_ROLLBACK_DRAFT_PASS");

  // 2B-15D-13: the expiry check MUST use SQL Server time after acquiring
  // the GrantId UPDLOCK/HOLDLOCK, not a timestamp captured before a lock
  // wait. This reproduces the stale-time acceptance vulnerability without
  // relying on any real platform connection, secrets, or users.
  stage="DELEGATED_GRANT_LOCK_WAIT_EXPIRY";
  const lockExpiry=await issue("00000000-0000-4000-8000-000000008008");
  await db!.request().input("id",sql.UniqueIdentifier,lockExpiry.grantId)
    .query("DECLARE @base DATETIME2(3)=SYSUTCDATETIME();" +
      "UPDATE uqp.ChartActorDelegationDisposable " +
      "SET IssuedAtUtc=DATEADD(SECOND,-56,@base)," +
      "ExpiresAtUtc=DATEADD(SECOND,4,@base) WHERE GrantId=@id");
  const beforeExpiryWait=await delegatedCounts();
  const hold=new sql.Transaction(db!);
  await hold.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  let holdReleased=false;
  try{
    const held=(await new sql.Request(hold)
      .input("id",sql.UniqueIdentifier,lockExpiry.grantId)
      .query("SELECT CASE WHEN ExpiresAtUtc>SYSUTCDATETIME() " +
        "THEN 1 ELSE 0 END AS StillValid FROM " +
        "uqp.ChartActorDelegationDisposable WITH(UPDLOCK,HOLDLOCK) " +
        "WHERE GrantId=@id")).recordset[0];
    assert.equal(Number(held?.StillValid),1);
    let finished=false;
    const pending=runDelegated(lockExpiry).then(
      result=>({status:"fulfilled" as const,result}),
      reason=>({status:"rejected" as const,reason}),
    ).finally(()=>{finished=true;});
    await new Promise(resolve=>setTimeout(resolve,5500));
    // The Writer should be blocked on the held issuer-owned grant.
    assert.equal(finished,false);
    await hold.commit();
    holdReleased=true;
    const outcome=await pending;
    assert.equal(outcome.status,"rejected");
    if(outcome.status==="rejected"){
      assert.equal(Number((outcome.reason as {number?:unknown}).number),51928);
    }
  }finally{
    if(!holdReleased)await hold.rollback().catch(()=>undefined);
  }
  await assertNoDelegatedPartialWrite(lockExpiry,beforeExpiryWait);
  console.log("CHART_2B15D13_DISPOSABLE_GRANT_EXPIRY_AFTER_LOCK_WAIT_DRAFT_PASS");


  // RELEASE BLOCKER WITNESS: the current synthetic Issuer procedure accepts
  // arbitrary @ActorId for ANY other valid DESIGN_QUERY user. Even though
  // the Writer cannot substitute an Actor into a grant for user 8, a forged
  // grant ISSUED for user 77 will be accepted. This is a KNOWN VULNERABLE
  // prototype behavior, not a security test PASS or release approval.
  // A real, independent HTTP-to-Issuer identity binding is still required.
  stage="DELEGATED_CREATE_ISSUER_ACTOR_SPOOF_WITNESS_BLOCKED";
  assert.equal(CHART_ATOMIC_CREATE_RUNTIME_ENABLED,false);
  assert.equal(CHART_WRITER_DB_ACTOR_BINDING_APPROVED,false);
  assert.equal(CHART_WRITER_APPROVED_PROCEDURE_SHA256,null);
  // The earlier ATOMIC_CREATE_OTHER_VALID_ACTOR phase ALREADY assigned
  // DESIGN_QUERY to Actor 77. Verify that existing valid actor without
  // inserting duplicate test roles or mutating privileges during this witness.
  const actor77Authorized=(await q(
      "SELECT COUNT_BIG(*) AS Total FROM uqp.AppUser u " +
      "JOIN uqp.UserRole ur ON ur.UserId=u.Id " +
      "JOIN uqp.Role r ON r.Id=ur.RoleId AND r.IsActive=1 " +
      "JOIN uqp.RolePermission rp ON rp.RoleId=r.Id " +
      "JOIN uqp.Permission p ON p.Id=rp.PermissionId " +
      "WHERE u.Id=77 AND u.IsActive=1 AND u.TokenVersion=1 " +
      "AND p.Code=N'DESIGN_QUERY'"
    )).recordset[0];
    assert.equal(Number(actor77Authorized?.Total),1);
  const forgedIssuerGrant=await issue(
    "00000000-0000-4000-8000-000000008077",77);
  const forgedCreate=(await runDelegated(forgedIssuerGrant,{actor:77})).recordset[0];
  const forgedAudit=(await db!.request()
    .input("requestId",sql.UniqueIdentifier,forgedIssuerGrant.requestId)
    .query("SELECT r.ActorId AS LedgerActor,a.UserId AS AuditActor," +
      "s.SealedBy AS SealActor,w.WidgetType,d.ConsumedAtUtc " +
      "FROM uqp.DashboardChartTrustRequest r " +
      "JOIN uqp.AuditLog a ON a.Id=r.AuditLogId " +
      "JOIN uqp.DashboardChartWidgetSeal s ON s.AuditLogId=a.Id " +
      "JOIN uqp.DashboardWidget w ON w.Id=s.WidgetId " +
      "JOIN uqp.ChartActorDelegationDisposable d ON d.RequestId=r.RequestId " +
      "WHERE r.RequestId=@requestId")).recordset;
  assert.equal(forgedAudit.length,1);
  assert(Number.isSafeInteger(Number(forgedCreate?.WidgetId)));
  assert.equal(Number(forgedAudit[0]?.LedgerActor),77);
  assert.equal(Number(forgedAudit[0]?.AuditActor),77);
  assert.equal(Number(forgedAudit[0]?.SealActor),77);
  assert.equal(forgedAudit[0]?.WidgetType,"CHART");
  assert(forgedAudit[0]?.ConsumedAtUtc instanceof Date);
  console.log("CHART_2B15D11_ISSUER_ACTOR_SPOOFING_REPRODUCED_RELEASE_BLOCKED");
  // 2B-15D-14: real SQL 2019/2022 exercises HMAC-SHA256 signed scope,
  // expiry, unique nonce and separate issuer/writer grants on disposable
  // synthetic data ONLY. This does NOT close the trusted HTTP actor gap.
  stage="ISSUER_SIGNED_SCOPE_DISPOSABLE";
  await (await import("./chart928IssuerMacAcceptance.js"))
    .verifyChartIssuerMacDisposable(db!,admin,config,machine);





 }catch(error){
  // Disposable SQL instance only. Report SQL error number/line, not values,
  // connection strings, database contents or untrusted SQL payload text.
  const metadata=error && typeof error==="object" ?
    error as {number?:unknown;lineNumber?:unknown;code?:unknown} : {};
  console.error("CHART_928_DRAFT_FAIL_STAGE:"+stage);
  console.error("CHART_928_DRAFT_ERROR_META:"+
    String(metadata.number??"NA")+":"+String(metadata.lineNumber??"NA")+":"+
    String(metadata.code??"NA"));
  throw Error("CHART_928_DRAFT_SQL_ACCEPTANCE_FAILED");
 }finally{
  await db?.close().catch(()=>undefined);
  if(created)await admin.request().query(
    "ALTER DATABASE ["+name+"] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE ["+name+"]");
 }
}
