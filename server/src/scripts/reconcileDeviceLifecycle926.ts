// Dedicated CLI: no dotenv/app config, no schema bootstrap, no migration execution.
import sql from "mssql";
import {readFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import path from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
import {parse926Approval,reconcile926,Reconcile926Error,sha926,resolve926Tls,failure926,diagnostic926,type Reconcile926Stage} from "./deviceLifecycle926Reconciliation.js";
export async function validate926Release(root:string,input:unknown){
 const a=parse926Approval(input),bytes=await readFile(path.join(root,"manifest.json"));
 if(createHash("sha256").update(bytes).digest("hex")!==a.packageManifestSha256)throw new Reconcile926Error("926_RELEASE_MANIFEST_HASH_MISMATCH");
 const m=JSON.parse(bytes.toString("utf8"));if(m.format!=="UQP_PR83_926_RELEASE_V1"||m.sourceCommit!==a.applicationSourceSha||m.migration926Sha256!==sha926||m.pr66Comparison?.behind!==0)throw new Reconcile926Error("926_RELEASE_BINDING_INVALID");
 const critical=["payload/server/dist/scripts/reconcileDeviceLifecycle926.js","payload/server/dist/scripts/deviceLifecycle926Reconciliation.js","payload/server/dist/modules/dashboard/dashboardDeviceLifecycleSchema.js","payload/database/migrations/926_dashboard_device_lifecycle.sql"];
 if(!Array.isArray(m.files)||critical.some(rel=>!m.files.some((f:any)=>f.path===rel)))throw new Reconcile926Error("926_RELEASE_FILES_REQUIRED");
 const seen=new Set<string>();
 for(const entry of m.files){
  const rel=entry.path;if(typeof rel!=="string"||/^(?:\/)|[\\:\r\n]|(?:^|\/)\.{1,2}(?:\/|$)/.test(rel)||seen.has(rel.toLowerCase()))throw new Reconcile926Error("926_RELEASE_PATH_INVALID");seen.add(rel.toLowerCase());
  if(createHash("sha256").update(await readFile(path.join(root,rel))).digest("hex")!==entry.sha256)throw new Reconcile926Error("926_RELEASE_FILE_HASH_MISMATCH");
 }
 if(path.resolve(fileURLToPath(import.meta.url))!==path.resolve(root,"payload/server/dist/scripts/reconcileDeviceLifecycle926.js"))throw new Reconcile926Error("926_CLI_MUST_RUN_FROM_VERIFIED_RELEASE");
 return a;
}
async function main(){
 let stage:Reconcile926Stage="INPUT",pool:sql.ConnectionPool|undefined,failure:Reconcile926Error|undefined,completed=false;
 try{
 const [mode,root,approvalPath,confirm]=process.argv.slice(2);
 if(!["preflight","adopt"].includes(mode??"")||!root||!approvalPath||(mode==="adopt"?confirm!=="CONFIRM_LEDGER_ONLY_926":confirm!==undefined)||process.argv.slice(2).length!==(mode==="adopt"?4:3))throw new Reconcile926Error("926_EXPLICIT_INVOCATION_REQUIRED");
 stage="APPROVAL";const input=parse926Approval(JSON.parse(await readFile(approvalPath,"utf8")));
 stage="RELEASE";const a=await validate926Release(path.resolve(root),input);
 stage="TLS";
 const tls=resolve926Tls(a,process.env.UQP_926_ADOPT_TLS_MODE);
 stage="CONNECTION";const host=process.env.UQP_926_ADOPT_HOST,password=process.env.UQP_926_ADOPT_PASSWORD;
 const port=Number(process.env.UQP_926_ADOPT_PORT??1433);
 if(!host||!password||!Number.isInteger(port)||port<1||port>65535)throw new Reconcile926Error("926_EXPLICIT_CONNECTION_REQUIRED");
 pool=new sql.ConnectionPool({server:host,port,user:a.loginName,password,database:a.databaseName,
  options:tls.options,connectionTimeout:10000,requestTimeout:20000,pool:{max:1,min:0}});
 await pool.connect();
 stage="RECONCILIATION";const receipt=await reconcile926(pool,a,mode as "preflight"|"adopt");completed=true;console.log(JSON.stringify(receipt));
 }catch(error){failure=failure926(error,stage);throw failure;}
 finally{if(pool)try{await pool.close();}catch(error){if(!failure)throw failure926(error,"CONNECTION_CLOSE",completed?"COMMITTED":"NOT_STARTED");}}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error(JSON.stringify(diagnostic926(e)));process.exitCode=1;});
