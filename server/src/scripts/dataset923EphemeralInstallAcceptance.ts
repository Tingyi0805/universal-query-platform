/**
 * Exercises the real dedicated 923 CLI on a second disposable, synthetic SQL2019 DB.
 * No production/schema secrets, no runtime activation, no real source connections.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import sql from "mssql";

const secondDb = "UQP923_CI_INSTALL";
const names = [
  "001_platform_identity.sql", "002_datasource.sql", "006_audit_log.sql",
  "016_audit_retention.sql", "019_user_token_version.sql",
  "919_dashboard_dataset_security_contract.sql",
  "920_dataset_definition_rowversion.sql",
  "921_datasource_native_parameter_versions.sql",
];

async function execute(mode: string, serverName: string, extra: Record<string,string>={}, approval=false) {
  const env = { ...process.env,
    PLATFORM_DB_SERVER: "127.0.0.1",
    PLATFORM_DB_PORT: "14333",
    PLATFORM_DB_DATABASE: secondDb,
    PLATFORM_DB_USER: "sa",
    PLATFORM_DB_PASSWORD: process.env.UQP_923_CI_PASSWORD!,
    PLATFORM_DB_ENCRYPT: "true", PLATFORM_DB_TRUST_SERVER_CERTIFICATE: "true",
    UQP_923_EXPECTED_SERVER: serverName,
    UQP_923_EXPECTED_DATABASE: secondDb, UQP_923_EXPECTED_LOGIN: "sa",
    UQP_923_APPROVE_INSTALL: approval ? "I_APPROVE_REBUILT_UQP_923" : "",
    UQP_923_BACKUP_VERIFIED: approval ? "YES" : "",
    ...extra,
  };
  return await new Promise<{exit:number|null;stdout:string;stderr:string}>((resolve,reject)=>{
    const child=spawn(process.execPath, ["--import","tsx","src/scripts/installDataset923.ts",
      mode,...(mode==="apply" ? ["--confirm"] : [])],{
      cwd:process.cwd(),env,stdio:["ignore","pipe","pipe"],shell:false,
    });
    let stdout="",stderr="";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data",(chunk:string)=>{stdout+=chunk;});
    child.stderr.on("data",(chunk:string)=>{stderr+=chunk;});
    child.on("error",reject);
    child.on("close",exit=>resolve({exit,stdout,stderr}));
  });
}
function success(r:{exit:number|null;stdout:string},marker:string){
  assert.equal(r.exit,0,`CLI failed at ${marker}`);
  assert.ok(r.stdout.includes(marker),`Missing 923 success marker: ${marker}`);
}
function rejection(r:{exit:number|null;stderr:string},marker:string){
  assert.notEqual(r.exit,0);
  assert.ok(r.stderr.includes(marker),`Missing 923 rejection marker ${marker}`);
}

export async function test923ManualInstallerOnSyntheticSqlServer(master:sql.ConnectionPool) {
  if(process.env.GITHUB_ACTIONS!=="true" || process.env.UQP_923_CI_EPHEMERAL!=="1"
    || process.env.UQP_923_CI_HOST!=="127.0.0.1" ||
    process.env.UQP_923_CI_PORT!=="14333" || !process.env.UQP_923_CI_PASSWORD)
    throw new Error("923_INSTALL_CI_ONLY");
  const info=(await master.request().query(`
    SELECT CONVERT(nvarchar(128),SERVERPROPERTY(N'MachineName')) AS Machine,
      TRY_CONVERT(int,SERVERPROPERTY(N'ProductMajorVersion')) AS Major,
      DB_NAME() AS Db, ORIGINAL_LOGIN() AS LoginName,
      @@SERVERNAME AS ServerName, DB_ID(N'${secondDb}') AS Existing
  `)).recordset[0];
  assert.equal(info?.Machine,"uqp-923-ephemeral");
  assert.equal(info?.Major,15);
  assert.equal(info?.Db,"master");
  assert.equal(info?.LoginName,"sa");
  assert.equal(info?.Existing,null);
  assert.equal(info?.ServerName,"uqp-923-ephemeral");
  let created=false;
  let pool:sql.ConnectionPool|undefined;
  try{
    await master.request().batch(`CREATE DATABASE [${secondDb}]`);created=true;
    await master.request().batch(`ALTER DATABASE [${secondDb}] SET COMPATIBILITY_LEVEL = 150`);
    pool=await new sql.ConnectionPool({
      server:"127.0.0.1",port:14333,database:secondDb,user:"sa",
      password:process.env.UQP_923_CI_PASSWORD!,
      options:{encrypt:true,trustServerCertificate:true},
      pool:{max:2,min:0},connectionTimeout:2000,requestTimeout:30000,
    }).connect();
    const setup=[
      "CREATE SCHEMA uqp",
      "CREATE TABLE uqp.Dataset(Id BIGINT NOT NULL PRIMARY KEY, DefinitionRowVersion ROWVERSION NOT NULL)",
      "CREATE TABLE uqp.DataSource(Id BIGINT NOT NULL PRIMARY KEY, ConfigurationRowVersion ROWVERSION NOT NULL)",
      "CREATE TABLE uqp.AppUser(Id BIGINT NOT NULL PRIMARY KEY)",
      "CREATE TABLE uqp.DatasetNativeParameterContract(DatasetId BIGINT NOT NULL PRIMARY KEY)",
      "CREATE TABLE uqp.DatasetSensitiveColumn(Id BIGINT NOT NULL PRIMARY KEY)",
      "CREATE TABLE uqp.DatasetPatientAuditConfig(DatasetId BIGINT NOT NULL PRIMARY KEY)",
      "CREATE TABLE uqp.AuditLog(Id BIGINT NOT NULL PRIMARY KEY)",
      "CREATE TABLE uqp.SchemaMigration(FileName NVARCHAR(255) NOT NULL PRIMARY KEY)",
    ];
    for(const command of setup)await pool.request().batch(command);
    for(const name of names)await pool.request().input("fileName",sql.NVarChar(255),name)
      .query("INSERT INTO uqp.SchemaMigration(FileName) VALUES(@fileName)");

    // An explicit target attestation mismatch is safe even in preflight.
    rejection(await execute("preflight",info.ServerName,{UQP_923_EXPECTED_DATABASE:"WRONG_TARGET"}),
      "923_TARGET_ATTESTATION_MISMATCH");
    success(await execute("preflight",info.ServerName),"923_PREFLIGHT=READY");
    rejection(await execute("apply",info.ServerName),"923_EXPLICIT_APPROVAL_AND_BACKUP_REQUIRED");
    const noInstall=await pool.request()
      .query("SELECT COUNT(*) AS C FROM uqp.SchemaMigration WHERE FileName=N'923_dataset_metadata.sql'");
    assert.equal(noInstall.recordset[0]?.C,0);
    success(await execute("apply",info.ServerName,{},true),
      "923_APPLY=COMMITTED_EXACT_MATCH_NO_DELIVERY_AUTHORITY");
    success(await execute("verify",info.ServerName),
      "923_VERIFY=INSTALLED_EXACT_MATCH_LEDGER_PRESENT");
    rejection(await execute("apply",info.ServerName,{},true),
      "923_ALREADY_INSTALLED_NO_MUTATION");

    const ledger=await pool.request()
      .query("SELECT COUNT(*) AS C FROM uqp.SchemaMigration WHERE FileName=N'923_dataset_metadata.sql'");
    assert.equal(ledger.recordset[0]?.C,1);
    console.log("UQP923_MANUAL_INSTALL_SYNTHETIC: PREFLIGHT_APPLY_VERIFY_REENTRY_SUCCESS");
    console.log("UQP923_MANUAL_INSTALL_PRODUCTION=NOT_RUN; DELIVERY_ALLOWED=false");
  }finally{
    if(pool)await pool.close().catch(()=>undefined);
    if(created){
      // Only the name created above on the verified disposable Actions server.
      await master.request().batch(`ALTER DATABASE [${secondDb}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
        DROP DATABASE [${secondDb}]`).catch(()=>undefined);
    }
  }
}
