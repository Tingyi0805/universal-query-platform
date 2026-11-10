// Issue #89: fails closed without any target DB mutation or private patient data.
import assert from "node:assert/strict";
import test from "node:test";
import {readFile} from "node:fs/promises";
import type sql from "mssql";
import {
  CHART_928_MAY_INSTALL,chart928TargetIdentitySql,
  chart928ReadonlySourceUrl,validateChart928ReadOnlyTargetInvocation,
  examineChart925ExactCatalog,inspectChart928ReadOnlyTarget,
} from "./chart928ReadOnlyTargetPreflight.js";
import {displayCatalogSql,displayDdlUrl} from "../modules/dataset/datasetDisplaySchema.js";

const expected={server:"CI_SQL",database:"UQP_CH_123456789abc",login:"ci_reader"};
const identity={ServerName:expected.server,DatabaseName:expected.database,
  OriginalLogin:expected.login,SqlMajor:15};
const catalogAbsent:Record<string,unknown>[][]=[
  [],[],[],[],[],[],[{visible:1}],
];
const sections=(phase="ABSENT_NOT_AUTHORIZED",present=0,mayInstall=0):Record<string,unknown>[][]=>[
  [{Section:"00_RELEASE_GATE",TargetDatabase:expected.database,SqlMajor:15,
    MayInstall928:mayInstall,Assessment:"BLOCKED_INDEPENDENT_APPROVAL_REQUIRED"}],
  [],
  [{Section:"02_925_EXACT_CATALOG",Exact925IndependentlyAttested:false}],
  [],
  [{Section:"04_928_PHASE",Assessment:phase,Expected:3,Present:present,
    ChartCanBeEnabled:false}],
  [],[],[],[],
];
function fixture({
  id=identity,catalog=catalogAbsent,report=sections(),
}:{
  id?:Record<string,unknown>;
  catalog?:Record<string,unknown>[][];
  report?:Record<string,unknown>[][];
}={}){
  const requests:string[]=[];
  const pool={request:()=>({query:async(text:string)=>{
    requests.push(text);
    if(text===chart928TargetIdentitySql)return {recordset:[id]};
    if(text===displayCatalogSql)return {recordsets:catalog};
    if(text.includes("00_RELEASE_GATE"))return {recordsets:report};
    throw Error("UNEXPECTED_SQL");
  }})} as unknown as sql.ConnectionPool;
  return {pool,requests};
}
test("preflight requires explicit, exact original-login target and never grants installation",()=>{
  assert.equal(CHART_928_MAY_INSTALL,false);
  assert.throws(()=>validateChart928ReadOnlyTargetInvocation([] ,expected));
  assert.throws(()=>validateChart928ReadOnlyTargetInvocation(["apply"],expected));
  assert.throws(()=>validateChart928ReadOnlyTargetInvocation(["preflight","--confirm"],expected));
  assert.throws(()=>validateChart928ReadOnlyTargetInvocation(["preflight"],
    {...expected,login:""}));
  assert.throws(()=>validateChart928ReadOnlyTargetInvocation(["preflight"],
    {...expected,database:" DB "}));
  validateChart928ReadOnlyTargetInvocation(["preflight"],expected);
});
test("exact reviewed 925 catalog parser distinguishes absent, partial and invisible",async()=>{
  const ddl=await readFile(displayDdlUrl,"utf8");
  assert.deepEqual(examineChart925ExactCatalog(catalogAbsent,ddl),
    {status:"ABSENT",reason:"925_NOT_INSTALLED"});
  assert.equal(examineChart925ExactCatalog([
    [{name:"DatasetPublicDisplayPolicy"}],[],[],[],[],[],[{visible:1}],
  ],ddl).status,"BLOCKED_MISMATCH");
  assert.equal(examineChart925ExactCatalog([
    [],[],[],[],[],[],[{visible:0}],
  ],ddl).status,"BLOCKED_MISMATCH");
  assert.equal(examineChart925ExactCatalog([],ddl).status,"BLOCKED_MISMATCH");
});
test("wrong target blocks before either catalog SELECT",async()=>{
  for(const id of [
    {...identity,OriginalLogin:"other"},
    {...identity,DatabaseName:"UniversalQueryPlatform"},
    {...identity,ServerName:"other-sql"},
    {...identity,SqlMajor:14},
  ]){
    const f=fixture({id});
    await assert.rejects(inspectChart928ReadOnlyTarget(f.pool,expected),
      /CHART_928_READONLY_TARGET_MISMATCH/);
    assert.deepEqual(f.requests,[chart928TargetIdentitySql]);
  }
});
test("925 absence and every 928 state remain independently NOT approved",async()=>{
  const source=await readFile(chart928ReadonlySourceUrl,"utf8");
  for(const [phase,present] of [
    ["ABSENT_NOT_AUTHORIZED",0],
    ["BLOCKED_PARTIAL_OR_CONFLICT",1],
    ["BLOCKED_PARTIAL_OR_CONFLICT",2],
    ["PRESENT_REQUIRES_EXACT_ATTESTATION",3],
  ] as const){
    const f=fixture({report:sections(phase,present)});
    const result=await inspectChart928ReadOnlyTarget(f.pool,expected);
    assert.equal(result.catalog925.status,"ABSENT");
    assert.equal(result.phase928,phase);
    assert.equal(result.sidecarsPresent,present);
    assert.equal(result.mayInstall928,false);
    assert.equal(result.chartCanBeEnabled,false);
    assert.equal(result.assessment,"BLOCKED_INDEPENDENT_APPROVAL_REQUIRED");
    assert.deepEqual(f.requests,
      [chart928TargetIdentitySql,displayCatalogSql,source]);
  }
});
test("tampered 928 report cannot self-approve an installation",async()=>{
  for(const report of [
    sections("ABSENT_NOT_AUTHORIZED",0,1),
    sections("ABSENT_NOT_AUTHORIZED",3),
    sections("PRESENT_REQUIRES_EXACT_ATTESTATION",1),
    sections("BLOCKED_PARTIAL_OR_CONFLICT",0),
    sections("BLOCKED_PARTIAL_OR_CONFLICT",3),
  ]){
    const f=fixture({report});
    await assert.rejects(inspectChart928ReadOnlyTarget(f.pool,expected),
      /CHART_928_READONLY_REPORT_INVALID/);
  }
});
