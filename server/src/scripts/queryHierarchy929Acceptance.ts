/** Real SQL only. Fixed GitHub-hosted disposable target; never reads connection details from .env. */
import sql from 'mssql';
import assert from 'node:assert/strict';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {randomBytes,createHash} from 'node:crypto';
const db='UQP929_DISPOSABLE_SYNTHETIC',machine='uqp929-ci',port=14339;
const reportUrl=new URL('../../../tools/sqlserver-acceptance/hierarchy-929/report.json',import.meta.url);
const ids=['ENV','BASELINE','A_TRANSACTION_REQUIRED','A_DDL_ROLLBACK','A_INSTALL_CATALOG','A_REPEAT_REFUSED','A_PARTIAL_REFUSED','A_SCHEMA_DRIFT_REFUSED','B_RESTRICTED_IDENTITY','B_GRANTED_WRITE','B_DENIED_DDL_DELETE','B_DENIED_ACCOUNT_SECRET','B_SOURCE_READ_ONLY','B_VISIBILITY_REQUIRED','C_TWO_CONNECTION_CAS','C_ACL_REVOKE','C_TOKEN_REVOKE','C_1222','C_1205','C_AUDIT_ROLLBACK','C_FINAL_REVALIDATION_ROLLBACK','C_COMMIT_UNKNOWN','D_SQL_COUNT_OFFSET','D_BIND_SEARCH','D_EMPTY','D_NON_UNIQUE_REFUSED','D_DRIFT_REFUSED','D_SAME_COUNT_DRIFT','D_ABA_KEYS','D_SOURCE_RANGE_LOCK','E_MASK_PAGE_AUDIT','E_CHILD_ACL','E_UNCONFIRMED','E_PATIENT_AUDIT_FAILURE','E_QUERY_AUDIT_FAILURE','E_ARCHIVE','F_ORACLE11G'];
const results=ids.map(id=>({id,status:'NOT_RUN' as 'NOT_RUN'|'PASS'|'FAIL',evidence:''}));
const evidence:Record<string,unknown>={format:'UQP929_REAL_SQL_ACCEPTANCE_V1',commit:process.env.UQP929_SOURCE_COMMIT??'UNKNOWN',sqlAcceptance:'NOT_RUN',environment:{status:'UNKNOWN'},results};
const delay=(n:number)=>new Promise(r=>setTimeout(r,n));
async function record(id:string,run:()=>Promise<unknown>){const r=results.find(x=>x.id===id)!;try{const v=await run();r.status='PASS';r.evidence=typeof v==='string'?v:'REAL_SQL_ASSERTIONS_PASS';}catch(e){r.status='FAIL';r.evidence='SAFE_FAILURE:'+String((e as any)?.number??(e as any)?.code??'ASSERTION').replace(/[^A-Za-z0-9_-]/g,'').slice(0,60);}console.log(id+'='+r.status+':'+r.evidence);await writeFile(reportUrl,JSON.stringify(evidence,null,2));return r.status==='PASS';}
const safe=()=>assert.equal(process.env.GITHUB_ACTIONS==='true'&&process.env.RUNNER_ENVIRONMENT==='github-hosted'&&process.env.UQP929_APPROVE==='DISPOSABLE_GITHUB_HOSTED_929_ONLY'&&!!process.env.UQP929_CI_PASSWORD,true,'CI_ISOLATION_REQUIRED');
async function main(){
 safe();const config:sql.config={server:'127.0.0.1',port,database:'master',user:'sa',password:process.env.UQP929_CI_PASSWORD!,options:{encrypt:true,trustServerCertificate:true},pool:{min:0,max:10},requestTimeout:20000,connectionTimeout:1500};
 let master:sql.ConnectionPool|undefined,root:sql.ConnectionPool|undefined,app:sql.ConnectionPool|undefined,created=false,closePlatform:(()=>Promise<void>)|undefined;
 const login='App929_'+randomBytes(6).toString('hex'),password='Q929!'+randomBytes(24).toString('hex'),sourceLogin='Source929_'+randomBytes(6).toString('hex'),sourcePassword='Q929!'+randomBytes(24).toString('hex');
 console.log('::add-mask::'+password);console.log('::add-mask::'+sourcePassword);
 try{
  if(!await record('ENV',async()=>{
   for(let n=0;n<60;n++){try{master=await new sql.ConnectionPool(config).connect();break;}catch{await delay(1000);}}
   assert(master);const v=(await master.request().query(`SELECT @@SERVERNAME S,DB_NAME() D,ORIGINAL_LOGIN() L,CONVERT(nvarchar(128),SERVERPROPERTY('MachineName')) M,CONVERT(varchar(128),SERVERPROPERTY('ProductVersion')) V,CONVERT(nvarchar(128),SERVERPROPERTY('Edition')) E,DB_ID(N'${db}') Existing`)).recordset[0];
   assert.equal(v.S,machine);assert.equal(v.M,machine);assert.equal(v.D,'master');assert.equal(v.L,'sa');assert.match(v.V,/^15\./);assert.equal(v.Existing,null);
   evidence.environment={engine:v.V,edition:v.E,instance:machine,database:db,compatibility:150,tls:'encrypted; isolated ephemeral self-signed certificate only',syntheticOnly:true,githubRun:process.env.GITHUB_RUN_ID,image:process.env.UQP929_IMAGE??'UNKNOWN'};
   await master!.request().batch(`CREATE DATABASE [${db}];ALTER DATABASE [${db}] SET COMPATIBILITY_LEVEL=150;`);created=true;
   root=await new sql.ConnectionPool({...config,database:db}).connect();await root.request().batch(`EXEC sys.sp_addextendedproperty @name=N'UQP929_DISPOSABLE',@value=N'${process.env.GITHUB_RUN_ID}';`);
  }))return;
  const r=root!;
  if(!await record('BASELINE',async()=>{
   const folder=new URL('../../../database/migrations/',import.meta.url),files=(await readdir(folder)).filter(f=>/^\d+_.*\.sql$/.test(f)).sort();assert.equal(files.length,50);assert.equal(files.at(-1),'927_workstation_pin_runtime.sql');
   const manifest=[];
   for(const file of files){const text=await readFile(new URL(file,folder),'utf8'),tx=new sql.Transaction(r);let aborted=false;tx.on('rollback',()=>{aborted=true;});await tx.begin();try{for(const batch of text.split(/^\s*GO\s*$/gim).filter(x=>x.trim()))await new sql.Request(tx).batch(batch);await tx.commit();}catch(e){if(!aborted)await tx.rollback().catch(()=>{});throw e;}manifest.push({file,sha256:createHash('sha256').update(text).digest('hex')});}
   evidence.migrations=manifest;assert.equal((await r.request().query("SELECT compatibility_level C FROM sys.databases WHERE name=DB_NAME()")).recordset[0].C,150);
   // Full real parent schema, not reduced synthetic parent tables; only business rows below are synthetic.
   await r.request().batch(`SET IDENTITY_INSERT uqp.AppUser ON;INSERT uqp.AppUser(Id,Username,DisplayName,PasswordHash) VALUES(11,N'ci929-admin',N'SYNTHETIC_ADMIN',N'NOT_A_LOGIN_HASH'),(12,N'ci929-user',N'SYNTHETIC_OPERATOR',NULL);SET IDENTITY_INSERT uqp.AppUser OFF;
    INSERT uqp.UserRole(UserId,RoleId) SELECT 11,Id FROM uqp.Role WHERE Code=N'SYSTEM_ADMIN';INSERT uqp.UserRole(UserId,RoleId) SELECT 12,Id FROM uqp.Role WHERE Code=N'REPORT_USER';
    CREATE TABLE dbo.Hierarchy929Rows(ID int NOT NULL PRIMARY KEY,Label nvarchar(40) NOT NULL,PatientKey nvarchar(40) NOT NULL,Secret nvarchar(40) NOT NULL);
    INSERT dbo.Hierarchy929Rows VALUES(1,N'SYNTHETIC_A',N'SYNTHETIC_P1',N'SYNTHETIC_SECRET'),(2,N'SYNTHETIC_A',N'SYNTHETIC_P2',N'SYNTHETIC_SECRET'),(3,N'SYNTHETIC_B',N'SYNTHETIC_P3',N'SYNTHETIC_SECRET'),(4,N'SYNTHETIC_B',N'SYNTHETIC_P4',N'SYNTHETIC_SECRET');`);
  }))return;
  await master!.request().batch(`CREATE LOGIN [${login}] WITH PASSWORD=N'${password}',CHECK_POLICY=OFF;CREATE LOGIN [${sourceLogin}] WITH PASSWORD=N'${sourcePassword}',CHECK_POLICY=OFF;`);
  await r.request().batch(`CREATE USER [${login}] FOR LOGIN [${login}];CREATE USER [${sourceLogin}] FOR LOGIN [${sourceLogin}];GRANT SELECT ON OBJECT::dbo.Hierarchy929Rows TO [${sourceLogin}];`);
  Object.assign(process.env,{PLATFORM_DB_SERVER:'127.0.0.1',PLATFORM_DB_PORT:String(port),PLATFORM_DB_DATABASE:db,PLATFORM_DB_USER:login,PLATFORM_DB_PASSWORD:password,PLATFORM_DB_ENCRYPT:'true',PLATFORM_DB_TRUST_SERVER_CERTIFICATE:'true',JWT_SECRET:randomBytes(40).toString('hex'),DATASOURCE_ENCRYPTION_KEY:randomBytes(32).toString('base64'),PATIENT_AUDIT_ACTIVE_KEY_VERSION:'1',PATIENT_AUDIT_HMAC_KEYRING_JSON:JSON.stringify({'1':randomBytes(32).toString('base64')})});
  const {encryptSecret}=await import('../security/secretCrypto.js');
  const sourceSql='SELECT ID,Label,PatientKey,Secret,PatientKey AS FullValue FROM dbo.Hierarchy929Rows';
  const insertSource=r.request().input('secret',sql.NVarChar(2000),encryptSecret(sourcePassword)).input('user',sql.NVarChar(200),sourceLogin).input('db',sql.NVarChar(200),db);
  await insertSource.query(`SET IDENTITY_INSERT uqp.DataSource ON;INSERT uqp.DataSource(Id,Code,Name,Type,Host,Port,DatabaseName,Username,EncryptedPassword,EncryptConnection,TrustServerCertificate) VALUES(21,N'CI929',N'SYNTHETIC',N'SQLSERVER',N'127.0.0.1',${port},@db,@user,@secret,1,1);SET IDENTITY_INSERT uqp.DataSource OFF;`);
  await r.request().input('sql',sql.NVarChar(sql.MAX),sourceSql).query(`SET IDENTITY_INSERT uqp.Dataset ON;INSERT uqp.Dataset(Id,Code,Name,DataSourceId,SqlText,MaxRows) VALUES(31,N'CI929_ROOT',N'SYNTHETIC_ROOT',21,@sql,100),(32,N'CI929_CHILD',N'SYNTHETIC_CHILD',21,@sql+N' WHERE ID={{KEY}}',100);SET IDENTITY_INSERT uqp.Dataset OFF;
   SET IDENTITY_INSERT uqp.QueryDefinition ON;INSERT uqp.QueryDefinition(Id,Code,Name,DatasetId,IsPublished) VALUES(41,N'CI929_ROOT',N'SYNTHETIC_ROOT',31,1),(42,N'CI929_CHILD',N'SYNTHETIC_CHILD',32,1);SET IDENTITY_INSERT uqp.QueryDefinition OFF;
   INSERT uqp.QueryDefinitionVersion(QueryDefinitionId,VersionNo,SnapshotJson) VALUES(41,1,N'{}'),(42,1,N'{}');
   INSERT uqp.UserQueryAccess(UserId,QueryDefinitionId,CanView,CanExecute) VALUES(12,41,1,1),(12,42,1,1);INSERT uqp.RoleQueryAccess(RoleId,QueryDefinitionId,CanView,CanExecute) SELECT r.Id,q.Id,1,1 FROM uqp.Role r CROSS JOIN uqp.QueryDefinition q WHERE r.Code=N'SYSTEM_ADMIN' AND q.Id IN(41,42);
   INSERT uqp.DatasetParameter(DatasetId,Name,Label,DataType,ControlType,IsRequired) VALUES(32,N'KEY',N'KEY',N'NUMBER',N'NUMBER',1);
   INSERT uqp.DatasetSensitivePolicyVersion(DatasetId,VersionNumber) VALUES(31,1),(32,1);
   INSERT uqp.DatasetColumn(DatasetId,ColumnName,DataType,Ordinal) SELECT d.Id,c.Name,c.Type,c.Ordinal FROM uqp.Dataset d CROSS JOIN(VALUES(N'ID',N'int',0),(N'Label',N'nvarchar',1),(N'PatientKey',N'nvarchar',2),(N'Secret',N'nvarchar',3),(N'FullValue',N'nvarchar',4)) c(Name,Type,Ordinal) WHERE d.Id IN(31,32);
   INSERT uqp.DatasetSensitiveColumn(DatasetId,ColumnName,SensitivityType,DeviceMaskMode,CustomMaskJson) SELECT d.Id,c.Name,N'OTHER',c.Mode,c.Custom FROM uqp.Dataset d CROSS JOIN(VALUES(N'ID','NONE',NULL),(N'Label','CUSTOM',N'{"prefix":1,"suffix":0,"symbol":"*"}'),(N'PatientKey','OMIT',NULL),(N'Secret','OMIT',NULL),(N'FullValue','FULL',NULL)) c(Name,Mode,Custom) WHERE d.Id IN(31,32);
   INSERT uqp.ReportColumn(QueryDefinitionId,ColumnName,DisplayLabel,DisplayOrder) SELECT q.Id,c.Name,c.Name,c.Ordinal FROM uqp.QueryDefinition q CROSS JOIN(VALUES(N'ID',0),(N'Label',1),(N'PatientKey',2),(N'Secret',3),(N'FullValue',4)) c(Name,Ordinal) WHERE q.Id IN(41,42);`);
  const {definitionHash}=await import('../modules/dataset/patientAuditConfig.service.js');
  for(const id of [31,32])await r.request().input('id',sql.BigInt,id).input('h',sql.Char(64),definitionHash({dataSourceId:21,sqlText:sourceSql+(id===32?' WHERE ID={{KEY}}':'')})).query(`INSERT uqp.DatasetPatientAuditMetadata(DatasetId,DefinitionHash,ColumnsJson) VALUES(@id,@h,N'["ID","Label","PatientKey","Secret","FullValue"]');INSERT uqp.DatasetPatientAuditConfig(DatasetId,IsEnabled,PatientKeyColumn,ConfigurationVersion) VALUES(@id,1,N'PatientKey',1);`);
  const {hierarchyCatalogSql,createQueryHierarchyRepository}=await import('../modules/queryDefinition/queryHierarchy.repository.js');
  const ddl=await readFile(new URL('../../../database/review/929_query_hierarchy.sql.txt',import.meta.url),'utf8');
  const install=async(rollback=false)=>{const t=new sql.Transaction(r);let aborted=false;t.on('rollback',()=>{aborted=true;});await t.begin();try{await new sql.Request(t).batch(ddl);if(rollback)await t.rollback();else await t.commit();}catch(e){if(!aborted)await t.rollback().catch(()=>{});throw e;}};
  await record('A_TRANSACTION_REQUIRED',async()=>{await assert.rejects(r.request().batch(ddl));assert.equal((await r.request().query("SELECT OBJECT_ID(N'uqp.QueryHierarchyConfiguration') O")).recordset[0].O,null);});
  await record('A_DDL_ROLLBACK',async()=>{await install(true);assert.equal((await r.request().query("SELECT OBJECT_ID(N'uqp.QueryHierarchyConfiguration') O")).recordset[0].O,null);});
  if(!await record('A_INSTALL_CATALOG',async()=>{await install();await r.request().query(hierarchyCatalogSql);})){const c=await r.request().query("SELECT name,system_type_id,max_length,scale FROM sys.columns WHERE object_id=OBJECT_ID(N'uqp.QueryHierarchyConfiguration')");evidence.catalogColumns=c.recordset;return;}
  await record('A_REPEAT_REFUSED',async()=>{await assert.rejects(install());await r.request().query(hierarchyCatalogSql);});
  for(const [id,change] of [['A_PARTIAL_REFUSED','ALTER TABLE uqp.QueryHierarchyConfiguration DROP CONSTRAINT FK_QueryHierarchy_Actor'],['A_SCHEMA_DRIFT_REFUSED','ALTER TABLE uqp.QueryHierarchyConfiguration ADD Unexpected int NULL']])await record(id!,async()=>{const t=new sql.Transaction(r);let aborted=false;t.on('rollback',()=>{aborted=true;});await t.begin();try{await new sql.Request(t).query(change!);await assert.rejects(new sql.Request(t).query(hierarchyCatalogSql));}finally{if(!aborted)await t.rollback();}await r.request().query(hierarchyCatalogSql);});
  const readTables=['QueryCategory','UserQueryFavorite','Role','Permission','UserRole','RolePermission','QueryDefinition','QueryDefinitionVersion','RoleQueryAccess','UserQueryAccess','Dataset','DatasetParameter','DataSource','DatasetColumn','DatasetSensitiveColumn','DatasetSensitivePolicyVersion','DatasetPatientAuditConfig','DatasetPatientAuditMetadata','Dashboard','DashboardDataSource','ReportColumn'];
  await r.request().batch(readTables.map(n=>`GRANT SELECT ON OBJECT::uqp.[${n}] TO [${login}];GRANT VIEW DEFINITION ON OBJECT::uqp.[${n}] TO [${login}];`).join('\n')+`
   GRANT SELECT(Id,Username,DisplayName,IsActive,TokenVersion) ON OBJECT::uqp.AppUser TO [${login}];GRANT VIEW DEFINITION ON OBJECT::uqp.AppUser TO [${login}];
   GRANT SELECT,INSERT,UPDATE,VIEW DEFINITION ON OBJECT::uqp.QueryHierarchyConfiguration TO [${login}];
   GRANT SELECT,INSERT,UPDATE ON OBJECT::uqp.AuditLog TO [${login}];GRANT SELECT,INSERT ON OBJECT::uqp.PatientListDisclosure TO [${login}];GRANT SELECT,INSERT ON OBJECT::uqp.PatientListDisclosureSubject TO [${login}];`);
  app=await new sql.ConnectionPool({...config,database:db,user:login,password}).connect();const a=app;
  const database=await import('../config/database.js');closePlatform=database.closePlatformDbPool;
  const {writeAuditEvent}=await import('../modules/audit/audit.repository.js');
  const {createRuntimeIdentityVerifier}=await import('../modules/queryDefinition/queryDelivery.js');
  const {default:jwt}=await import('jsonwebtoken');
  const verifier=createRuntimeIdentityVerifier(),token=(id:number)=>'Bearer '+jwt.sign({sub:String(id),tokenVersion:1},process.env.JWT_SECRET!),admin=(t?:sql.Transaction)=>verifier(token(11),t),operator=(t?:sql.Transaction)=>verifier(token(12),t);
  const {createQueryHierarchyService,hierarchyServiceDependencies}=await import('../modules/queryDefinition/queryHierarchy.service.js');
  const {parseHierarchyGraph}=await import('../modules/queryDefinition/queryHierarchy.contract.js');
  const graph=parseHierarchyGraph({version:1,root:'root',nodes:[{id:'root',queryId:41,layout:'TABLE',pageSize:2,orderBy:['ID']},{id:'child',queryId:42,layout:'CARDS',pageSize:2,orderBy:['ID']}],edges:[{id:'detail',from:'root',to:'child',label:'SYNTHETIC',trigger:'ROW',display:'PANEL',bindings:[{field:'ID',parameter:'KEY',type:'NUMBER'}]}]});
  const repo=createQueryHierarchyRepository({getPool:async()=>a,audit:writeAuditEvent}),service=createQueryHierarchyService({...hierarchyServiceDependencies,store:repo});
  const binding=(t:sql.Transaction)=>service.bindingEvidence(41,graph,admin,t),meta={ipAddress:'127.0.0.1',userAgent:'UQP929_SYNTHETIC_CI'};
  const save=async()=>repo.save(41,graph,(await repo.read(41))?.revision??'MISSING',admin,binding);
  await record('B_RESTRICTED_IDENTITY',async()=>{const x=(await a.request().query("SELECT IS_ROLEMEMBER('db_owner') O,IS_SRVROLEMEMBER('sysadmin') S,HAS_PERMS_BY_NAME(NULL,NULL,'VIEW SERVER STATE') V")).recordset[0];assert.equal(x.O,0);assert.equal(x.S,0);assert.equal(x.V,0);});
  if(!await record('B_GRANTED_WRITE',async()=>{await save();assert((await repo.read(41))?.revision);} ))return;
  await record('B_DENIED_DDL_DELETE',async()=>{await assert.rejects(a.request().query('DELETE uqp.QueryHierarchyConfiguration WHERE RootQueryId=41'));await assert.rejects(a.request().query('CREATE TABLE uqp.Unapproved929(Id int)'));await assert.rejects(a.request().query('UPDATE uqp.Role SET IsActive=0 WHERE Code=\'SYSTEM_ADMIN\''));});
  await record('B_DENIED_ACCOUNT_SECRET',async()=>{await assert.rejects(a.request().query('SELECT PasswordHash FROM uqp.AppUser'));await assert.rejects(a.request().query('UPDATE uqp.AppUser SET TokenVersion=2 WHERE Id=12'));});
  await record('B_SOURCE_READ_ONLY',async()=>{await assert.rejects(a.request().query('SELECT * FROM dbo.Hierarchy929Rows'));const p=await new sql.ConnectionPool({...config,database:db,user:sourceLogin,password:sourcePassword}).connect();try{assert.equal((await p.request().query('SELECT COUNT(*) N FROM dbo.Hierarchy929Rows')).recordset[0].N,4);await assert.rejects(p.request().query('UPDATE dbo.Hierarchy929Rows SET Label=Label WHERE ID=1'));await assert.rejects(p.request().query('SELECT Username FROM uqp.AppUser'));}finally{await p.close();}});
  await record('B_VISIBILITY_REQUIRED',async()=>{await r.request().query(`DENY VIEW DEFINITION ON OBJECT::uqp.QueryHierarchyConfiguration TO [${login}]`);try{await assert.rejects(repo.read(41));}finally{await r.request().query(`GRANT VIEW DEFINITION ON OBJECT::uqp.QueryHierarchyConfiguration TO [${login}]`);}});
  await record('C_TWO_CONNECTION_CAS',async()=>{const before=(await repo.read(41))!.revision;const z=await Promise.allSettled([repo.save(41,graph,before,admin,binding),repo.save(41,graph,before,admin,binding)]);assert.equal(z.filter(x=>x.status==='fulfilled').length,1);assert.match((z.find(x=>x.status==='rejected') as PromiseRejectedResult).reason.code,/CAS_CONFLICT/);return 'REAL_POOL_CONCURRENT_SERIALIZABLE_ONE_WINNER';});
  await record('C_ACL_REVOKE',async()=>{const x=await service.create(41,'owner',{},operator,meta) as any;await r.request().query('UPDATE uqp.UserQueryAccess SET CanExecute=0 WHERE UserId=12 AND QueryDefinitionId=41');try{await assert.rejects(service.act(41,x.contextId,'owner',operator,{kind:'PAGE',controls:{page:2,search:null,sort:null}},meta));}finally{await r.request().query('UPDATE uqp.UserQueryAccess SET CanExecute=1 WHERE UserId=12 AND QueryDefinitionId=41');}});
  await record('C_TOKEN_REVOKE',async()=>{const x=await service.create(41,'revoked-token',{},operator,meta) as any;await r.request().query('UPDATE uqp.AppUser SET TokenVersion=2 WHERE Id=12');try{await assert.rejects(service.act(41,x.contextId,'revoked-token',operator,{kind:'PAGE',controls:{page:2,search:null,sort:null}},meta));}finally{await r.request().query('UPDATE uqp.AppUser SET TokenVersion=1 WHERE Id=12');}return 'REAL_LIVE_TOKENVERSION_RECHECK_NO_DATA_DELIVERY';});
  await record('C_1222',async()=>{const t=new sql.Transaction(r);await t.begin();try{await new sql.Request(t).query('UPDATE uqp.QueryHierarchyConfiguration SET UpdatedAtUtc=SYSUTCDATETIME() WHERE RootQueryId=41');const before=(await new sql.Request(t).query('SELECT CONVERT(varchar(16),ConfigRowVersion,2) V FROM uqp.QueryHierarchyConfiguration')).recordset[0].V.toLowerCase();await assert.rejects(repo.save(41,graph,before,admin,binding),(e:any)=>e.number===1222||e.code==='HIERARCHY_ROLLBACK_UNKNOWN');}finally{await t.rollback();}return 'REAL_1222_TRANSACTION_BLOCKED_5_SECONDS';});
  await record('C_1205',async()=>{
   const before=(await repo.read(41))!.revision,control=new sql.Transaction(r);await control.begin();let observed=0;
   try{
    await new sql.Request(control).query('SET DEADLOCK_PRIORITY HIGH;UPDATE uqp.QueryDefinition SET Name=Name WHERE Id=41');
    let entered!:()=>void;const barrier=new Promise<void>(resolve=>{entered=resolve;});
    const attempt=repo.save(41,graph,before,admin,async t=>{await new sql.Request(t).query('SET LOCK_TIMEOUT 15000;SET DEADLOCK_PRIORITY LOW;');entered();try{return await binding(t);}catch(e){observed=Number((e as any)?.number??0);throw e;}});
    const rejected=assert.rejects(attempt);await barrier;await delay(100);
    await new sql.Request(control).query('UPDATE uqp.QueryHierarchyConfiguration SET UpdatedAtUtc=UpdatedAtUtc WHERE RootQueryId=41');await rejected;assert.equal(observed,1205);
   }finally{await control.rollback().catch(()=>{});}
   assert.equal((await repo.read(41))!.revision,before);return 'REAL_REPOSITORY_DEADLOCK_1205_VICTIM_NO_COMMIT';
  });
  const snapshot=async()=>JSON.stringify((await r.request().query('SELECT GraphJson,BindingJson,CONVERT(varchar(20),AuditLogId) A,CONVERT(varchar(16),ConfigRowVersion,2) V FROM uqp.QueryHierarchyConfiguration')).recordset);
  await record('C_AUDIT_ROLLBACK',async()=>{const before=await snapshot();await r.request().query(`DENY INSERT ON OBJECT::uqp.AuditLog TO [${login}]`);try{await assert.rejects(save());assert.equal(await snapshot(),before);}finally{await r.request().query(`GRANT INSERT ON OBJECT::uqp.AuditLog TO [${login}]`);}});
  await record('C_FINAL_REVALIDATION_ROLLBACK',async()=>{const before=await snapshot(),audits=(await r.request().query("SELECT COUNT(*) N FROM uqp.AuditLog WHERE EventType='QUERY_HIERARCHY_UPDATED'")).recordset[0].N;let count=0;await assert.rejects(repo.save(41,graph,(await repo.read(41))!.revision,admin,async t=>{const b=await binding(t);if(++count===2)throw Error('INJECTED_FINAL_AUTHORIZATION_REJECTION');return b;}));assert.equal(await snapshot(),before);assert.equal((await r.request().query("SELECT COUNT(*) N FROM uqp.AuditLog WHERE EventType='QUERY_HIERARCHY_UPDATED'")).recordset[0].N,audits);});
  const {executeSavedDatasetPage}=await import('../modules/dataset/datasetPaging.service.js');
  const plan={page:1,pageSize:2,orderBy:['ID'],search:null,sort:null};
  await record('D_SQL_COUNT_OFFSET',async()=>{const p=await executeSavedDatasetPage(31,{},plan),next=await executeSavedDatasetPage(31,{}, {...plan,page:2,expectedWitness:p.sourceWitness});assert.equal(p.pagination.totalRows,4);assert.deepEqual([...p.result.rows,...next.result.rows].map(x=>x.ID),[1,2,3,4]);assert(!JSON.stringify(p.result).includes('UQP_HP_'));});
  await record('D_BIND_SEARCH',async()=>{const p=await executeSavedDatasetPage(31,{}, {...plan,search:{column:'ID',text:"%_' OR 1=1"}});assert.equal(p.result.rows.length,0);});
  await record('D_EMPTY',async()=>{const p=await executeSavedDatasetPage(31,{}, {...plan,search:{column:'ID',text:'999'}});assert.equal(p.pagination.totalRows,0);assert.equal(p.result.rows.length,0);assert.equal(p.result.columns.length,5);});
  await record('D_NON_UNIQUE_REFUSED',async()=>{await assert.rejects(executeSavedDatasetPage(31,{}, {...plan,orderBy:['Label']}),(e:any)=>e.number===51929);});
  await record('D_DRIFT_REFUSED',async()=>{const x=await service.create(41,'drift',{},operator,meta) as any;await r.request().query("INSERT dbo.Hierarchy929Rows VALUES(0,N'SYNTHETIC_0',N'SYNTHETIC_P0',N'SYNTHETIC_SECRET')");try{await assert.rejects(service.act(41,x.contextId,'drift',operator,{kind:'PAGE',controls:{page:2,search:null,sort:null}},meta));}finally{await r.request().query('DELETE dbo.Hierarchy929Rows WHERE ID=0');}return 'INSERT_BEFORE_OFFSET_REJECTED_NO_DUPLICATE_DELIVERY';});
  await record('D_SAME_COUNT_DRIFT',async()=>{const p=await executeSavedDatasetPage(31,{},plan);await r.request().query('UPDATE dbo.Hierarchy929Rows SET ID=0 WHERE ID=4');try{await assert.rejects(executeSavedDatasetPage(31,{}, {...plan,page:2,expectedWitness:p.sourceWitness}),/SOURCE_PAGE_CHANGED/);}finally{await r.request().query('UPDATE dbo.Hierarchy929Rows SET ID=4 WHERE ID=0');}return 'SAME_COUNT_OFFSET_DUPLICATION_REJECTED_BY_ORDERED_KEY_WITNESS';});
  await record('D_ABA_KEYS',async()=>{const p=await executeSavedDatasetPage(31,{},plan);await r.request().query('UPDATE dbo.Hierarchy929Rows SET ID=99 WHERE ID=4;UPDATE dbo.Hierarchy929Rows SET ID=4 WHERE ID=99;');const next=await executeSavedDatasetPage(31,{}, {...plan,page:2,expectedWitness:p.sourceWitness});assert.deepEqual(next.result.rows.map(x=>x.ID),[3,4]);return 'RESTORED_KEY_MEMBERSHIP_IS_IDENTICAL_NOT_A_MUTATION_EPOCH_CLAIM';});
  await record('D_SOURCE_RANGE_LOCK',async()=>{
   const {compileSavedPage}=await import('../modules/dataset/datasetPaging.service.js');
   const p=await new sql.ConnectionPool({...config,database:db,user:sourceLogin,password:sourcePassword,pool:{min:1,max:1}}).connect();
   try{
    const spid=(await p.request().query('SELECT @@SPID S')).recordset[0].S;
    const compiled=compileSavedPage(sourceSql,'SQLSERVER',{},plan).consistentSql!;
    const source=p.request().input('UQP_HP_OFFSET',sql.Int,0).input('UQP_HP_LIMIT',sql.Int,2).input('UQP_HP_CAPPLUS',sql.Int,101).query(compiled.replace('SELECT CONVERT(varchar(20),@uqp_total)',"WAITFOR DELAY '00:00:02'; SELECT CONVERT(varchar(20),@uqp_total)"));
    let barrier=false;for(let n=0;n<80;n++){const waiting=(await r.request().input('s',sql.Int,spid).query('SELECT wait_type FROM sys.dm_exec_requests WHERE session_id=@s')).recordset[0]?.wait_type;if(waiting==='WAITFOR'){barrier=true;break;}await delay(20);}
    assert.equal(barrier,true);await assert.rejects(r.request().query("SET LOCK_TIMEOUT 200;INSERT dbo.Hierarchy929Rows VALUES(5,N'SYNTHETIC',N'SYNTHETIC_P5',N'SYNTHETIC_SECRET')"),(e:any)=>e.number===1222);
    assert.equal((await source).recordset.length,2);
   }finally{await p.close();await r.request().query('SET LOCK_TIMEOUT -1');}
   return 'REAL_COMPILED_COUNT_WITNESS_PAGE_BATCH_BARRIER_BLOCKS_CONCURRENT_INSERT';
  });
  await record('E_MASK_PAGE_AUDIT',async()=>{const x=await service.create(41,'masked',{},operator,meta) as any;assert.equal(x.result.rows.length,2);assert(!('Secret' in x.result.rows[0]));assert.notEqual(x.result.rows[0].Label,'SYNTHETIC_A');assert(!('PatientKey' in x.result.rows[0]));assert.equal(x.result.rows[0].FullValue,'○○○○');const p=(await r.request().query(`SELECT DeliveryType,PageNumber,RowCount,UserId FROM uqp.PatientListDisclosure WHERE Id=${x.disclosureId}`)).recordset[0];assert.equal(p.DeliveryType,'PAGE');assert.equal(p.PageNumber,1);assert.equal(p.RowCount,2);assert.equal(String(p.UserId),'12');assert.equal((await r.request().query(`SELECT COUNT(*) N FROM uqp.PatientListDisclosureSubject WHERE DisclosureId=${x.disclosureId}`)).recordset[0].N,2);const y=await service.act(41,x.contextId,'masked',operator,{kind:'NAVIGATE',edge:'detail',rowRef:x.rowRefs[0]},meta) as any;assert.equal(y.depth,2);assert.equal(y.result.rows.length,1);});
  await record('E_CHILD_ACL',async()=>{const x=await service.create(41,'denied',{},operator,meta) as any;await r.request().query('UPDATE uqp.UserQueryAccess SET CanView=0,CanExecute=0 WHERE UserId=12 AND QueryDefinitionId=42');try{await assert.rejects(service.act(41,x.contextId,'denied',operator,{kind:'NAVIGATE',edge:'detail',rowRef:x.rowRefs[0]},meta));}finally{await r.request().query('UPDATE uqp.UserQueryAccess SET CanView=1,CanExecute=1 WHERE UserId=12 AND QueryDefinitionId=42');}});
  await record('E_UNCONFIRMED',async()=>{await r.request().query('UPDATE uqp.DatasetSensitivePolicyVersion SET VersionNumber=0 WHERE DatasetId=31');try{await assert.rejects(service.create(41,'unconfirmed',{},operator,meta));}finally{await r.request().query('UPDATE uqp.DatasetSensitivePolicyVersion SET VersionNumber=1 WHERE DatasetId=31');}});
  await record('E_PATIENT_AUDIT_FAILURE',async()=>{await r.request().query(`DENY INSERT ON OBJECT::uqp.PatientListDisclosureSubject TO [${login}]`);try{const before=(await r.request().query('SELECT COUNT(*) N FROM uqp.PatientListDisclosure')).recordset[0].N;await assert.rejects(service.create(41,'auditfail',{},operator,meta));assert.equal((await r.request().query('SELECT COUNT(*) N FROM uqp.PatientListDisclosure')).recordset[0].N,before);}finally{await r.request().query(`GRANT INSERT ON OBJECT::uqp.PatientListDisclosureSubject TO [${login}]`);}});
  await record('E_QUERY_AUDIT_FAILURE',async()=>{await r.request().query(`DENY UPDATE ON OBJECT::uqp.AuditLog TO [${login}]`);try{await assert.rejects(service.create(41,'auditfinalfail',{},operator,meta));}finally{await r.request().query(`GRANT UPDATE ON OBJECT::uqp.AuditLog TO [${login}]`);}});
  await record('E_ARCHIVE',async()=>{const id=(await r.request().query('SELECT CONVERT(varchar(20),AuditLogId) A FROM uqp.QueryHierarchyConfiguration WHERE RootQueryId=41')).recordset[0].A;assert.match(id,/^[1-9][0-9]*$/);const columns=(await r.request().query("SELECT name FROM sys.columns WHERE object_id=OBJECT_ID(N'uqp.AuditLogArchive') AND name<>'ArchivedAtUtc' ORDER BY column_id")).recordset.map(x=>`[${x.name}]`).join(',');await r.request().input('id',sql.VarChar(20),id).query(`BEGIN TRAN;INSERT uqp.AuditLogArchive(${columns}) SELECT ${columns} FROM uqp.AuditLog WHERE Id=CONVERT(bigint,@id);DELETE uqp.AuditLog WHERE Id=CONVERT(bigint,@id);COMMIT;`);assert.equal((await r.request().input('id',sql.VarChar(20),id).query('SELECT COUNT(*) N FROM uqp.AuditLogArchive WHERE Id=CONVERT(bigint,@id)')).recordset[0].N,1);assert((await repo.read(41))?.revision);});
  results.find(x=>x.id==='F_ORACLE11G')!.evidence='NO_APPROVED_ORACLE11G_THICK_ENVIRONMENT';
  await record('C_COMMIT_UNKNOWN',async()=>{
   const {create929CommitProxy}=await import('./queryHierarchy929CommitProxy.js'),proxy=await create929CommitProxy(port);
   const p=await new sql.ConnectionPool({...config,database:db,user:login,password,port:proxy.port,options:{encrypt:false,trustServerCertificate:true},pool:{min:1,max:1},requestTimeout:5000}).connect();
   try{
    // Only transaction transport uses the proxy. Real metadata/Audit use the same
    // SQL transaction object; no fake receipt or commit implementation.
    const faultRepo=createQueryHierarchyRepository({getPool:async()=>p,audit:writeAuditEvent});
    const before=(await repo.read(41))!.revision;await p.request().query('SELECT 1 Ready');proxy.arm();
    const attempted=faultRepo.save(41,graph,before,admin,binding);const rejected=assert.rejects(attempted,(e:any)=>e.code==='HIERARCHY_COMMIT_UNKNOWN_DO_NOT_RETRY');
    let changed=false;
    for(let n=0;n<80;n++){const x=proxy.state();if(x.commitObserved&&x.held){changed=(await repo.read(41))!.revision!==before;if(changed)break;}await delay(25);}
    assert.equal(proxy.state().commitObserved,true);assert.equal(proxy.state().held,true);assert.equal(changed,true);
    proxy.disconnect();await rejected;
    return 'REAL_TDS_COMMIT_FORWARDED_ACK_WITHHELD_SQL_DURABLE_CALLER_REJECTED_NO_RETRY';
   }finally{proxy.disconnect();await p.close().catch(()=>{});await proxy.close();}
  });
  evidence.sqlAcceptance=results.some(x=>x.status==='FAIL')?'FAIL':'PARTIAL';
 }finally{
  if(results.find(x=>x.id==='ENV')!.status==='PASS')evidence.sqlAcceptance=results.some(x=>x.status==='FAIL')?'FAIL':results.some(x=>x.id!=='F_ORACLE11G'&&x.status==='NOT_RUN')?'PARTIAL':'PASS';
  await closePlatform?.().catch(()=>{});await app?.close().catch(()=>{});await root?.close().catch(()=>{});
  if(created&&master){const marker=(await master.request().query(`SELECT value FROM [${db}].sys.extended_properties WHERE class=0 AND name=N'UQP929_DISPOSABLE'`)).recordset[0]?.value;assert.equal(marker,process.env.GITHUB_RUN_ID);await master.request().batch(`ALTER DATABASE [${db}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;DROP DATABASE [${db}];`);evidence.cleanup='OWN_MARKED_DATABASE_DESTROYED';}
  await master?.close().catch(()=>{});await writeFile(reportUrl,JSON.stringify(evidence,null,2));
 }
}
main().catch(e=>{evidence.sqlAcceptance='FAIL';evidence.failureCode=String(e?.number??e?.code??'HARNESS_REJECTED').slice(0,50);console.error('929_ACCEPTANCE_FAILED_SAFE_CODE='+evidence.failureCode);process.exitCode=1;}).finally(async()=>{await writeFile(reportUrl,JSON.stringify(evidence,null,2));if(results.some(x=>x.status==='FAIL'))process.exitCode=1;console.log('SQL_ACCEPTANCE='+evidence.sqlAcceptance);});
