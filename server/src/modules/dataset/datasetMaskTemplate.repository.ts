import {QueryDeliveryError} from "../queryDefinition/queryDelivery.js";
import sql from "mssql";
import {z} from "zod";
import {validCustomMask} from "../dashboard/dashboardDeviceMasking.js";
import {displayRepositoryDefaults,type DisplayActor} from "./datasetPublicDisplay.repository.js";
import {DatasetDisplayError,exactPositiveId,exactRevision,requireDisplaySchema} from "./datasetDisplaySchema.js";
export const maskTemplateInput=z.object({name:z.string().trim().min(1).max(100),aliases:z.array(z.string().trim().min(1).max(256)).min(1).max(40),
 mode:z.enum(["NONE","CUSTOM","FULL","OMIT"]),customMask:z.unknown().nullable(),suggestedPublicAllowed:z.boolean(),isActive:z.boolean(),expectedVersion:z.string().regex(/^[0-9a-f]{16}$/).nullable()}).strict()
 .refine(v=>JSON.stringify(v.aliases).length<=4000,"ALIASES_TOO_LARGE")
 .refine(v=>new Set(v.aliases.map(a=>a.normalize("NFKC").toUpperCase())).size===v.aliases.length&&!v.aliases.some(a=>/[\x00-\x1f\x7f]/u.test(a)),"ALIASES_INVALID")
 .refine(v=>v.mode==="CUSTOM"?validCustomMask(v.customMask):v.customMask===null,"CUSTOM_INVALID").refine(v=>v.mode!=="OMIT"||!v.suggestedPublicAllowed,"OMIT_PUBLIC_DENIED");
