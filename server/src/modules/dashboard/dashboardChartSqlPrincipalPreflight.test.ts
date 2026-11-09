import assert from "node:assert/strict";
import test from "node:test";
import type sql from "mssql";
import {
  chartIssuerIdentitySql,
} from "./dashboardChartIssuerBoundary.js";
import {
  chartWriterIdentitySql,
} from "./dashboardChartWriterBoundary.js";
import {
  CHART_SQL_PRINCIPAL_PREFLIGHT_RELEASE_APPROVED,
  createDormantChartSqlPrincipalPreflight,
  createReleaseDisabledChartSqlPrincipalPreflight,
} from "./dashboardChartSqlPrincipalPreflight.js";

const issuerDigest="a".repeat(64),writerDigest="f".repeat(64);
const issuerBase={
  DbName:"UQP_TEST",ServerName:"CI_SQL",OriginalSid:"AA",EffectiveUser:"platform",
  IssuerProcedureId:123,IssuerProcedureSha256:issuerDigest,
  Sysadmin:0,ServerControl:0,ServerImpersonateAny:0,ServerAlterLogins:0,
  ServerAlterRoles:0,ServerSelectAllUserData:0,
  DbOwner:0,DbDdlAdmin:0,DbSecurityAdmin:0,DbDataWriter:0,
  DbDataReader:0,DbAccessAdmin:0,DbControl:0,DbAlterAnyUser:0,
  DbAlterAnyRole:0,DbAlterAnySchema:0,SchemaControl:0,SchemaAlter:0,
  ImpersonateIssuer:0,IssueAlter:0,
  GrantSelect:0,GrantInsert:0,GrantUpdate:0,GrantDelete:0,
  IssueExecute:0,CreateExecute:0,ConsumeExecute:0,
};
const writerBase={
  DbName:"UQP_TEST",ServerName:"CI_SQL",OriginalSid:"AA",EffectiveUser:"platform",
  ProcedureId:321,ProcedureSha256:writerDigest,
  Sysadmin:0,ServerControl:0,ServerImpersonateAny:0,ServerAlterLogins:0,
  ServerAlterRoles:0,ServerSelectAllUserData:0,
  DbOwner:0,DbDdlAdmin:0,DbSecurityAdmin:0,DbDataWriter:0,
  DbDataReader:0,DbAccessAdmin:0,
  DbAlterAnyUser:0,DbAlterAnyRole:0,DbAlterAnySchema:0,
  DbControl:0,SchemaControl:0,SchemaAlter:0,
  ImpersonateWriter:0,CreateExecute:0,CreateAlter:0,
  PermitInsert:0,SealInsert:0,LedgerInsert:0,ReviewUpdate:0,
  WidgetInsert:0,WidgetUpdate:0,WidgetDelete:0,
};
function fixture(){
  let queries=0;
  const rows:Record<string,Record<string,unknown>>={
    platformIssuer:{...issuerBase},
    issuerIssuer:{...issuerBase,OriginalSid:"BB",EffectiveUser:"issuer",IssueExecute:1},
    writerIssuer:{...issuerBase,OriginalSid:"CC",EffectiveUser:"writer",CreateExecute:1},
    platformWriter:{...writerBase},
    writerWriter:{...writerBase,OriginalSid:"CC",EffectiveUser:"writer",CreateExecute:1},
  };
  const pool=(role:"platform"|"issuer"|"writer")=>({
    request:()=>({query:async(text:string)=>{
      queries++;
      if(text===chartIssuerIdentitySql)
        return {recordset:[rows[role+"Issuer"]]};
      if(text===chartWriterIdentitySql)
        return {recordset:[rows[role+"Writer"]]};
      throw Error("UNEXPECTED_QUERY");
    }}),
  }) as unknown as sql.ConnectionPool;
  const pools={platform:pool("platform"),issuer:pool("issuer"),writer:pool("writer")};
  return {rows,pools,get queries(){return queries;}};
}
const digests={issuerSha256:issuerDigest,writerSha256:writerDigest};

test("production default refuses before ANY SQL metadata query",async()=>{
  const f=fixture();
  assert.equal(CHART_SQL_PRINCIPAL_PREFLIGHT_RELEASE_APPROVED,false);
  await assert.rejects(createReleaseDisabledChartSqlPrincipalPreflight(f.pools));
  assert.equal(f.queries,0);
  await assert.rejects(createDormantChartSqlPrincipalPreflight(f.pools,digests));
  assert.equal(f.queries,0);
  for(const invalid of [
    {...digests,issuerSha256:null},
    {...digests,writerSha256:null},
    {...digests,writerSha256:"browser"},
  ]){
    await assert.rejects(createDormantChartSqlPrincipalPreflight(
      f.pools,invalid,()=>true));
    assert.equal(f.queries,0);
  }
});

test("only three distinct, pinned SQL identities with both procedure hashes pass",async()=>{
  const f=fixture();
  await assert.doesNotReject(createDormantChartSqlPrincipalPreflight(
    f.pools,digests,()=>true));
  assert.equal(f.queries,5);
  for(const invalid of [
    {...f.pools,issuer:f.pools.platform},
    {...f.pools,writer:f.pools.issuer},
    {...f.pools,platform:f.pools.writer},
  ]){
    await assert.rejects(createDormantChartSqlPrincipalPreflight(
      invalid,digests,()=>true));
  }
  assert.equal(f.queries,5,"duplicate SQL pools must reject without touching DB");
});

test("cross-attestation rejects Writer db_datareader and drifted SQL procedure",async()=>{
  const f=fixture(),check=createDormantChartSqlPrincipalPreflight(
    f.pools,digests,()=>true);
  f.rows.writerWriter!.DbDataReader=1;
  await assert.rejects(check());
  f.rows.writerWriter!.DbDataReader=0;
  f.rows.writerIssuer!.OriginalSid="AA";
  await assert.rejects(check());
  f.rows.writerIssuer!.OriginalSid="CC";
  f.rows.issuerIssuer!.IssuerProcedureSha256="b".repeat(64);
  await assert.rejects(check());
  f.rows.issuerIssuer!.IssuerProcedureSha256=issuerDigest;
  f.rows.writerWriter!.ProcedureSha256="e".repeat(64);
  await assert.rejects(check());
  f.rows.writerWriter!.ProcedureSha256=writerDigest;
  f.rows.writerWriter!.WidgetInsert=1;
  await assert.rejects(check());
  f.rows.writerWriter!.WidgetInsert=0;
  f.rows.writerWriter!.DbName="WRONG_DATABASE";
  await assert.rejects(check());
  f.rows.writerWriter!.DbName="UQP_TEST";
  await assert.doesNotReject(check());
});
