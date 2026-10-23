import sql from "mssql";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getPlatformDbPool } from "../../config/database.js";
import { env } from "../../config/env.js";
import { createRuntimeIdentityVerifier, type RuntimeIdentity } from "../queryDefinition/queryDelivery.js";
import { writeExact923AuditReceipt, parseExact923AuditId } from "./dataset923ExactAuditReceipt.js";
import { exactScopeId, scopeEpoch, scopeCommand, scopeKind, scopeDigest, scopeFail, DatasetScopeError, scopeSafety, type ScopeCommand } from "./datasetScopeManagement.js";

type Params=Record<string,string|number|Buffer|null>;
export async function scopeQuery(tx:sql.Transaction,text:string,params:Params={}) {
  const r=new sql.Request(tx);
  for(const [key,value] of Object.entries(params)) r.input(key,Buffer.isBuffer(value)?sql.VarBinary(value.length):
    value===null&&["expected","parentVersion"].includes(key)?sql.Binary(8):
    typeof value==="number"||(value===null&&["subjectToken","parentToken"].includes(key))?sql.Int:["incarnation","requestId","transactionReference"].includes(key)?sql.UniqueIdentifier:sql.NVarChar(sql.MAX),value);
  return r.query(text);
}
const uuid=z.string().uuid().refine(v=>v!=="00000000-0000-0000-0000-000000000000");
const epoch=(v:unknown)=>scopeEpoch.parse(v);
const hex=(v:unknown)=>Buffer.isBuffer(v)&&v.length===8?epoch(v.toString("hex")):scopeFail("SCOPE_VERSION_INVALID",503);
const eligible=(user:string)=>`EXISTS(SELECT 1 FROM uqp.UserRole ur WITH(HOLDLOCK)
  JOIN uqp.Role r WITH(HOLDLOCK) ON r.Id=ur.RoleId AND r.IsActive=1
  JOIN uqp.RolePermission rp WITH(HOLDLOCK) ON rp.RoleId=r.Id
  JOIN uqp.Permission p WITH(HOLDLOCK) ON p.Id=rp.PermissionId
  WHERE ur.UserId=${user} AND p.Code=N'CONFIRM_DATASET_CLASSIFICATION')`;

