// Explicit ledger-only adoption. Never imports app configuration, dotenv or the migration runner.
import sql from "mssql";
import {z} from "zod";
import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import {requireDeviceLifecycleSchema} from "../modules/dashboard/dashboardDeviceLifecycleSchema.js";
import {canonicalDisplayExpression} from "../modules/dataset/datasetDisplaySchema.js";
export const ledger926="926_dashboard_device_lifecycle.sql";
export const sha926="f2d17b2a24963860e646a620f9548b22ff6a1a296e077071e8fb50237c8cfd43";
const sha=z.string().regex(/^[a-f0-9]{40}$/),reference=z.string().trim().min(8).max(300);
const approvalSchema=z.object({format:z.literal("UQP_926_LEDGER_APPROVAL_V1"),approved:z.literal(true),
 scope:z.enum(["PRODUCTION","DISPOSABLE_ONLY"]),applicationSourceSha:sha,packageManifestSha256:z.string().regex(/^[a-f0-9]{64}$/),
 migrationSha256:z.literal(sha926),serverName:z.string().min(1),machineName:z.string().min(1),databaseName:z.string().min(1),
 loginName:z.string().min(1),databaseUser:z.string().min(1),engineMajor:z.union([z.literal(15),z.literal(16)]),
 connectionMode:z.enum(["STRICT_TLS","ENCRYPT_TRUST_CERT"]).default("STRICT_TLS"),tlsTrustApprovalReference:reference.optional(),
 approvedAtUtc:z.iso.datetime(),expiresAtUtc:z.iso.datetime(),approvalReference:reference,maintenanceReference:reference,existingBackupReference:reference}).strict();
