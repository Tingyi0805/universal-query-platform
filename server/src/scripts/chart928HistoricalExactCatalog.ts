// Issue #89: reuse independent existing 926 and 927 exact catalog validators.
// NO application-table DML, migration execution, approval or runtime switch.
// 927 uses only transient T-SQL table variables to compare metadata; no
// persistent object or user/clinical table is read or written here.
import type sql from "mssql";
import {deviceLifecycleSchemaSql} from "../modules/dashboard/dashboardDeviceLifecycleSchema.js";
import {workstationPinSchemaSql} from "../modules/auth/workstationPinSchema.js";
import type {ChartHistoricalFootprint} from "./chart928HistoricalFootprint.js";

export type ChartHistoricalExactCatalogStatus=
  "EXACT_REVIEWED_CATALOG_MATCH"|
  "NOT_RUN_FOOTPRINT_INCOMPLETE"|
  "BLOCKED_CATALOG_MISMATCH_OR_INVISIBLE";
export type ChartHistoricalExactCatalogEvidence=Readonly<{
  schema926:ChartHistoricalExactCatalogStatus;
  schema927:ChartHistoricalExactCatalogStatus;
  // Even both exact catalog matches do not establish source provenance,
  // SQL principal identity, signer, patient privacy or deployment approval.
  approves928:false;
}>;

/** Run only against the already-pinned SQL 2019/2022 target.
 * Throws inside validators are caught and reported as blocked, never as
 * evidence of an installed or repaired schema. No schema modification.
 */
export async function verifyChartHistoricalExactCatalog(
  pool:Pick<sql.ConnectionPool,"request">,
  footprint:Readonly<{schema926:ChartHistoricalFootprint;schema927:ChartHistoricalFootprint}>,
):Promise<ChartHistoricalExactCatalogEvidence>{
  const check=async(
    status:ChartHistoricalFootprint,
    statement:string,
  ):Promise<ChartHistoricalExactCatalogStatus>=>{
    if(status.status!=="PRESENT_REQUIRES_EXACT_ATTESTATION")
      return "NOT_RUN_FOOTPRINT_INCOMPLETE";
    try{
      await pool.request().query(statement);
      return "EXACT_REVIEWED_CATALOG_MATCH";
    }catch{
      // Do not return SQL error details, credentials, trigger definitions,
      // PIN/device values or data excerpts in operator evidence.
      return "BLOCKED_CATALOG_MISMATCH_OR_INVISIBLE";
    }
  };
  const schema926=await check(footprint.schema926,deviceLifecycleSchemaSql);
  const schema927=await check(footprint.schema927,workstationPinSchemaSql);
  return Object.freeze({schema926,schema927,approves928:false as const});
}
