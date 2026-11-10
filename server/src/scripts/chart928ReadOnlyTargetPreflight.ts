// Issue #89: read-only, exact-925 + 928 inventory inspection.
// This is NOT a migration, an authorization, an IIS command, or a way to
// turn on the CHART Writer, Signer, projection or public playback.
import {readFile} from "node:fs/promises";
import {pathToFileURL} from "node:url";
import type sql from "mssql";
import {
  displayCatalogSql, displayDdlUrl, validateDisplayCatalog,
} from "../modules/dataset/datasetDisplaySchema.js";
import {getPlatformDbPool,closePlatformDbPool} from "../config/database.js";
import {
  chartHistoricalFootprintSql,chartHistoricalLedgerSql,
  parseChartHistoricalFootprints,type ChartHistoricalFootprint,
} from "./chart928HistoricalFootprint.js";

export const CHART_928_MAY_INSTALL=false as const;
export const chart928ReadonlySourceUrl=new URL(
  "../../../database/acceptance/chart-928-adoption-preflight-readonly.sql",
  import.meta.url,
);
export const chart928TargetIdentitySql=[
  "SELECT CONVERT(nvarchar(256),@@SERVERNAME) AS ServerName,",
  "DB_NAME() AS DatabaseName,ORIGINAL_LOGIN() AS OriginalLogin,",
  "CONVERT(int,SERVERPROPERTY('ProductMajorVersion')) AS SqlMajor",
].join(" ");

export type Chart928ExpectedTarget=Readonly<{
  server:string;database:string;login:string;
}>;
export type Chart925ExactEvidence=Readonly<{
  status:"EXACT_MATCH"|"ABSENT"|"BLOCKED_MISMATCH";
  reason:string;
}>;
export type Chart928ReadOnlyTargetEvidence=Readonly<{
  target:Chart928ExpectedTarget;
  sqlMajor:15|16;
  catalog925:Chart925ExactEvidence;
  phase928:"ABSENT_NOT_AUTHORIZED"|"BLOCKED_PARTIAL_OR_CONFLICT"|
    "PRESENT_REQUIRES_EXACT_ATTESTATION";
  sidecarsPresent:number;
  // Independent footprint and Ledger facts; not equivalent to exact
  // 926/927 migration attestation or permission to install 928.
  schema926:ChartHistoricalFootprint;
  schema927:ChartHistoricalFootprint;
  mayInstall928:false;
  chartCanBeEnabled:false;
  assessment:"BLOCKED_INDEPENDENT_APPROVAL_REQUIRED";
}>;
const nonEmpty=(s:unknown):s is string=>
  typeof s==="string" && s.trim().length>0 && s===s.trim();
const safeReason=(reason:string):string=>
  /^(?:COLUMN|CONSTRAINT|INDEX)_[A-Za-z0-9_]+$/.test(reason)||
  ["CATALOG_COUNTS","CATALOG_MISMATCH","CATALOG_EXPRESSION_UNKNOWN"].includes(reason)
  ?reason:"CATALOG_MISMATCH";

export function validateChart928ReadOnlyTargetInvocation(
  args:readonly string[],expected:Chart928ExpectedTarget,
):void{
  if(args.length!==1||args[0]!=="preflight"||
    !nonEmpty(expected.server)||!nonEmpty(expected.database)||
    !nonEmpty(expected.login))
    throw Error("CHART_928_EXPLICIT_TARGET_REQUIRED");
}

/** Uses the already-reviewed exact 925 catalog validator; table counts and
 * 928 SQL's minimum-presence flag can NEVER substitute for its result.
 * SQL errors or invisible metadata always block; no guessed adoption.
 */
export function examineChart925ExactCatalog(
  sets:Record<string,unknown>[][],ddl:string,
):Chart925ExactEvidence{
  let reason="CATALOG_MISMATCH";
  try{
    const status=validateDisplayCatalog(sets,ddl,r=>{reason=safeReason(r);});
    return {status,reason:status==="EXACT_MATCH"?"EXACT_SOURCE_MATCH":"925_NOT_INSTALLED"};
  }catch{
    return {status:"BLOCKED_MISMATCH",reason:safeReason(reason)};
  }
}

function recordsetsOf(value:unknown):Record<string,unknown>[][]{
  if(!Array.isArray(value)||value.some(s=>!Array.isArray(s)))
    throw Error("CHART_928_CATALOG_RESULT_INVALID");
  return value as Record<string,unknown>[][];
}

/** Before inspecting either catalog, pin *original* login, SQL Server and DB.
 * Only static SELECT queries from the checked-in source are executed. This
 * function has no apply/approval mode and cannot provision any SQL objects.
 */
