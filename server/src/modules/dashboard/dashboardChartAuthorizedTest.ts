/** Gate 4 test activation only. Existing production release constants remain false. */
import {readFileSync} from "node:fs";
import {z} from "zod";
import {env} from "../../config/env.js";
import {getPlatformDbPool} from "../../config/database.js";
import sql from "mssql";
const target=z.object({server:z.string().trim().min(1).max(128),database:z.string().trim().min(1).max(128),login:z.string().trim().min(1).max(128)}).strict();
export const chartAuthorizedTestSchema=z.object({version:z.literal(1),purpose:z.literal("UQP_AUTHORIZED_CHART_TEST_ONLY"),target,
 dashboardIds:z.array(z.number().int().positive().safe()).min(1).max(100),expiresAt:z.iso.datetime(),
 changeReceipt:z.string().trim().min(1).max(200),backupReceipt:z.string().trim().min(1).max(200),
 privacy:z.literal("EXISTING_REVIEW_AND_PATIENT_AUDIT_REQUIRED")}).strict();
export type ChartAuthorizedTest=z.infer<typeof chartAuthorizedTestSchema>;
export function parseChartAuthorizedTest(value:unknown,nodeEnv:string,now=Date.now()):ChartAuthorizedTest|null{
 const r=chartAuthorizedTestSchema.safeParse(value);if(nodeEnv!=="test"||!r.success)return null;
 const a=r.data,t=Date.parse(a.expiresAt);
 if(t<=now||t-now>7*86400000||new Set(a.dashboardIds).size!==a.dashboardIds.length||
  ["master","model","msdb","tempdb"].includes(a.target.database.toLowerCase()))return null;
 return Object.freeze(a);
}
export function readChartAuthorizedTest():ChartAuthorizedTest|null{
 if(env.NODE_ENV!=="test"||!process.env.UQP_CHART_AUTHORIZED_TEST_FILE)return null;
 try{return parseChartAuthorizedTest(JSON.parse(readFileSync(process.env.UQP_CHART_AUTHORIZED_TEST_FILE,"utf8")),env.NODE_ENV);}catch{return null;}
}
export const chartAuthorizedTestEnabled=()=>readChartAuthorizedTest()!==null;
export async function attestChartAuthorizedTest(pool:Pick<sql.ConnectionPool,"request">,approval:ChartAuthorizedTest):Promise<void>{
 const manifest=JSON.parse(readFileSync(new URL("../../../../database/authorized-test/928_source_manifest.json",import.meta.url),"utf8")) as {modules:Record<string,string>};
 const witness=(await pool.request().query(`SELECT CONVERT(nvarchar(128),@@SERVERNAME) ServerName,DB_NAME() DatabaseName,ORIGINAL_LOGIN() LoginName,
 CONVERT(int,SERVERPROPERTY('ProductMajorVersion')) Engine,
 (SELECT CONVERT(nvarchar(128),value) FROM sys.extended_properties WHERE class=0 AND name=N'UQP_CHART_AUTHORIZED_TEST') TestTarget;`)).recordset;
 const w=witness[0];
 if(witness.length!==1||w.ServerName!==approval.target.server||w.DatabaseName!==approval.target.database||w.LoginName!==approval.target.login||
  ![15,16].includes(w.Engine)||w.TestTarget!=="UQP_AUTHORIZED_CHART_TEST_ONLY")throw Error("CHART_TEST_TARGET_NOT_ATTESTED");
 const rows=(await pool.request().query(`SELECT o.name Name,LOWER(CONVERT(varchar(64),HASHBYTES('SHA2_256',CONVERT(varbinary(max),m.definition)),2)) Digest,
 COALESCE(t.is_disabled,0) Disabled FROM sys.objects o JOIN sys.sql_modules m ON m.object_id=o.object_id
 LEFT JOIN sys.triggers t ON t.object_id=o.object_id WHERE o.schema_id=SCHEMA_ID(N'uqp') AND o.name IN
 (N'TR_DashboardWidget_ChartFreeze',N'TR_ChartSeal_DeleteBlock',N'TR_ChartReview_Transition',N'TR_ChartTrustRequest_Immutable',
 N'TR_ChartSeal_AuditReceipt',N'TR_ChartReview_AuditReceipt',N'TR_ChartTrustRequest_AuditReceipt',N'usp_DashboardChartCreate');`)).recordset;
 if(rows.length!==Object.keys(manifest.modules).length||rows.some(r=>manifest.modules[r.Name]!==r.Digest||![false,0].includes(r.Disabled)))throw Error("CHART_TEST_MODULE_DRIFT");
}
export async function requireChartAuthorizedTest(dashboardId:number):Promise<void>{
 const a=readChartAuthorizedTest();if(!a||!a.dashboardIds.includes(dashboardId))throw Error("CHART_TEST_SCOPE_DENIED");
 const pool=await getPlatformDbPool();if(!pool)throw Error("CHART_TEST_DATABASE_UNAVAILABLE");
 await attestChartAuthorizedTest(pool,a);
 if(JSON.stringify(readChartAuthorizedTest())!==JSON.stringify(a))throw Error("CHART_TEST_EXPIRED");
}