export function createDatasetScopeManagement(deps:Partial<{
  pool:typeof getPlatformDbPool; identity:ReturnType<typeof createRuntimeIdentityVerifier>;
  enabled:()=>boolean;incarnation:()=>string|undefined;
  transaction:(pool:sql.ConnectionPool)=>sql.Transaction;query:typeof scopeQuery;audit:typeof writeExact923AuditReceipt;
}>={}) {
  const pool=deps.pool??getPlatformDbPool,verify=deps.identity??createRuntimeIdentityVerifier();
  const query=deps.query??scopeQuery,audit=deps.audit??writeExact923AuditReceipt;
  const enabled=deps.enabled??(()=>env.DATASET_SECURITY_SCOPE_MANAGEMENT);
  const incarnation=deps.incarnation??(()=>env.DATASET_SECURITY_PLATFORM_INCARNATION);
  async function authorize(tx:sql.Transaction,authorization:string|undefined) {
    const actor=await verify(authorization,tx);
    if(!Number.isSafeInteger(actor.userId)||actor.userId<=0||!Number.isSafeInteger(actor.tokenVersion)||actor.tokenVersion<1)
      return scopeFail("INVALID_TOKEN",401);
    const result=await query(tx,`/* scope:admin */ SELECT u.TokenVersion FROM uqp.AppUser u WITH(HOLDLOCK)
      WHERE u.Id=CONVERT(bigint,@actorId) AND u.IsActive=1 AND u.TokenVersion=@tokenVersion
      AND EXISTS(SELECT 1 FROM uqp.UserRole ur WITH(HOLDLOCK) JOIN uqp.Role r WITH(HOLDLOCK) ON r.Id=ur.RoleId
        WHERE ur.UserId=u.Id AND r.IsActive=1 AND r.IsSystem=1 AND r.Code=N'SYSTEM_ADMIN')
      AND EXISTS(SELECT 1 FROM uqp.UserRole ur WITH(HOLDLOCK) JOIN uqp.Role r WITH(HOLDLOCK) ON r.Id=ur.RoleId AND r.IsActive=1
        JOIN uqp.RolePermission rp WITH(HOLDLOCK) ON rp.RoleId=r.Id JOIN uqp.Permission p WITH(HOLDLOCK) ON p.Id=rp.PermissionId
        WHERE ur.UserId=u.Id AND p.Code=N'MANAGE_DATASET_SECURITY_SCOPE')`,{actorId:actor.userId.toString(),tokenVersion:actor.tokenVersion});
    if(result.recordset.length!==1) return scopeFail("SCOPE_ADMIN_REQUIRED",403);
    return actor;
  }
  async function owned<T>(authorization:string|undefined,write:boolean,work:(tx:sql.Transaction,actor:RuntimeIdentity,inc:string)=>Promise<T>):Promise<T>{
    const inc=uuid.safeParse(incarnation());
    if(!enabled()||!inc.success) return scopeFail("SCOPE_MANAGEMENT_NOT_CONFIGURED",503);
    const p=await pool(); if(!p) return scopeFail("SCOPE_DB_NOT_READY",503);
    const tx=(deps.transaction??(p=>new sql.Transaction(p)))(p);
    let aborted=false,committing=false,started=false;
    tx.on("rollback",()=>{aborted=true;});
    try {
      await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);started=true;
      await query(tx,`/* scope:owner */ SET XACT_ABORT ON; SET LOCK_TIMEOUT 5000;
        SET ANSI_NULLS ON; SET QUOTED_IDENTIFIER ON; SET ANSI_PADDING ON; SET ANSI_WARNINGS ON;
        SET ARITHABORT ON; SET CONCAT_NULL_YIELDS_NULL ON; SET NUMERIC_ROUNDABORT OFF;
        IF @@TRANCOUNT<>1 OR NOT EXISTS(SELECT 1 FROM sys.dm_exec_sessions WHERE session_id=@@SPID AND transaction_isolation_level=4)
          THROW 52924,'SCOPE_TRANSACTION_REQUIRED',1;
        DECLARE @lockResult int;
        EXEC @lockResult=sys.sp_getapplock @Resource=N'UQP:DATASET_SECURITY_SCOPE:V1',@LockMode=${write?"N'Exclusive'":"N'Shared'"},@LockOwner=N'Transaction',@LockTimeout=5000;
        IF @lockResult IS NULL OR @lockResult<0 THROW 52924,'SCOPE_LOCK_UNAVAILABLE',1;`);
      const actor=await authorize(tx,authorization);
      const ready=await query(tx,`/* scope:ready */ SELECT CASE WHEN
        OBJECT_ID(N'uqp.DatasetSecurityScopeBinding',N'U') IS NOT NULL
        AND (SELECT COUNT(*) FROM sys.columns WHERE object_id=OBJECT_ID(N'uqp.DatasetSecurityScopeBinding'))=10
        AND NOT EXISTS(SELECT 1 FROM (VALUES(N'DatasetId',127,8,0),(N'UserId',127,8,0),(N'ScopeKind',231,16,0),
          (N'ScopeVersion',173,8,0),(N'SubjectTokenVersion',56,4,0),(N'DefinitionVersion',173,8,0),(N'ConfigurationVersion',173,8,0),
          (N'ParentScopeVersion',173,8,1),(N'ParentTokenVersion',56,4,1),(N'PlatformIncarnation',36,16,0)) e(n,t,l,v)
          WHERE NOT EXISTS(SELECT 1 FROM sys.columns c WHERE c.object_id=OBJECT_ID(N'uqp.DatasetSecurityScopeBinding')
            AND c.name=e.n AND c.system_type_id=e.t AND c.user_type_id=e.t AND c.max_length=e.l AND c.is_nullable=e.v AND c.is_computed=0))
        AND EXISTS(SELECT 1 FROM sys.foreign_keys WHERE parent_object_id=OBJECT_ID(N'uqp.DatasetSecurityScopeBinding')
          AND referenced_object_id=OBJECT_ID(N'uqp.Dataset') AND is_disabled=0 AND is_not_trusted=0 AND delete_referential_action=0 AND update_referential_action=0)
        AND EXISTS(SELECT 1 FROM sys.foreign_keys WHERE parent_object_id=OBJECT_ID(N'uqp.DatasetSecurityScopeBinding')
          AND referenced_object_id=OBJECT_ID(N'uqp.AppUser') AND is_disabled=0 AND is_not_trusted=0 AND delete_referential_action=0 AND update_referential_action=0)
        AND COALESCE(HAS_PERMS_BY_NAME(N'uqp.DatasetSecurityDecision',N'OBJECT',N'UPDATE'),1)=0
        AND NOT EXISTS(SELECT 1 FROM sys.columns c WHERE c.object_id=OBJECT_ID(N'uqp.DatasetSecurityDecision')
          AND COALESCE(HAS_PERMS_BY_NAME(N'uqp.DatasetSecurityDecision',N'OBJECT',N'UPDATE',c.name,N'COLUMN'),1)<>0)
        AND COALESCE(HAS_PERMS_BY_NAME(N'uqp.DatasetSecurityDecision',N'OBJECT',N'DELETE'),1)=0
        AND COALESCE(HAS_PERMS_BY_NAME(N'uqp.DatasetSecurityDecision',N'OBJECT',N'ALTER'),1)=0
        AND COALESCE(HAS_PERMS_BY_NAME(DB_NAME(),N'DATABASE',N'CONTROL'),1)=0
        AND COALESCE(HAS_PERMS_BY_NAME(N'uqp',N'SCHEMA',N'ALTER'),1)=0
        AND COALESCE(HAS_PERMS_BY_NAME(N'uqp.DatasetSecurityScopeBinding',N'OBJECT',N'ALTER'),1)=0
        AND COALESCE(HAS_PERMS_BY_NAME(N'uqp.DatasetSecurityDecision',N'OBJECT',N'CONTROL'),1)=0
        THEN 1 ELSE 0 END AS Ready;`);
      if(ready.recordset[0]?.Ready!==1) return scopeFail("SCOPE_924_OR_IMMUTABLE_LEDGER_REQUIRED",503);
      const result=await work(tx,actor,inc.data.toLowerCase());
      const finalActor=await authorize(tx,authorization);
      if(finalActor.userId!==actor.userId||finalActor.tokenVersion!==actor.tokenVersion) return scopeFail("TOKEN_REVOKED",401);
      committing=true;await tx.commit();started=false;return result;
    } catch(error) {
      if(started&&!aborted) try{await tx.rollback();}catch{return scopeFail(committing?"SCOPE_COMMIT_UNKNOWN":"SCOPE_ROLLBACK_UNKNOWN",503);}
      if(committing) return scopeFail("SCOPE_COMMIT_UNKNOWN",503);
      if(error instanceof DatasetScopeError) throw error;
      if(error && typeof error==="object" && "code" in error && ["TOKEN_REVOKED","INVALID_TOKEN","UNAUTHORIZED"].includes(String(error.code))) return scopeFail(String(error.code),401);
      const number=(error as {number?:number})?.number;
      return scopeFail(number===1205||number===1222?"SCOPE_TRANSACTION_CONFLICT":"SCOPE_OPERATION_FAILED",number===1205||number===1222?409:503);
    }
  }
  async function dataset(tx:sql.Transaction,id:string){
    const r=await query(tx,`/* scope:dataset */ SELECT CONVERT(varchar(20),d.Id) AS Id,d.Name,
      CONVERT(varchar(20),d.DataSourceId) AS DataSourceId,d.DefinitionRowVersion,ds.ConfigurationRowVersion,
      d.IsActive,d.IsArchived,ds.IsActive AS SourceActive
      FROM uqp.Dataset d WITH(HOLDLOCK) JOIN uqp.DataSource ds WITH(HOLDLOCK) ON ds.Id=d.DataSourceId WHERE d.Id=CONVERT(bigint,@datasetId)`,{datasetId:id});
    if(r.recordset.length!==1) return scopeFail("SCOPE_DATASET_NOT_FOUND",404);
    const d=r.recordset[0];return {id:exactScopeId.parse(d.Id),name:String(d.Name),dataSourceId:exactScopeId.parse(d.DataSourceId),
      definitionVersion:hex(d.DefinitionRowVersion),configurationVersion:hex(d.ConfigurationRowVersion),active:Boolean(d.IsActive)&&!d.IsArchived&&Boolean(d.SourceActive)};
  }
  async function scopes(tx:sql.Transaction,datasetId:string,inc:string){
    const r=await query(tx,`/* scope:rows */ SELECT CONVERT(varchar(20),sc.UserId) AS UserId,sc.ScopeKind,sc.State,sc.ScopeRowVersion,
      CONVERT(varchar(20),sc.BoundDataSourceId) AS BoundDataSourceId,CONVERT(varchar(20),sc.ParentOwnerUserId) AS ParentOwnerUserId,
      CASE WHEN sc.State=N'ACTIVE' AND d.IsActive=1 AND d.IsArchived=0 AND ds.IsActive=1 AND u.IsActive=1
        AND sc.BoundDataSourceId=d.DataSourceId AND b.ScopeVersion=sc.ScopeRowVersion AND b.SubjectTokenVersion=u.TokenVersion
        AND b.DefinitionVersion=d.DefinitionRowVersion AND b.ConfigurationVersion=ds.ConfigurationRowVersion AND b.PlatformIncarnation=@incarnation
        AND ${eligible("u.Id")} AND (sc.ScopeKind=N'OWNER' OR
          (parent.State=N'ACTIVE' AND parent.BoundDataSourceId=d.DataSourceId AND o.IsActive=1 AND ${eligible("o.Id")}
           AND pb.ScopeVersion=parent.ScopeRowVersion AND pb.SubjectTokenVersion=o.TokenVersion
           AND pb.DefinitionVersion=d.DefinitionRowVersion AND pb.ConfigurationVersion=ds.ConfigurationRowVersion AND pb.PlatformIncarnation=@incarnation
           AND b.ParentScopeVersion=parent.ScopeRowVersion AND b.ParentTokenVersion=o.TokenVersion)) THEN 1 ELSE 0 END AS Effective
      FROM uqp.DatasetSecurityScope sc WITH(HOLDLOCK)
      JOIN uqp.Dataset d WITH(HOLDLOCK) ON d.Id=sc.DatasetId JOIN uqp.DataSource ds WITH(HOLDLOCK) ON ds.Id=d.DataSourceId
      JOIN uqp.AppUser u WITH(HOLDLOCK) ON u.Id=sc.UserId
      LEFT JOIN uqp.DatasetSecurityScopeBinding b WITH(HOLDLOCK) ON b.DatasetId=sc.DatasetId AND b.UserId=sc.UserId AND b.ScopeKind=sc.ScopeKind
      LEFT JOIN uqp.DatasetSecurityScope parent WITH(HOLDLOCK) ON parent.DatasetId=sc.DatasetId AND parent.UserId=sc.ParentOwnerUserId AND parent.ScopeKind=N'OWNER'
      LEFT JOIN uqp.DatasetSecurityScopeBinding pb WITH(HOLDLOCK) ON pb.DatasetId=parent.DatasetId AND pb.UserId=parent.UserId AND pb.ScopeKind=N'OWNER'
      LEFT JOIN uqp.AppUser o WITH(HOLDLOCK) ON o.Id=parent.UserId
      WHERE sc.DatasetId=CONVERT(bigint,@datasetId) ORDER BY sc.UserId,sc.ScopeKind`,{datasetId,incarnation:inc});
    return r.recordset.map(row=>({userId:exactScopeId.parse(row.UserId),kind:scopeKind.parse(row.ScopeKind),state:String(row.State),
      version:hex(row.ScopeRowVersion),boundDataSourceId:exactScopeId.parse(row.BoundDataSourceId),parentOwnerUserId:row.ParentOwnerUserId===null?null:exactScopeId.parse(row.ParentOwnerUserId),effective:row.Effective===1}));
  }
  async function receiptExists(tx:sql.Transaction,auditId:string,datasetId:string,actorId:string,requestId:string,action:string,digest:string){
    const params={auditId,datasetId,actorId,requestId,action,digest};
    const condition=`Id=CONVERT(bigint,@auditId) AND DatasetId=CONVERT(bigint,@datasetId) AND UserId=CONVERT(bigint,@actorId)
      AND EventType=N'DATASET_SECURITY_DECISION' AND Status=N'SUCCESS' AND LOWER(JSON_VALUE(ParametersJson,'$.requestId'))=LOWER(CONVERT(nvarchar(36),@requestId)) AND DATALENGTH(JSON_VALUE(ParametersJson,'$.requestId'))=72
      AND JSON_VALUE(ParametersJson,'$.kind') COLLATE Latin1_General_100_BIN2=N'SCOPE' AND DATALENGTH(JSON_VALUE(ParametersJson,'$.kind'))=10
      AND JSON_VALUE(ParametersJson,'$.action') COLLATE Latin1_General_100_BIN2=@action COLLATE Latin1_General_100_BIN2
      AND DATALENGTH(JSON_VALUE(ParametersJson,'$.action'))=DATALENGTH(@action)
      AND JSON_VALUE(ParametersJson,'$.commandDigest') COLLATE Latin1_General_100_BIN2=@digest COLLATE Latin1_General_100_BIN2
      AND DATALENGTH(JSON_VALUE(ParametersJson,'$.commandDigest'))=128`;
    if((await query(tx,`/* scope:receipt */ SELECT CONVERT(varchar(20),Id) AS Id FROM uqp.AuditLog WITH(HOLDLOCK) WHERE ${condition}`,params)).recordset.length===1) return;
    const archive=await query(tx,"/* scope:archive */ SELECT CASE WHEN OBJECT_ID(N'uqp.AuditLogArchive',N'U') IS NOT NULL THEN 1 ELSE 0 END AS Present");
    if(archive.recordset[0]?.Present===1 && (await query(tx,`SELECT CONVERT(varchar(20),Id) AS Id FROM uqp.AuditLogArchive WITH(HOLDLOCK) WHERE ${condition}`,params)).recordset.length===1) return;
    return scopeFail("SCOPE_AUDIT_HISTORY_MISSING");
  }
  return {
    history:(authorization:string|undefined,datasetId:string,requestId?:string)=>owned(authorization,false,async(tx)=>{
      exactScopeId.parse(datasetId);if(requestId)z.string().uuid().parse(requestId);
      await dataset(tx,datasetId);
      const r=await query(tx,`/* scope:history */ SELECT TOP(100) CONVERT(varchar(20),Id) AS decisionId,
        CONVERT(varchar(20),AuditLogId) AS auditLogId,CONVERT(nvarchar(36),RequestId) AS requestId,
        CONVERT(varchar(20),ActorId) AS actorId,CONVERT(varchar(20),SubjectUserId) AS userId,
        ScopeKind AS kind,Action AS action,PreviousState AS previousState,NextState AS nextState,
        CONVERT(varchar(16),NextStateVersion,2) AS version FROM uqp.DatasetSecurityDecision WITH(HOLDLOCK)
        WHERE DatasetId=CONVERT(bigint,@datasetId) AND Kind=N'SCOPE' AND (@requestId IS NULL OR RequestId=@requestId) ORDER BY Id DESC`,{datasetId,requestId:requestId??null});
      return {decisions:r.recordset.map(row=>({...row,decisionId:parseExact923AuditId(row.decisionId),auditLogId:parseExact923AuditId(row.auditLogId),auditPersistence:"REFERENCE_ONLY"})),...scopeSafety};
    }),
    options:(authorization:string|undefined,search="")=>owned(authorization,false,async tx=>{
      const datasets=await query(tx,`/* scope:options-datasets */ SELECT TOP(100) CONVERT(varchar(20),Id) AS id,Name AS name FROM uqp.Dataset WHERE Name LIKE @search ORDER BY Id`,{search:`%${search.slice(0,100)}%`});
      const users=await query(tx,`/* scope:options-users */ SELECT TOP(100) CONVERT(varchar(20),u.Id) AS id,u.DisplayName AS name FROM uqp.AppUser u WHERE u.IsActive=1 AND ${eligible("u.Id")} ORDER BY u.Id`);
      return {datasets:datasets.recordset,users:users.recordset,...scopeSafety};
    }),
    list:(authorization:string|undefined,datasetId:string)=>owned(authorization,false,async(tx,_actor,inc)=>({
      dataset:await dataset(tx,exactScopeId.parse(datasetId)),scopes:await scopes(tx,datasetId,inc),...scopeSafety,
    })),
    mutate:(authorization:string|undefined,datasetId:string,userId:string,kind:"OWNER"|"REVIEWER",input:ScopeCommand)=>owned(authorization,true,async(tx,actor,inc)=>{
      exactScopeId.parse(datasetId);exactScopeId.parse(userId);scopeKind.parse(kind);const command=scopeCommand.parse(input);
      const actorId=actor.userId.toString(),digest=scopeDigest(actorId,datasetId,userId,kind,command,inc);
      const prior=await query(tx,`/* scope:replay */ SELECT CommandDigest,CONVERT(varchar(20),Id) AS Id,CONVERT(varchar(20),AuditLogId) AS AuditId
        FROM uqp.DatasetSecurityDecision WITH(UPDLOCK,HOLDLOCK) WHERE RequestId=@requestId`,{requestId:command.requestId});
      if(prior.recordset.length){
        const row=prior.recordset[0];if(!Buffer.isBuffer(row.CommandDigest)||row.CommandDigest.toString("hex")!==digest) return scopeFail("SCOPE_REQUEST_CONFLICT");
        const auditId=parseExact923AuditId(row.AuditId);await receiptExists(tx,auditId,datasetId,actorId,command.requestId,command.action==="GRANT"?"GRANT_SCOPE":"REVOKE_SCOPE",digest);
        return {decisionId:parseExact923AuditId(row.Id),auditLogId:auditId,replayed:true,...scopeSafety};
      }
      const d=await dataset(tx,datasetId);
      if(d.definitionVersion!==command.definitionVersion||d.configurationVersion!==command.configurationVersion) return scopeFail("SCOPE_DATASET_VERSION_CONFLICT");
      const heads=await scopes(tx,datasetId,inc),old=heads.find(h=>h.userId===userId&&h.kind===kind);
      if((old?.version??"MISSING")!==command.expectedVersion) return scopeFail("SCOPE_VERSION_CONFLICT");
      if(command.action==="REVOKE"&&!old) return scopeFail("SCOPE_NOT_FOUND",404);
      let parent:typeof old;
      let subjectToken:number|null=null,parentToken:number|null=null;
      if(command.action==="GRANT"){
        if(!d.active) return scopeFail("SCOPE_DATASET_INACTIVE");
        if(kind==="OWNER"&&(command.parentOwnerUserId!==null||command.parentOwnerVersion!==null)) return scopeFail("SCOPE_PARENT_INVALID",400);
        if(kind==="REVIEWER"){
          parent=heads.find(h=>h.kind==="OWNER"&&h.userId===command.parentOwnerUserId);
          if(!parent?.effective||parent.userId===userId||parent.version!==command.parentOwnerVersion) return scopeFail("SCOPE_OWNER_INVALID");
        }
        const subjects=await query(tx,`/* scope:subjects */ SELECT CONVERT(varchar(20),u.Id) AS Id,u.TokenVersion FROM uqp.AppUser u WITH(HOLDLOCK)
          WHERE u.IsActive=1 AND u.Id IN(CONVERT(bigint,@userId),CONVERT(bigint,@parentId)) AND ${eligible("u.Id")}`,{userId,parentId:parent?.userId??userId});
        subjectToken=subjects.recordset.find(r=>r.Id===userId)?.TokenVersion;
        parentToken=parent?subjects.recordset.find(r=>r.Id===parent!.userId)?.TokenVersion:null;
        if(!Number.isInteger(subjectToken)||subjectToken!<=0||(parent&&(!Number.isInteger(parentToken)||parentToken!<=0))) return scopeFail("SCOPE_SUBJECT_INELIGIBLE");
      }else if(command.parentOwnerUserId!==null||command.parentOwnerVersion!==null) return scopeFail("SCOPE_PARENT_INVALID",400);
      const action=command.action==="GRANT"?"GRANT_SCOPE":"REVOKE_SCOPE",next=command.action==="GRANT"?"ACTIVE":"REVOKED";
      const reason=command.action==="REVOKE"?"SCOPE_REVOKED":old?"SCOPE_REBOUND":kind==="OWNER"?"OWNER_APPOINTED":"REVIEWER_APPOINTED";
      const params:Params={datasetId,userId,kind,sourceId:d.dataSourceId,actorId,requestId:command.requestId,next,reason,
        parentId:parent?.userId??null,parentKind:parent?"OWNER":null,expected:old?Buffer.from(old.version,"hex"):null};
      const changed=await query(tx,old?`/* scope:cas */ UPDATE uqp.DatasetSecurityScope SET State=@next,
        BoundDataSourceId=CASE WHEN @next=N'ACTIVE' THEN CONVERT(bigint,@sourceId) ELSE BoundDataSourceId END,
        ParentOwnerUserId=CASE WHEN @next=N'ACTIVE' THEN CONVERT(bigint,@parentId) ELSE ParentOwnerUserId END,
        ParentOwnerKind=CASE WHEN @next=N'ACTIVE' THEN @parentKind ELSE ParentOwnerKind END,
        ChangedByUserId=CONVERT(bigint,@actorId),LastRequestId=@requestId,LastReasonCode=@reason,ChangedAt=SYSUTCDATETIME()
        OUTPUT inserted.ScopeRowVersion AS Version WHERE DatasetId=CONVERT(bigint,@datasetId) AND UserId=CONVERT(bigint,@userId) AND ScopeKind=@kind AND ScopeRowVersion=@expected`
        :`/* scope:cas */ INSERT INTO uqp.DatasetSecurityScope(DatasetId,UserId,ScopeKind,BoundDataSourceId,State,ParentOwnerUserId,ParentOwnerKind,
          ChangedByUserId,LastRequestId,LastReasonCode,GrantedAt,ChangedAt) OUTPUT inserted.ScopeRowVersion AS Version
          VALUES(CONVERT(bigint,@datasetId),CONVERT(bigint,@userId),@kind,CONVERT(bigint,@sourceId),@next,CONVERT(bigint,@parentId),@parentKind,
            CONVERT(bigint,@actorId),@requestId,@reason,SYSUTCDATETIME(),SYSUTCDATETIME())`,params);
      if(changed.recordset.length!==1) return scopeFail("SCOPE_VERSION_CONFLICT");
      const version=hex(changed.recordset[0].Version);
      if(command.action==="GRANT")await query(tx,`/* scope:binding */ DELETE FROM uqp.DatasetSecurityScopeBinding WHERE DatasetId=CONVERT(bigint,@datasetId) AND UserId=CONVERT(bigint,@userId) AND ScopeKind=@kind;
        INSERT INTO uqp.DatasetSecurityScopeBinding(DatasetId,UserId,ScopeKind,ScopeVersion,SubjectTokenVersion,DefinitionVersion,ConfigurationVersion,ParentScopeVersion,ParentTokenVersion,PlatformIncarnation)
        VALUES(CONVERT(bigint,@datasetId),CONVERT(bigint,@userId),@kind,@version,@subjectToken,@definition,@configuration,@parentVersion,@parentToken,@incarnation)`,
        {datasetId,userId,kind,version:Buffer.from(version,"hex"),subjectToken,definition:Buffer.from(d.definitionVersion,"hex"),configuration:Buffer.from(d.configurationVersion,"hex"),parentVersion:parent?Buffer.from(parent.version,"hex"):null,parentToken,incarnation:inc});
      const auditId=await audit(tx,{datasetId,actorUserId:actorId,kind:"SCOPE",action,requestId:command.requestId,commandDigestHex:digest});
      await receiptExists(tx,parseExact923AuditId(auditId),datasetId,actorId,command.requestId,action,digest);
      const ledger=await query(tx,`/* scope:decision */ INSERT INTO uqp.DatasetSecurityDecision(DatasetId,Kind,SubjectUserId,ScopeKind,RequestId,CommandDigest,
        ActorId,ActorTokenVersion,Action,ReasonCode,PreviousState,NextState,PreviousStateVersion,NextStateVersion,AuthorizationEvidenceJson,DetailsJson,
        AuditLogId,TransactionReference,PlatformIncarnation,DecidedAt) OUTPUT CONVERT(varchar(20),inserted.Id) AS Id
        VALUES(CONVERT(bigint,@datasetId),N'SCOPE',CONVERT(bigint,@userId),@kind,@requestId,@digest,CONVERT(bigint,@actorId),@actorToken,@action,@reason,
          @previous,@next,@expected,@version,@authorization,@details,CONVERT(bigint,@auditId),@transactionReference,@incarnation,SYSUTCDATETIME())`,
        {...params,digest:Buffer.from(digest,"hex"),actorToken:actor.tokenVersion,action,previous:old?.state??"MISSING",version:Buffer.from(version,"hex"),
          authorization:JSON.stringify({format:"DATASET_SCOPE_AUTH_V1",actorId,tokenVersion:actor.tokenVersion,subjectToken,parentToken,incarnation:inc}),
          details:JSON.stringify({definitionVersion:d.definitionVersion,configurationVersion:d.configurationVersion,parentOwnerId:parent?.userId??old?.parentOwnerUserId??null,parentVersion:parent?.version??null}),
          auditId,transactionReference:randomUUID(),incarnation:inc});
      if(ledger.recordset.length!==1) return scopeFail("SCOPE_DECISION_REQUIRED",503);
      const final=await scopes(tx,datasetId,inc),head=final.find(h=>h.userId===userId&&h.kind===kind);
      if(!head||head.version!==version||(command.action==="GRANT"&&!head.effective)) return scopeFail("SCOPE_FINAL_REVALIDATION_FAILED");
      return {decisionId:parseExact923AuditId(ledger.recordset[0].Id),auditLogId:auditId,replayed:false,...scopeSafety};
    }),
  };
}
export const datasetScopeManagement=createDatasetScopeManagement();