export type ReconcileApproval=z.infer<typeof approvalSchema>;
export class Reconcile926Error extends Error{constructor(readonly code:string){super(code);}}
export function parse926Approval(value:unknown,now=Date.now()):ReconcileApproval{
 const result=approvalSchema.safeParse(value);if(!result.success)throw new Reconcile926Error("926_APPROVAL_INVALID");const a=result.data;
 if(a.connectionMode==="ENCRYPT_TRUST_CERT"&&!a.tlsTrustApprovalReference)throw new Reconcile926Error("926_TLS_TRUST_APPROVAL_REQUIRED");
 const issued=Date.parse(a.approvedAtUtc),expires=Date.parse(a.expiresAtUtc);
 if(issued>now+60000||expires<=now||expires<=issued||expires-issued>86400000)throw new Reconcile926Error("926_APPROVAL_EXPIRED_OR_INVALID_WINDOW");
 if(a.scope==="PRODUCTION"&&(a.databaseName!=="UniversalQueryPlatform"||a.engineMajor!==15))throw new Reconcile926Error("926_PRODUCTION_PROFILE_NOT_APPROVED");
 if(a.scope==="DISPOSABLE_ONLY"&&(!/^UQP_D1_UPGRADE_[a-f0-9]{12}$/.test(a.databaseName)||!/^uqp-d1-[a-f0-9]{12}$/.test(a.machineName)))throw new Reconcile926Error("926_DISPOSABLE_TARGET_INVALID");
 return a;
}
/** Explicit operator selection must match reviewed approval; no unencrypted or fallback mode. */
export function resolve926Tls(a:ReconcileApproval,selected?:string){
 const mode=selected??"STRICT_TLS";
 if(mode!=="STRICT_TLS"&&mode!=="ENCRYPT_TRUST_CERT")throw new Reconcile926Error("926_TLS_MODE_INVALID");
 if(mode!==a.connectionMode)throw new Reconcile926Error("926_TLS_MODE_APPROVAL_MISMATCH");
 return {mode,options:{encrypt:true as const,trustServerCertificate:mode==="ENCRYPT_TRUST_CERT"}};
}
export async function verify926Source(){const data=await readFile(new URL("../../../database/migrations/926_dashboard_device_lifecycle.sql",import.meta.url));if(createHash("sha256").update(data).digest("hex")!==sha926)throw new Reconcile926Error("926_SOURCE_HASH_MISMATCH");}
const fail=(code:string):never=>{throw new Reconcile926Error(code);};
async function identity(tx:sql.Transaction,a:ReconcileApproval){
 const r=(await new sql.Request(tx).query(`SELECT CONVERT(nvarchar(128),SERVERPROPERTY('ServerName')) ServerName,
 CONVERT(nvarchar(128),SERVERPROPERTY('MachineName')) MachineName,DB_NAME() DatabaseName,ORIGINAL_LOGIN() LoginName,USER_NAME() DatabaseUser,
 CONVERT(int,SERVERPROPERTY('ProductMajorVersion')) EngineMajor,CONVERT(int,SERVERPROPERTY('EngineEdition')) EngineEdition,
 (SELECT compatibility_level FROM sys.databases WHERE database_id=DB_ID()) Compatibility,
 (SELECT state_desc FROM sys.databases WHERE database_id=DB_ID()) State,
 (SELECT is_read_only FROM sys.databases WHERE database_id=DB_ID()) ReadOnly,
 HAS_PERMS_BY_NAME(DB_NAME(),'DATABASE','VIEW DEFINITION') Visible,
 HAS_PERMS_BY_NAME('uqp.SchemaMigration','OBJECT','SELECT') LedgerRead,HAS_PERMS_BY_NAME('uqp.SchemaMigration','OBJECT','INSERT') LedgerInsert,
 HAS_PERMS_BY_NAME('uqp.DashboardDisplayDevice','OBJECT','SELECT') DeviceRead,
 HAS_PERMS_BY_NAME('sys.sp_getapplock','OBJECT','EXECUTE') LockExecute`)).recordset[0];
 if(!r||["serverName","machineName","databaseName","loginName","databaseUser"].some(k=>r[k[0]!.toUpperCase()+k.slice(1)]!==a[k as keyof ReconcileApproval])||r.EngineMajor!==a.engineMajor||r.Compatibility!==150||r.State!=="ONLINE"||r.ReadOnly||a.scope==="PRODUCTION"&&r.EngineEdition!==4)fail("926_TARGET_IDENTITY_MISMATCH");
 if([r.Visible,r.LedgerRead,r.LedgerInsert,r.DeviceRead,r.LockExecute].some(v=>v!==1))fail("926_DEPLOYMENT_PERMISSION_REQUIRED");
 return r;
}
async function schema(tx:sql.Transaction){
 await requireDeviceLifecycleSchema(new sql.Request(tx));
 const r=await new sql.Request(tx).query(`
 SELECT c.name,c.system_type_id TypeId,c.user_type_id UserTypeId,c.max_length Length,c.scale Scale,c.is_nullable Nullable,c.is_computed Computed,c.is_identity IdentityColumn,c.default_object_id DefaultId,c.is_sparse SparseColumn,c.generated_always_type GeneratedAlways
 FROM sys.columns c WHERE c.object_id=OBJECT_ID('uqp.DashboardDisplayDevice','U');
 SELECT FileName=COL_NAME(c.object_id,c.column_id),c.system_type_id TypeId,c.max_length Length,c.is_nullable Nullable,c.is_computed Computed
 FROM sys.columns c WHERE c.object_id=OBJECT_ID('uqp.SchemaMigration','U');
 SELECT name,definition,is_disabled Disabled,is_not_trusted Untrusted,is_not_for_replication Nfr FROM sys.check_constraints
 WHERE (parent_object_id=OBJECT_ID('uqp.DashboardDisplayDevice') AND name='CK_DashboardDevice_QueryModeGrant') OR (parent_object_id=OBJECT_ID('uqp.Dashboard') AND name='CK_Dashboard_QueryMode');
 SELECT CASE WHEN OBJECT_ID('uqp.DashboardDeviceArchivePolicy','U') IS NOT NULL AND OBJECT_ID('uqp.DashboardDeviceArchiveHistory','U') IS NOT NULL
 AND EXISTS(SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('uqp.Dashboard') AND name='QueryMode' AND system_type_id=167 AND user_type_id=167 AND max_length=24 AND is_nullable=0 AND is_computed=0)
 AND EXISTS(SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('uqp.Dashboard') AND name='QueryModeVersion' AND system_type_id=127 AND user_type_id=127 AND is_nullable=0 AND is_computed=0)
 AND EXISTS(SELECT 1 FROM sys.indexes i JOIN sys.index_columns ic ON ic.object_id=i.object_id AND ic.index_id=i.index_id
 WHERE i.object_id=OBJECT_ID('uqp.SchemaMigration') AND i.is_unique=1 AND i.is_disabled=0 AND i.has_filter=0 AND ic.key_ordinal=1 AND COL_NAME(ic.object_id,ic.column_id)='FileName'
 AND (SELECT COUNT(*) FROM sys.index_columns k WHERE k.object_id=i.object_id AND k.index_id=i.index_id AND k.key_ordinal>0)=1)
 THEN 1 ELSE 0 END Foundation;
 SELECT name FROM sys.triggers WHERE parent_id=OBJECT_ID('uqp.SchemaMigration') OR
 (parent_id=OBJECT_ID('uqp.DashboardDisplayDevice') AND object_id<>OBJECT_ID('uqp.TR_DashboardDevice_Lifecycle'));
 SELECT FileName,AppliedAtUtc FROM uqp.SchemaMigration WITH(UPDLOCK,HOLDLOCK)
 WHERE LEFT(FileName,4) IN(N'025_',N'900_',N'918_',N'926_');`);
 const sets=r.recordsets as unknown as Record<string,any>[][];
 const expected:[string,number,number|undefined,boolean,boolean?][]=[
  ["Id",127,8,false,true],["DashboardId",127,8,false],["DeviceName",231,400,false],["TokenHash",175,64,false],
  ["IsActive",104,1,false],["ExpiresAtUtc",42,undefined,true],["LastUsedAtUtc",42,undefined,true],["CreatedByUserId",127,8,false],
  ["CreatedAtUtc",42,undefined,false],["RevokedAtUtc",42,undefined,true],["ArchivedAtUtc",42,undefined,true],
  ["QueryModeGrantVersion",127,8,true],["DelegatorTokenVersion",127,8,true]];
 for(const [name,type,length,nullable,isIdentity=false] of expected){const c=sets[0]!.find(c=>c.name===name);if(!c||c.TypeId!==type||c.UserTypeId!==type||length!==undefined&&c.Length!==length||type===42&&c.Scale!==0||!!c.Nullable!==nullable||!!c.IdentityColumn!==isIdentity||c.Computed)fail("926_PREREQUISITE_COLUMN_MISMATCH");}
 for(const name of ["SuspendedAtUtc","ReenrollmentRequired"]){const c=sets[0]!.find(c=>c.name===name);if(!c||c.IdentityColumn||c.SparseColumn||c.GeneratedAlways)fail("926_COLUMN_ATTRIBUTE_MISMATCH");}
 const l=sets[1]!;if(l.length!==2||!l.some(c=>c.FileName==="FileName"&&c.TypeId===231&&c.Length===510&&!c.Nullable&&!c.Computed)||!l.some(c=>c.FileName==="AppliedAtUtc"&&c.TypeId===42&&!c.Nullable&&!c.Computed)||sets[3]?.[0]?.Foundation!==1)fail("926_FOUNDATION_OR_LEDGER_SHAPE_MISMATCH");
 if(sets[4]!.length)fail("926_UNREVIEWED_TRIGGER");
 const predicates:Record<string,string>={CK_DashboardDevice_QueryModeGrant:"(QueryModeGrantVersion IS NULL AND DelegatorTokenVersion IS NULL) OR (QueryModeGrantVersion IS NOT NULL AND DelegatorTokenVersion IS NOT NULL AND QueryModeGrantVersion>0 AND DelegatorTokenVersion>0)",CK_Dashboard_QueryMode:"QueryMode IN ('LEGACY','QUERY_ONLY','QUERY_ONLY_DISABLED') AND QueryModeVersion>=0 AND (QueryMode='LEGACY' OR QueryModeVersion>0)"};
 for(const [name,predicate] of Object.entries(predicates)){const c=sets[2]!.filter(c=>c.name===name);if(c.length!==1||c[0]!.Disabled||c[0]!.Untrusted||c[0]!.Nfr||canonicalDisplayExpression(c[0]!.definition)!==canonicalDisplayExpression(predicate))fail("926_PREREQUISITE_CHECK_MISMATCH");}
 const prerequisites=["025_dashboard_display_device.sql","900_dashboard_device_archive.sql","918_dashboard_query_playback_mode.sql"];
 for(const f of prerequisites)if(sets[5]!.filter(c=>c.FileName===f).length!==1)fail("926_PREREQUISITE_LEDGER_MISMATCH");
 if(sets[5]!.some(c=>![...prerequisites,ledger926].includes(c.FileName)))fail("926_LEDGER_FILENAME_MISMATCH");
 const prior=sets[5]!.filter(c=>c.FileName===ledger926);if(prior.length>1)fail("926_DUPLICATE_LEDGER");return prior[0];
}
async function legalData(tx:sql.Transaction){
 const r=(await new sql.Request(tx).query(`SELECT COUNT_BIG(*) DeviceCount,
 COALESCE(SUM(CONVERT(bigint,CASE WHEN RevokedAtUtc IS NOT NULL AND IsActive<>0 THEN 0 WHEN ArchivedAtUtc IS NOT NULL AND IsActive<>0 THEN 0 ELSE 1 END)),0) TerminalValid,
 COALESCE(SUM(CONVERT(bigint,CASE WHEN SuspendedAtUtc IS NULL THEN 1 WHEN IsActive=0 AND RevokedAtUtc IS NULL AND ArchivedAtUtc IS NULL AND ReenrollmentRequired=1 AND QueryModeGrantVersion IS NULL AND DelegatorTokenVersion IS NULL THEN 1 ELSE 0 END)),0) SuspendedValid,
 COALESCE(SUM(CONVERT(bigint,CASE WHEN ReenrollmentRequired IS NULL THEN 1 WHEN RevokedAtUtc IS NOT NULL THEN 0 WHEN ArchivedAtUtc IS NOT NULL THEN 0 WHEN SuspendedAtUtc IS NOT NULL THEN 1 WHEN IsActive=1 THEN 1 ELSE 0 END)),0) EnrollmentValid,
 COALESCE(SUM(CONVERT(bigint,CASE WHEN (QueryModeGrantVersion IS NULL AND DelegatorTokenVersion IS NULL) OR (QueryModeGrantVersion IS NOT NULL AND DelegatorTokenVersion IS NOT NULL AND QueryModeGrantVersion>0 AND DelegatorTokenVersion>0) THEN 1 ELSE 0 END)),0) GrantValid
 FROM uqp.DashboardDisplayDevice WITH(TABLOCK,HOLDLOCK)`)).recordset[0];
 if(!r||[r.TerminalValid,r.SuspendedValid,r.EnrollmentValid,r.GrantValid].some(n=>String(n)!==String(r.DeviceCount)))fail("926_EXISTING_DATA_INVALID");
}
export async function reconcile926(pool:sql.ConnectionPool,input:unknown,mode:"preflight"|"adopt"){
 const a=parse926Approval(input);if(!["preflight","adopt"].includes(mode))fail("926_MODE_INVALID");await verify926Source();
 const tls=resolve926Tls(a,a.connectionMode);
 const options=(pool as sql.ConnectionPool & {readonly config?:sql.config}).config?.options;
 if(options?.encrypt!==true||options?.trustServerCertificate!==tls.options.trustServerCertificate)fail("926_TLS_CONNECTION_MISMATCH");
 const tx=new sql.Transaction(pool);let begun=false,aborted=false,committing=false;tx.on("rollback",()=>{aborted=true;});
 try{
  await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);begun=true;
  await new sql.Request(tx).query("SET XACT_ABORT ON; SET LOCK_TIMEOUT 5000");
  await identity(tx,a);
  const lock=(await new sql.Request(tx).query("DECLARE @result int; EXEC @result=sys.sp_getapplock @Resource=N'UQP:926:DeviceLifecycle',@LockMode=N'Exclusive',@LockOwner=N'Transaction',@LockTimeout=5000; SELECT @result Code")).recordset[0]?.Code;
  if(typeof lock!=="number"||lock<0)fail("926_RECONCILIATION_LOCK_REQUIRED");
  let prior=await schema(tx);await legalData(tx);await identity(tx,a);prior=await schema(tx);
  let appliedAtUtc=prior?.AppliedAtUtc;
  if(!prior&&mode==="adopt"){
   const result=await new sql.Request(tx).input("file",sql.NVarChar(255),ledger926).query("INSERT uqp.SchemaMigration(FileName,AppliedAtUtc) OUTPUT INSERTED.AppliedAtUtc VALUES(@file,SYSUTCDATETIME())");
   if(result.recordset.length!==1)fail("926_LEDGER_WRITE_UNCONFIRMED");appliedAtUtc=result.recordset[0].AppliedAtUtc;
  }
  await identity(tx,a);await requireDeviceLifecycleSchema(new sql.Request(tx));
  const status=prior?"ALREADY_RECORDED":mode==="adopt"?"ADOPTED":"READY_LEDGER_ONLY";
  committing=true;await tx.commit();begun=false;
  return {format:"UQP_926_RECONCILIATION_RECEIPT_V1",status,applicationSourceSha:a.applicationSourceSha,packageManifestSha256:a.packageManifestSha256,
   connectionMode:tls.mode,encrypt:true,trustServerCertificate:tls.options.trustServerCertificate,tlsTrustApprovalReference:a.tlsTrustApprovalReference??null,
   migration:ledger926,migrationSha256:sha926,approvalReference:a.approvalReference,database:a.databaseName,
   appliedAtUtc:appliedAtUtc instanceof Date?appliedAtUtc.toISOString():appliedAtUtc??null,historicalExecutionTimeBackdated:false};
 }catch(error){if(begun&&!aborted)try{await tx.rollback();}catch{throw new Reconcile926Error("926_COMMIT_OR_ROLLBACK_UNKNOWN_NO_RETRY");}
  if(committing)throw new Reconcile926Error("926_COMMIT_OR_ROLLBACK_UNKNOWN_NO_RETRY");if(error instanceof Reconcile926Error)throw error;throw new Reconcile926Error("926_RECONCILIATION_FAILED_NO_RETRY");}
}
