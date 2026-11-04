// 2B-10: real, disposable SQL Server 2019/2022 acceptance of the
// shared legacy/managed layout deletion guard. Synthetic data ONLY.
import assert from "node:assert/strict";
import sql from "mssql";
import { writeDashboardLayout } from "../modules/dashboard/dashboardLayout.repository.js";
import { QuerySourceError } from "../modules/dashboard/dashboardQuerySources.service.js";

export async function verifyChartLayoutReplacementSql(db: sql.ConnectionPool) {
  if (process.env.UQP_D1_SCOPE !== "DISPOSABLE_ONLY")
    throw Error("CHART_LAYOUT_DISPOSABLE_ONLY");
  const name = String((await db.request().query("SELECT DB_NAME() AS Db")).recordset[0]?.Db ?? "");
  if (!/^UQP_CF_[a-f0-9]{12}$/i.test(name))
    throw Error("CHART_LAYOUT_DATABASE_MISMATCH");

  const exec = (query: string) => db.request().query(query);
  const rejected = async (dashboardId: number) => {
    const tx = new sql.Transaction(db);
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    try {
      await assert.rejects(
        writeDashboardLayout(tx, dashboardId, []),
        (error: unknown) => error instanceof QuerySourceError &&
          error.code === "CHART_LAYOUT_ATOMIC_WRITER_REQUIRED",
      );
    } finally {
      await tx.rollback();
    }
  };

  // Existing sealed widget: neither profile nor widget may be deleted.
  await rejected(7);
  const baseline = (await exec("SELECT COUNT_BIG(*) AS Total FROM uqp.DashboardWidget WHERE Id=88")).recordset;
  assert.equal(Number(baseline[0]?.Total), 1);

  // A CHART row with no seal is also protected, even when the review sidecar exists.
  await exec("INSERT uqp.Dashboard(Id,QueryDefinitionId,IsActive,QueryMode) VALUES(701,9,0,N'LEGACY'); " +
    "INSERT uqp.DashboardDisplayProfile(Id,DashboardId) VALUES(311,701); " +
    "INSERT uqp.DashboardWidget(Id,ProfileId,WidgetType,SourceKey,ConfigJson) " +
    "VALUES(312,311,N'CHART',N'PRIMARY',N'{}');");
  await rejected(701);
  assert.equal(Number((await exec("SELECT COUNT_BIG(*) AS Total FROM uqp.DashboardWidget WHERE Id=312")).recordset[0]?.Total), 1);

  // A mismatched sidecar attached to TEXT must be treated as protected state,
  // not silently cleaned by the old layout writer.
  await exec("INSERT uqp.Dashboard(Id,QueryDefinitionId,IsActive,QueryMode) VALUES(702,9,0,N'LEGACY'); " +
    "INSERT uqp.DashboardDisplayProfile(Id,DashboardId) VALUES(321,702); " +
    "INSERT uqp.DashboardWidget(Id,ProfileId,WidgetType,SourceKey,ConfigJson) " +
    "VALUES(322,321,N'TEXT',N'PRIMARY',N'{}'); " +
    "INSERT uqp.DashboardChartWidgetSeal(WidgetId,ConfigDigest,IsActive,SealedBy) " +
    "VALUES(322,REPLICATE('0',64),0,77);");
  await rejected(702);
  assert.equal(Number((await exec("SELECT COUNT_BIG(*) AS Total FROM uqp.DashboardWidget WHERE Id=322")).recordset[0]?.Total), 1);

  // Unrelated legacy layouts must still be replaceable by the real shared
  // writer (not merely by a synthetic mock of its guard).
  await exec("INSERT uqp.Dashboard(Id,QueryDefinitionId,IsActive,QueryMode) VALUES(700,9,0,N'LEGACY'); " +
    "INSERT uqp.DashboardDisplayProfile(Id,DashboardId) VALUES(301,700); " +
    "INSERT uqp.DashboardWidget(Id,ProfileId,WidgetType,SourceKey,ConfigJson) " +
    "VALUES(302,301,N'TEXT',N'PRIMARY',N'{}');");
  // Two independent SQL connections contend for the same Dashboard.
  // A held parent lock cannot be bypassed by the existing layout writer.
  const holder=new sql.Transaction(db);
  await holder.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  const contender=new sql.Transaction(db);
  try {
    await new sql.Request(holder).input("dashboardId",sql.BigInt,700)
      .query("SELECT Id FROM uqp.Dashboard WITH (UPDLOCK,HOLDLOCK) WHERE Id=@dashboardId");
    await contender.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    try {
      await new sql.Request(contender).query("SET LOCK_TIMEOUT 400");
      await assert.rejects(writeDashboardLayout(contender,700,[]),
        (error: unknown) => /lock request time out/i.test(String(error)) ||
          (typeof error === "object" && error !== null &&
            Number((error as {number?: number}).number) === 1222));
    } finally {
      await contender.rollback().catch(()=>undefined);
    }
  } finally {
    await holder.rollback().catch(()=>undefined);
  }
  assert.equal(Number((await exec(
    "SELECT COUNT_BIG(*) AS Total FROM uqp.DashboardWidget WHERE Id=302"
  )).recordset[0]?.Total),1);

  const tx = new sql.Transaction(db);
  await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  try {
    await writeDashboardLayout(tx, 700, []);
    await tx.commit();
  } catch (error) {
    await tx.rollback().catch(() => undefined);
    throw error;
  }
  const after = (await exec(
    "SELECT (SELECT COUNT_BIG(*) FROM uqp.DashboardWidget w JOIN uqp.DashboardDisplayProfile p " +
    "ON p.Id=w.ProfileId WHERE p.DashboardId=700) AS Widgets, " +
    "(SELECT COUNT_BIG(*) FROM uqp.DashboardDisplayProfile WHERE DashboardId=700) AS Profiles, " +
    "(SELECT COUNT_BIG(*) FROM uqp.DashboardWidget WHERE Id=88) AS ProtectedWidget",
  )).recordset[0];
  assert.equal(Number(after?.Widgets), 0);
  assert.equal(Number(after?.Profiles), 0);
  assert.equal(Number(after?.ProtectedWidget), 1);
  console.log("CHART_LAYOUT_2B11_SQL_PARENT_LOCK_CONTENTION_PASS");
  console.log("CHART_LAYOUT_2B10_SQL_ATOMIC_DELETE_FENCE_PASS");
}
