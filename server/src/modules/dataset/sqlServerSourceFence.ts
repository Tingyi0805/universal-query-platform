/** Metadata-only source observation. Cooperative SQL gate is never promoted to DBA-proof authority. */
import sql from "mssql";
import {createHash,randomUUID} from "node:crypto";
import {candidateDescription,compileDescription,type DescriptionColumn} from "../../query/queryDescription.js";
import {exactScopeId,DatasetScopeError} from "./datasetScopeManagement.js";
export class SourceFenceError extends DatasetScopeError {constructor(code:string){super(code,503);this.name="SourceFenceError";}}
const fail=(code:string):never=>{throw new SourceFenceError(code);};
const identifier="(?:\\[[^\\]\\r\\n]+\\]|[A-Za-z_][A-Za-z0-9_]*)";
const unquote=(s:string)=>s.startsWith("[")?s.slice(1,-1):s;
export function restrictedSavedSelect(text:string){
  if(typeof text!=="string"||text.length>200000||/[\u0000-\u001f\u007f\ud800-\udfff]/u.test(text.replace(/[\r\n\t]/g," ")))return fail("SOURCE_SQL_UNSUPPORTED");
  try{compileDescription({sql:text,parameters:[],timeoutSec:5},"SQLSERVER");}catch{return fail("SOURCE_SQL_UNSUPPORTED");}
  const parsed=new RegExp(`^\\s*SELECT\\s+(.+?)\\s+FROM\\s+(${identifier})\\.(${identifier})\\s*;?\\s*$`,"is").exec(text);
  if(!parsed)return fail("SOURCE_DEPENDENCY_UNPROVEN");
  const columns=parsed[1]!.split(",").map(item=>{
    const m=new RegExp(`^\\s*(${identifier})(?:\\s+AS\\s+(${identifier}))?\\s*$`,"i").exec(item);
    if(!m)return fail("SOURCE_SQL_UNSUPPORTED");
    const name=unquote(m[1]!),alias=unquote(m[2]??m[1]!);
    if([name,alias].some(n=>!n.trim()||n!==n.trim()||n.length>128||/[\u0000-\u001f\u007f]/u.test(n)))return fail("SOURCE_COLUMN_INVALID");
    return {name,alias};
  });
  if(!columns.length||columns.length>128||new Set(columns.map(c=>c.alias.toUpperCase())).size!==columns.length)return fail("SOURCE_COLUMN_INVALID");
  return {schema:unquote(parsed[2]!),table:unquote(parsed[3]!),columns};
}
export const sourceObservationSafety={authority:"NONE",fence:"BLOCKED_PRIVILEGED_DDL_PATHS",runtimeBindVerified:false,deliveryAllowed:false} as const;
export type SourceObservation={sessionId:number;identity:string;incarnation:string;generation:string;leaseVersion:string;leaseId:string;collation:string;columns:readonly DescriptionColumn[];dependencyDigest:string;fence:typeof sourceObservationSafety.fence};
export interface MetadataSourceLease {describe(savedSql:string):Promise<SourceObservation>;revalidate():Promise<void>;close():Promise<void>}
export type MetadataSourceProvider=(dataSourceId:string)=>Promise<MetadataSourceLease>;
const hash=(s:unknown)=>createHash("sha256").update(JSON.stringify(s)).digest("hex");
/** Explicit server registration only. No request-supplied credentials, registry, identity, generation or VERIFIED flag. */
export async function acquireControlledMetadataLease(pool:sql.ConnectionPool,expected:{identity:string;incarnation:string;database:string}):Promise<MetadataSourceLease>{
  const config=(pool as unknown as {config:sql.config}).config;
  if(!config||!config.requestTimeout||config.requestTimeout>5000)return fail("SOURCE_BOUNDED_TIMEOUT_REQUIRED");
  const tx=new sql.Transaction(pool);let aborted=false,closed=false,original:SourceObservation|undefined,sqlText:string|undefined;
  tx.on("rollback",()=>{aborted=true;});
  try{
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    const lock=new sql.Request(tx);
    await lock.query(`SET XACT_ABORT ON; SET LOCK_TIMEOUT 1000;
      DECLARE @r int; EXEC @r=sys.sp_getapplock @Resource=N'UQP:F3:SOURCE_GATE:V1',@LockMode=N'Shared',@LockOwner=N'Transaction',@DbPrincipal=N'public',@LockTimeout=1000;
      IF @r IS NULL OR @r<0 THROW 52930,'SOURCE_GATE_UNAVAILABLE',1;`);
  }catch{await tx.rollback().catch(()=>undefined);return fail("SOURCE_GATE_UNAVAILABLE");}
  async function observe(text:string):Promise<SourceObservation>{
    if(closed||aborted)return fail("SOURCE_LEASE_LOST");
    const plan=restrictedSavedSelect(text),request=new sql.Request(tx);
    const state=(await request.query(`SELECT @@SPID AS SessionId,HAS_PERMS_BY_NAME(DB_NAME(),N'DATABASE',N'VIEW DEFINITION') AS CompleteCatalog,DB_NAME() AS Db,CONVERT(varchar(36),d.service_broker_guid) AS NativeIdentity,
      CONVERT(varchar(36),f.SourceIdentity) AS IdentityRef,CONVERT(varchar(36),f.Incarnation) AS Incarnation,
      CONVERT(varchar(20),f.Generation) AS Generation,CONVERT(varchar(20),f.LeaseVersion) AS LeaseVersion,d.collation_name AS Collation
      FROM sys.databases d CROSS JOIN f3.FenceState f WITH(HOLDLOCK) WHERE d.database_id=DB_ID() AND f.Id=1`)).recordset;
    if(state.length!==1)return fail("SOURCE_IDENTITY_UNPROVEN");
    const s=state[0];
    if(s.CompleteCatalog!==1||s.Db!==expected.database||s.NativeIdentity.toLowerCase()!==expected.identity.toLowerCase()
      ||s.IdentityRef.toLowerCase()!==expected.identity.toLowerCase()||s.Incarnation.toLowerCase()!==expected.incarnation.toLowerCase())return fail("SOURCE_IDENTITY_CONFLICT");
    exactScopeId.parse(s.Generation);exactScopeId.parse(s.LeaseVersion);
    const table=(await new sql.Request(tx).input("schema",sql.NVarChar(128),plan.schema).input("table",sql.NVarChar(128),plan.table).query(`
      SELECT o.type,t.temporal_type,t.is_memory_optimized,t.is_filetable,o.object_id,
        (SELECT COUNT(*) FROM sys.columns c WHERE c.object_id=o.object_id AND (c.is_computed=1 OR c.user_type_id<>c.system_type_id OR c.encryption_type IS NOT NULL)) AS Unsafe,
        (SELECT COUNT(*) FROM sys.security_predicates p WHERE p.target_object_id=o.object_id) AS SecurityPredicates,
        (SELECT COUNT(*) FROM sys.external_tables e WHERE e.object_id=o.object_id) AS ExternalTable
      FROM sys.objects o JOIN sys.schemas s ON s.schema_id=o.schema_id LEFT JOIN sys.tables t ON t.object_id=o.object_id
      WHERE s.name=@schema AND o.name=@table AND o.is_ms_shipped=0`)).recordset;
    const t=table[0];
    if(table.length!==1||t.type!=="U "&&t.type!=="U"||t.temporal_type!==0||t.is_memory_optimized||t.is_filetable||t.Unsafe||t.SecurityPredicates||t.ExternalTable)return fail("SOURCE_DEPENDENCY_UNPROVEN");
    const describe=new sql.Request(tx);
    const result=await describe.input("tsql",sql.NVarChar(sql.MAX),text).input("params",sql.NVarChar(sql.MAX),null)
      .input("browse_information_mode",sql.TinyInt,1).execute("sys.sp_describe_first_result_set");
    const visible=result.recordset.filter(r=>!r.is_hidden);
    if(visible.length!==plan.columns.length)return fail("SOURCE_COLUMN_INVALID");
    const columns=visible.map((r,i)=>{
      if(r.error_number||r.name!==plan.columns[i]!.alias||r.column_ordinal!==i+1||r.source_schema!==plan.schema||r.source_table!==plan.table
        ||r.source_column!==plan.columns[i]!.name||r.source_database!==expected.database
        ||!(/^(int|bigint|bit|date|datetime2\([0-7]\)|(?:n?varchar)\((?:max|[1-9][0-9]*)\)|decimal\([1-9][0-9]?,[0-9]+\))$/u.test(r.system_type_name)))return fail("SOURCE_COLUMN_INVALID");
      return {name:r.name,dataType:r.system_type_name,ordinal:i+1};
    });
    const candidate=candidateDescription("SQLSERVER_DESCRIBE_FIRST_RESULT_SET",columns);
    return {sessionId:s.SessionId,identity:s.NativeIdentity.toLowerCase(),incarnation:s.Incarnation.toLowerCase(),generation:s.Generation,leaseVersion:s.LeaseVersion,
      leaseId:original?.leaseId??randomUUID(),collation:s.Collation,columns:candidate.columns,dependencyDigest:hash({schema:plan.schema,table:plan.table,id:t.object_id,columns:candidate.columns}),fence:"BLOCKED_PRIVILEGED_DDL_PATHS"};
  }
  return {
    async describe(text){try{if(original)return fail("SOURCE_LEASE_ALREADY_DESCRIBED");sqlText=text;original=await observe(text);return original;}
      catch(e){throw e instanceof SourceFenceError?e:new SourceFenceError("SOURCE_DESCRIPTION_FAILED");}},
    async revalidate(){try{if(!original||!sqlText)return fail("SOURCE_LEASE_UNOBSERVED");if(hash(await observe(sqlText))!==hash(original))return fail("SOURCE_SCHEMA_DRIFT");}
      catch(e){throw e instanceof SourceFenceError?e:new SourceFenceError("SOURCE_LEASE_LOST");}},
    async close(){if(closed)return;closed=true;if(!aborted)try{await tx.rollback();}catch{return fail("SOURCE_RELEASE_UNKNOWN");}},
  };
}
