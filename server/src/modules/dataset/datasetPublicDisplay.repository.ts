import sql from "mssql";
import { createHash } from "node:crypto";
import { getPlatformDbPool } from "../../config/database.js";
import { getEffectiveQueryAccess } from "../queryDefinition/queryDefinition.repository.js";
import { confirmDatasetPublicDisplay, publicDisplayDigest } from "./datasetPublicDisplayConfirmation.js";
import type { PublicDisplayPolicy, PublicDisplayGrant } from "./datasetPublicDisplayPolicy.js";
import type { DatasetSensitiveColumn } from "./datasetSensitiveColumn.repository.js";
import { DatasetDisplayError, exactPositiveId, exactRevision, requireDisplaySchema } from "./datasetDisplaySchema.js";
import type { RuntimeIdentity } from "../queryDefinition/queryDelivery.js";

export type PublicDisplaySnapshot = { status: "UNCONFIRMED"|"CONFIRMED"|"STALE"; policy: PublicDisplayPolicy|null;
  version: string|null; digest: string|null; sensitivityVersion: number; definitionVersion: string; configurationVersion: string;
  dataSourceId: string; confirmedBy: string|null; confirmedAtUtc: string|null };
export type DisplayActor = (tx: sql.Transaction) => Promise<RuntimeIdentity>;
export const displayRepositoryDefaults = { getPool: getPlatformDbPool, schema: requireDisplaySchema, access: getEffectiveQueryAccess,
  transaction: (p: sql.ConnectionPool)=>new sql.Transaction(p), request:(t:sql.Transaction)=>new sql.Request(t) };
