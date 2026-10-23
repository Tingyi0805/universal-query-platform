/** New management Writer acceptance only in the existing disposable CI container. Never imports/uses platform DB config. */
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {randomUUID,randomBytes} from "node:crypto";
import sql from "mssql";
import jwt from "jsonwebtoken";
import {env} from "../config/env.js";
import {createDatasetScopeManagement} from "../modules/dataset/datasetScopeManagement.repository.js";
import {scopeCommand,type ScopeCommand} from "../modules/dataset/datasetScopeManagement.js";
import {render923CatalogSql} from "../modules/dataset/datasetMetadata923Catalog.js";

export async function testDatasetScopeManagementInDisposableSql2019(root:sql.ConnectionPool){
  const config=(root as unknown as {config:sql.config}).config;
  if(process.env.GITHUB_ACTIONS!=="true"||process.env.UQP_923_CI_EPHEMERAL!=="1"||config.server!=="127.0.0.1"||config.port!==14333)
    throw Error("SCOPE_CI_ISOLATION_REQUIRED");
  const target=(await root.request().query("SELECT DB_NAME() AS Db,CONVERT(nvarchar(128),SERVERPROPERTY(N'MachineName')) AS Machine")).recordset[0];
  assert.equal(target.Db,"UQP923_CI_SYNTHETIC");assert.equal(target.Machine,"uqp-923-ephemeral");
  const login=`ScopeCi_${randomBytes(8).toString("hex")}`,password=`Ci!${randomBytes(24).toString("hex")}Z`;
  const master=await new sql.ConnectionPool({...config,database:"master"}).connect();
  let app:sql.ConnectionPool|undefined;
  const secret=env.JWT_SECRET;env.JWT_SECRET=randomBytes(32).toString("hex");
  const datasetId="9007199254740993",ownerId="9007199254740995",reviewerId="302",actorId="303",incarnation=randomUUID();
  try{
    // Extend synthetic parent fixtures only, after all existing 923/F2/F5 rehearsals have completed.
    await root.request().batch(`ALTER TABLE uqp.Dataset ADD Name NVARCHAR(200) NOT NULL DEFAULT N'SYNTHETIC',DefinitionRowVersion ROWVERSION NOT NULL;
      ALTER TABLE uqp.DataSource ADD ConfigurationRowVersion ROWVERSION NOT NULL;
      ALTER TABLE uqp.AppUser ADD DisplayName NVARCHAR(200) NOT NULL DEFAULT N'SYNTHETIC';
      ALTER TABLE uqp.Permission ADD Name NVARCHAR(100) NOT NULL DEFAULT N'SYNTHETIC',Description NVARCHAR(500) NULL;
      CREATE SEQUENCE uqp.CiPermissionSequence AS BIGINT START WITH 1000;
      ALTER TABLE uqp.Permission ADD CONSTRAINT DF_CiScopePermission DEFAULT(NEXT VALUE FOR uqp.CiPermissionSequence) FOR Id;
      INSERT uqp.Dataset(Id,DataSourceId,Name) VALUES(${datasetId},202,N'SYNTHETIC_EXACT_DATASET');
      INSERT uqp.AppUser(Id,DisplayName) VALUES(${ownerId},N'SYNTHETIC_EXACT_OWNER'),(${actorId},N'SYNTHETIC_ADMIN');
      INSERT uqp.UserRole(UserId,RoleId) VALUES(${ownerId},1);
      INSERT uqp.Role(Id,Code,IsActive,IsSystem) VALUES(2,N'SYSTEM_ADMIN',1,1);
      INSERT uqp.UserRole(UserId,RoleId) VALUES(${actorId},2);`);
    const draft=await readFile(new URL("../../../database/drafts/924_dataset_security_scope_binding.sql",import.meta.url),"utf8");
    await root.request().batch(draft);
    const catalog=(await root.request().query(render923CatalogSql())).recordset[0];
    assert.equal(catalog.CatalogStatus??catalog.state??catalog.State??catalog.status,"EXACT_MATCH");
    assert.equal((await root.request().query("SELECT COUNT(*) AS C FROM uqp.RolePermission rp JOIN uqp.Permission p ON p.Id=rp.PermissionId WHERE p.Code=N'MANAGE_DATASET_SECURITY_SCOPE'")).recordset[0].C,0);
    await root.request().query("INSERT uqp.RolePermission(RoleId,PermissionId) SELECT 2,Id FROM uqp.Permission WHERE Code=N'MANAGE_DATASET_SECURITY_SCOPE'");
    // Dedicated, non-dbo application identity. No user/environment connection credentials are reused or printed.
    await master.request().batch(`CREATE LOGIN [${login}] WITH PASSWORD=N'${password}',CHECK_POLICY=OFF; GRANT VIEW SERVER STATE TO [${login}];`);
    await root.request().batch(`CREATE USER [${login}] FOR LOGIN [${login}]; ALTER ROLE db_datareader ADD MEMBER [${login}];
      ALTER ROLE db_datawriter ADD MEMBER [${login}]; GRANT VIEW DEFINITION TO [${login}];`);
    app=await new sql.ConnectionPool({...config,user:login,password,pool:{min:0,max:4}}).connect();
    const store=createDatasetScopeManagement({pool:async()=>app!,enabled:()=>true,incarnation:()=>incarnation});
    const token=(id=actorId,version=1)=>`Bearer ${jwt.sign({sub:id,tokenVersion:version,roles:["SYSTEM_ADMIN"],permissions:["MANAGE_DATASET_SECURITY_SCOPE"]},env.JWT_SECRET!)}`;
    let auth=token();
    const snapshot=()=>store.list(auth,datasetId);
    async function command(user:string,kind:"OWNER"|"REVIEWER",action:"GRANT"|"REVOKE"="GRANT"):Promise<ScopeCommand>{
      const current=await snapshot(),parent=current.scopes.find(s=>s.kind==="OWNER"&&s.userId===ownerId);
      return scopeCommand.parse({requestId:randomUUID(),action,expectedVersion:current.scopes.find(s=>s.userId===user&&s.kind===kind)?.version??"MISSING",
        definitionVersion:current.dataset.definitionVersion,configurationVersion:current.dataset.configurationVersion,
        parentOwnerUserId:kind==="REVIEWER"&&action==="GRANT"?ownerId:null,parentOwnerVersion:kind==="REVIEWER"&&action==="GRANT"?parent?.version:null});
    }
    async function grantOwner(){const c=await command(ownerId,"OWNER");return store.mutate(auth,datasetId,ownerId,"OWNER",c);}
    const before=await snapshot();assert.equal(before.scopes.length,0);
    await assert.rejects(()=>store.list(token(reviewerId),datasetId),{code:"SCOPE_ADMIN_REQUIRED"});
    const privileged=createDatasetScopeManagement({pool:async()=>root,enabled:()=>true,incarnation:()=>incarnation});
    await assert.rejects(()=>privileged.list(auth,datasetId),{code:"SCOPE_924_OR_IMMUTABLE_LEDGER_REQUIRED"});
    const first=await command(ownerId,"OWNER"),written=await store.mutate(auth,datasetId,ownerId,"OWNER",first);
    assert.equal(written.deliveryAllowed,false);assert.ok(BigInt(written.auditLogId)>9007199254740991n);
    assert.equal((await store.mutate(auth,datasetId,ownerId,"OWNER",first)).replayed,true);
    await assert.rejects(()=>store.mutate(auth,datasetId,ownerId,"OWNER",{...first,action:"REVOKE"}),{code:"SCOPE_REQUEST_CONFLICT"});
    assert.equal((await snapshot()).scopes[0]?.effective,true);
    await store.mutate(auth,datasetId,reviewerId,"REVIEWER",await command(reviewerId,"REVIEWER"));
    assert.ok((await snapshot()).scopes.every(s=>s.effective));
    // New repository path, not a repetition of the pre-existing low-level F5 primitive tests.
    const counts=async()=>(await root.request().query(`SELECT (SELECT COUNT_BIG(*) FROM uqp.DatasetSecurityDecision) D,(SELECT COUNT_BIG(*) FROM uqp.AuditLog) A`)).recordset[0];
    for(const object of ["AuditLog","DatasetSecurityDecision"]){
      const old=(await snapshot()).scopes.find(s=>s.userId===ownerId)!,start=await counts();
      await root.request().query(`DENY INSERT ON OBJECT::uqp.${object} TO [${login}]`);
      await assert.rejects(()=>store.mutate(auth,datasetId,ownerId,"OWNER",{...first,requestId:randomUUID(),expectedVersion:old.version,action:"REVOKE"}));
      await root.request().query(`REVOKE INSERT ON OBJECT::uqp.${object} FROM [${login}]`);
      assert.deepEqual(await counts(),start);assert.equal((await snapshot()).scopes.find(s=>s.userId===ownerId)?.version,old.version);
    }
    await assert.rejects(()=>app!.request().query("UPDATE uqp.DatasetSecurityDecision SET ReasonCode=ReasonCode"));
    await assert.rejects(()=>app!.request().query("DELETE FROM uqp.DatasetSecurityDecision"));
    const same=await command(ownerId,"OWNER"),competing=await Promise.allSettled([
      store.mutate(auth,datasetId,ownerId,"OWNER",same),store.mutate(auth,datasetId,ownerId,"OWNER",{...same,requestId:randomUUID()}),
    ]);
    assert.equal(competing.filter(r=>r.status==="fulfilled").length,1);
    assert.equal(competing.filter(r=>r.status==="rejected").length,1);
    assert.equal((await snapshot()).scopes.find(s=>s.userId===reviewerId)?.effective,false);
    await store.mutate(auth,datasetId,reviewerId,"REVIEWER",await command(reviewerId,"REVIEWER"));
    await store.mutate(auth,datasetId,ownerId,"OWNER",await command(ownerId,"OWNER","REVOKE"));
    assert.ok((await snapshot()).scopes.every(s=>!s.effective));
    await grantOwner();assert.equal((await snapshot()).scopes.find(s=>s.userId===reviewerId)?.effective,false);
    await root.request().query(`UPDATE uqp.AppUser SET IsActive=0,TokenVersion=TokenVersion+1 WHERE Id=${ownerId}`);
    assert.equal((await snapshot()).scopes.find(s=>s.userId===ownerId)?.effective,false);
    await root.request().query(`UPDATE uqp.AppUser SET IsActive=1,TokenVersion=TokenVersion+1 WHERE Id=${ownerId}`);
    assert.equal((await snapshot()).scopes.find(s=>s.userId===ownerId)?.effective,false);
    await grantOwner();
    await root.request().query(`UPDATE uqp.Role SET IsActive=0 WHERE Id=1; UPDATE uqp.AppUser SET TokenVersion=TokenVersion+1 WHERE Id IN(SELECT UserId FROM uqp.UserRole WHERE RoleId=1)`);
    assert.equal((await snapshot()).scopes.find(s=>s.userId===ownerId)?.effective,false);
    await root.request().query(`UPDATE uqp.Role SET IsActive=1 WHERE Id=1; UPDATE uqp.AppUser SET TokenVersion=TokenVersion+1 WHERE Id IN(SELECT UserId FROM uqp.UserRole WHERE RoleId=1)`);
    assert.equal((await snapshot()).scopes.find(s=>s.userId===ownerId)?.effective,false);
    await grantOwner();
    await root.request().query(`UPDATE uqp.Dataset SET DataSourceId=201 WHERE Id=${datasetId}; UPDATE uqp.Dataset SET DataSourceId=202 WHERE Id=${datasetId};`);
    assert.equal((await snapshot()).scopes.find(s=>s.userId===ownerId)?.effective,false);
    await grantOwner();
    await root.request().query(`UPDATE uqp.AppUser SET TokenVersion=TokenVersion+1 WHERE Id=${actorId}`);
    await assert.rejects(snapshot,{code:"TOKEN_REVOKED"});auth=token(actorId,2);
    const history=await store.history(auth,datasetId,first.requestId);assert.equal(history.decisions.length,1);
    assert.equal(history.decisions[0].auditLogId,written.auditLogId);
    console.log("DATASET_SCOPE_MANAGEMENT_SQL2019: EXACT_IDS CAS_REPLAY IMMUTABLE_LEDGER REAL_AUDIT_ROLLBACK PARENT_TOKEN_SOURCE_ABA_CLOSED");
    console.log("SOURCE_BOUND=false SQL_LOCK_VERIFIED=false DATA_PREVIEW=false");
  }finally{
    env.JWT_SECRET=secret;
    if(app)await app.close();
    await root.request().batch(`IF USER_ID(N'${login}') IS NOT NULL DROP USER [${login}];`).catch(()=>undefined);
    await master.request().batch(`IF SUSER_ID(N'${login}') IS NOT NULL DROP LOGIN [${login}];`).catch(()=>undefined);
    await master.close();
  }
}
