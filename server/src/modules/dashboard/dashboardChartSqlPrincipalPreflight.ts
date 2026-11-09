// Issue #89: read-only, cross-checking SQL identity evidence for the
// independently provisioned Chart Issuer and Writer. This module never
// provisions SQL logins, executes DML, accesses a signer private key or
// changes Migration 928. Each invocation verifies BOTH reviewed procedures.
import type sql from "mssql";
import {
  attestChartIssuerSqlPools,CHART_ISSUER_APPROVED_PROCEDURE_SHA256,
} from "./dashboardChartIssuerBoundary.js";
import {
  attestChartWriterSqlPools,CHART_WRITER_APPROVED_PROCEDURE_SHA256,
} from "./dashboardChartWriterBoundary.js";

export const CHART_SQL_PRINCIPAL_PREFLIGHT_RELEASE_APPROVED=false as const;
export type ChartSqlPrincipalPools=Readonly<{
  platform:sql.ConnectionPool;issuer:sql.ConnectionPool;
  writer:sql.ConnectionPool;
}>;
export type ReviewedChartSqlProcedures=Readonly<{
  issuerSha256:string|null;writerSha256:string|null;
}>;
const digest=(value:unknown):value is string=>
  typeof value==="string"&&/^[0-9a-f]{64}$/.test(value);

/** No SQL query or fallback runs without two explicit reviewed procedure
 * hashes and a positive release predicate. In a synthetic unit test only,
 * the predicate and procedure hashes can be injected. Real runtime calls
 * MUST use createReleaseDisabledChartSqlPrincipalPreflight below.
 */
export function createDormantChartSqlPrincipalPreflight(
  pools:ChartSqlPrincipalPools,
  reviewed:ReviewedChartSqlProcedures,
  approved:()=>boolean=()=>false,
):()=>Promise<void>{
  return async()=>{
    if(!approved()||!pools.platform||!pools.issuer||!pools.writer||
       pools.platform===pools.issuer||
       pools.platform===pools.writer||
       pools.issuer===pools.writer||
       !digest(reviewed.issuerSha256)||!digest(reviewed.writerSha256))
      throw Error("CHART_SQL_PRINCIPAL_APPROVAL_REQUIRED");
    // Issuer attestation checks THREE original-login SIDs, target DB,
    // least privilege, signature-issuer execute and Issuer procedure hash.
    await attestChartIssuerSqlPools(
      pools.platform,pools.issuer,pools.writer,reviewed.issuerSha256);
    // Writer attestation independently checks exact reviewed Writer SQL,
    // original-login identity, direct DML and db_datareader absence.
    await attestChartWriterSqlPools(
      pools.platform,pools.writer,reviewed.writerSha256);
  };
}

/** Immutable release boundary: ordinary UQP cannot promote a Draft SQL
 * fixture into production by supplying hashes through env/body/headers.
 * Both reviewed hashes are pinned to null and this gate to false.
 */
export function createReleaseDisabledChartSqlPrincipalPreflight(
  pools:ChartSqlPrincipalPools,
):()=>Promise<void>{
  return createDormantChartSqlPrincipalPreflight(pools,{
    issuerSha256:CHART_ISSUER_APPROVED_PROCEDURE_SHA256,
    writerSha256:CHART_WRITER_APPROVED_PROCEDURE_SHA256,
  },()=>CHART_SQL_PRINCIPAL_PREFLIGHT_RELEASE_APPROVED);
}
