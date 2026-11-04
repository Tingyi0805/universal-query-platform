// 2B-8: real SQL Server 2019/2022 *synthetic sidecar contract* tests.
// Called by the existing D1 disposable UQP_CF_ database acceptance only.
// NOT a migration, production writer, patient-audit check or CHART activation.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import sql from "mssql";
import { createDormantChartTrustReaders } from "../modules/dashboard/dashboardChartTrust.repository.js";
import type { ExecutionSubject } from "../modules/dashboard/dashboardQuerySourceExecution.js";
import type { PublicCountScope } from "../modules/dashboard/dashboardChartPublicCountPrivacy.js";

export async function verifyChartTrustStoreSql(db: sql.ConnectionPool) {
  if (process.env.UQP_D1_SCOPE !== "DISPOSABLE_ONLY") throw Error("CHART_TRUST_DISPOSABLE_ONLY");
  const name = String((await db.request().query("SELECT DB_NAME() AS Db")).recordset[0]?.Db ?? "");
  if (!/^UQP_CF_[a-f0-9]{12}$/i.test(name)) throw Error("CHART_TRUST_DATABASE_MISMATCH");
  const exec = (statement: string) => db.request().query(statement);

  await exec([
    "CREATE TABLE uqp.DashboardDisplayProfile(Id BIGINT NOT NULL PRIMARY KEY,DashboardId BIGINT NOT NULL);",
    "CREATE TABLE uqp.DashboardWidget(Id BIGINT NOT NULL PRIMARY KEY,ProfileId BIGINT NOT NULL,WidgetType NVARCHAR(30) NOT NULL,SourceKey NVARCHAR(64) NOT NULL,ConfigJson NVARCHAR(MAX) NOT NULL);",
    "CREATE TABLE uqp.DashboardChartWidgetSeal(WidgetId BIGINT NOT NULL PRIMARY KEY REFERENCES uqp.DashboardWidget(Id),ConfigDigest CHAR(64) NOT NULL,IsActive BIT NOT NULL,SealedBy BIGINT NOT NULL,AuditLogId BIGINT NULL,SealRowVersion ROWVERSION NOT NULL);",
    "CREATE TABLE uqp.DashboardChartPrivacyReview(Id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,DashboardId BIGINT NOT NULL,QueryId BIGINT NOT NULL,DatasetId BIGINT NOT NULL,SourceKey NVARCHAR(64) NOT NULL,CategoryColumn NVARCHAR(128) NOT NULL,ValueColumn NVARCHAR(128) NOT NULL,QueryRevision BINARY(8) NOT NULL,DatasetRevision BINARY(8) NOT NULL,PolicyRevision CHAR(64) NOT NULL,Status VARCHAR(20) NOT NULL,MinimumCellCount INT NOT NULL,CategoryPrivacyReviewed BIT NOT NULL,DifferencingRiskReviewed BIT NOT NULL,RequestedByUserId BIGINT NOT NULL DEFAULT(8),RequestedAtUtc DATETIME2(3) NOT NULL DEFAULT(SYSUTCDATETIME()),ReviewerUserId BIGINT NULL,AuditLogId BIGINT NULL,ReviewedAtUtc DATETIME2(3) NULL,ValidUntilUtc DATETIME2(3) NULL,ReviewRowVersion ROWVERSION NOT NULL);",
    "CREATE UNIQUE INDEX UX_ChartPrivacyReview_Approved ON uqp.DashboardChartPrivacyReview(DashboardId,QueryId,DatasetId,SourceKey,CategoryColumn,ValueColumn) WHERE Status='APPROVED';",
    "CREATE TABLE uqp.AuditLog(Id BIGINT IDENTITY(1,1) PRIMARY KEY,EventType NVARCHAR(100) NOT NULL,EventCategory NVARCHAR(40) NOT NULL,IsImportant BIT NOT NULL,UserId BIGINT NOT NULL,Status NVARCHAR(20) NOT NULL,ParametersJson NVARCHAR(MAX) NOT NULL,CompletedAtUtc DATETIME2(3) NOT NULL);",
    "CREATE TABLE uqp.DashboardChartTrustRequest(RequestId UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,Action NVARCHAR(40) NOT NULL,ActorId BIGINT NOT NULL,AuditLogId BIGINT NULL);"
  ].join("\n"));
  const config = {
    version: 1, chartType: "BAR", dataSourceKey: "PRIMARY",
    categoryColumn: "ROOM", valueColumn: "TOTAL",
    valueMode: "QUERY_RESULT", maxPoints: 20, showLegend: false,
  };
  const raw = JSON.stringify(config);
  const digest = createHash("sha256").update(raw).digest("hex");
  await db.request().input("raw", sql.NVarChar(sql.MAX), raw)
    .input("digest", sql.Char(64), digest)
    .query("INSERT uqp.DashboardDisplayProfile(Id,DashboardId) VALUES(22,7); " +
      "INSERT uqp.DashboardWidget(Id,ProfileId,WidgetType,SourceKey,ConfigJson) VALUES(88,22,'CHART','PRIMARY',@raw); " +
      "INSERT uqp.DashboardChartWidgetSeal(WidgetId,ConfigDigest,IsActive,SealedBy) VALUES(88,@digest,1,77);");
  const readers = createDormantChartTrustReaders(async () => db);
  const initial = await readers.readSavedWidget(7, 88);
  assert(initial && initial.revision.length === 16);
  assert.deepEqual(initial.config, config);
  assert.equal(await readers.readSavedWidget(77, 88), null);
  assert.equal(await readers.readSavedWidget(7, 99), null);

  await exec("UPDATE uqp.DashboardWidget SET ConfigJson=N'{}' WHERE Id=88");
  assert.equal(await readers.readSavedWidget(7, 88), null);
  await db.request().input("raw", sql.NVarChar(sql.MAX), raw)
    .query("UPDATE uqp.DashboardWidget SET ConfigJson=@raw WHERE Id=88");
  // A future guarded writer MUST move the seal epoch in the same transaction,
  // even when the JSON reverts to the same bytes (A -> B -> A).
  await exec("UPDATE uqp.DashboardChartWidgetSeal SET ConfigDigest=ConfigDigest WHERE WidgetId=88");
  const restored = await readers.readSavedWidget(7, 88);
  assert(restored && restored.revision !== initial.revision);
  await exec("UPDATE uqp.DashboardChartWidgetSeal SET IsActive=0 WHERE WidgetId=88");
  assert.equal(await readers.readSavedWidget(7, 88), null);
  await exec("UPDATE uqp.DashboardChartWidgetSeal SET IsActive=1 WHERE WidgetId=88");
  assert(await readers.readSavedWidget(7, 88));

  const scope: PublicCountScope = {
    dashboardId: 7, queryId: 9, datasetId: 10, sourceKey: "PRIMARY",
    categoryColumn: "ROOM", valueColumn: "TOTAL",
    queryRevision: "a".repeat(16), datasetRevision: "b".repeat(16),
    policyRevision: "c".repeat(64),
  };
  const actor: ExecutionSubject = {
    context: "user", userId: 8, tokenVersion: 1, tokenHash: "synthetic",
  };
  await db.request()
    .input("queryRevision", sql.Binary, Buffer.from(scope.queryRevision, "hex"))
    .input("datasetRevision", sql.Binary, Buffer.from(scope.datasetRevision, "hex"))
    .input("policyRevision", sql.Char(64), scope.policyRevision)
    .query("SET IDENTITY_INSERT uqp.DashboardChartPrivacyReview ON; INSERT uqp.DashboardChartPrivacyReview(Id,DashboardId,QueryId,DatasetId,SourceKey,CategoryColumn,ValueColumn,QueryRevision,DatasetRevision,PolicyRevision,Status,MinimumCellCount,CategoryPrivacyReviewed,DifferencingRiskReviewed,ReviewerUserId,AuditLogId,ReviewedAtUtc,ValidUntilUtc) " +
      "VALUES(123,7,9,10,'PRIMARY','ROOM','TOTAL',@queryRevision,@datasetRevision,@policyRevision,'APPROVED',5,1,1,77,9876,DATEADD(day,-1,SYSUTCDATETIME()),DATEADD(day,30,SYSUTCDATETIME())); SET IDENTITY_INSERT uqp.DashboardChartPrivacyReview OFF;");
  const initialReview = await readers.readPublicReview(scope, actor);
  assert(initialReview && initialReview.minimumCellCount === 5);
  assert.equal(await readers.readPublicReview({ ...scope, policyRevision: "d".repeat(64) }, actor), null);
  assert.equal(await readers.readPublicReview({ ...scope, queryRevision: "e".repeat(16) }, actor), null);
  assert.equal(await readers.readPublicReview(scope, { ...actor, userId: 77 }), null);

  await exec("UPDATE uqp.DashboardChartPrivacyReview SET Status='REVOKED' WHERE Id=123");
  assert.equal(await readers.readPublicReview(scope, actor), null);
  await exec("UPDATE uqp.DashboardChartPrivacyReview SET Status='APPROVED' WHERE Id=123");
  const restoredReview = await readers.readPublicReview(scope, actor);
  assert(restoredReview && restoredReview.reviewRevision !== initialReview.reviewRevision);
  await exec("UPDATE uqp.DashboardChartPrivacyReview SET CategoryPrivacyReviewed=0 WHERE Id=123");
  assert.equal(await readers.readPublicReview(scope, actor), null);
  await exec("UPDATE uqp.DashboardChartPrivacyReview SET CategoryPrivacyReviewed=1 WHERE Id=123");
  await exec("UPDATE uqp.DashboardChartPrivacyReview SET ValidUntilUtc=DATEADD(day,-1,SYSUTCDATETIME()) WHERE Id=123");
  assert.equal(await readers.readPublicReview(scope, actor), null);
  await (await import("./chartTrustWriterSqlAcceptance.js")).verifyChartTrustWriterSql(db);
  console.log("CHART_TRUST_SQL_2B8_SEAL_REVIEW_ABA_REVOKE_EXPIRE_PASS");
}
