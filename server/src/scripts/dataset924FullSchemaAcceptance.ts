/** GitHub Actions disposable SQL Server 2019 only. Runs all real migrations, never simplified parent tables. */
import assert from "node:assert/strict";
import {readFile,readdir} from "node:fs/promises";
import {createHash,randomBytes,randomUUID} from "node:crypto";
import {spawn} from "node:child_process";
import sql from "mssql";
import jwt from "jsonwebtoken";
import {env} from "../config/env.js";
import {render923CatalogSql} from "../modules/dataset/datasetMetadata923Catalog.js";
import {render924CatalogSql,bindingTable,read924Draft} from "../modules/dataset/datasetMetadata924Catalog.js";
import {createDatasetScopeManagement} from "../modules/dataset/datasetScopeManagement.repository.js";
import {scopeCommand,type ScopeCommand} from "../modules/dataset/datasetScopeManagement.js";
const machine="uqp-924-full-schema",db="UQP924_CI_FULL",port=14334;
const datasetId="9007199254740993",ownerId="9007199254740995",reviewerId="302",actorId="303";
let stage="PRECHECK";
const digest=(v:string)=>createHash("sha256").update(v).digest("hex");
function check(ok:unknown,label:string):asserts ok {if(!ok)throw Error(label);}
async function cli(which:"923"|"924",mode:string,approval=true,extra:Record<string,string>={}){
  const e={...process.env,PLATFORM_DB_SERVER:"127.0.0.1",PLATFORM_DB_PORT:String(port),PLATFORM_DB_DATABASE:db,
    PLATFORM_DB_USER:"sa",PLATFORM_DB_PASSWORD:process.env.UQP_924_CI_PASSWORD!,PLATFORM_DB_ENCRYPT:"true",PLATFORM_DB_TRUST_SERVER_CERTIFICATE:"true",
    [`UQP_${which}_EXPECTED_SERVER`]:machine,[`UQP_${which}_EXPECTED_DATABASE`]:db,[`UQP_${which}_EXPECTED_LOGIN`]:"sa",
    [`UQP_${which}_APPROVE_INSTALL`]:approval?(which==="923"?"I_APPROVE_REBUILT_UQP_923":"I_APPROVE_ISOLATED_924"):"",
    [`UQP_${which}_BACKUP_VERIFIED`]:approval?"YES":"",UQP_924_MAINTENANCE_APPROVED:approval?"YES":"",...extra};
  return new Promise<{exit:number|null;out:string;err:string}>((resolve,reject)=>{
    const child=spawn(process.execPath,["--import","tsx",`src/scripts/installDataset${which}.ts`,mode,...(mode==="apply"?["--confirm"]:[])],{env:e,shell:false,stdio:["ignore","pipe","pipe"]});
    let out="",err="";child.stdout.on("data",b=>{out+=b;});child.stderr.on("data",b=>{err+=b;});
    child.on("error",reject);child.on("close",exit=>resolve({exit,out,err}));
  });
}
function passed(r:{exit:number|null;out:string},marker:string){check(r.exit===0&&r.out.includes(marker),"CLI_"+marker);}
function rejected(r:{exit:number|null;err:string},marker?:string){check(r.exit!==0&&(!marker||r.err.includes(marker)),"CLI_REJECTION_"+(marker??"EXPECTED"));}
async function catalog(pool:sql.ConnectionPool){
  const r=(await pool.request().query(render924CatalogSql())).recordset[0];
  if(r.CatalogStatus!=="EXACT_MATCH"&&r.CatalogStatus!=="NOT_INSTALLED"){
    // Synthetic fixed schema only. Capture persisted CHECK bytes to review the SQL2019 serializer; no business inputs.
    const c=(await pool.request().query(`SELECT definition,is_disabled,is_not_trusted,is_not_for_replication,parent_column_id,is_system_named,uses_database_collation
      FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID(N'uqp.DatasetSecurityScopeBinding')`)).recordset;
    console.error("924_SYNTHETIC_CHECK_CATALOG="+JSON.stringify(c));
    console.error("924_CATALOG_COUNTS="+JSON.stringify({missing:String(r.MissingDefinitionCount),extra:String(r.UnexpectedDefinitionCount)}));
  }
  return r.CatalogStatus;
}
async function businessSnapshot(pool:sql.ConnectionPool){
  const names=(await pool.request().query("SELECT name FROM sys.tables WHERE schema_id=SCHEMA_ID(N'uqp') AND name NOT IN(N'SchemaMigration',N'Permission',N'DatasetSecurityScopeBinding') ORDER BY name")).recordset;
  const result:Record<string,string>={};
  const priorStage=stage;
  for(const {name} of names){stage="BUSINESS_SNAPSHOT_"+name;check(/^[A-Za-z0-9_]+$/.test(name),"FIXED_TABLE_NAME");
    const r=await pool.request().query(`SELECT (SELECT * FROM uqp.[${name}] FOR JSON PATH,INCLUDE_NULL_VALUES) AS Payload`);
    result[name]=digest(JSON.stringify((JSON.parse(r.recordset[0].Payload) as unknown[]).map(v=>JSON.stringify(v)).sort()));
  }
  stage=priorStage;return result;
}
async function main(){
  check(process.env.GITHUB_ACTIONS==="true"&&process.env.UQP_924_CI_EPHEMERAL==="1"&&!!process.env.UQP_924_CI_PASSWORD,"CI_ONLY");
  // Fixed loopback target, never reads PLATFORM_DB_* or .env connection settings.
  const config:sql.config={server:"127.0.0.1",port,user:"sa",password:process.env.UQP_924_CI_PASSWORD!,database:"master",
    options:{encrypt:true,trustServerCertificate:true},pool:{min:0,max:4},connectionTimeout:2000,requestTimeout:30000};
  let master:sql.ConnectionPool|undefined;
  for(let n=0;n<40;n++){try{master=await new sql.ConnectionPool(config).connect();break;}catch{await new Promise(r=>setTimeout(r,1000));}}
  check(master,"CI_STARTUP_FAILED");
  let root:sql.ConnectionPool|undefined,app:sql.ConnectionPool|undefined,created=false;
  const secret=env.JWT_SECRET;
  try{
    stage="IDENTITY";
    const identity=(await master.request().query(`SELECT @@SERVERNAME S,DB_NAME() D,ORIGINAL_LOGIN() L,
      CONVERT(nvarchar(128),SERVERPROPERTY(N'MachineName')) M,CONVERT(int,SERVERPROPERTY(N'ProductMajorVersion')) V,DB_ID(N'${db}') Existing`)).recordset[0];
    check(identity.S===machine&&identity.M===machine&&identity.D==="master"&&identity.L==="sa"&&identity.V===15&&identity.Existing===null,"CI_IDENTITY");
    await master.request().batch(`CREATE DATABASE [${db}]; ALTER DATABASE [${db}] SET COMPATIBILITY_LEVEL=150;`);created=true;
    root=await new sql.ConnectionPool({...config,database:db}).connect();
    await root.request().batch("CREATE SCHEMA uqp");
    await root.request().batch("CREATE TABLE uqp.SchemaMigration(FileName NVARCHAR(255) NOT NULL PRIMARY KEY,AppliedAtUtc DATETIME2(0) NOT NULL DEFAULT SYSUTCDATETIME())");
    const folder=new URL("../../../database/migrations/",import.meta.url);
    const files=(await readdir(folder)).filter(n=>/^\d+_.*\.sql$/i.test(n)).sort();
    check(files.length===48&&files.at(-1)==="921_datasource_native_parameter_versions.sql","FULL_SOURCE_MANIFEST");
    for(const file of files){
      stage="MIGRATION_"+file.slice(0,3);const tx=new sql.Transaction(root);let aborted=false;tx.on("rollback",()=>{aborted=true;});await tx.begin();
      try{
        for(const batch of (await readFile(new URL(file,folder),"utf8")).split(/^\s*GO\s*$/gim).map(x=>x.trim()).filter(Boolean))await new sql.Request(tx).batch(batch);
        await new sql.Request(tx).input("f",sql.NVarChar(255),file).query("INSERT uqp.SchemaMigration(FileName) VALUES(@f)");await tx.commit();
      }catch(e){if(!aborted)await tx.rollback().catch(()=>undefined);throw e;}
    }
    check((await root.request().query("SELECT COUNT(*) C FROM sys.tables WHERE schema_id=SCHEMA_ID(N'uqp')")).recordset[0].C===46,"FULL_TABLE_COUNT");
    stage="INSTALL_923";passed(await cli("923","apply"),"923_APPLY=COMMITTED_EXACT_MATCH_NO_DELIVERY_AUTHORITY");
    check((await root.request().query(render923CatalogSql())).recordset[0].CatalogStatus==="EXACT_MATCH","923_BASELINE");
    stage="SYNTHETIC_BUSINESS_FIXTURE";
    await root.request().batch(`SET IDENTITY_INSERT uqp.AppUser ON;
      INSERT uqp.AppUser(Id,Username,DisplayName,PasswordHash) VALUES(303,N'ci-admin',N'SYNTHETIC_ADMIN',N'SYNTHETIC_NOT_A_PASSWORD_HASH'),
      (302,N'ci-reviewer',N'SYNTHETIC_REVIEWER',NULL),(${ownerId},N'ci-owner',N'SYNTHETIC_OWNER',NULL); SET IDENTITY_INSERT uqp.AppUser OFF;
      INSERT uqp.UserRole(UserId,RoleId) SELECT 303,Id FROM uqp.Role WHERE Code=N'SYSTEM_ADMIN';
      SET IDENTITY_INSERT uqp.DataSource ON;
      INSERT uqp.DataSource(Id,Code,Name,Type,Host,Port,Username,EncryptedPassword) VALUES
      (201,N'CI_A',N'SYNTHETIC_A',N'SQLSERVER',N'invalid.invalid',1433,N'SYNTHETIC',N'NOT_A_CREDENTIAL'),
      (202,N'CI_B',N'SYNTHETIC_B',N'SQLSERVER',N'invalid.invalid',1433,N'SYNTHETIC',N'NOT_A_CREDENTIAL'); SET IDENTITY_INSERT uqp.DataSource OFF;
      SET IDENTITY_INSERT uqp.Dataset ON;
      INSERT uqp.Dataset(Id,Code,Name,DataSourceId,SqlText) VALUES(${datasetId},N'CI_DATASET',N'SYNTHETIC',201,N'SELECT 1 AS SyntheticValue');SET IDENTITY_INSERT uqp.Dataset OFF;
      INSERT uqp.QueryDefinition(Code,Name,DatasetId) VALUES(N'CI_QUERY',N'SYNTHETIC',${datasetId});
      INSERT uqp.Dashboard(Code,Name,QueryDefinitionId) SELECT N'CI_DASHBOARD',N'SYNTHETIC',Id FROM uqp.QueryDefinition WHERE Code=N'CI_QUERY';
      INSERT uqp.DashboardDataSource(DashboardId,SourceKey,DatasetId) SELECT Id,N'SYNTHETIC_SOURCE',${datasetId} FROM uqp.Dashboard WHERE Code=N'CI_DASHBOARD';`);
    await root.request().batch(`SET IDENTITY_INSERT uqp.AuditLog ON;
      INSERT uqp.AuditLog(Id,EventType,Status,UserId,DatasetId,ParametersJson) VALUES(9007199254740993,N'SYNTHETIC_PRESERVED',N'SUCCESS',303,${datasetId},N'{"synthetic":true}');
      SET IDENTITY_INSERT uqp.AuditLog OFF;`);
    const before=await businessSnapshot(root);
    stage="924_ABSENT";check(await catalog(root)==="NOT_INSTALLED","924_ABSENT");
    passed(await cli("924","preflight"),"924_PREFLIGHT=READY");
    rejected(await cli("924","apply",false),"924_EXPLICIT_ISOLATION_BACKUP_APPROVAL_REQUIRED");
    rejected(await cli("924","preflight",true,{UQP_924_EXPECTED_SERVER:"WRONG"}),"924_TARGET_ATTESTATION_MISMATCH");
    stage="924_PARTIAL";
    await root.request().batch(`CREATE TABLE uqp.${bindingTable}(WrongColumn INT)`);
    rejected(await cli("924","apply"),"924_PARTIAL_UNRECORDED_OR_DIFFERENT");
    await root.request().batch(`DROP TABLE uqp.${bindingTable}`);
    stage="924_DDL_ROLLBACK";
    await root.request().query("ALTER TABLE uqp.Permission ADD CONSTRAINT CK_Ci924_FailSecondCapability CHECK(Code<>N'CONFIRM_DATASET_CLASSIFICATION')");
    rejected(await cli("924","apply"));
    check(await catalog(root)==="NOT_INSTALLED","DDL_FAILURE_LEFT_TABLE");
    check((await root.request().query("SELECT COUNT(*) C FROM uqp.Permission WHERE Code IN(N'MANAGE_DATASET_SECURITY_SCOPE',N'CONFIRM_DATASET_CLASSIFICATION')")).recordset[0].C===0,"DDL_FAILURE_LEFT_PERMISSION");
    check((await root.request().query("SELECT COUNT(*) C FROM uqp.SchemaMigration WHERE FileName=N'924_dataset_security_scope_binding.sql'")).recordset[0].C===0,"DDL_FAILURE_LEFT_LEDGER");
    await root.request().query("ALTER TABLE uqp.Permission DROP CONSTRAINT CK_Ci924_FailSecondCapability");
    stage="924_REFERENCE_ROUNDTRIP";
    const probe=new sql.Transaction(root);await probe.begin();
    try{
      await new sql.Request(probe).batch(await read924Draft());
      const result=(await new sql.Request(probe).query(render924CatalogSql())).recordset[0];
      if(result.CatalogStatus!=="EXACT_MATCH"){
        const query=render924CatalogSql(),offset=query.lastIndexOf("\nSELECT CASE WHEN v.ok");
        check(offset>0,"CATALOG_PROJECTION");
        const drift=(await new sql.Request(probe).query(query.slice(0,offset)+" SELECT N'MISSING' Side,* FROM Missing UNION ALL SELECT N'UNEXPECTED' Side,* FROM Unexpected;")).recordset;
        console.error("924_SYNTHETIC_SCHEMA_DRIFT="+JSON.stringify(drift));
      }
      check(result.CatalogStatus==="EXACT_MATCH","REFERENCE_CATALOG_MISMATCH");
    }finally{await probe.rollback();}
    stage="924_APPLY";
    const applied=await cli("924","apply");
    if(applied.exit!==0)await catalog(root);
    passed(applied,"924_APPLY=COMMITTED_EXACT_MATCH_NO_SCOPE_GRANTS");
    passed(await cli("924","verify"),"924_VERIFY=INSTALLED_EXACT_MATCH_923_UNCHANGED");
    rejected(await cli("924","apply"),"924_ALREADY_INSTALLED_NO_MUTATION");
    check(await catalog(root)==="EXACT_MATCH","924_EXACT");
    assert.deepEqual(await businessSnapshot(root),before);
    check((await root.request().query("SELECT COUNT(*) C FROM uqp.RolePermission rp JOIN uqp.Permission p ON p.Id=rp.PermissionId WHERE p.Code IN(N'MANAGE_DATASET_SECURITY_SCOPE',N'CONFIRM_DATASET_CLASSIFICATION')")).recordset[0].C===0,"AUTOMATIC_GRANTS");
    stage="924_CATALOG_DRIFT";
    for(const mutation of [
      `ALTER TABLE uqp.${bindingTable} NOCHECK CONSTRAINT CK_${bindingTable}_Values`,
      `ALTER TABLE uqp.${bindingTable} ADD ExtraColumn INT NULL`,
      `ALTER TABLE uqp.${bindingTable} NOCHECK CONSTRAINT FK_${bindingTable}_User`,
      `CREATE INDEX IX_CiUnexpected ON uqp.${bindingTable}(UserId)`,
    ]){
      const tx=new sql.Transaction(root);await tx.begin();
      try{await new sql.Request(tx).query(mutation);check((await new sql.Request(tx).query(render924CatalogSql())).recordset[0].CatalogStatus==="REJECTED_PARTIAL_OR_DIFFERENT","DRIFT_ACCEPTED");}finally{await tx.rollback();}
    }
    stage="924_CHECK_FK_BOUNDARIES";
    const valid=[datasetId,ownerId,"N'OWNER'","0x0101010101010101","1","0x0101010101010101","0x0101010101010101","NULL","NULL","NEWID()"];
    const cases=[valid,...[[0,"0"],[2,"N'OWNER '"],[3,"0x0000000000000000"],[4,"0"],[5,"NULL"],[7,"0x0101010101010101"],[8,"1"],[0,"9223372036854775807"]].map(([i,value])=>valid.map((v,n)=>n===i?String(value):v))];
    for(const [i,values] of cases.entries()){
      const r=await root.request().batch(`BEGIN TRAN; BEGIN TRY INSERT uqp.${bindingTable} VALUES(${values.join(",")});
        ROLLBACK; SELECT 1 AS Accepted; END TRY BEGIN CATCH IF XACT_STATE()<>0 ROLLBACK; SELECT 0 AS Accepted,ERROR_NUMBER() AS N; END CATCH`);
      check(r.recordset[0]?.Accepted===(i===0?1:0),"BINDING_CHECK_OR_FK_BOUNDARY");
    }
    stage="RUNTIME_LEAST_PRIVILEGE";
    const login="Scope924_"+randomBytes(8).toString("hex"),password="Ci!"+randomBytes(24).toString("hex")+"Z";
    await master.request().batch(`CREATE LOGIN [${login}] WITH PASSWORD=N'${password}',CHECK_POLICY=OFF;`);
    await root.request().batch(`CREATE USER [${login}] FOR LOGIN [${login}];
      ${["AppUser","Role","Permission","UserRole","RolePermission","Dataset","DataSource","DatasetSecurityScope","DatasetSecurityScopeBinding","DatasetSecurityDecision","AuditLog","AuditLogArchive"].map(t=>`GRANT SELECT ON OBJECT::uqp.${t} TO [${login}];`).join("\n")}
      GRANT INSERT,UPDATE ON OBJECT::uqp.DatasetSecurityScope TO [${login}];
      GRANT INSERT,DELETE ON OBJECT::uqp.DatasetSecurityScopeBinding TO [${login}];
      GRANT INSERT ON OBJECT::uqp.DatasetSecurityDecision TO [${login}]; GRANT INSERT ON OBJECT::uqp.AuditLog TO [${login}];
      GRANT VIEW DEFINITION ON OBJECT::uqp.DatasetSecurityScopeBinding TO [${login}];
      GRANT VIEW DEFINITION ON OBJECT::uqp.DatasetSecurityDecision TO [${login}];
      INSERT uqp.Role(Code,Name) VALUES(N'CI_CLASSIFY',N'SYNTHETIC');
      INSERT uqp.RolePermission(RoleId,PermissionId) SELECT r.Id,p.Id FROM uqp.Role r CROSS JOIN uqp.Permission p WHERE r.Code=N'CI_CLASSIFY' AND p.Code=N'CONFIRM_DATASET_CLASSIFICATION';
      INSERT uqp.UserRole(UserId,RoleId) SELECT u.Id,r.Id FROM uqp.AppUser u CROSS JOIN uqp.Role r WHERE u.Id IN(302,${ownerId}) AND r.Code=N'CI_CLASSIFY';
      INSERT uqp.RolePermission(RoleId,PermissionId) SELECT r.Id,p.Id FROM uqp.Role r CROSS JOIN uqp.Permission p WHERE r.Code=N'SYSTEM_ADMIN' AND p.Code=N'MANAGE_DATASET_SECURITY_SCOPE';`);
    app=await new sql.ConnectionPool({...config,database:db,user:login,password,pool:{min:0,max:4}}).connect();
    const rights=(await app.request().query(`SELECT IS_SRVROLEMEMBER(N'sysadmin') SA,IS_MEMBER(N'db_owner') DO,
      HAS_PERMS_BY_NAME(NULL,N'SERVER',N'VIEW SERVER STATE') VS,HAS_PERMS_BY_NAME(DB_NAME(),N'DATABASE',N'CONTROL') CT,
      HAS_PERMS_BY_NAME(N'uqp',N'SCHEMA',N'ALTER') AL`)).recordset[0];
    check(Object.values(rights).every(v=>v===0),"EXCESS_RUNTIME_PRIVILEGE");
    check((await app.request().query(render924CatalogSql())).recordset[0].CatalogStatus==="REJECTED_UNKNOWN","NON_DBO_CATALOG_MUST_NOT_CLAIM_EXACT");
    env.JWT_SECRET=randomBytes(32).toString("hex");
    const inc=randomUUID(),store=createDatasetScopeManagement({pool:async()=>app!,enabled:()=>true,incarnation:()=>inc});
    const token=(id=actorId,tv=1)=>"Bearer "+jwt.sign({sub:id,tokenVersion:tv,roles:["SYSTEM_ADMIN"],permissions:["MANAGE_DATASET_SECURITY_SCOPE"]},env.JWT_SECRET!);
    let auth=token();const snapshot=()=>store.list(auth,datasetId);
    const command=async(user:string,kind:"OWNER"|"REVIEWER",action:"GRANT"|"REVOKE"="GRANT"):Promise<ScopeCommand>=>{
      const s=await snapshot(),parent=s.scopes.find(x=>x.userId===ownerId&&x.kind==="OWNER");
      return scopeCommand.parse({requestId:randomUUID(),action,expectedVersion:s.scopes.find(x=>x.userId===user&&x.kind===kind)?.version??"MISSING",
        definitionVersion:s.dataset.definitionVersion,configurationVersion:s.dataset.configurationVersion,
        parentOwnerUserId:kind==="REVIEWER"&&action==="GRANT"?ownerId:null,parentOwnerVersion:kind==="REVIEWER"&&action==="GRANT"?parent?.version:null});
    };
    const grantOwner=async()=>store.mutate(auth,datasetId,ownerId,"OWNER",await command(ownerId,"OWNER"));
    stage="924_REAL_OWNER_WRITER";
    check((await snapshot()).scopes.length===0,"GLOBAL_PERMISSION_CREATED_SCOPE");
    await assert.rejects(()=>store.list(token(reviewerId),datasetId),{code:"SCOPE_ADMIN_REQUIRED"});
    const first=await command(ownerId,"OWNER"),written=await store.mutate(auth,datasetId,ownerId,"OWNER",first);
    check(written.deliveryAllowed===false&&BigInt(written.auditLogId)>9007199254740991n,"DELIVERY_OR_EXACT_AUDIT_ID");
    check((await store.mutate(auth,datasetId,ownerId,"OWNER",first)).replayed,"REPLAY");
    await assert.rejects(()=>store.mutate(auth,datasetId,ownerId,"OWNER",{...first,action:"REVOKE"}),{code:"SCOPE_REQUEST_CONFLICT"});
    await store.mutate(auth,datasetId,reviewerId,"REVIEWER",await command(reviewerId,"REVIEWER"));
    check((await snapshot()).scopes.every(s=>s.effective),"REVIEWER_NOT_EFFECTIVE");
    stage="924_REAL_ATOMICITY";
    const counts=async()=>(await root!.request().query(`SELECT (SELECT COUNT(*) FROM uqp.AuditLog) A,(SELECT COUNT(*) FROM uqp.DatasetSecurityDecision) D`)).recordset[0];
    for(const object of ["AuditLog","DatasetSecurityDecision"]){
      const head=await snapshot(),n=await counts();await root.request().query(`DENY INSERT ON OBJECT::uqp.${object} TO [${login}]`);
      await assert.rejects(grantOwner);await root.request().query(`REVOKE INSERT ON OBJECT::uqp.${object} FROM [${login}]`);
      // Restore only the object INSERT grant removed by REVOKE; no db_datawriter role exists.
      await root.request().query(`GRANT INSERT ON OBJECT::uqp.${object} TO [${login}]`);
      assert.deepEqual(await snapshot(),head);assert.deepEqual(await counts(),n);
    }
    await assert.rejects(()=>app!.request().query("UPDATE uqp.DatasetSecurityDecision SET ReasonCode=ReasonCode"));
    await assert.rejects(()=>app!.request().query("DELETE FROM uqp.DatasetSecurityDecision"));
    stage="924_REAL_CAS";const same=await command(ownerId,"OWNER");
    const competing=await Promise.allSettled([store.mutate(auth,datasetId,ownerId,"OWNER",same),store.mutate(auth,datasetId,ownerId,"OWNER",{...same,requestId:randomUUID()})]);
    check(competing.filter(r=>r.status==="fulfilled").length===1,"CAS_MULTIPLE_SUCCESS");
    check(!(await snapshot()).scopes.find(s=>s.userId===reviewerId)?.effective,"PARENT_VERSION_RESURRECTED");
    await store.mutate(auth,datasetId,reviewerId,"REVIEWER",await command(reviewerId,"REVIEWER"));
    await store.mutate(auth,datasetId,ownerId,"OWNER",await command(ownerId,"OWNER","REVOKE"));
    check((await snapshot()).scopes.every(s=>!s.effective),"PARENT_REVOKE");await grantOwner();
    check(!(await snapshot()).scopes.find(s=>s.userId===reviewerId)?.effective,"PARENT_REGRANT_RESURRECTED");
    stage="924_REVOCATION_VECTORS";
    for(const mutation of [
      `UPDATE uqp.AppUser SET IsActive=0,TokenVersion=TokenVersion+1 WHERE Id=${ownerId}; UPDATE uqp.AppUser SET IsActive=1,TokenVersion=TokenVersion+1 WHERE Id=${ownerId}`,
      `UPDATE uqp.AppUser SET TokenVersion=TokenVersion+1 WHERE Id=${ownerId}`,
      `UPDATE uqp.Dataset SET DataSourceId=202 WHERE Id=${datasetId}; UPDATE uqp.Dataset SET DataSourceId=201 WHERE Id=${datasetId}`,
      "UPDATE uqp.DataSource SET Name=N'SYNTHETIC_CHANGED' WHERE Id=201",
    ]){await root.request().query(mutation);check(!(await snapshot()).scopes.find(s=>s.userId===ownerId)?.effective,"REVOCATION_ABA");await grantOwner();}
    await root.request().query(`UPDATE uqp.AppUser SET TokenVersion=TokenVersion+1 WHERE Id=${actorId}`);
    await assert.rejects(snapshot,{code:"TOKEN_REVOKED"});auth=token(actorId,2);
    const h=await store.history(auth,datasetId,first.requestId);check(h.decisions.length===1&&h.decisions[0].auditLogId===written.auditLogId,"AUDIT_DECISION_LINK");
    stage="924_ARCHIVE_RECEIPT_RELATION";
    await root.request().input("auditId",sql.VarChar(20),written.auditLogId).query(`BEGIN TRAN;
      INSERT uqp.AuditLogArchive(Id,EventType,EventCategory,IsImportant,UserId,DatasetId,Status,ParametersJson,CreatedAtUtc,CompletedAtUtc)
        SELECT Id,EventType,EventCategory,IsImportant,UserId,DatasetId,Status,ParametersJson,CreatedAtUtc,CompletedAtUtc
        FROM uqp.AuditLog WHERE Id=CONVERT(bigint,@auditId);
      DELETE uqp.AuditLog WHERE Id=CONVERT(bigint,@auditId);COMMIT;`);
    check((await store.mutate(auth,datasetId,ownerId,"OWNER",first)).replayed,"ARCHIVE_RELATION_LOST");
    await root.request().input("auditId",sql.VarChar(20),written.auditLogId).query("DELETE uqp.AuditLogArchive WHERE Id=CONVERT(bigint,@auditId)");
    await assert.rejects(()=>store.mutate(auth,datasetId,ownerId,"OWNER",first),{code:"SCOPE_AUDIT_HISTORY_MISSING"});
    stage="FINAL_923_924_COMPATIBILITY";
    check(await catalog(root)==="EXACT_MATCH","924_FINAL");
    check((await root.request().query(render923CatalogSql())).recordset[0].CatalogStatus==="EXACT_MATCH","923_CHANGED");
    console.log("F2_924_FULL_SCHEMA: 48_REAL_MIGRATIONS_PLUS_923; EXACT_924; CLI_REENTRY_PARTIAL_ROLLBACK; BUSINESS_DATA_PRESERVED; RESTRICTED_RUNTIME_NO_SERVER_STATE; OWNER_REVIEWER_CAS_AUDIT_ATOMICITY_PASS");
    console.log("SOURCE_BOUND=false; SQL_LOCK_VERIFIED=false; deliveryAllowed=false; USER_DATABASES_NOT_TOUCHED");
  }finally{
    env.JWT_SECRET=secret;if(app)await app.close();if(root)await root.close();
    if(created){const i=(await master.request().query("SELECT CONVERT(nvarchar(128),SERVERPROPERTY(N'MachineName')) M,DB_NAME() D")).recordset[0];
      check(i.M===machine&&i.D==="master","CI_CLEANUP_TARGET");
      await master.request().batch(`ALTER DATABASE [${db}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;DROP DATABASE [${db}]`);
    }await master.close();
  }
}
main().catch(e=>{console.error(`F2_924_FAILED stage=${stage};type=${e instanceof SyntaxError?"SYNTAX":e instanceof TypeError?"TYPE":"OTHER"};code=${typeof e?.code==="string"&&/^[A-Z0-9_]+$/.test(e.code)?e.code:"CHECK_FAILED"};number=${Number.isSafeInteger(e?.number)?e.number:0}`);process.exitCode=1;});
