import sql from "mssql";
import {createHash} from "node:crypto";
import {z} from "zod";
import {datasetScopeManagement,scopeQuery,verifyExactDatasetAuditReceipt} from "./datasetScopeManagement.repository.js";
import {scopeEpoch,exactScopeId,scopeFail,scopeSafety} from "./datasetScopeManagement.js";
import {writeExact923AuditReceipt,parseExact923AuditId} from "./dataset923ExactAuditReceipt.js";
import {candidateDescription} from "../../query/queryDescription.js";
import {computeParameterSnapshotDigest} from "./canonicalSnapshotDigest.js";
import {restrictedSavedSelect,SourceFenceError,type MetadataSourceProvider,type MetadataSourceLease} from "./sqlServerSourceFence.js";
const sha=(s:string)=>createHash("sha256").update(s,"utf8").digest("hex");
const bytes=(s:string)=>Buffer.from(s,"hex");
export const initializeFieldsCommand=z.object({requestId:z.string().uuid().transform(s=>s.toLowerCase()),definitionVersion:scopeEpoch,
  configurationVersion:scopeEpoch,expectedSnapshotVersion:z.union([z.literal("MISSING"),scopeEpoch])}).strict();
const safety={...scopeSafety,authority:"NONE",trust:"UNBOUND_CANDIDATE",sourceFence:"BLOCKED_PRIVILEGED_DDL_PATHS",classificationState:"UNCONFIRMED"} as const;
export function createDatasetFieldInitialization(deps:{management?:typeof datasetScopeManagement;source?:MetadataSourceProvider;audit?:typeof writeExact923AuditReceipt}={}){
  const management=deps.management??datasetScopeManagement,audit=deps.audit??writeExact923AuditReceipt;
  async function latest(tx:sql.Transaction,id:string){
    const r=await scopeQuery(tx,`SELECT TOP(1) CONVERT(varchar(20),Id) Id,State,StateRowVersion,ColumnsJson,DefinitionVersion,ConfigurationVersion
      FROM uqp.DatasetFieldSnapshot WITH(UPDLOCK,HOLDLOCK) WHERE DatasetId=CONVERT(bigint,@datasetId) ORDER BY Id DESC`,{datasetId:id});return r.recordset[0];
  }
  return {
    status:(auth:string|undefined,id:string)=>management.withMetadataOwner(auth,exactScopeId.parse(id),async(tx,c)=>{
      const s=await latest(tx,id);
      // Stored descriptions are never supplied to the existing policy/column repositories.
      return {dataset:c.dataset,snapshot:s?{id:parseExact923AuditId(s.Id),state:s.State,version:s.StateRowVersion.toString("hex"),
        columns:candidateDescription("SQLSERVER_DESCRIBE_FIRST_RESULT_SET",JSON.parse(s.ColumnsJson)).columns,current:s.DefinitionVersion.toString("hex")===c.dataset.definitionVersion&&s.ConfigurationVersion.toString("hex")===c.dataset.configurationVersion}:null,
        collectorConfigured:!!deps.source,...safety};
    }),
    async collect(auth:string|undefined,id:string,input:z.infer<typeof initializeFieldsCommand>){
      const command=initializeFieldsCommand.parse(input);exactScopeId.parse(id);let lease:MetadataSourceLease|undefined;
      try{return await management.withMetadataOwner(auth,id,async(tx,c)=>{
        const digest=sha(JSON.stringify(["SAVED_METADATA_DESCRIBED_V1",id,c.actor.userId.toString(),c.actor.tokenVersion,c.scopeVersion,c.incarnation,command]));
        const prior=(await scopeQuery(tx,`SELECT CONVERT(varchar(20),Id) Id,CONVERT(varchar(20),SnapshotId) SnapshotId,
          CONVERT(varchar(20),AuditLogId) AuditId,CommandDigest FROM uqp.DatasetSecurityDecision WITH(UPDLOCK,HOLDLOCK) WHERE RequestId=@requestId`,{requestId:command.requestId})).recordset;
        if(prior.length){
          const p=prior[0];if(p.CommandDigest.toString("hex")!==digest)return scopeFail("METADATA_REQUEST_CONFLICT");
          await verifyExactDatasetAuditReceipt(tx,parseExact923AuditId(p.AuditId),id,c.actor.userId.toString(),command.requestId,"SNAPSHOT","COLLECT_METADATA",digest);
          return {snapshotId:parseExact923AuditId(p.SnapshotId),decisionId:parseExact923AuditId(p.Id),auditLogId:parseExact923AuditId(p.AuditId),replayed:true,metadataState:"DESCRIBED",...safety};
        }
        if(command.definitionVersion!==c.dataset.definitionVersion||command.configurationVersion!==c.dataset.configurationVersion)return scopeFail("METADATA_VERSION_CONFLICT");
        const head=await latest(tx,id);
        if((head?.StateRowVersion.toString("hex")??"MISSING")!==command.expectedSnapshotVersion)return scopeFail("METADATA_SNAPSHOT_CONFLICT");
        const saved=(await scopeQuery(tx,`SELECT d.SqlText,ds.Type,ds.Host,ds.Port,ds.DatabaseName,
          (SELECT COUNT(*) FROM uqp.DatasetParameter WITH(HOLDLOCK) WHERE DatasetId=d.Id) ParameterCount,n.ContractRowVersion,n.State ContractState
          FROM uqp.Dataset d WITH(HOLDLOCK) JOIN uqp.DataSource ds WITH(HOLDLOCK) ON ds.Id=d.DataSourceId
          LEFT JOIN uqp.DatasetNativeParameterContract n WITH(HOLDLOCK) ON n.DatasetId=d.Id WHERE d.Id=CONVERT(bigint,@datasetId)`,{datasetId:id})).recordset[0];
        if(!saved||saved.Type!=="SQLSERVER"||saved.ParameterCount!==0||saved.ContractState&&saved.ContractState!=="UNCONFIRMED")return scopeFail("METADATA_PARAMETER_OR_SOURCE_UNSUPPORTED");
        restrictedSavedSelect(saved.SqlText);
        if(!deps.source)throw new SourceFenceError("SOURCE_PROVIDER_NOT_REGISTERED");
        if(typeof saved.Host!=="string"||!Number.isInteger(saved.Port)||saved.Port<1||saved.Port>65535||typeof saved.DatabaseName!=="string"||!saved.DatabaseName)return scopeFail("METADATA_SOURCE_TARGET_INVALID");
        lease=await deps.source({dataSourceId:c.dataset.dataSourceId,configurationVersion:c.dataset.configurationVersion,host:saved.Host,port:saved.Port,database:saved.DatabaseName});const observation=await lease.describe(saved.SqlText);
        // Explicitly no SOURCE_BOUND issuing branch. Cooperative gate/registry observations cannot establish DBA-safe authority.
        if(observation.fence!=="BLOCKED_PRIVILEGED_DDL_PATHS")throw new SourceFenceError("SOURCE_AUTHORITY_UNPROVEN");
        await lease.revalidate();
        const columns=JSON.stringify(observation.columns),native=JSON.stringify(observation.columns.map(x=>x.dataType));
        const parameterDigest=computeParameterSnapshotDigest({scope:"SYNTHETIC_TEST_ONLY",datasetId:id,parameters:[]}).integrity.digest;
        const evidence=JSON.stringify({format:"SOURCE_OBSERVATION_V1",...observation,columns:undefined,authority:"NONE",externalDdl:"BLOCKED"});
        const written=(await scopeQuery(tx,`INSERT uqp.DatasetFieldSnapshot(DatasetId,DataSourceId,PlatformIncarnation,DefinitionVersion,ConfigurationVersion,BaseContractVersion,
          SqlDigest,ParameterDigest,NativeTypesDigest,ColumnsDigest,ColumnsJson,NativeBindingsJson,ParameterMode,CollectorVersion,CodecVersion,PlanVersion,DriverVersion,
          CollectedAt,ExpiresAt,State,SourceIdentity,SourceIncarnation,LeaseId,SourceGeneration,LeaseVersion,SourceCollation,CollectorEvidenceDigest,SourceEvidenceJson)
          OUTPUT CONVERT(varchar(20),inserted.Id) Id,inserted.StateRowVersion Version
          VALUES(CONVERT(bigint,@datasetId),CONVERT(bigint,@sourceId),@incarnation,@definition,@configuration,CONVERT(binary(8),@base),
          @sqlDigest,@parameterDigest,@nativeDigest,@columnsDigest,@columns,N'[]',N'NO_PARAMETERS',N'SAVED_METADATA_DESCRIBED_V1',N'SAVED_PARAMETER_SNAPSHOT_V1',N'PARAMETER_FREE_DESCRIPTION_ONLY_V1',N'MSSQL11_DESCRIBE_V1',
          SYSUTCDATETIME(),DATEADD(minute,15,SYSUTCDATETIME()),N'DESCRIBED',CONVERT(uniqueidentifier,@sourceIdentity),CONVERT(uniqueidentifier,@sourceIncarnation),CONVERT(uniqueidentifier,@leaseId),
          CONVERT(bigint,@generation),CONVERT(bigint,@leaseVersion),@collation,@evidenceDigest,@evidence)`,
          {datasetId:id,sourceId:c.dataset.dataSourceId,incarnation:c.incarnation,definition:bytes(command.definitionVersion),configuration:bytes(command.configurationVersion),base:saved.ContractRowVersion??null,
            sqlDigest:bytes(sha(saved.SqlText)),parameterDigest:bytes(parameterDigest),nativeDigest:bytes(sha(native)),columnsDigest:bytes(sha(columns)),columns,
            sourceIdentity:observation.identity,sourceIncarnation:observation.incarnation,leaseId:observation.leaseId,generation:observation.generation,leaseVersion:observation.leaseVersion,
            collation:observation.collation,evidenceDigest:bytes(sha(evidence)),evidence})).recordset;
        if(written.length!==1)return scopeFail("METADATA_SNAPSHOT_WRITE_FAILED",503);
        const s=written[0],snapshotId=parseExact923AuditId(s.Id),version=s.Version;
        const auditId=await audit(tx,{datasetId:id,actorUserId:c.actor.userId.toString(),kind:"SNAPSHOT",action:"COLLECT_METADATA",requestId:command.requestId,commandDigestHex:digest});
        await verifyExactDatasetAuditReceipt(tx,parseExact923AuditId(auditId),id,c.actor.userId.toString(),command.requestId,"SNAPSHOT","COLLECT_METADATA",digest);
        const decision=(await scopeQuery(tx,`INSERT uqp.DatasetSecurityDecision(DatasetId,Kind,SnapshotId,RequestId,CommandDigest,ActorId,ActorTokenVersion,
          Action,ReasonCode,PreviousState,NextState,PreviousStateVersion,NextStateVersion,SnapshotDigest,AuthorizationEvidenceJson,DetailsJson,AuditLogId,TransactionReference,PlatformIncarnation,DecidedAt)
          OUTPUT CONVERT(varchar(20),inserted.Id) Id VALUES(CONVERT(bigint,@datasetId),N'SNAPSHOT',CONVERT(bigint,@snapshotId),@requestId,@digest,CONVERT(bigint,@actorId),@token,
          N'COLLECT_METADATA',N'METADATA_COLLECTED',N'MISSING',N'DESCRIBED',NULL,@version,@snapshotDigest,@authorization,@details,CONVERT(bigint,@auditId),@transactionReference,@incarnation,SYSUTCDATETIME())`,
          {datasetId:id,snapshotId,requestId:command.requestId,digest:bytes(digest),actorId:c.actor.userId.toString(),token:c.actor.tokenVersion,version,snapshotDigest:bytes(sha(columns)),
            authorization:JSON.stringify({format:"SCOPE_BINDING_924",scopeVersion:c.scopeVersion,tokenVersion:c.actor.tokenVersion}),details:JSON.stringify({sourceFence:"BLOCKED_PRIVILEGED_DDL_PATHS",previousHeadId:head?.Id??null}),
            auditId,transactionReference:command.requestId,incarnation:c.incarnation})).recordset;
        if(decision.length!==1)return scopeFail("METADATA_DECISION_REQUIRED",503);
        await lease.revalidate();
        return {snapshotId,decisionId:parseExact923AuditId(decision[0].Id),auditLogId:parseExact923AuditId(auditId),replayed:false,metadataState:"DESCRIBED",...safety};
      });}finally{if(lease)await lease.close();}
    },
  };
}
export const datasetFieldInitialization=createDatasetFieldInitialization();