export function createDatasetPublicDisplayRepository(deps=displayRepositoryDefaults) {
  const transaction = async <T>(work:(tx:sql.Transaction)=>Promise<T>) => {
    const pool=await deps.getPool();if(!pool)throw new DatasetDisplayError("DATASET_DISPLAY_UNAVAILABLE",503);
    const tx=deps.transaction(pool);await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    try {await deps.request(tx).query("SET XACT_ABORT ON");await deps.schema(deps.request(tx));const result=await work(tx);await tx.commit();return result;}
    catch(e){try{await tx.rollback();}catch{}if(e instanceof DatasetDisplayError)throw e;throw new DatasetDisplayError("DATASET_DISPLAY_WRITE_FAILED",503);}
  };
  const req=(tx:sql.Transaction,id:number)=>deps.request(tx).input("id",sql.BigInt,id);
  const read = async (tx:sql.Transaction,id:number) => {
    const ds=(await req(tx,id).query(`SELECT d.DefinitionRowVersion,s.ConfigurationRowVersion,CONVERT(varchar(20),s.Id) AS SourceId
      FROM uqp.Dataset d WITH(UPDLOCK,HOLDLOCK) JOIN uqp.DataSource s WITH(HOLDLOCK) ON s.Id=d.DataSourceId
      WHERE d.Id=@id AND d.IsActive=1 AND d.IsArchived=0 AND s.IsActive=1`)).recordset[0];
    if(!ds)throw new DatasetDisplayError("DATASET_NOT_AVAILABLE",404);
    const v=(await req(tx,id).query("SELECT VersionNumber FROM uqp.DatasetSensitivePolicyVersion WITH(HOLDLOCK) WHERE DatasetId=@id")).recordset[0];
    const version=Number(v?.VersionNumber??0);if(!Number.isSafeInteger(version)||version<1)throw new DatasetDisplayError("DATASET_DISPLAY_SENSITIVITY_REQUIRED");
    const rules=(await req(tx,id).query("SELECT ColumnName,SensitivityType,DeviceMaskMode,CustomMaskJson FROM uqp.DatasetSensitiveColumn WITH(HOLDLOCK) WHERE DatasetId=@id ORDER BY ColumnName")).recordset;
    const sensitivity={version,columns:rules.map(r=>({columnName:r.ColumnName,sensitivityType:r.SensitivityType,deviceMaskMode:r.DeviceMaskMode,customMask:r.CustomMaskJson?JSON.parse(r.CustomMaskJson):null})) as DatasetSensitiveColumn[]};
    const row=(await req(tx,id).query("SELECT *,CONVERT(varchar(20),DataSourceId) AS SourceExact,CONVERT(varchar(20),ConfirmedBy) AS ActorExact,CONVERT(varchar(20),AuditLogId) AS AuditExact FROM uqp.DatasetPublicDisplayPolicy WITH(UPDLOCK,HOLDLOCK) WHERE DatasetId=@id")).recordset[0];
    const definitionVersion=exactRevision(ds.DefinitionRowVersion),configurationVersion=exactRevision(ds.ConfigurationRowVersion);
    const policy:PublicDisplayPolicy|null=row?{confirmed:true,sensitivityVersion:Number(row.SensitivityVersion),grants:JSON.parse(row.GrantsJson)}:null;

    const current=!!row&&exactRevision(row.DefinitionVersion)===definitionVersion&&exactRevision(row.ConfigurationVersion)===configurationVersion&&row.SourceExact===ds.SourceId&&Number(row.SensitivityVersion)===version;
    if(current&&policy)confirmDatasetPublicDisplay(sensitivity,null,{expectedSensitivityVersion:policy.sensitivityVersion,expectedPolicyDigest:null,grants:policy.grants});
    const snapshot:PublicDisplaySnapshot={status:row?(current?"CONFIRMED":"STALE"):"UNCONFIRMED",policy:policy?{...policy,confirmed:current}:null,
      version:row?exactRevision(row.RowVersion):null,digest:publicDisplayDigest(policy),sensitivityVersion:version,definitionVersion,configurationVersion,dataSourceId:ds.SourceId,
      confirmedBy:row?.ActorExact??null,confirmedAtUtc:row?.ConfirmedAtUtc?.toISOString()??null};
    return {snapshot,sensitivity,row};
  };
  const authorize=async(tx:sql.Transaction,id:number,actor:DisplayActor)=>{
    const a=await actor(tx);if(!a.permissions.includes("DESIGN_QUERY")||!a.permissions.includes("EXECUTE_QUERY"))throw new DatasetDisplayError("FORBIDDEN",403);
    const queries=(await req(tx,id).query("SELECT Id FROM uqp.QueryDefinition WITH(HOLDLOCK) WHERE DatasetId=@id AND IsPublished=1 AND IsActive=1 AND IsArchived=0 ORDER BY Id")).recordset;
    for(const q of queries){const access=await deps.access(a.userId,Number(q.Id),tx,false);if(!access?.canView||!access.canExecute)throw new DatasetDisplayError("DATASET_DISPLAY_DATASET_FORBIDDEN",403);}
    return a;
  };
  return {
    getInTransaction: async(tx:sql.Transaction,id:number)=>{await deps.schema(deps.request(tx));return (await read(tx,id)).snapshot;},
    get:(id:number,actor?:DisplayActor)=>transaction(async tx=>{if(actor)await authorize(tx,id,actor);const result=await read(tx,id);if(actor)await authorize(tx,id,actor);return result.snapshot;}),
    save:(id:number,actor:DisplayActor,input:{expectedVersion:string|null;expectedSensitivityVersion:number;expectedDefinitionVersion:string;expectedConfigurationVersion:string;requestId:string;grants:PublicDisplayGrant[]})=>transaction(async tx=>{
      const a=await authorize(tx,id,actor),before=await read(tx,id);
      const requestDigest=createHash("sha256").update(JSON.stringify([id,a.userId,input])).digest("hex");
      if(before.row?.RequestId?.toLowerCase()===input.requestId.toLowerCase()){
        if(before.row.RequestDigest!==requestDigest||before.snapshot.status!=="CONFIRMED")throw new DatasetDisplayError("DATASET_DISPLAY_REQUEST_CONFLICT");
        return before.snapshot;
      }
      if(before.snapshot.version!==input.expectedVersion||before.snapshot.definitionVersion!==input.expectedDefinitionVersion||before.snapshot.configurationVersion!==input.expectedConfigurationVersion)throw new DatasetDisplayError("DATASET_DISPLAY_VERSION_CONFLICT");
      let policy:PublicDisplayPolicy;
      try {policy=confirmDatasetPublicDisplay(before.sensitivity,before.snapshot.policy?{...before.snapshot.policy,confirmed:true}:null,{expectedSensitivityVersion:input.expectedSensitivityVersion,expectedPolicyDigest:before.snapshot.digest,grants:input.grants});}
      catch{throw new DatasetDisplayError(before.sensitivity.version!==input.expectedSensitivityVersion?"DATASET_DISPLAY_VERSION_CONFLICT":"DATASET_DISPLAY_GRANTS_INVALID");}
      const fields=(await req(tx,id).query("SELECT ColumnName FROM uqp.DatasetColumn WITH(HOLDLOCK) WHERE DatasetId=@id")).recordset.map(r=>String(r.ColumnName).toUpperCase());
      if(policy.grants.some(g=>!fields.includes(g.columnName.toUpperCase())))throw new DatasetDisplayError("DATASET_DISPLAY_COLUMN_NOT_FOUND",400);
      const details=JSON.stringify({before:before.snapshot.policy,after:policy,definitionVersion:before.snapshot.definitionVersion,configurationVersion:before.snapshot.configurationVersion,requestId:input.requestId});
      // Core evidence must never rely on AuditLog's truncation behavior.
      if(details.length>20000)throw new DatasetDisplayError("DATASET_DISPLAY_AUDIT_TOO_LARGE",400);
      const audit=(await req(tx,id).input("actor",sql.BigInt,a.userId).input("details",sql.NVarChar(sql.MAX),details).query(`INSERT uqp.AuditLog(EventType,EventCategory,IsImportant,UserId,DatasetId,Status,ParametersJson,CompletedAtUtc)
        OUTPUT CONVERT(varchar(20),INSERTED.Id) AS Id VALUES('DATASET_PUBLIC_DISPLAY_CONFIRMED','CONFIG',1,@actor,@id,'SUCCESS',@details,SYSUTCDATETIME())`)).recordset[0]?.Id;
      if(!exactPositiveId(audit))throw new DatasetDisplayError("DATASET_DISPLAY_AUDIT_REQUIRED",503);
      const write=req(tx,id).input("source",sql.VarChar(20),before.snapshot.dataSourceId).input("definition",sql.Binary,Buffer.from(before.snapshot.definitionVersion,"hex")).input("configuration",sql.Binary,Buffer.from(before.snapshot.configurationVersion,"hex"))
        .input("sensitivity",sql.BigInt,policy.sensitivityVersion).input("grants",sql.NVarChar(sql.MAX),JSON.stringify(policy.grants)).input("actor",sql.BigInt,a.userId).input("requestId",sql.UniqueIdentifier,input.requestId).input("digest",sql.Char(64),requestDigest).input("audit",sql.VarChar(20),audit);
      if(before.row)await write.input("expected",sql.Binary,Buffer.from(input.expectedVersion!,"hex")).query(`UPDATE uqp.DatasetPublicDisplayPolicy SET DataSourceId=CONVERT(bigint,@source),DefinitionVersion=@definition,ConfigurationVersion=@configuration,SensitivityVersion=@sensitivity,GrantsJson=@grants,ConfirmedBy=@actor,ConfirmedAtUtc=SYSUTCDATETIME(),UpdatedAtUtc=SYSUTCDATETIME(),RequestId=@requestId,RequestDigest=@digest,AuditLogId=CONVERT(bigint,@audit) WHERE DatasetId=@id AND RowVersion=@expected; IF @@ROWCOUNT<>1 THROW 51925,'DISPLAY_CAS_CONFLICT',1;`);
      else await write.query(`INSERT uqp.DatasetPublicDisplayPolicy(DatasetId,DataSourceId,DefinitionVersion,ConfigurationVersion,SensitivityVersion,GrantsJson,ConfirmedBy,RequestId,RequestDigest,AuditLogId) VALUES(@id,CONVERT(bigint,@source),@definition,@configuration,@sensitivity,@grants,@actor,@requestId,@digest,CONVERT(bigint,@audit))`);
      const after=await read(tx,id),again=await authorize(tx,id,actor);if(again.userId!==a.userId||again.tokenVersion!==a.tokenVersion||after.snapshot.status!=="CONFIRMED")throw new DatasetDisplayError("DATASET_DISPLAY_VERSION_CONFLICT");
      return after.snapshot;
    }),
  };
}
export const datasetPublicDisplayRepository=createDatasetPublicDisplayRepository();
export const getDatasetPublicDisplay=datasetPublicDisplayRepository.get;
