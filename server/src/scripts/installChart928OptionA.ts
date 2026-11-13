// CHART 928 Option A: proposed production installation transaction bridge.
// NOT A RELEASE. No CLI, HTTP route, environment override or startup hook.
// Operator signoff, exact target+source attestation, backups and privacy
// review precede a distinct approved release commit; compile-time blocked.
// Neither database/review/*.sql.txt candidate is an executable installer.
import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import sql from "mssql";
import {
 inspectChart928ReadOnlyTarget,hasReviewableChart928MetadataFootprint,
 type Chart928ExpectedTarget,
} from "./chart928ReadOnlyTargetPreflight.js";

export const CHART_928_OPTION_A_INSTALL_RELEASE_APPROVED=false as const;
const releaseEnabled=():boolean=>CHART_928_OPTION_A_INSTALL_RELEASE_APPROVED;
const reviewedRelease=():Chart928OptionARelease|null=>null;
const ledgerName="928_dashboard_chart_trust_schema.sql";

export type Chart928OptionARelease=Readonly<{
 target:Chart928ExpectedTarget;
 // Approved, executable SQL artifacts are NOT checked in yet.
 frozenSqlUrl:URL;writerSqlUrl:URL;
 frozenSqlSha256:string;writerSqlSha256:string;
 finalTriggerModuleSha256:string;finalWriterModuleSha256:string;
 changeReceipt:string;backupReceipt:string;
}>;
const sha=(s:string)=>createHash("sha256").update(s,"utf8").digest("hex");
const hex64=(s:unknown):s is string=>
 typeof s==="string"&&/^[0-9a-f]{64}$/.test(s);
const label=(s:unknown):s is string=>
 typeof s==="string"&&s.trim()===s&&s.length>=1&&s.length<=256;

function validateRelease(a:Chart928OptionARelease):void{
 if(!a||!label(a.target?.server)||!label(a.target?.database)||
  !label(a.target?.login)||!label(a.changeReceipt)||!label(a.backupReceipt)||
  !hex64(a.frozenSqlSha256)||!hex64(a.writerSqlSha256)||
  !hex64(a.finalTriggerModuleSha256)||!hex64(a.finalWriterModuleSha256)||
  !(a.frozenSqlUrl instanceof URL)||!(a.writerSqlUrl instanceof URL)||
  a.frozenSqlUrl.protocol!=="file:"||a.writerSqlUrl.protocol!=="file:")
  throw Error("CHART_A_APPROVED_SOURCE_AND_TARGET_REQUIRED");
}
function validateExecutableSql(s:string,which:"frozen"|"writer"):void{
 const stopWords=[
  "CHART_A_WRITER_PRODUCTION_REVIEW_NOT_APPROVED",
  "CHART_928_PRODUCTION_REVIEW_NOT_APPROVED",
  "CHART_A_DISPOSABLE_ONLY","CHART_928_DISPOSABLE_ONLY",
 ];
 if(s.length<3500||stopWords.some(w=>s.includes(w))||
    /@approvedWriterOriginalSid\s+VARBINARY\(85\)\s*=\s*NULL/i.test(s)||
    /@approvedFrozenTriggerDefinitionSha256\s+VARBINARY\(32\)\s*=\s*NULL/i.test(s))
  throw Error("CHART_A_NON_EXECUTABLE_REVIEW_SOURCE");
 if(/^\s*(?:GO|USE\s+|CREATE\s+LOGIN|GRANT\s+EXECUTE)\b/im.test(s))
  throw Error("CHART_A_SCRIPT_BATCH_OR_PRIVILEGE_BLOCKED");
 if(which==="frozen"){
  if(!s.includes("CREATE TABLE uqp.DashboardChartWidgetSeal")||
    !s.includes("CREATE TABLE uqp.DashboardChartTrustRequest")||
    !s.includes("TR_DashboardWidget_ChartFreeze"))
    throw Error("CHART_A_FROZEN_SCHEMA_SOURCE_INVALID");
 }else if(!s.includes("CREATE PROCEDURE uqp.usp_DashboardChartCreate")||
  !s.includes("ALTER TRIGGER uqp.TR_DashboardWidget_ChartFreeze")||
  !s.includes("CREATE TABLE uqp.DashboardChartCreatePermit")||
  /ChartActorDelegationDisposable|usp_ChartDelegationIssue/.test(s))
  throw Error("CHART_A_SQL_WRITER_SOURCE_INVALID");
}
async function readPinnedSources(a:Chart928OptionARelease){
 validateRelease(a);
 const [base,writer]=await Promise.all([
  readFile(a.frozenSqlUrl,"utf8"),readFile(a.writerSqlUrl,"utf8"),
 ]);
 if(sha(base)!==a.frozenSqlSha256||sha(writer)!==a.writerSqlSha256)
  throw Error("CHART_A_EXECUTABLE_SOURCE_SHA256_MISMATCH");
 validateExecutableSql(base,"frozen");validateExecutableSql(writer,"writer");
 return {base,writer};
}

