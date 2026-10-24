/** Dedicated installer. No automatic invocation by the migration runner. */
import sql from "mssql";
import {readFile} from "node:fs/promises";
import {pathToFileURL} from "node:url";
import {getPlatformDbPool,closePlatformDbPool} from "../config/database.js";
import {displayCatalogSql,displayDdlUrl,validateDisplayCatalog,DatasetDisplayError} from "../modules/dataset/datasetDisplaySchema.js";
export async function installDisplay925(pool:sql.ConnectionPool,apply:boolean){
 const ddl=await readFile(displayDdlUrl,"utf8");const status=validateDisplayCatalog((await pool.request().query(displayCatalogSql)).recordsets as unknown as Record<string,any>[][],ddl);
 if(status==="EXACT_MATCH"||!apply)return status;
 const tx=new sql.Transaction(pool);await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
 try{await new sql.Request(tx).query("SET XACT_ABORT ON; SET LOCK_TIMEOUT 10000");
  const gate=await new sql.Request(tx).query("DECLARE @r int; EXEC @r=sys.sp_getapplock @Resource=N'UQP_925_INSTALL',@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000; SELECT @r AS Code");
  if(gate.recordset[0]?.Code<0)throw new DatasetDisplayError("DISPLAY_INSTALL_LOCK_FAILED",503);
  const current=validateDisplayCatalog((await new sql.Request(tx).query(displayCatalogSql)).recordsets as unknown as Record<string,any>[][],ddl);
  if(current==="ABSENT"){await new sql.Request(tx).batch(ddl);}
  const exact=validateDisplayCatalog((await new sql.Request(tx).query(displayCatalogSql)).recordsets as unknown as Record<string,any>[][],ddl,(reason)=>console.error("925_CATALOG_MISMATCH_"+reason));
  if(exact!=="EXACT_MATCH")throw new DatasetDisplayError("DATASET_DISPLAY_SCHEMA_REQUIRED",503);
  await tx.commit();return exact;
 }catch(e){try{await tx.rollback();}catch{}throw e;}
}
export function validate925Invocation(args:string[],expected:{server?:string;database?:string;login?:string}){
 if(!["preflight","verify","apply"].includes(args[0]??"")||args.length!==(args[0]==="apply"?2:1)||args[0]==="apply"&&args[1]!=="--confirm"||!expected.server||!expected.database||!expected.login)throw new DatasetDisplayError("DISPLAY_INSTALL_EXPLICIT_TARGET_REQUIRED",400);
}
async function main(){
 const args=process.argv.slice(2),expected={server:process.env.UQP_925_EXPECTED_SERVER,database:process.env.UQP_925_EXPECTED_DATABASE,login:process.env.UQP_925_EXPECTED_LOGIN};validate925Invocation(args,expected);
 const pool=await getPlatformDbPool();if(!pool)throw new DatasetDisplayError("DISPLAY_INSTALL_CONNECTION_REQUIRED",503);
 try{const r=(await pool.request().query("SELECT @@SERVERNAME AS S,DB_NAME() AS D,ORIGINAL_LOGIN() AS L,CONVERT(int,SERVERPROPERTY('ProductMajorVersion')) AS V,IS_MEMBER('db_owner') AS OwnerFlag,USER_NAME() AS DbUser,(SELECT compatibility_level FROM sys.databases WHERE database_id=DB_ID()) AS Compatibility")).recordset[0];
  if(r.S!==expected.server||r.D!==expected.database||r.L!==expected.login||r.V!==15||r.Compatibility!==150||r.DbUser!=="dbo")throw new DatasetDisplayError("DISPLAY_INSTALL_TARGET_MISMATCH",400);
  const status=await installDisplay925(pool,args[0]==="apply");if(args[0]==="verify"&&status!=="EXACT_MATCH")throw new DatasetDisplayError("DATASET_DISPLAY_SCHEMA_REQUIRED",503);
  console.log("925_"+status);
 }finally{await closePlatformDbPool();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error(e instanceof DatasetDisplayError?e.code:"DISPLAY_INSTALL_FAILED");process.exitCode=1;});