export type TemplateInput=z.infer<typeof maskTemplateInput>;
export type TemplateApplication={columnName:string;templateId:string;templateRevision:string};
export function createMaskTemplateRepository(deps=displayRepositoryDefaults){
 const run=async<T>(actor:DisplayActor,admin:boolean,work:(tx:sql.Transaction,actorId:number)=>Promise<T>)=>{
  const pool=await deps.getPool();if(!pool)throw new DatasetDisplayError("DATASET_DISPLAY_UNAVAILABLE",503);const tx=deps.transaction(pool);await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  const verify=async()=>{const a=await actor(tx);if(!a.permissions.includes(admin?"MANAGE_SETTINGS":"DESIGN_QUERY")&&!(!admin&&a.permissions.includes("MANAGE_SETTINGS")))throw new DatasetDisplayError("FORBIDDEN",403);return a;};
  try{await deps.request(tx).query("SET XACT_ABORT ON");await deps.schema(deps.request(tx));const a=await verify();const r=await work(tx,a.userId);const b=await verify();if(a.userId!==b.userId||a.tokenVersion!==b.tokenVersion)throw new DatasetDisplayError("TOKEN_REVOKED",401);await tx.commit();return r;}catch(e){try{await tx.rollback();}catch{}if(e instanceof DatasetDisplayError||e instanceof QueryDeliveryError)throw e;throw new DatasetDisplayError("MASK_TEMPLATE_WRITE_FAILED",503);}
 };
 const list=async(tx:sql.Transaction)=>{
  const rows=(await deps.request(tx).query("SELECT *,CONVERT(varchar(20),Id) AS ExactId,CONVERT(varchar(20),Revision) AS ExactRevision,CONVERT(varchar(20),CreatedBy) AS Creator,CONVERT(varchar(20),UpdatedBy) AS Updater FROM uqp.DatasetMaskTemplate ORDER BY Name")).recordset;
  const uses=(await deps.request(tx).query(`SELECT CONVERT(varchar(20),u.TemplateId) TemplateId,CONVERT(varchar(20),u.DatasetId) DatasetId,u.ColumnName,
    CONVERT(varchar(20),u.TemplateRevision) TemplateRevision,CONVERT(varchar(20),u.SensitivityVersion) SensitivityVersion,d.Code,
    CASE WHEN d.Id IS NULL THEN 'DELETED_DATASET' WHEN v.VersionNumber<>u.SensitivityVersion OR v.VersionNumber IS NULL THEN 'HISTORICAL' WHEN t.Revision<>u.TemplateRevision OR t.IsActive=0 THEN 'NEEDS_RECONFIRMATION' ELSE 'CURRENT' END AS State
    FROM uqp.DatasetMaskTemplateUse u JOIN uqp.DatasetMaskTemplate t ON t.Id=u.TemplateId LEFT JOIN uqp.Dataset d ON d.Id=u.DatasetId LEFT JOIN uqp.DatasetSensitivePolicyVersion v ON v.DatasetId=d.Id
    WHERE NOT EXISTS(SELECT 1 FROM uqp.DatasetMaskTemplateUse n WHERE n.DatasetId=u.DatasetId AND n.ColumnName=u.ColumnName AND n.Id>u.Id) ORDER BY u.Id`)).recordset;
  for(const r of rows){if(!exactPositiveId(r.ExactId)||!exactPositiveId(r.ExactRevision))throw new DatasetDisplayError("MASK_TEMPLATE_ID_INVALID",503);maskTemplateInput.parse({name:r.Name,aliases:JSON.parse(r.AliasesJson),mode:r.MaskMode,customMask:r.CustomMaskJson?JSON.parse(r.CustomMaskJson):null,suggestedPublicAllowed:r.SuggestedPublicAllowed,isActive:r.IsActive,expectedVersion:exactRevision(r.RowVersion)});}
  return rows.map(r=>({id:r.ExactId,revision:r.ExactRevision,version:exactRevision(r.RowVersion),name:r.Name,aliases:JSON.parse(r.AliasesJson),mode:r.MaskMode,customMask:r.CustomMaskJson?JSON.parse(r.CustomMaskJson):null,suggestedPublicAllowed:r.SuggestedPublicAllowed,isActive:r.IsActive,createdBy:r.Creator,updatedBy:r.Updater,createdAtUtc:r.CreatedAtUtc?.toISOString(),updatedAtUtc:r.UpdatedAtUtc?.toISOString(),uses:uses.filter(u=>u.TemplateId===r.ExactId)}));
 };
 return {list:(actor:DisplayActor)=>run(actor,false,async tx=>list(tx)),
 save:(actor:DisplayActor,id:string|null,input:TemplateInput)=>run(actor,true,async(tx,actorId)=>{
  const value=maskTemplateInput.parse(input);if(id&&!exactPositiveId(id))throw new DatasetDisplayError("VALIDATION_ERROR",400);
  const req=()=>deps.request(tx).input("id",sql.VarChar(20),id);
  const old=id?(await req().query("SELECT *,CONVERT(varchar(20),Revision) ExactRevision FROM uqp.DatasetMaskTemplate WITH(UPDLOCK,HOLDLOCK) WHERE Id=CONVERT(bigint,@id)")).recordset[0]:null;
  if(id&&(!old||exactRevision(old.RowVersion)!==value.expectedVersion)||!id&&value.expectedVersion!==null)throw new DatasetDisplayError("MASK_TEMPLATE_VERSION_CONFLICT");
  const query=req().input("name",sql.NVarChar(100),value.name).input("aliases",sql.NVarChar(4000),JSON.stringify(value.aliases)).input("mode",sql.VarChar(16),value.mode).input("custom",sql.NVarChar(256),value.customMask?JSON.stringify(value.customMask):null).input("public",sql.Bit,value.suggestedPublicAllowed).input("active",sql.Bit,value.isActive).input("actor",sql.BigInt,actorId);
  let exactId=id;
  if(id)await query.input("expected",sql.Binary,Buffer.from(value.expectedVersion!,"hex")).query(`UPDATE uqp.DatasetMaskTemplate SET Name=@name,AliasesJson=@aliases,MaskMode=@mode,CustomMaskJson=@custom,SuggestedPublicAllowed=@public,IsActive=@active,Revision=Revision+1,UpdatedBy=@actor,UpdatedAtUtc=SYSUTCDATETIME() WHERE Id=CONVERT(bigint,@id) AND RowVersion=@expected; IF @@ROWCOUNT<>1 THROW 51925,'TEMPLATE_CAS_CONFLICT',1;`);
  else exactId=(await query.query(`INSERT uqp.DatasetMaskTemplate(Name,AliasesJson,MaskMode,CustomMaskJson,SuggestedPublicAllowed,IsActive,CreatedBy,UpdatedBy) OUTPUT CONVERT(varchar(20),INSERTED.Id) AS Id VALUES(@name,@aliases,@mode,@custom,@public,@active,@actor,@actor)`)).recordset[0]?.Id;
  if(!exactPositiveId(exactId))throw new DatasetDisplayError("MASK_TEMPLATE_ID_INVALID",503);
  const detail=JSON.stringify({templateId:exactId,before:old?{revision:old.ExactRevision,name:old.Name,mode:old.MaskMode,aliases:JSON.parse(old.AliasesJson),customMask:old.CustomMaskJson?JSON.parse(old.CustomMaskJson):null,isActive:old.IsActive,suggestedPublicAllowed:old.SuggestedPublicAllowed}:null,after:value});
  if(detail.length>20000)throw new DatasetDisplayError("MASK_TEMPLATE_AUDIT_TOO_LARGE",400);
  const audit=(await deps.request(tx).input("actor",sql.BigInt,actorId).input("detail",sql.NVarChar(sql.MAX),detail).query(`INSERT uqp.AuditLog(EventType,EventCategory,IsImportant,UserId,Status,ParametersJson,CompletedAtUtc) OUTPUT CONVERT(varchar(20),INSERTED.Id) AS Id VALUES('DATASET_MASK_TEMPLATE_UPDATED','CONFIG',1,@actor,'SUCCESS',@detail,SYSUTCDATETIME())`)).recordset[0]?.Id;
  if(!exactPositiveId(audit))throw new DatasetDisplayError("DATASET_DISPLAY_AUDIT_REQUIRED",503);
  return {id:exactId,templates:await list(tx)};
 })};
}
export const maskTemplateRepository=createMaskTemplateRepository();
/** Called within the existing sensitivity writer's owned transaction. No independent commit. */
export async function recordTemplateApplications(tx:sql.Transaction,datasetId:number,version:number,userId:number,applications:TemplateApplication[],rules:{columnName:string;deviceMaskMode:string;customMask?:unknown}[]){
 if(!applications.length)return;await requireDisplaySchema(new sql.Request(tx));
 if(applications.length>300||new Set(applications.map(a=>a.columnName.toUpperCase())).size!==applications.length)throw new DatasetDisplayError("MASK_TEMPLATE_APPLICATION_INVALID",400);
 for(const a of applications){
  if(!exactPositiveId(a.templateId)||!exactPositiveId(a.templateRevision))throw new DatasetDisplayError("MASK_TEMPLATE_APPLICATION_INVALID",400);
  const r=rules.find(r=>r.columnName.toUpperCase()===a.columnName.toUpperCase());
  const t=(await new sql.Request(tx).input("id",sql.VarChar(20),a.templateId).query("SELECT *,CONVERT(varchar(20),Revision) ExactRevision FROM uqp.DatasetMaskTemplate WITH(HOLDLOCK) WHERE Id=CONVERT(bigint,@id)")).recordset[0];
  if(!r||!t?.IsActive||t.ExactRevision!==a.templateRevision||r.deviceMaskMode!==t.MaskMode||["prefix","suffix","symbol","start","end"].some(k=>(r.customMask as Record<string,unknown>|null)?.[k]!==((t.CustomMaskJson?JSON.parse(t.CustomMaskJson):null) as Record<string,unknown>|null)?.[k]))throw new DatasetDisplayError("MASK_TEMPLATE_VERSION_CONFLICT");
  await new sql.Request(tx).input("dataset",sql.BigInt,datasetId).input("column",sql.NVarChar(256),r.columnName).input("template",sql.VarChar(20),a.templateId).input("revision",sql.VarChar(20),a.templateRevision).input("version",sql.BigInt,version).input("actor",sql.BigInt,userId).query(`INSERT uqp.DatasetMaskTemplateUse(DatasetId,ColumnName,TemplateId,TemplateRevision,SensitivityVersion,AppliedBy) VALUES(@dataset,@column,CONVERT(bigint,@template),CONVERT(bigint,@revision),@version,@actor)`);
 }
}
