/** Explicit Gate 2/4 test installer. No startup registration, generic migration or deployment. */
import {readFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {pathToFileURL} from "node:url";
import sql from "mssql";
import {getPlatformDbPool,closePlatformDbPool} from "../config/database.js";
import {readChartAuthorizedTest,attestChartAuthorizedTest} from "../modules/dashboard/dashboardChartAuthorizedTest.js";
import {inspectChart928ReadOnlyTarget,hasReviewableChart928MetadataFootprint} from "./chart928ReadOnlyTargetPreflight.js";
const root=new URL("../../../database/authorized-test/",import.meta.url);
export async function installChart928AuthorizedTest(mode:"preflight"|"apply"|"verify",getPool=getPlatformDbPool){
 const a=readChartAuthorizedTest();if(!a)throw Error("CHART_EXPLICIT_TEST_APPROVAL_FILE_REQUIRED");
 const pool=await getPool();if(!pool)throw Error("CHART_TEST_DATABASE_UNAVAILABLE");
 if(mode==="verify"){await attestChartAuthorizedTest(pool,a);return {status:"TEST_INSTALL_VERIFIED",productionApproved:false};}
 const before=await inspectChart928ReadOnlyTarget(pool,a.target);
 if(!hasReviewableChart928MetadataFootprint(before)||before.catalog925.status!=="EXACT_MATCH")throw Error("CHART_TEST_PREREQUISITES_UNPROVEN");
 if(mode==="preflight")return {status:"PREFLIGHT_ONLY",phase928:before.phase928,productionApproved:false};
 // Never adopt a partial/previously installed fixture or fabricate historical 926 ledger.
 if(before.phase928!=="ABSENT_NOT_AUTHORIZED")throw Error("CHART_TEST_INSTALL_REQUIRES_ABSENT_928");
 const manifest=JSON.parse(await readFile(new URL("928_source_manifest.json",root),"utf8")) as {files:Record<string,string>};
 const files=["928_chart_base.test-install.sql.txt","928_chart_approval.test-install.sql.txt","928_chart_writer.test-install.sql.txt"];
 const sources=await Promise.all(files.map(async name=>{
  const data=await readFile(new URL(name,root),"utf8");
  if(createHash("sha256").update(data).digest("hex")!==manifest.files[name]||data.includes("UQP_CHART_TEST_DISPOSABLE")||
   /CREATE LOGIN|GRANT EXECUTE|UPDATE @approvedChecks/.test(data))throw Error("CHART_TEST_SOURCE_DRIFT");return data;
 }));
 const tx=new sql.Transaction(pool);let committing=false;
 try{
  await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  await new sql.Request(tx).query("SET XACT_ABORT ON; SET LOCK_TIMEOUT 5000; DECLARE @l int; EXEC @l=sys.sp_getapplock @Resource=N'UQP:928:ChartTrustRelease',@LockMode=N'Exclusive',@LockOwner=N'Transaction',@LockTimeout=5000; IF @l<0 THROW 51928,'CHART_TEST_INSTALL_LOCK_DENIED',1;");
  const current=await inspectChart928ReadOnlyTarget({request:()=>new sql.Request(tx)},a.target);
  if(current.catalog925.status!=="EXACT_MATCH"||!hasReviewableChart928MetadataFootprint(current)||current.phase928!=="ABSENT_NOT_AUTHORIZED")throw Error("CHART_TEST_TARGET_CHANGED");
  const ledger=(await new sql.Request(tx).query("SELECT FileName FROM uqp.SchemaMigration WITH(UPDLOCK,HOLDLOCK) WHERE FileName LIKE N'928[_]%'")).recordset;
  if(ledger.length)throw Error("CHART_TEST_LEDGER_CONFLICT");
  for(const source of sources)await new sql.Request(tx)
   .input("UqpTestPurpose",sql.NVarChar(64),a.purpose).input("UqpTestServer",sql.NVarChar(128),a.target.server)
   .input("UqpTestDatabase",sql.NVarChar(128),a.target.database).input("UqpTestLogin",sql.NVarChar(128),a.target.login).query(source);
  await new sql.Request(tx).query("EXEC sys.sp_addextendedproperty @name=N'UQP_CHART_AUTHORIZED_TEST',@value=N'UQP_AUTHORIZED_CHART_TEST_ONLY';");
  await attestChartAuthorizedTest({request:()=>new sql.Request(tx)},a);
  if(JSON.stringify(readChartAuthorizedTest())!==JSON.stringify(a))throw Error("CHART_TEST_APPROVAL_CHANGED");
  await new sql.Request(tx).input("file",sql.NVarChar(255),"928_chart_authorized_test.sql")
   .query("INSERT uqp.SchemaMigration(FileName) VALUES(@file)");
  committing=true;await tx.commit();return {status:"TEST_INSTALL_COMMITTED",productionApproved:false};
 }catch{
  if(committing)throw Error("CHART_TEST_COMMIT_UNKNOWN_DO_NOT_RETRY");
  try{await tx.rollback();}catch{throw Error("CHART_TEST_ROLLBACK_UNKNOWN_RECONCILE");}
  throw Error("CHART_TEST_INSTALL_ROLLED_BACK");
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{const mode=process.argv[2];if(!["preflight","apply","verify"].includes(mode??""))throw Error("CHART_TEST_COMMAND_REQUIRED");
  console.log(JSON.stringify(await installChart928AuthorizedTest(mode as "preflight"|"apply"|"verify")));
 }catch(e){console.error(e instanceof Error&&/^[A-Z0-9_]+$/.test(e.message)?e.message:"CHART_TEST_INSTALL_FAILED");process.exitCode=1;}
 finally{await closePlatformDbPool();}
}
