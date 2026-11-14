// Real SQL Server 2019/2022 scope acceptance for the independent signer.
// ALL mutations are to a new disposable UQP_CH_<12hex> database inside the
// CI-only uqp-d1-<12hex> Docker instance. No UQP .env, production or PHI.
import assert from "node:assert/strict";
import {randomBytes} from "node:crypto";
import sql from "mssql";
import {createIndependentSignerSqlReaders}
  from "../chartSigner/independentSignerSqlReaders.js";

export async function verifyIndependentSignerSourceScopeSql(
  admin:sql.ConnectionPool,config:sql.config,machine:string,
):Promise<void>{
  if(process.env.UQP_D1_SCOPE!=="DISPOSABLE_ONLY"||
     process.env.UQP_D1_CONTAINER_NAME!==machine||
     !/^uqp-d1-[a-f0-9]{12}$/.test(machine)||
     config.server!=="127.0.0.1"||config.port!==14336||
     Object.keys(process.env).some(k=>k.startsWith("PLATFORM_DB_")||
       k==="DOTENV_CONFIG_PATH"))
    throw Error("CHART_SIGNER_SCOPE_DISPOSABLE_ONLY");
  const target=(await admin.request().query(
    "SELECT DB_NAME() AS Db,CONVERT(nvarchar(128),"+
    "SERVERPROPERTY('MachineName')) AS Machine",
  )).recordset[0];
  if(target?.Db!=="master"||target.Machine!==machine)
    throw Error("CHART_SIGNER_SCOPE_TARGET_MISMATCH");

  const name="UQP_CH_"+randomBytes(6).toString("hex");
  let db:sql.ConnectionPool|undefined,created=false;
  let stage="CREATE_DISPOSABLE_DB";
  try{
    await admin.request().query("CREATE DATABASE ["+name+"]");
    created=true;
    db=await new sql.ConnectionPool({...config,database:name,
      pool:{min:0,max:3}}).connect();
    const call=(statement:string)=>db!.request().query(statement);
    stage="CREATE_SIGNER_SCOPE_FIXTURE";
    await call("CREATE SCHEMA uqp");
    await call([
      "CREATE TABLE uqp.AppUser(Id bigint PRIMARY KEY,IsActive bit NOT NULL,TokenVersion int NOT NULL);",
      "CREATE TABLE uqp.Role(Id bigint PRIMARY KEY,IsActive bit NOT NULL);",
      "CREATE TABLE uqp.Permission(Id bigint PRIMARY KEY,Code nvarchar(100) NOT NULL);",
      "CREATE TABLE uqp.UserRole(UserId bigint NOT NULL,RoleId bigint NOT NULL);",
      "CREATE TABLE uqp.RolePermission(RoleId bigint NOT NULL,PermissionId bigint NOT NULL);",
      "CREATE TABLE uqp.UserQueryAccess(UserId bigint NOT NULL,QueryDefinitionId bigint NOT NULL,CanView bit NOT NULL,CanExecute bit NOT NULL);",
      "CREATE TABLE uqp.RoleQueryAccess(RoleId bigint NOT NULL,QueryDefinitionId bigint NOT NULL,CanView bit NOT NULL,CanExecute bit NOT NULL);",
      "CREATE TABLE uqp.Dashboard(Id bigint PRIMARY KEY,IsActive bit NOT NULL,QueryMode nvarchar(32) NOT NULL,QueryModeVersion bigint NOT NULL,QuerySourceMaxRows int NULL,QueryDefinitionId bigint NULL);",
      "CREATE TABLE uqp.DashboardDisplayProfile(Id bigint PRIMARY KEY,DashboardId bigint NOT NULL);",
      "CREATE TABLE uqp.DashboardDataSource(DashboardId bigint NOT NULL,SourceKey nvarchar(64) NOT NULL,DatasetId bigint NOT NULL,QueryDefinitionId bigint NULL,IsEnabled bit NOT NULL,QueryBindingRevision bigint NOT NULL,MaxRows int NULL);",
      "CREATE TABLE uqp.QueryDefinition(Id bigint PRIMARY KEY,DatasetId bigint NOT NULL,IsActive bit NOT NULL,IsPublished bit NOT NULL,IsArchived bit NOT NULL);",
      "CREATE TABLE uqp.Dataset(Id bigint PRIMARY KEY,DataSourceId bigint NOT NULL,IsActive bit NOT NULL,IsArchived bit NOT NULL);",
      "CREATE TABLE uqp.DataSource(Id bigint PRIMARY KEY,IsActive bit NOT NULL);",
      "CREATE TABLE uqp.DatasetParameter(DatasetId bigint NOT NULL,LookupDatasetId bigint NULL);",
    ].join("\n"));
    await call([
      "INSERT uqp.AppUser VALUES(8,1,7),(9,0,7);",
      "INSERT uqp.Role VALUES(1,1);",
      "INSERT uqp.Permission VALUES(1,N'DESIGN_QUERY'),(2,N'EXECUTE_QUERY');",
      "INSERT uqp.UserRole VALUES(8,1);",
      "INSERT uqp.RolePermission VALUES(1,1),(1,2);",
      "INSERT uqp.DataSource VALUES(40,1);",
      "INSERT uqp.Dataset VALUES(10,40,1,0),(20,40,1,0),(30,40,1,0);",
      "INSERT uqp.QueryDefinition VALUES(9,10,1,1,0),(19,20,1,1,0),(29,30,1,1,0);",
      "INSERT uqp.Dashboard VALUES(7,1,N'QUERY_ONLY',1,100,9);",
      "INSERT uqp.DashboardDisplayProfile VALUES(22,7);",
      "INSERT uqp.DashboardDataSource VALUES(7,N'SURGERY',20,19,1,1,100);",
      "INSERT uqp.UserQueryAccess VALUES(8,9,1,1),(8,19,1,1);",
    ].join("\n"));
    const signer=createIndependentSignerSqlReaders(db);
    const allow=(key:string)=>signer.authorizeChartCreate(8,7,22,key);
    stage="POSITIVE_PRIMARY_AND_SECONDARY";
    const initialSession=await signer.readLiveSession(8);
    assert.equal(initialSession?.isActive,true);
    assert.equal(initialSession?.tokenVersion,7);
    assert.deepEqual(new Set(initialSession?.permissions),
      new Set(["DESIGN_QUERY","EXECUTE_QUERY"]));
    // PRIMARY has NO DashboardDataSource record. The old signer query denied
    // it unconditionally despite valid Dashboard.QueryDefinitionId=9.
    assert.equal(await allow("PRIMARY"),true);
    assert.equal(await allow("SURGERY"),true);
    assert.equal(await allow("surgery"),false);
    assert.equal(await allow("Primary"),false);
    assert.equal(await allow("NONEXISTENT"),false);
    assert.equal(await signer.authorizeChartCreate(9,7,22,"PRIMARY"),false);
    assert.equal(await signer.authorizeChartCreate(8,7,23,"PRIMARY"),false);

    stage="PRIMARY_DASHBOARD_BINDING_MUST_NOT_FALLBACK";
    await call("UPDATE uqp.Dashboard SET QueryDefinitionId=NULL WHERE Id=7");
    assert.equal(await allow("PRIMARY"),false);
    // Secondary remains independently valid even when PRIMARY is missing:
    // authorization scope must not silently substitute another Query.
    assert.equal(await allow("SURGERY"),true);
    await call("UPDATE uqp.Dashboard SET QueryDefinitionId=9 WHERE Id=7");
    await call("INSERT uqp.DashboardDataSource VALUES(7,N'PRIMARY',30,29,1,1,100)");
    assert.equal(await allow("PRIMARY"),false);
    assert.equal(await allow("SURGERY"),false);
    await call("DELETE FROM uqp.DashboardDataSource WHERE SourceKey=N'PRIMARY'");

    stage="SECONDARY_LIFECYCLE_DENY";
    await call("UPDATE uqp.DashboardDataSource SET IsEnabled=0 WHERE SourceKey=N'SURGERY'");
    assert.equal(await allow("SURGERY"),false);
    await call("UPDATE uqp.DashboardDataSource SET IsEnabled=1,QueryBindingRevision=0 WHERE SourceKey=N'SURGERY'");
    assert.equal(await allow("SURGERY"),false);
    await call("UPDATE uqp.DashboardDataSource SET QueryBindingRevision=1,MaxRows=NULL WHERE SourceKey=N'SURGERY'");
    assert.equal(await allow("SURGERY"),false);
    await call("UPDATE uqp.DashboardDataSource SET MaxRows=100,DatasetId=30 WHERE SourceKey=N'SURGERY'");
    assert.equal(await allow("SURGERY"),false);
    await call("UPDATE uqp.DashboardDataSource SET DatasetId=20 WHERE SourceKey=N'SURGERY'");
    assert.equal(await allow("SURGERY"),true);

    stage="DASHBOARD_MODE_AND_PERMISSION_DENY";
    await call("UPDATE uqp.Dashboard SET QueryMode=N'LEGACY' WHERE Id=7");
    assert.equal(await allow("PRIMARY"),false);
    await call("UPDATE uqp.Dashboard SET QueryMode=N'QUERY_ONLY',QueryModeVersion=0 WHERE Id=7");
    assert.equal(await allow("PRIMARY"),false);
    await call("UPDATE uqp.Dashboard SET QueryModeVersion=1,QuerySourceMaxRows=NULL WHERE Id=7");
    assert.equal(await allow("PRIMARY"),false);
    await call("UPDATE uqp.Dashboard SET QuerySourceMaxRows=100 WHERE Id=7");
    await call("UPDATE uqp.UserQueryAccess SET CanExecute=0 WHERE QueryDefinitionId=9");
    assert.equal(await allow("PRIMARY"),false);
    await call("UPDATE uqp.UserQueryAccess SET CanExecute=1 WHERE QueryDefinitionId=9");
    await call("UPDATE uqp.QueryDefinition SET IsArchived=1 WHERE Id=9");
    assert.equal(await allow("PRIMARY"),false);
    await call("UPDATE uqp.QueryDefinition SET IsArchived=0 WHERE Id=9");
    await call("UPDATE uqp.DataSource SET IsActive=0 WHERE Id=40");
    assert.equal(await allow("PRIMARY"),false);
    await call("UPDATE uqp.DataSource SET IsActive=1 WHERE Id=40");
    await call("UPDATE uqp.AppUser SET IsActive=0 WHERE Id=8");
    assert.equal(await allow("PRIMARY"),false);
    await call("UPDATE uqp.AppUser SET IsActive=1 WHERE Id=8");
    assert.equal(await allow("PRIMARY"),true);
    console.log("CHART_SIGNER_SQL_PRIMARY_SECONDARY_BINDING_DENY_PASS");
  }catch(e){
    console.error("CHART_SIGNER_SCOPE_DISPOSABLE_FAILED_STAGE="+stage);
    throw e;
  }finally{
    await db?.close();
    if(created)await admin.request().query(
      "ALTER DATABASE ["+name+"] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;"+
      "DROP DATABASE ["+name+"]",
    );
  }
}