export async function inspectChart928ReadOnlyTarget(
  pool:Pick<sql.ConnectionPool,"request">,expected:Chart928ExpectedTarget,
):Promise<Chart928ReadOnlyTargetEvidence>{
  validateChart928ReadOnlyTargetInvocation(["preflight"],expected);
  if(!pool||typeof pool.request!=="function")
    throw Error("CHART_928_READONLY_CONNECTION_REQUIRED");
  const identity=await pool.request().query(chart928TargetIdentitySql);
  if(identity.recordset?.length!==1)
    throw Error("CHART_928_READONLY_TARGET_UNAVAILABLE");
  const row=identity.recordset[0]!;
  if(row.ServerName!==expected.server||
     row.DatabaseName!==expected.database||
     row.OriginalLogin!==expected.login||
     (row.SqlMajor!==15 && row.SqlMajor!==16))
    throw Error("CHART_928_READONLY_TARGET_MISMATCH");

  const [ddl,adoptionSql]=await Promise.all([
    readFile(displayDdlUrl,"utf8"),readFile(chart928ReadonlySourceUrl,"utf8"),
  ]);
  const catalog=await pool.request().query(displayCatalogSql);
  const catalog925=examineChart925ExactCatalog(
    recordsetsOf(catalog.recordsets),ddl,
  );
  const adoption=await pool.request().query(adoptionSql);
  const sections=recordsetsOf(adoption.recordsets);
  const release=sections[0]?.[0],min925=sections[2]?.[0];
  const phase=sections[4]?.[0];
  const values=[
    "ABSENT_NOT_AUTHORIZED","BLOCKED_PARTIAL_OR_CONFLICT",
    "PRESENT_REQUIRES_EXACT_ATTESTATION",
  ] as const;
  const phase928=phase?.Assessment;
  if(sections.length!==9||
     release?.Section!=="00_RELEASE_GATE"||
     release.TargetDatabase!==expected.database||
     release.SqlMajor!==row.SqlMajor||
     (release.MayInstall928!==0 && release.MayInstall928!==false)||
     release.Assessment!=="BLOCKED_INDEPENDENT_APPROVAL_REQUIRED"||
     min925?.Section!=="02_925_EXACT_CATALOG"||
     (min925.Exact925IndependentlyAttested!==0&&
      min925.Exact925IndependentlyAttested!==false)||
     phase?.Section!=="04_928_PHASE"||
     !values.some(v=>v===phase928)||
     Number(phase.Expected)!==3||
     !Number.isSafeInteger(Number(phase.Present))||
     Number(phase.Present)<0||Number(phase.Present)>3||
     (phase.ChartCanBeEnabled!==0&&phase.ChartCanBeEnabled!==false)||
     (Number(phase.Present)===0)!==(phase928==="ABSENT_NOT_AUTHORIZED")||
     (Number(phase.Present)===3)!==(phase928==="PRESENT_REQUIRES_EXACT_ATTESTATION"))
    throw Error("CHART_928_READONLY_REPORT_INVALID");
  // These catalog-only queries never inspect patient/device/PIN data.
  // SQL ledger rows are names only; recorded is NOT exact attestation.
  // Missing Ledger/read permissions are fatal rather than guessed ABSENT.
  const footprintInventory=await pool.request().query(chartHistoricalFootprintSql);
  const footprintLedger=await pool.request().query(chartHistoricalLedgerSql);
  const historical=parseChartHistoricalFootprints(
    footprintInventory.recordset,footprintLedger.recordset,
  );
  return Object.freeze({
    target:{...expected},sqlMajor:row.SqlMajor as 15|16,
    catalog925,phase928:phase928 as typeof values[number],
    sidecarsPresent:Number(phase.Present),
    ...historical,
    mayInstall928:CHART_928_MAY_INSTALL,
    chartCanBeEnabled:false as const,
    assessment:"BLOCKED_INDEPENDENT_APPROVAL_REQUIRED" as const,
  });
}

async function main():Promise<void>{
  const expected:Chart928ExpectedTarget={
    server:process.env.UQP_CHART_PREFLIGHT_EXPECTED_SERVER??"",
    database:process.env.UQP_CHART_PREFLIGHT_EXPECTED_DATABASE??"",
    login:process.env.UQP_CHART_PREFLIGHT_EXPECTED_LOGIN??"",
  };
  validateChart928ReadOnlyTargetInvocation(process.argv.slice(2),expected);
  const pool=await getPlatformDbPool();
  if(!pool)throw Error("CHART_928_READONLY_CONNECTION_REQUIRED");
  try{
    const result=await inspectChart928ReadOnlyTarget(pool,expected);
    console.log(JSON.stringify(result,null,2));
    if(result.catalog925.status!=="EXACT_MATCH")process.exitCode=2;
  }finally{await closePlatformDbPool();}
}
// No imports into the UQP service router; only an explicit local CLI command.
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)
  main().catch(()=>{console.error("CHART_928_READONLY_PREFLIGHT_BLOCKED");process.exitCode=1;});