/** No test-only injection of approved SHA/SID, target, source or release gate
 * is accepted here. A later approved SOURCE COMMIT must populate and review
 * the fixed release manifest, not a mutable environment or HTTP parameter.
 */
export async function installChart928OptionA(
 getPool:()=>Promise<sql.ConnectionPool|null>,
):Promise<void>{
 if(!releaseEnabled())throw Error("CHART_928_OPTION_A_INSTALL_NOT_APPROVED");
 const approval=reviewedRelease();
 if(!approval)throw Error("CHART_A_EXPLICIT_RELEASE_MANIFEST_MISSING");
 const {base,writer}=await readPinnedSources(approval);
 const pool=await getPool();
 if(!pool)throw Error("CHART_A_PLATFORM_POOL_UNAVAILABLE");
 const tx=new sql.Transaction(pool);
 await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
 try{
  const request=()=>new sql.Request(tx);
  const locked=(await request().query(
   "DECLARE @lock int; "+
   "EXEC @lock=sys.sp_getapplock "+
   "@Resource=N'UQP:928:ChartTrustRelease',"+
   "@LockMode=N'Exclusive',@LockOwner=N'Transaction',@LockTimeout=5000; "+
   "SELECT @lock AS LockResult")).recordset;
  // sp_getapplock succeeds only for non-negative integer return codes.
  // Missing/null/malformed results must not pass as an acquired lock.
  const lockResult=locked.length===1?locked[0]?.LockResult:undefined;
  if(typeof lockResult!=="number"||!Number.isInteger(lockResult)||lockResult<0)
   throw Error("CHART_A_MIGRATION_LOCK_DENIED");

  // This exact SELECT-only preflight runs ON the migration transaction.
  const before=await inspectChart928ReadOnlyTarget({request},approval.target);
  if(!hasReviewableChart928MetadataFootprint(before)||
   before.catalog925.status!=="EXACT_MATCH"||
   before.phase928!=="ABSENT_NOT_AUTHORIZED"||
   before.schema926.ledger!=="RECORDED_NOT_ATTESTED"||
   before.schema926.consistency!=="COHERENT_NOT_ATTESTED")
   throw Error("CHART_A_TARGET_925_926_928_NOT_RECONCILED");

  const ledger=(await request()
   .query("SELECT FileName FROM uqp.SchemaMigration WITH(UPDLOCK,HOLDLOCK) "+
    "WHERE FileName LIKE N'928[_]%'")).recordset;
  if(ledger.length!==0)throw Error("CHART_A_928_LEDGER_ALREADY_EXISTS");

  // DDL and ledger are in the same SQL transaction. No partial commit.
  await request().batch(base);
  await request().batch(writer);

  const observed=(await request().query(
   "SELECT "+
   "LOWER(CONVERT(varchar(64),HASHBYTES('SHA2_256',CONVERT(varbinary(max),"+
   "(SELECT definition FROM sys.sql_modules WHERE object_id="+
   "OBJECT_ID(N'uqp.TR_DashboardWidget_ChartFreeze',N'TR')))),2)) AS TriggerHash,"+
   "LOWER(CONVERT(varchar(64),HASHBYTES('SHA2_256',CONVERT(varbinary(max),"+
   "(SELECT definition FROM sys.sql_modules WHERE object_id="+
   "OBJECT_ID(N'uqp.usp_DashboardChartCreate',N'P')))),2)) AS WriterHash,"+
   "OBJECT_ID(N'uqp.DashboardChartCreatePermit',N'U') AS PermitId"
  )).recordset;
  if(observed.length!==1||
   observed[0]?.TriggerHash!==approval.finalTriggerModuleSha256||
   observed[0]?.WriterHash!==approval.finalWriterModuleSha256||
   !(Number(observed[0]?.PermitId)>0))
   throw Error("CHART_A_INSTALLED_MODULES_NOT_EXACT");

  await request().input("file",sql.NVarChar(255),ledgerName)
   .query("INSERT INTO uqp.SchemaMigration(FileName) VALUES(@file)");
  await tx.commit();
 }catch{
  try{await tx.rollback();}catch{/* transaction may be aborted */}
  // Only stable code is reported; do not disclose target, SQL or patient data.
  throw Error("CHART_A_INSTALL_ABORTED_AND_REQUIRES_OPERATOR_REVIEW");
 }
}
// Intentionally no npm command or registration in the generic migration path.
