// Synthetic, disposable D1 acceptance against real SQL Server 2019/2022.
// Does not read platform config or run migrations on a real user database.
import sql from "mssql";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createChartRevisionFenceReader, createFencedChartOperation } from "../modules/dashboard/dashboardChartRevisionFence.js";
import { getTokenSessionState } from "../modules/auth/auth.repository.js";
import { getEffectiveQueryAccess } from "../modules/queryDefinition/queryDefinition.repository.js";
import { getQueryAccessRevision } from "../modules/queryDefinition/queryAccess.repository.js";
import type { ExecutionSubject } from "../modules/dashboard/dashboardQuerySourceExecution.js";

export async function verifyChartRevisionFenceSql(admin: sql.ConnectionPool, config: sql.config, machine: string) {
  if (process.env.UQP_D1_SCOPE !== "DISPOSABLE_ONLY" ||
      !/^uqp-d1-[a-f0-9]{12}$/.test(process.env.UQP_D1_CONTAINER_NAME ?? "") ||
      machine !== process.env.UQP_D1_CONTAINER_NAME ||
      Object.keys(process.env).some(k => k.startsWith("PLATFORM_DB_") || k === "DOTENV_CONFIG_PATH"))
    throw Error("DISPOSABLE_TARGET_REQUIRED");
  const identity = (await admin.request().query("SELECT DB_NAME() AS Db, CONVERT(nvarchar(128),SERVERPROPERTY('MachineName')) AS Machine")).recordset[0];
  if (identity?.Db !== "master" || identity.Machine !== machine)
    throw Error("DISPOSABLE_DATABASE_MISMATCH");
  const name = "UQP_CF_" + randomBytes(6).toString("hex");
  let db: sql.ConnectionPool | undefined;
  let created = false;
  let stage = "CREATE_DB";
  try {
    await admin.request().query("CREATE DATABASE [" + name + "]");
    created = true;
    // Only this disposable UQP_CF_ pool permits two simultaneous SQL sessions.
    // D1's parent/production-like pool remains max=1 and is never changed.
    db = await new sql.ConnectionPool({
      ...config,database:name,pool:{max:2,min:0},
    }).connect();
    const query = (queryText: string) => db!.request().query(queryText);
    await query("CREATE SCHEMA uqp");

  stage = "DDL";
  await query("CREATE TABLE uqp.DataSource(Id BIGINT PRIMARY KEY,IsActive BIT NOT NULL,ConfigurationRowVersion ROWVERSION NOT NULL);\nCREATE TABLE uqp.Dataset(Id BIGINT PRIMARY KEY,DataSourceId BIGINT NOT NULL,Name NVARCHAR(100) NOT NULL,IsActive BIT NOT NULL,IsArchived BIT NOT NULL,SqlText NVARCHAR(MAX) NOT NULL,DefinitionRowVersion ROWVERSION NOT NULL);\nCREATE TABLE uqp.QueryDefinition(Id BIGINT PRIMARY KEY,DatasetId BIGINT NOT NULL,Code NVARCHAR(30) NOT NULL,Name NVARCHAR(100) NOT NULL,Description NVARCHAR(100) NULL,CategoryId BIGINT NULL,Icon NVARCHAR(20) NOT NULL,SortOrder INT NOT NULL,AllowExcelExport BIT NOT NULL,IsPublished BIT NOT NULL,IsActive BIT NOT NULL,IsArchived BIT NOT NULL,PublishedAtUtc DATETIME2(3) NULL);\nCREATE TABLE uqp.QueryDefinitionVersion(QueryDefinitionId BIGINT NOT NULL,VersionNo INT NOT NULL,CONSTRAINT PK_ChartFixtureQueryVersion PRIMARY KEY(QueryDefinitionId,VersionNo));\nCREATE TABLE uqp.DatasetSensitivePolicyVersion(DatasetId BIGINT PRIMARY KEY,VersionNumber BIGINT NOT NULL);\nCREATE TABLE uqp.DatasetPublicDisplayPolicy(DatasetId BIGINT PRIMARY KEY,DataSourceId BIGINT NOT NULL,DefinitionVersion BINARY(8) NOT NULL,ConfigurationVersion BINARY(8) NOT NULL,SensitivityVersion BIGINT NOT NULL,RowVersion ROWVERSION NOT NULL);\nCREATE TABLE uqp.Dashboard(Id BIGINT PRIMARY KEY,QueryDefinitionId BIGINT NOT NULL,IsActive BIT NOT NULL,QueryMode NVARCHAR(30) NOT NULL,ApprovalRowVersion ROWVERSION NOT NULL);\nCREATE TABLE uqp.DashboardDataSource(Id BIGINT PRIMARY KEY,DashboardId BIGINT NOT NULL,SourceKey NVARCHAR(64) NOT NULL,DatasetId BIGINT NOT NULL,QueryDefinitionId BIGINT NULL,IsEnabled BIT NOT NULL,ApprovalRowVersion ROWVERSION NOT NULL);\nCREATE TABLE uqp.AppUser(Id BIGINT PRIMARY KEY,IsActive BIT NOT NULL,TokenVersion BIGINT NOT NULL);\nCREATE TABLE uqp.Role(Id BIGINT PRIMARY KEY,IsActive BIT NOT NULL);\nCREATE TABLE uqp.UserRole(UserId BIGINT NOT NULL,RoleId BIGINT NOT NULL);\nCREATE TABLE uqp.Permission(Id BIGINT PRIMARY KEY,Code NVARCHAR(100) NOT NULL);\nCREATE TABLE uqp.RolePermission(RoleId BIGINT NOT NULL,PermissionId BIGINT NOT NULL);\nCREATE TABLE uqp.RoleQueryAccess(RoleId BIGINT NOT NULL,QueryDefinitionId BIGINT NOT NULL,CanView BIT NOT NULL,CanExecute BIT NOT NULL,CanExport BIT NOT NULL);\nCREATE TABLE uqp.UserQueryAccess(UserId BIGINT NOT NULL,QueryDefinitionId BIGINT NOT NULL,CanView BIT NOT NULL,CanExecute BIT NOT NULL,CanExport BIT NOT NULL);\nCREATE TABLE uqp.UserQueryFavorite(UserId BIGINT NOT NULL,QueryDefinitionId BIGINT NOT NULL);\nCREATE TABLE uqp.QueryCategory(Id BIGINT PRIMARY KEY,Name NVARCHAR(100) NOT NULL,SortOrder INT NOT NULL);\nCREATE TABLE uqp.DatasetParameter(DatasetId BIGINT NOT NULL,LookupDatasetId BIGINT NULL);");
  stage = "SEED";
  await query("INSERT uqp.DataSource(Id,IsActive) VALUES(11,1);\nINSERT uqp.Dataset(Id,DataSourceId,Name,IsActive,IsArchived,SqlText) VALUES(10,11,N'Synthetic dataset',1,0,N'SELECT ROOM AS ROOM, COUNT(*) AS TOTAL FROM OPS GROUP BY ROOM');\nINSERT uqp.QueryDefinition(Id,DatasetId,Code,Name,Description,CategoryId,Icon,SortOrder,AllowExcelExport,IsPublished,IsActive,IsArchived,PublishedAtUtc) VALUES(9,10,N'SYN_COUNT',N'Synthetic Count',NULL,NULL,N'table',0,0,1,1,0,SYSUTCDATETIME());\nINSERT uqp.QueryDefinitionVersion(QueryDefinitionId,VersionNo) VALUES(9,1);\nINSERT uqp.DatasetSensitivePolicyVersion(DatasetId,VersionNumber) VALUES(10,1);\nINSERT uqp.Dashboard(Id,QueryDefinitionId,IsActive,QueryMode) VALUES(7,9,0,N'QUERY_ONLY_DISABLED');\nINSERT uqp.DashboardDataSource(Id,DashboardId,SourceKey,DatasetId,QueryDefinitionId,IsEnabled) VALUES(21,7,N'EXTRA',10,9,1);\nINSERT uqp.AppUser(Id,IsActive,TokenVersion) VALUES(8,1,1);\nINSERT uqp.Role(Id,IsActive) VALUES(1,1);\nINSERT uqp.UserRole(UserId,RoleId) VALUES(8,1);\nINSERT uqp.Permission(Id,Code) VALUES(1,N'DESIGN_QUERY'),(2,N'EXECUTE_QUERY'),(3,N'VIEW_QUERY');\nINSERT uqp.RolePermission(RoleId,PermissionId) VALUES(1,1),(1,2),(1,3);\nINSERT uqp.RoleQueryAccess(RoleId,QueryDefinitionId,CanView,CanExecute,CanExport) VALUES(1,9,1,1,0);");

  stage = "INITIAL";
  let readerPhase = "CATALOG";
  const read = createChartRevisionFenceReader({
    getPool: async () => db!,
    getSession: async (userId, tx) => {
      readerPhase = "SESSION";
      return getTokenSessionState(userId, tx);
    },
    getAccess: async (userId, queryId, tx, includeUsage) => {
      readerPhase = "ACCESS";
      return getEffectiveQueryAccess(userId, queryId, tx, includeUsage);
    },
    getAcl: async (queryId, tx) => {
      readerPhase = "ACL";
      return getQueryAccessRevision(queryId, tx);
    },
  });
  const designer: ExecutionSubject = {context:"designer",userId:8,tokenVersion:1,tokenHash:"synthetic"};
  const viewer: ExecutionSubject = {...designer,context:"user"};
  const load = (key="PRIMARY",actor=designer) => read(7,key,9,10,actor);
  stage = "INITIAL_READ";
  readerPhase = "CATALOG";
  const initial = await load();
  if (!initial) console.error("CHART_FENCE_SQL_INITIAL_NULL_PHASE:" + readerPhase);
  assert(initial && /^[a-f0-9]{64}$/.test(initial.version));
  const extraInitial = await load("EXTRA");
  assert.equal(extraInitial?.sourceKey, "EXTRA");
  assert.equal(await load("INJECT;DROP"), null);

  // Actual Dataset rowversion advances even when SQL is restored verbatim.
  await query("UPDATE uqp.Dataset SET SqlText=N'SELECT ROOM AS ROOM, COUNT(*) AS TOTAL FROM OPS2 GROUP BY ROOM' WHERE Id=10");
  stage = "DATASET_ABA";
  const changed = await load(); assert(changed && changed.version !== initial.version);
  await query("UPDATE uqp.Dataset SET SqlText=N'SELECT ROOM AS ROOM, COUNT(*) AS TOTAL FROM OPS GROUP BY ROOM' WHERE Id=10");
  const restored = await load();
  assert(restored && restored.version !== initial.version && restored.version !== changed.version);

  await query("INSERT uqp.QueryDefinitionVersion(QueryDefinitionId,VersionNo) VALUES(9,2)");
  stage = "QUERY_VERSION";
  const queryUpdated = await load(); assert(queryUpdated && queryUpdated.version !== restored.version);
  await query("UPDATE uqp.DatasetSensitivePolicyVersion SET VersionNumber=2 WHERE DatasetId=10");
  const sensitivityUpdated = await load(); assert(sensitivityUpdated && sensitivityUpdated.version !== queryUpdated.version);

  // Exercise the real UQP Query permission and token repositories inside the fence.
  stage = "ACL_REVOKE";
  await query("UPDATE uqp.RoleQueryAccess SET CanExecute=0 WHERE RoleId=1 AND QueryDefinitionId=9");
  assert.equal(await load(), null);
  await query("UPDATE uqp.RoleQueryAccess SET CanExecute=1 WHERE RoleId=1 AND QueryDefinitionId=9");
  // In the published ACL writer 919 evidence is advanced with access changes.
  await query("UPDATE uqp.Dashboard SET IsActive=IsActive WHERE Id=7");
  const accessRestored = await load();
  assert(accessRestored && accessRestored.version !== sensitivityUpdated.version);

  stage = "TOKEN_REVOKE";
  await query("UPDATE uqp.AppUser SET TokenVersion=2 WHERE Id=8");
  assert.equal(await load(),null);
  await query("UPDATE uqp.AppUser SET TokenVersion=1 WHERE Id=8");
  assert(await load());
  await query("UPDATE uqp.AppUser SET IsActive=0 WHERE Id=8");
  assert.equal(await load(), null);
  await query("UPDATE uqp.AppUser SET IsActive=1 WHERE Id=8");

  stage = "SOURCE_REVOKE";
  await query("UPDATE uqp.DashboardDataSource SET IsEnabled=0 WHERE Id=21");
  assert.equal(await load("EXTRA"), null);
  await query("UPDATE uqp.DashboardDataSource SET IsEnabled=1 WHERE Id=21");
  const extraRestored = await load("EXTRA"); assert(extraRestored);
  await query("UPDATE uqp.DashboardDataSource SET IsEnabled=1 WHERE Id=21");
  const extraAgain = await load("EXTRA");
  assert(extraAgain && extraAgain.version !== extraRestored.version);

  // Public (user) playback requires an active QUERY_ONLY Dashboard and a
  // current persisted 925 policy revision, even when Query ACLs are granted.
  assert.equal(await load("PRIMARY", viewer), null);
  await query("UPDATE uqp.Dashboard SET IsActive=1,QueryMode=N'QUERY_ONLY' WHERE Id=7");
  await query("INSERT uqp.DatasetPublicDisplayPolicy(DatasetId,DataSourceId,DefinitionVersion,ConfigurationVersion,SensitivityVersion) SELECT d.Id,s.Id,d.DefinitionRowVersion,s.ConfigurationRowVersion,2 FROM uqp.Dataset d JOIN uqp.DataSource s ON s.Id=d.DataSourceId WHERE d.Id=10");
  stage = "PUBLIC_POLICY";
  const publicReady = await load("PRIMARY",viewer);assert(publicReady);
  await query("UPDATE uqp.DataSource SET IsActive=1 WHERE Id=11");
  assert.equal(await load("PRIMARY",viewer), null);
  await query("UPDATE pd SET ConfigurationVersion=s.ConfigurationRowVersion FROM uqp.DatasetPublicDisplayPolicy pd JOIN uqp.DataSource s ON s.Id=pd.DataSourceId WHERE pd.DatasetId=10");
  const publicRenewed=await load("PRIMARY",viewer);
  assert(publicRenewed && publicRenewed.version !== publicReady.version);

  // A real SQL mutation during the guarded operation invalidates its result.
  stage = "GUARDED_DELIVERY";
  const guarded=createFencedChartOperation(read,async()=>{
    await query("UPDATE uqp.Dashboard SET QueryMode=N'QUERY_ONLY' WHERE Id=7");
    return {label:"OR-01",value:7};
  });
  assert.equal(await guarded(7,"PRIMARY",9,10,viewer),null);
  const allowed=createFencedChartOperation(read,async()=>({label:"OR-01",value:7}));
  assert.deepEqual(await allowed(7,"PRIMARY",9,10,viewer),{label:"OR-01",value:7});

  stage = "UNPUBLISH";
  await query("UPDATE uqp.QueryDefinition SET IsPublished=0 WHERE Id=9");
  assert.equal(await load("PRIMARY",viewer),null);
  await query("UPDATE uqp.QueryDefinition SET IsPublished=1 WHERE Id=9");
  await query("UPDATE uqp.DataSource SET IsActive=0 WHERE Id=11");
  assert.equal(await load("PRIMARY",viewer),null);
  stage = "CHART_TRUST_2B8";
  await (await import("./chartTrustSqlAcceptance.js")).verifyChartTrustStoreSql(db!);
  console.log("CHART_FENCE_REAL_SQL_2B6_AUTH_REVISION_ABA_PUBLIC_PASS");
  } catch {
    console.error("CHART_FENCE_SQL_ACCEPTANCE_FAIL_STAGE:" + stage);
    throw Error("CHART_FENCE_SQL_ACCEPTANCE_FAILED");
  } finally {
    await db?.close();
    if (created) await admin.request().query(
      "ALTER DATABASE [" + name + "] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [" + name + "]"
    );
  }
}
