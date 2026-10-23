/** Dedicated 924 installer. Import has no database side effects; never scans generic migrations. */
import sql from "mssql";
import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { getPlatformDbPool,closePlatformDbPool } from "../config/database.js";
import { render923CatalogSql } from "../modules/dataset/datasetMetadata923Catalog.js";
import { render924CatalogSql,render924InstallBatch } from "../modules/dataset/datasetMetadata924Catalog.js";
export const ledger924="924_dataset_security_scope_binding.sql";
export class Install924Error extends Error { constructor(readonly code:string){super(code);} }
const fail=(s:string):never=>{throw new Install924Error(s);};
export function assess924(catalog:string,recorded:boolean,baseExact:boolean,capabilities:boolean,immutable:boolean){
  if(!baseExact)return fail("924_BASELINE_923_NOT_EXACT");
  if(catalog==="REJECTED_UNKNOWN")return fail("924_FULL_CATALOG_VISIBILITY_REQUIRED");
  if(catalog==="NOT_INSTALLED"&&!recorded)return "READY";
  if(catalog==="EXACT_MATCH"&&recorded&&capabilities&&immutable)return "INSTALLED";
  return fail("924_PARTIAL_UNRECORDED_OR_DIFFERENT");
}
export function approve924(args:string[],env=process.env){
  if(args.length!==2||args[1]!=="--confirm"||env.UQP_924_APPROVE_INSTALL!=="I_APPROVE_ISOLATED_924"
    ||env.UQP_924_BACKUP_VERIFIED!=="YES"||env.UQP_924_MAINTENANCE_APPROVED!=="YES")fail("924_EXPLICIT_ISOLATION_BACKUP_APPROVAL_REQUIRED");
}
export async function inspect924(request:()=>sql.Request){
  const info=(await request().query(`SELECT @@SERVERNAME AS ServerName,DB_NAME() AS DatabaseName,ORIGINAL_LOGIN() AS LoginName,
    TRY_CONVERT(int,SERVERPROPERTY(N'ProductMajorVersion')) AS Major,
    (SELECT compatibility_level FROM sys.databases WHERE database_id=DB_ID()) AS Compat,
    (SELECT state_desc FROM sys.databases WHERE database_id=DB_ID()) AS State,
    OBJECT_ID(N'uqp.SchemaMigration',N'U') AS Ledger,
    CASE WHEN EXISTS(SELECT 1 FROM uqp.Permission WHERE Code COLLATE Latin1_General_100_BIN2=N'MANAGE_DATASET_SECURITY_SCOPE' AND DATALENGTH(Code)=58)
      AND EXISTS(SELECT 1 FROM uqp.Permission WHERE Code COLLATE Latin1_General_100_BIN2=N'CONFIRM_DATASET_CLASSIFICATION' AND DATALENGTH(Code)=60) THEN 1 ELSE 0 END AS Capabilities,
    (SELECT COUNT(*) FROM sys.database_permissions WHERE class=1 AND major_id=OBJECT_ID(N'uqp.DatasetSecurityDecision')
      AND minor_id=0 AND grantee_principal_id=DATABASE_PRINCIPAL_ID(N'public') AND state=N'D' AND permission_name IN(N'UPDATE',N'DELETE')) AS Immutable
    `)).recordset[0];
  if(!info||info.Major!==15||info.Compat!==150||info.State!=="ONLINE"||!info.Ledger)fail("924_FULL_BASELINE_OR_ENGINE_REQUIRED");
  const expected=await readdir(new URL("../../../database/migrations/",import.meta.url));
  const files=expected.filter(n=>/^\d+_.*\.sql$/i.test(n)).sort();
  if(files.length!==48||files.some(n=>Number(n.slice(0,3))>921))fail("924_BASELINE_MANIFEST_UNREVIEWED");
  const applied=(await request().query("SELECT FileName FROM uqp.SchemaMigration")).recordset.map(r=>String(r.FileName));
  if([...files,"923_dataset_metadata.sql"].some(n=>!applied.includes(n))||applied.some(n=>![...files,"923_dataset_metadata.sql",ledger924].includes(n)))fail("924_FULL_MIGRATION_MANIFEST_REQUIRED");
  const base=(await request().query(render923CatalogSql())).recordset[0]?.CatalogStatus;
  const catalog=(await request().query(render924CatalogSql())).recordset[0]?.CatalogStatus;
  return {info,catalog,state:assess924(catalog,applied.includes(ledger924),base==="EXACT_MATCH",info.Capabilities===1,info.Immutable===2)};
}
function attest(info:Record<string,unknown>){
  for(const [column,suffix] of [["ServerName","SERVER"],["DatabaseName","DATABASE"],["LoginName","LOGIN"]] as const)
    if(!process.env[`UQP_924_EXPECTED_${suffix}`]||info[column]!==process.env[`UQP_924_EXPECTED_${suffix}`])fail("924_TARGET_ATTESTATION_MISMATCH");
}
export async function apply924(pool:sql.ConnectionPool){
  const tx=new sql.Transaction(pool);let active=false,aborted=false,committing=false;
  tx.on("rollback",()=>{aborted=true;});
  try{
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);active=true;
    await new sql.Request(tx).query(`SET XACT_ABORT ON;
      DECLARE @result int; EXEC @result=sys.sp_getapplock @Resource=N'UQP_924_SCHEMA_INSTALL',@LockMode=N'Exclusive',@LockOwner=N'Transaction',@LockTimeout=5000;
      IF @result IS NULL OR @result<0 THROW 52924,'924_INSTALL_LOCK_UNAVAILABLE',1;`);
    const before=await inspect924(()=>new sql.Request(tx));attest(before.info);
    if(before.state!=="READY")fail("924_ALREADY_INSTALLED_NO_MUTATION");
    await new sql.Request(tx).batch(await render924InstallBatch());
    if((await new sql.Request(tx).query(render924CatalogSql())).recordset[0]?.CatalogStatus!=="EXACT_MATCH")fail("924_INSTALLED_CATALOG_NOT_EXACT");
    await new sql.Request(tx).input("name",sql.NVarChar(255),ledger924).query("INSERT uqp.SchemaMigration(FileName) VALUES(@name)");
    const final=await inspect924(()=>new sql.Request(tx));attest(final.info);
    if(final.state!=="INSTALLED")fail("924_FINAL_VERIFICATION_FAILED");
    committing=true;await tx.commit();active=false;
  }catch(e){
    if(active&&!aborted)try{await tx.rollback();}catch{fail("924_COMMIT_OR_ROLLBACK_UNKNOWN_VERIFY_MANUALLY");}
    if(committing)fail("924_COMMIT_OR_ROLLBACK_UNKNOWN_VERIFY_MANUALLY");
    throw e;
  }
}
async function run(){
  const args=process.argv.slice(2),mode=args[0];
  if(!["preflight","apply","verify"].includes(mode??"")||(mode!=="apply"&&args.length!==1))fail("924_USAGE_PREPARED_INSTALL_ONLY");
  if(mode==="apply")approve924(args);
  if(["SERVER","DATABASE","LOGIN"].some(k=>!process.env[`UQP_924_EXPECTED_${k}`]))fail("924_TARGET_ATTESTATION_REQUIRED");
  try{
    const pool=await getPlatformDbPool();if(!pool) return fail("924_PLATFORM_DB_NOT_CONFIGURED");
    const before=await inspect924(()=>pool.request());attest(before.info);
    if(mode==="preflight"){console.log("924_PREFLIGHT="+before.state);return;}
    if(mode==="verify"){
      if(before.state!=="INSTALLED")fail("924_NOT_INSTALLED");
      console.log("924_VERIFY=INSTALLED_EXACT_MATCH_923_UNCHANGED");return;
    }
    if(before.state!=="READY")fail("924_ALREADY_INSTALLED_NO_MUTATION");
    await apply924(pool);console.log("924_APPLY=COMMITTED_EXACT_MATCH_NO_SCOPE_GRANTS");
  }finally{await closePlatformDbPool();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))run().catch(e=>{
  console.error(e instanceof Install924Error?e.code:"924_INSTALL_FAILED_VERIFY_STATE_NO_RETRY");process.exitCode=1;
});
