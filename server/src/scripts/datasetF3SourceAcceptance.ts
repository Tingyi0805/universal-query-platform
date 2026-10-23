/** F3 tests only inside the verified full-schema CI container; separate source DB, accounts and connections. */
import assert from "node:assert/strict";
import {randomBytes,randomUUID} from "node:crypto";
import sql from "mssql";
import jwt from "jsonwebtoken";
import {env} from "../config/env.js";
import {createDatasetScopeManagement} from "../modules/dataset/datasetScopeManagement.repository.js";
import {createDatasetFieldInitialization,initializeFieldsCommand} from "../modules/dataset/datasetFieldInitialization.repository.js";
import {acquireControlledMetadataLease,restrictedSavedSelect} from "../modules/dataset/sqlServerSourceFence.js";
import {scopeCommand} from "../modules/dataset/datasetScopeManagement.js";
const sourceDb="UQP_F3_CI_SOURCE",datasetId="9007199254740993";
export async function testF3SourceMetadata(root:sql.ConnectionPool,master:sql.ConnectionPool,config:sql.config,app:sql.ConnectionPool,appLogin:string){
  const target=(await master.request().query("SELECT @@SERVERNAME S,DB_NAME() D")).recordset[0];
  assert.equal(target.S,"uqp-924-full-schema");assert.equal(target.D,"master");assert.equal(process.env.GITHUB_ACTIONS,"true");
  let source:sql.ConnectionPool|undefined,collector:sql.ConnectionPool|undefined,ddl:sql.ConnectionPool|undefined;
  const ddlLogin="F3Ddl_"+randomBytes(8).toString("hex"),ddlPassword="Ci!"+randomBytes(24).toString("hex")+"Z";
  let phase="SOURCE_CREATE";
  try{
    await master.request().batch(`CREATE DATABASE [${sourceDb}];ALTER DATABASE [${sourceDb}] SET COMPATIBILITY_LEVEL=150;
      CREATE LOGIN [${ddlLogin}] WITH PASSWORD=N'${ddlPassword}',CHECK_POLICY=OFF;`);
    source=await new sql.ConnectionPool({...config,database:sourceDb}).connect();
    const identity=(await source.request().query("SELECT CONVERT(varchar(36),service_broker_guid) Id FROM sys.databases WHERE database_id=DB_ID()")).recordset[0].Id;
    const incarnation=randomUUID(),expected={identity,incarnation,database:sourceDb};
    await source.request().batch("CREATE SCHEMA f3");
    await source.request().batch(`CREATE TABLE f3.Records(Id INT NOT NULL PRIMARY KEY,Label NVARCHAR(30) NULL);
      CREATE TABLE f3.FenceState(Id INT NOT NULL PRIMARY KEY,SourceIdentity UNIQUEIDENTIFIER NOT NULL,Incarnation UNIQUEIDENTIFIER NOT NULL,Generation BIGINT NOT NULL,LeaseVersion BIGINT NOT NULL);
      INSERT f3.FenceState VALUES(1,'${identity}','${incarnation}',9007199254740993,1);
      CREATE USER [${appLogin}] FOR LOGIN [${appLogin}]; GRANT VIEW DEFINITION TO [${appLogin}];
      GRANT SELECT ON OBJECT::f3.FenceState TO [${appLogin}];GRANT SELECT ON OBJECT::f3.Records TO [${appLogin}];
      CREATE USER [${ddlLogin}] FOR LOGIN [${ddlLogin}];`);
    await source.request().batch(`CREATE PROCEDURE f3.ControlledDdl @Operation NVARCHAR(12) WITH EXECUTE AS OWNER AS
      BEGIN SET XACT_ABORT ON; BEGIN TRY BEGIN TRAN;
        DECLARE @r int; EXEC @r=sys.sp_getapplock @Resource=N'UQP:F3:SOURCE_GATE:V1',@LockMode=N'Exclusive',@LockOwner=N'Transaction',@DbPrincipal=N'public',@LockTimeout=300;
        IF @r IS NULL OR @r<0 THROW 52930,'CONTROLLED_GATE_TIMEOUT',1;
        IF @Operation=N'ADD' EXEC(N'ALTER TABLE f3.Records ADD Scratch INT NULL');
        ELSE IF @Operation=N'REMOVE' EXEC(N'ALTER TABLE f3.Records DROP COLUMN Scratch');
        ELSE IF @Operation=N'DROP' EXEC(N'DROP TABLE f3.Records');
        ELSE IF @Operation=N'REVOKE' REVOKE SELECT ON OBJECT::f3.Records FROM [${appLogin}];
        ELSE IF @Operation=N'GRANT' GRANT SELECT ON OBJECT::f3.Records TO [${appLogin}];
        ELSE THROW 52930,'UNKNOWN_OPERATION',1;
        UPDATE f3.FenceState SET Generation=Generation+1,LeaseVersion=LeaseVersion+1 WHERE Id=1;
        COMMIT; END TRY BEGIN CATCH IF XACT_STATE()<>0 ROLLBACK;THROW;END CATCH END;`);
    await source.request().query(`GRANT EXECUTE ON OBJECT::f3.ControlledDdl TO [${ddlLogin}]`);
    // Reuse only the CI app pool's generated credentials, never platform/user configuration.
    const appConfig=(app as unknown as {config:sql.config}).config;
    collector=await new sql.ConnectionPool({...appConfig,database:sourceDb,requestTimeout:5000,pool:{min:0,max:4}}).connect();
    ddl=await new sql.ConnectionPool({...config,database:sourceDb,user:ddlLogin,password:ddlPassword,pool:{min:0,max:2}}).connect();
    const controlled=(op:string)=>ddl!.request().input("Operation",sql.NVarChar(12),op).execute("f3.ControlledDdl");
    const acquire=()=>acquireControlledMetadataLease(collector!,expected);
    const text="SELECT [Id], [Label] FROM [f3].[Records]";
    phase="CONTROLLED_WRITER_GATE";
    let lease=await acquire(),observation=await lease.describe(text);
    assert.equal(observation.generation,"9007199254740993");assert.equal(observation.columns.length,2);
    for(const op of ["ADD","DROP","REVOKE"])await assert.rejects(()=>controlled(op));
    await lease.revalidate();await lease.close();
    await assert.rejects(()=>ddl!.request().query("ALTER TABLE f3.Records ADD Bypass INT NULL"));
    await controlled("ADD");await controlled("REMOVE");
    lease=await acquire();const aba=await lease.describe(text);
    assert.notEqual(aba.generation,observation.generation);assert.deepEqual(aba.columns,observation.columns);await lease.close();
    phase="PRIVILEGED_DDL_BYPASS";
    lease=await acquire();observation=await lease.describe(text);
    // A privileged DDL session does NOT acquire the cooperative Gate. ABA restores identical descriptors/generation.
    await source.request().query("SET LOCK_TIMEOUT 700; ALTER TABLE f3.Records ADD Untracked INT NULL;ALTER TABLE f3.Records DROP COLUMN Untracked;");
    await source.request().query(`GRANT SELECT ON OBJECT::f3.Records TO [${ddlLogin}]; REVOKE SELECT ON OBJECT::f3.Records FROM [${ddlLogin}]`);
    await lease.revalidate();assert.equal(observation.fence,"BLOCKED_PRIVILEGED_DDL_PATHS");
    console.log("F3_EXTERNAL_DBA_ALTER_ABA: BYPASSES_GATE_AND_GENERATION; TRUSTED_ISSUANCE=BLOCKED");
    await source.request().query("ALTER TABLE f3.Records ALTER COLUMN Label NVARCHAR(40) NULL");
    await assert.rejects(()=>lease.revalidate());await lease.close();
    await source.request().query("ALTER TABLE f3.Records ALTER COLUMN Label NVARCHAR(30) NULL");
    phase="PERMISSION_AND_SOURCE_LOSS";
    await controlled("REVOKE");lease=await acquire();await assert.rejects(()=>lease.describe(text));await lease.close();await controlled("GRANT");
    lease=await acquire();observation=await lease.describe(text);
    await source.request().query(`KILL ${observation.sessionId}`);await assert.rejects(()=>lease.revalidate());await lease.close().catch(()=>undefined);
    const exclusive=new sql.Transaction(ddl);await exclusive.begin();
    await new sql.Request(exclusive).query("DECLARE @r int; EXEC @r=sys.sp_getapplock @Resource=N'UQP:F3:SOURCE_GATE:V1',@LockMode=N'Exclusive',@LockOwner=N'Transaction',@DbPrincipal=N'public'");
    await assert.rejects(acquire,{code:"SOURCE_GATE_UNAVAILABLE"});await exclusive.rollback();
    phase="METADATA_SCOPE_SETUP";
    await root.request().batch(`GRANT SELECT,INSERT ON OBJECT::uqp.DatasetFieldSnapshot TO [${appLogin}];
      GRANT SELECT ON OBJECT::uqp.DatasetParameter TO [${appLogin}];GRANT SELECT ON OBJECT::uqp.DatasetNativeParameterContract TO [${appLogin}];
      INSERT uqp.UserRole(UserId,RoleId) SELECT 303,Id FROM uqp.Role WHERE Code=N'CI_CLASSIFY';
      INSERT uqp.RolePermission(RoleId,PermissionId) SELECT r.Id,p.Id FROM uqp.Role r CROSS JOIN uqp.Permission p WHERE r.Code=N'CI_CLASSIFY' AND p.Code=N'DESIGN_QUERY';
      UPDATE uqp.AppUser SET TokenVersion=TokenVersion+1 WHERE Id=303;
      UPDATE uqp.Dataset SET SqlText=N'SELECT [Id], [Label] FROM [f3].[Records]' WHERE Id=${datasetId};`);
    const tv=(await root.request().query("SELECT TokenVersion V FROM uqp.AppUser WHERE Id=303")).recordset[0].V;
    const auth="Bearer "+jwt.sign({sub:"303",tokenVersion:tv},env.JWT_SECRET!);
    const management=createDatasetScopeManagement({pool:async()=>app,enabled:()=>true,incarnation:()=>"4ebc4152-07e5-4110-a7ad-be0538a662f0"});
    const state=await management.list(auth,datasetId);
    await management.mutate(auth,datasetId,"303","OWNER",scopeCommand.parse({requestId:randomUUID(),action:"GRANT",expectedVersion:"MISSING",definitionVersion:state.dataset.definitionVersion,
      configurationVersion:state.dataset.configurationVersion,parentOwnerUserId:null,parentOwnerVersion:null}));
    const service=createDatasetFieldInitialization({management,source:async id=>{assert.equal(id,"201");return acquire();}});
    const command=async()=>{const s=await service.status(auth,datasetId);return initializeFieldsCommand.parse({requestId:randomUUID(),definitionVersion:s.dataset.definitionVersion,
      configurationVersion:s.dataset.configurationVersion,expectedSnapshotVersion:s.snapshot?.version??"MISSING"});};
    await assert.rejects(()=>service.status("Bearer "+jwt.sign({sub:"302",tokenVersion:1},env.JWT_SECRET!),datasetId),{code:"SCOPE_METADATA_AUTHORIZATION_REQUIRED"});
    phase="DESCRIBED_ATOMIC_SNAPSHOT";
    const first=await command(),written=await service.collect(auth,datasetId,first);
    assert.equal(written.metadataState,"DESCRIBED");assert.equal(written.authority,"NONE");assert.equal(written.deliveryAllowed,false);
    assert.ok(BigInt(written.auditLogId)>9007199254740991n);
    assert.equal((await service.collect(auth,datasetId,first)).replayed,true);
    const s=await service.status(auth,datasetId);assert.equal(s.snapshot?.columns.length,2);assert.equal(s.snapshot?.state,"DESCRIBED");
    await assert.rejects(()=>service.collect(auth,datasetId,{...first,requestId:randomUUID()}),{code:"METADATA_SNAPSHOT_CONFLICT"});
    const counts=async()=>(await root.request().query(`SELECT (SELECT COUNT(*) FROM uqp.DatasetFieldSnapshot) S,(SELECT COUNT(*) FROM uqp.DatasetSecurityDecision) D,(SELECT COUNT(*) FROM uqp.AuditLog) A`)).recordset[0];
    for(const table of ["AuditLog","DatasetSecurityDecision"]){
      const before=await counts(),c=await command();await root.request().query(`DENY INSERT ON OBJECT::uqp.${table} TO [${appLogin}]`);
      await assert.rejects(()=>service.collect(auth,datasetId,c));await root.request().query(`REVOKE INSERT ON OBJECT::uqp.${table} FROM [${appLogin}]; GRANT INSERT ON OBJECT::uqp.${table} TO [${appLogin}]`);
      assert.deepEqual(await counts(),before);
    }
    const stale=await command();await assert.rejects(()=>service.collect(auth,datasetId,{...stale,definitionVersion:"ffffffffffffffff"}),{code:"METADATA_VERSION_CONFLICT"});
    phase="SOURCE_INCARNATION_REJECTS";
    const beforeIdentity=await counts(),identityCommand=await command();
    await source.request().query(`UPDATE f3.FenceState SET Incarnation=NEWID() WHERE Id=1`);
    await assert.rejects(()=>service.collect(auth,datasetId,identityCommand),{code:"SOURCE_IDENTITY_CONFLICT"});
    assert.deepEqual(await counts(),beforeIdentity);
    await source.request().query(`UPDATE f3.FenceState SET Incarnation='${incarnation}',Generation=Generation+1 WHERE Id=1`);
    phase="SOURCE_LOSS_ROLLS_BACK_PLATFORM";
    const beforeLoss=await counts(),lossCommand=await command();
    const interrupted=createDatasetFieldInitialization({management,source:async()=>{
      const active=await acquire();let spid=0;
      return {describe:async text=>{const o=await active.describe(text);spid=o.sessionId;return o;},revalidate:async()=>{await source!.request().query(`KILL ${spid}`);await active.revalidate();},close:()=>active.close()};
    }});
    await assert.rejects(()=>interrupted.collect(auth,datasetId,lossCommand));assert.deepEqual(await counts(),beforeLoss);
    phase="SNAPSHOT_CONCURRENT_CAS";
    const same=await command(),competing=await Promise.allSettled([service.collect(auth,datasetId,same),service.collect(auth,datasetId,{...same,requestId:randomUUID()})]);
    assert.equal(competing.filter(r=>r.status==="fulfilled").length,1);
    phase="PLATFORM_SOURCE_VERSION_DRIFT";
    const oldCommand=await command();await root.request().query("UPDATE uqp.DataSource SET Name=N'F3_CHANGED' WHERE Id=201");
    await assert.rejects(()=>service.collect(auth,datasetId,oldCommand),{code:"SCOPE_METADATA_AUTHORIZATION_REQUIRED"});
    const rebound=await management.list(auth,datasetId),oldOwner=rebound.scopes.find(s=>s.userId==="303"&&s.kind==="OWNER")!;
    await management.mutate(auth,datasetId,"303","OWNER",scopeCommand.parse({requestId:randomUUID(),action:"GRANT",expectedVersion:oldOwner.version,
      definitionVersion:rebound.dataset.definitionVersion,configurationVersion:rebound.dataset.configurationVersion,parentOwnerUserId:null,parentOwnerVersion:null}));
    await assert.rejects(()=>service.collect(auth,datasetId,oldCommand),{code:"METADATA_VERSION_CONFLICT"});
    phase="INVALID_DEPENDENCIES_AND_NO_AUTHORITY";
    for(const invalid of ["SELECT * FROM f3.Records","SELECT Id FROM otherdb.f3.Records","SELECT dbo.fn(Id) FROM f3.Records","EXEC sys.sp_tables","SELECT Id FROM f3.Records;DROP TABLE f3.Records"])
      assert.throws(()=>restrictedSavedSelect(invalid));
    assert.equal((await root.request().query("SELECT COUNT(*) C FROM uqp.DatasetFieldSnapshot WHERE State=N'SOURCE_BOUND'")).recordset[0].C,0);
    lease=await acquire();await lease.describe(text);await source.request().query("DROP TABLE f3.Records");await assert.rejects(()=>lease.revalidate());await lease.close();
    console.log("F3_SQL2019: CONTROLLED_ALTER_DROP_PERMISSION_TIMEOUT_BLOCKED; GENERATION_ABA_DETECTED; DISCONNECT_FAIL_CLOSED; DESCRIBED_SNAPSHOT_DECISION_EXACT_AUDIT_ATOMIC; CONCURRENT_CAS_PASS");
    console.log("F3_SOURCE_BOUND=BLOCKED; EXTERNAL_DBA_FENCE=BLOCKED; SQL_LOCK_VERIFIED=false; deliveryAllowed=false; RAW_ROW_QUERIES=0");
  }catch(e){console.error("F3_PHASE="+phase);throw e;}finally{
    if(collector)await collector.close();if(ddl)await ddl.close();if(source)await source.close();
    await master.request().batch(`IF DB_ID(N'${sourceDb}') IS NOT NULL BEGIN ALTER DATABASE [${sourceDb}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;DROP DATABASE [${sourceDb}];END;`).catch(()=>undefined);
  }
}
