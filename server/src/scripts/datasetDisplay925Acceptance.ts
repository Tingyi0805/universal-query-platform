/** Invoked only by the fixed-target disposable full-schema SQL2019 CI harness. */
import sql from "mssql";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import {randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import {env} from "../config/env.js";
import {displayCatalogSql,displayDdlUrl,validateDisplayCatalog} from "../modules/dataset/datasetDisplaySchema.js";
import {installDisplay925} from "./installDataset925.js";
import {createDatasetPublicDisplayRepository,displayRepositoryDefaults} from "../modules/dataset/datasetPublicDisplay.repository.js";
import {createMaskTemplateRepository,maskTemplateInput,recordTemplateApplications} from "../modules/dataset/datasetMaskTemplate.repository.js";
import {createRuntimeIdentityVerifier} from "../modules/queryDefinition/queryDelivery.js";
import {resolveDatasetPublicDisplayMasks} from "../modules/dataset/datasetPublicDisplayPolicy.js";
export async function testDisplay925CleanCatalog(root:sql.ConnectionPool){
 assert.equal(process.env.GITHUB_ACTIONS,"true");
 const ddl=await readFile(displayDdlUrl,"utf8"),t=new sql.Transaction(root);await t.begin();
 try{await new sql.Request(t).batch(ddl);const r=await new sql.Request(t).query(displayCatalogSql);assert.equal(validateDisplayCatalog(r.recordsets as unknown as Record<string,any>[][],ddl,reason=>console.log("925_CATALOG_"+reason)),"EXACT_MATCH");}
 finally{await t.rollback();}
 console.log("DATASET_DISPLAY_925_CLEAN_FULL_SCHEMA_ROUNDTRIP_ROLLBACK_PASS");
}
export async function testDatasetDisplay925(root:sql.ConnectionPool,app:sql.ConnectionPool,login:string){
 assert.equal(process.env.GITHUB_ACTIONS,"true");assert.match(login,/^Scope924_[a-f0-9]+$/);
 const ddl=await readFile(displayDdlUrl,"utf8");const catalog=async()=>validateDisplayCatalog((await root.request().query(displayCatalogSql)).recordsets as unknown as Record<string,any>[][],ddl);
 console.log("DATASET_DISPLAY_925_STAGE_ABSENT");
 assert.equal(await catalog(),"ABSENT");
 // Real rollback after all DDL and seed writes, not a mocked rollback receipt.
 const failed=new sql.Transaction(root);await failed.begin();try{await new sql.Request(failed).batch(ddl+"\nTHROW 51925,'SYNTHETIC_INSTALL_FAILURE',1;");assert.fail("FAULT_NOT_REACHED");}catch{}finally{try{await failed.rollback();}catch{}}
 assert.equal(await catalog(),"ABSENT");
 await root.request().query("CREATE TABLE uqp.DatasetPublicDisplayPolicy(WrongShape int)");await assert.rejects(installDisplay925(root,true));await root.request().query("DROP TABLE uqp.DatasetPublicDisplayPolicy");
 console.log("DATASET_DISPLAY_925_STAGE_INSTALL");
 assert.equal(await installDisplay925(root,false),"ABSENT");assert.equal(await installDisplay925(root,true),"EXACT_MATCH");assert.equal(await installDisplay925(root,true),"EXACT_MATCH");
 assert.equal((await root.request().query("SELECT COUNT(*) C FROM uqp.DatasetMaskTemplate")).recordset[0].C,8);
 assert.equal((await root.request().query("SELECT COUNT(*) C FROM uqp.DatasetPublicDisplayPolicy")).recordset[0].C,0);
 // Same-name altered metadata must fail; rollback restores the exact baseline.
 for(const change of ["ALTER TABLE uqp.DatasetPublicDisplayPolicy ADD Extra int NULL","ALTER TABLE uqp.DatasetMaskTemplate NOCHECK CONSTRAINT CK_MaskTemplate_Custom","CREATE INDEX IX_UNREVIEWED ON uqp.DatasetMaskTemplate(IsActive)"]){const t=new sql.Transaction(root);await t.begin();try{await new sql.Request(t).query(change); }catch{}finally{const r=await new sql.Request(t).query(displayCatalogSql);assert.throws(()=>validateDisplayCatalog(r.recordsets as unknown as Record<string,any>[][],ddl));await t.rollback();}assert.equal(await catalog(),"EXACT_MATCH");}
 await root.request().batch(`SET IDENTITY_INSERT uqp.Dataset ON;INSERT uqp.Dataset(Id,Code,Name,DataSourceId,SqlText) VALUES(79,N'DISPLAY925',N'SYNTHETIC',202,N'SELECT NULL AS NAME,NULL AS PHONE,NULL AS SECRET');SET IDENTITY_INSERT uqp.Dataset OFF;
  INSERT uqp.DatasetColumn(DatasetId,ColumnName,DataType,[Ordinal]) VALUES(79,N'NAME',N'nvarchar',0),(79,N'PHONE',N'nvarchar',1),(79,N'SECRET',N'nvarchar',2);
  INSERT uqp.DatasetSensitivePolicyVersion(DatasetId,VersionNumber) VALUES(79,1);
  INSERT uqp.DatasetSensitiveColumn(DatasetId,ColumnName,SensitivityType,DeviceMaskMode) VALUES(79,N'NAME',N'NAME','FULL'),(79,N'PHONE',N'OTHER','NONE'),(79,N'SECRET',N'OTHER','OMIT');
  GRANT SELECT,INSERT,UPDATE ON OBJECT::uqp.DatasetPublicDisplayPolicy TO [${login}];
  GRANT SELECT,INSERT,UPDATE ON OBJECT::uqp.DatasetMaskTemplate TO [${login}];GRANT SELECT,INSERT ON OBJECT::uqp.DatasetMaskTemplateUse TO [${login}];
  GRANT VIEW DEFINITION ON OBJECT::uqp.DatasetPublicDisplayPolicy TO [${login}];GRANT VIEW DEFINITION ON OBJECT::uqp.DatasetMaskTemplate TO [${login}];GRANT VIEW DEFINITION ON OBJECT::uqp.DatasetMaskTemplateUse TO [${login}];
  GRANT SELECT ON OBJECT::uqp.QueryDefinition TO [${login}];GRANT SELECT ON OBJECT::uqp.DatasetSensitivePolicyVersion TO [${login}];`);
 console.log("DATASET_DISPLAY_925_STAGE_RESTRICTED_WRITE");
 const deps={...displayRepositoryDefaults,getPool:async()=>app,request:(tx:sql.Transaction)=>{
  const r=new sql.Request(tx),query=r.query;r.query=function(...args:unknown[]){return Reflect.apply(query,r,args).catch((e:unknown)=>{const n=(e as {number?:unknown})?.number;console.error("925_SQL_FAILURE_NUMBER="+(Number.isSafeInteger(n)?n:0));throw e;});} as typeof r.query;return r;
 }};const store=createDatasetPublicDisplayRepository(deps),templates=createMaskTemplateRepository(deps);
 const tokenVersion=Number((await root.request().query("SELECT TokenVersion FROM uqp.AppUser WHERE Id=303")).recordset[0].TokenVersion);
 const secret=env.JWT_SECRET;env.JWT_SECRET="SYNTHETIC_925_CI";
 try{
  const token=jwt.sign({sub:"303",tokenVersion},env.JWT_SECRET);const identity=createRuntimeIdentityVerifier();const actor=(tx:sql.Transaction)=>identity("Bearer "+token,tx);
  console.log("925_STEP_INITIAL_GET");const s=await store.get(79,actor);assert.equal(s.status,"UNCONFIRMED");
  const command=(v= s)=>({expectedVersion:v.version,expectedSensitivityVersion:v.sensitivityVersion,expectedDefinitionVersion:v.definitionVersion,expectedConfigurationVersion:v.configurationVersion,requestId:randomUUID(),grants:[{columnName:"NAME",permitted:true},{columnName:"PHONE",permitted:true},{columnName:"SECRET",permitted:false}]});
  await assert.rejects(store.save(79,actor,{...command(),grants:[{columnName:"SECRET",permitted:true}]}));
  await root.request().query("DBCC CHECKIDENT ('uqp.AuditLog',RESEED,9007199254740993) WITH NO_INFOMSGS");
  console.log("925_STEP_FIRST_CONFIRM");const c=command(),first=await store.save(79,actor,c);assert.equal(first.status,"CONFIRMED");assert.deepEqual(await store.save(79,actor,c),first);
  const exact=(await root.request().query("SELECT CONVERT(varchar(20),AuditLogId) A FROM uqp.DatasetPublicDisplayPolicy WHERE DatasetId=79")).recordset[0].A;assert.ok(BigInt(exact)>9007199254740992n);
  await assert.rejects(store.save(79,actor,{...c,grants:[]}));
  console.log("925_STEP_RACE");const race=await Promise.allSettled([store.save(79,actor,command(first)),store.save(79,actor,command(first))]);assert.equal(race.filter(r=>r.status==="fulfilled").length,1);
  console.log("925_STEP_AUDIT_DENIAL");const current=await store.get(79,actor);await root.request().query(`DENY INSERT ON OBJECT::uqp.AuditLog TO [${login}]`);
  await assert.rejects(store.save(79,actor,{...command(current),grants:[]}));assert.equal((await store.get(79,actor)).version,current.version);await root.request().query(`GRANT INSERT ON OBJECT::uqp.AuditLog TO [${login}]`);
  console.log("925_STEP_VERSION_INVALIDATION");await root.request().query("UPDATE uqp.DatasetSensitivePolicyVersion SET VersionNumber=VersionNumber+2 WHERE DatasetId=79");assert.equal((await store.get(79,actor)).status,"STALE");
  let next=await store.get(79,actor);await store.save(79,actor,command(next));
  await root.request().query("UPDATE uqp.DataSource SET Name=Name WHERE Id=202");assert.equal((await store.get(79,actor)).status,"STALE");
  next=await store.get(79,actor);await store.save(79,actor,command(next));
  const published=await store.get(79,actor);const input=maskTemplateInput.parse({name:"SYNTHETIC925",aliases:["NAME"],mode:"FULL",customMask:null,suggestedPublicAllowed:false,isActive:true,expectedVersion:null});
  const created=await templates.save(actor,null,input),template=created.templates.find(t=>t.id===created.id)!;
  const use=new sql.Transaction(app);await use.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);await recordTemplateApplications(use,79,next.sensitivityVersion,303,[{columnName:"NAME",templateId:template.id,templateRevision:template.revision}],[{columnName:"NAME",deviceMaskMode:"FULL"}]);await use.commit();
  await templates.save(actor,template.id,{...input,expectedVersion:template.version,isActive:false});
  assert.equal((await store.get(79,actor)).version,published.version);assert.equal((await templates.list(actor)).find(t=>t.id===created.id)!.uses[0]!.State,"NEEDS_RECONFIRMATION");
  const again=new sql.Transaction(app);await again.begin();await assert.rejects(recordTemplateApplications(again,79,next.sensitivityVersion,303,[{columnName:"NAME",templateId:template.id,templateRevision:template.revision}],[{columnName:"NAME",deviceMaskMode:"FULL"}]));await again.rollback();
  const deny=async(tx:sql.Transaction)=>({...await actor(tx),permissions:["DESIGN_QUERY"]});await assert.rejects(store.save(79,deny,command(await store.get(79))));await assert.rejects(templates.save(deny,null,input));
  await root.request().query("UPDATE uqp.AppUser SET TokenVersion=TokenVersion+1 WHERE Id=303");await assert.rejects(store.get(79,actor));await root.request().query("UPDATE uqp.AppUser SET TokenVersion=TokenVersion-1 WHERE Id=303");
  const final=await store.get(79,actor);assert.deepEqual(resolveDatasetPublicDisplayMasks({version:next.sensitivityVersion,columns:[{columnName:"NAME",sensitivityType:"NAME",deviceMaskMode:"FULL"},{columnName:"PHONE",sensitivityType:"OTHER",deviceMaskMode:"NONE"},{columnName:"SECRET",sensitivityType:"OTHER",deviceMaskMode:"OMIT"}]},final.policy,["NAME","PHONE","SECRET","NEW"]),{NAME:"FULL",PHONE:"NONE"});
  console.log("DATASET_DISPLAY_925: REAL_FULL_SCHEMA_ABSENT_INSTALL_REPEAT_PARTIAL_FAILURE_ROLLBACK_EXACT; RESTRICTED_ACTOR_CAS_RACE_EXACT_AUDIT_ABA_SOURCE_TOKEN_INVALIDATION; TEMPLATE_HISTORY_NO_DATASET_MUTATION_PASS");
 }finally{env.JWT_SECRET=secret;}
}
