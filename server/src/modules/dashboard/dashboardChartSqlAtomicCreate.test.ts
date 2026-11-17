import assert from "node:assert/strict";
import test from "node:test";
import type sql from "mssql";
import {readFile} from "node:fs/promises";
import {
  CHART_SQL_ATOMIC_CREATE_RELEASE_APPROVED,
  chartIssuerGrantSql,chartWriterCreateSql,createDormantSqlChartAtomicCreate,
  createPreflightBoundDormantSqlChartAtomicCreate,
  createReleaseDisabledChartSqlAtomicCreate,
} from "./dashboardChartSqlAtomicCreate.js";
import {
  planDormantChartCreate,
} from "./dashboardChartAtomicCreate.contract.js";
import type {VerifiedSqlChartIssuerProof} from "./dashboardChartIndependentIssuerProof.js";

const now=1_800_000_000_000;
const plan=planDormantChartCreate({
  dashboardId:7,profileId:22,actorId:8,tokenVersion:3,
  requestId:"00000000-0000-4000-8000-000000000011",
  config:{version:1,chartType:"BAR",dataSourceKey:"PRIMARY",
    categoryColumn:"ROOM",valueColumn:"TOTAL",valueMode:"QUERY_RESULT",
    maxPoints:20,showLegend:true},
  placement:{x:80,y:80,width:600,height:360},
});
assert(plan);
const signed:VerifiedSqlChartIssuerProof={
  ActorId:8,TokenVersion:3,DashboardId:7,ProfileId:22,
  RequestId:plan.requestId,SourceKey:plan.sourceKey,
  ConfigSha256:plan.config.sha256,
  X:80,Y:80,Width:600,Height:360,
  Nonce:"44444444-4444-4444-4444-444444444444",
  IssuedAtUtc:new Date(now-500),
  ExpiresAtUtc:new Date(now+6000),
  Signature:Buffer.alloc(32,0x22),
};
const grant="55555555-5555-4555-8555-555555555555";
const receipt={WidgetId:88,AuditLogId:"9007199254740993",
  Digest:plan.config.sha256,SealRevision:"0011223344556677"};
const bearer="Bearer synthetic.jwt.signature";

function fixture(){
  let approved=false,allowAttest=true,liveNow=now;
  let issuerRows:unknown[]=[{GrantId:grant,Secret:Buffer.alloc(32,0x11)}];
  let writerRows:unknown[]=[receipt];
  let handed:VerifiedSqlChartIssuerProof|null=signed;
  let issuerCalls=0,writerCalls=0,attestCalls=0,handoffCalls=0;
  let capturedIssuer:Record<string,unknown>={},capturedWriter:Record<string,unknown>={};
  let lastSecret:Buffer|null=null;
  // Build the fluent mssql.Request double without a DB connection.
  const mkPool=(kind:"issuer"|"writer")=>{
    return {request:()=>{
      const inputs:Record<string,unknown>={};
      const request={
        input:(name:string,_type:unknown,value:unknown)=>{
          inputs[name]=Buffer.isBuffer(value)?Buffer.from(value):value;
          return request;
        },
        query:async(query:string)=>{
          if(kind==="issuer"){
            assert.equal(query,chartIssuerGrantSql);
            issuerCalls++;capturedIssuer=inputs;
            const rows=issuerRows;
            if(rows.length===1&&rows[0]&&typeof rows[0]==="object"){
              const r=rows[0] as {Secret?:unknown};
              if(Buffer.isBuffer(r.Secret))lastSecret=r.Secret;
            }
            return {recordset:rows};
          }
          assert.equal(query,chartWriterCreateSql);
          writerCalls++;capturedWriter=inputs;
          return {recordset:writerRows};
        },
      };
      return request;
    }} as unknown as sql.ConnectionPool;
  };
  const issuerPool=mkPool("issuer"),writerPool=mkPool("writer");
  const deps={
    issuerPool,writerPool,
    enabled:()=>approved,
    now:()=>liveNow,
    attestIndependentPrincipals:async()=>{
      attestCalls++;
      if(!allowAttest)throw Error("UNAPPROVED_SQL_SID");
    },
    handoff:async(p:typeof plan,b:string)=>{
      handoffCalls++;
      assert.deepEqual(p,plan);assert.equal(b,bearer);
      return handed;
    },
  };
  return {
    deps,
    execute:createDormantSqlChartAtomicCreate(deps),
    setApproved:(value:boolean)=>{approved=value;},
    setAttest:(value:boolean)=>{allowAttest=value;},
    setIssuer:(rows:unknown[])=>{issuerRows=rows;},
    setWriter:(rows:unknown[])=>{writerRows=rows;},
    setProof:(proof:VerifiedSqlChartIssuerProof|null)=>{handed=proof;},
    setNow:(value:number)=>{liveNow=value;},
    get issuerCalls(){return issuerCalls;},
    get writerCalls(){return writerCalls;},
    get attestCalls(){return attestCalls;},
    get handoffCalls(){return handoffCalls;},
    get capturedIssuer(){return capturedIssuer;},
    get capturedWriter(){return capturedWriter;},
    get lastSecret(){return lastSecret;},
  };
}

test("future SQL create is pinned to the reviewed Signed Issuer ABI, not legacy issue",()=>{
  assert.match(chartIssuerGrantSql,/EXEC uqp\.usp_ChartDelegationIssueSigned\s/);
  assert.doesNotMatch(chartIssuerGrantSql,/EXEC uqp\.usp_ChartDelegationIssue\s/);
  assert.match(chartIssuerGrantSql,/@Signature=@signature/);
  assert.match(chartIssuerGrantSql,/@Nonce=@nonce/);
  assert.match(chartIssuerGrantSql,/@ExpiresAtUtc=@expires/);
});

test("disposable SQL Writer binds source key byte-exactly to Signer and Issuer grant",async()=>{
  // SQL Server pads trailing spaces for '=' even under BIN2 collation.
  // Both the active Query binding and one-time grant must reject that alias.
  // Only the disposable fixture is tested, NOT a production migration.
  const url=new URL(
    "../../../../database/drafts/928_chart_atomic_create_with_delegation.sql.draft",
    import.meta.url,
  );
  const source=await readFile(url,"utf8");
  assert.match(source,
    /DATALENGTH\(CONVERT\(nvarchar\(max\),bs\.SourceKey\)\)\s*=\s*DATALENGTH\(@SourceKey\)/);
  assert.match(source,
    /d\.SourceKey COLLATE Latin1_General_100_BIN2\s*= @SourceKey COLLATE Latin1_General_100_BIN2\s*(?:--[^\n]*\n\s*)*AND DATALENGTH\(d\.SourceKey\)=DATALENGTH\(@SourceKey\)/);
  assert.match(source,/CHART_DELEGATED_DISPOSABLE_ONLY/);
  assert.doesNotMatch(source,/CREATE PROCEDURE uqp\.usp_DashboardChartCreate\b/);
});

test("SQL Issuer/Writer remains hard-disabled with zero DB or Signer calls",async()=>{
  const f=fixture();
  assert.equal(CHART_SQL_ATOMIC_CREATE_RELEASE_APPROVED,false);
  assert.equal(await f.execute(plan,bearer),null);
  assert.equal(f.issuerCalls,0);assert.equal(f.writerCalls,0);
  assert.equal(f.attestCalls,0);assert.equal(f.handoffCalls,0);
});
test("synthetic signed grant is handed to distinct SQL Writer exactly once",async()=>{
  const f=fixture();f.setApproved(true);
  const value=await f.execute(plan,bearer);
  assert.deepEqual(value,receipt);
  assert.equal(f.attestCalls,1);assert.equal(f.handoffCalls,1);
  assert.equal(f.issuerCalls,1);assert.equal(f.writerCalls,1);
  assert.equal(f.capturedIssuer.actor,8);
  assert.equal(f.capturedIssuer.nonce,signed.Nonce);
  assert.equal(f.capturedIssuer.digest,plan.config.sha256);
  assert.deepEqual(f.capturedIssuer.signature,signed.Signature);
  assert.equal(f.capturedWriter.grant,grant);
  assert.equal(f.capturedWriter.config,plan.config.json);
  assert.equal(f.capturedWriter.actor,plan.actorId);
  assert.deepEqual(f.capturedWriter.secret,Buffer.alloc(32,0x11));
  assert(f.lastSecret);
  assert.equal((f.lastSecret as Buffer).equals(Buffer.alloc(32)),true);
  assert.equal(JSON.stringify(value).includes("Secret"),false);
});
test("invalid issuer receipts never reach Writer and secret is scrubbed",async()=>{
  for(const row of [
    null,{GrantId:"invalid",Secret:Buffer.alloc(32,0x77)},
    {GrantId:grant,Secret:Buffer.alloc(16,0x77)},
    {GrantId:grant,Secret:"RAW_SECRET"},
    {GrantId:grant,Secret:Buffer.alloc(32,0x77),ActorId:77},
  ]){
    const f=fixture();f.setApproved(true);
    f.setIssuer(row===null?[]:[row]);
    assert.equal(await f.execute(plan,bearer),null);
    assert.equal(f.issuerCalls,1);assert.equal(f.writerCalls,0);
    if(row&&Buffer.isBuffer(row.Secret))
      assert(row.Secret.equals(Buffer.alloc(row.Secret.length)),
        "invalid Issuer grant must not retain any secret bytes");
  }
});
test("no SQL call on invalid scope, disabled permissions or altered signer proof",async()=>{
  const f=fixture();f.setApproved(true);f.setAttest(false);
  assert.equal(await f.execute(plan,bearer),null);
  assert.equal(f.issuerCalls,0);assert.equal(f.handoffCalls,0);
  f.setAttest(true);
  for(const bad of [
    {...plan,actorId:77},{...plan,sourceKey:"OTHER"},
    {...plan,config:{...plan.config,json:"broken"}},
    {...plan,config:{...plan.config,sha256:"0".repeat(64)}},
  ])assert.equal(await f.execute(bad,bearer),null);
  assert.equal(await f.execute(plan,"Bearer bad header"),null);
  assert.equal(f.issuerCalls,0);
  f.setProof({...signed,ActorId:77});
  assert.equal(await f.execute(plan,bearer),null);
  f.setProof({...signed,Nonce:"not-guid"});
  assert.equal(await f.execute(plan,bearer),null);
  f.setProof({...signed,Signature:Buffer.alloc(30)});
  assert.equal(await f.execute(plan,bearer),null);
  f.setProof(signed);
  f.setNow(now+7000);
  assert.equal(await f.execute(plan,bearer),null);
  assert.equal(f.issuerCalls,0);assert.equal(f.writerCalls,0);
});
test("Writer failure or forged row never results in saved Chart HTTP receipt",async()=>{
  for(const row of [
    {WidgetId:88,AuditLogId:9007199254740993,Digest:plan.config.sha256,
      SealRevision:"0011223344556677"},
    {...receipt,Digest:"0".repeat(64)},
    {...receipt,SealRevision:"not-valid"},
    {...receipt,InternalSecret:"MUST_NOT_LEAK"},
    {...receipt,WidgetId:9007199254740993},
  ]){
    const f=fixture();f.setApproved(true);f.setWriter([row]);
    assert.equal(await f.execute(plan,bearer),null);
    assert.equal(f.issuerCalls,1);assert.equal(f.writerCalls,1);
    assert(f.lastSecret);
    assert.equal((f.lastSecret as Buffer).equals(Buffer.alloc(32)),true);
  }
});
test("same SQL pool for Issuer and Writer is forbidden before any work",async()=>{
  const f=fixture();f.setApproved(true);
  const execute=createDormantSqlChartAtomicCreate({
    ...f.deps,writerPool:f.deps.issuerPool,
  });
  assert.equal(await execute(plan,bearer),null);
  assert.equal(f.attestCalls,0);
});

test("release-bound SQL composition never queries any login, signer or Writer",async()=>{
  const f=fixture();f.setApproved(true);
  let queried=0;
  const platform={request:()=>{queried++;throw Error("NOT_APPROVED");}} as unknown as sql.ConnectionPool;
  const release=createReleaseDisabledChartSqlAtomicCreate({
    ...f.deps,platformPool:platform,
  });
  assert.equal(await release(plan,bearer),null);
  assert.equal(f.issuerCalls,0);
  assert.equal(f.writerCalls,0);
  assert.equal(f.handoffCalls,0);
  assert.equal(queried,0);
  // A synthetic caller opting into the test seam is STILL blocked by
  // an absent reviewed SQL procedure digest, before the first query.
  const unreviewed=createPreflightBoundDormantSqlChartAtomicCreate({
    ...f.deps,platformPool:platform,
    reviewed:{issuerSha256:null,writerSha256:null},
  });
  assert.equal(await unreviewed(plan,bearer),null);
  assert.equal(f.issuerCalls,0);
  assert.equal(f.writerCalls,0);
  assert.equal(f.handoffCalls,0);
  assert.equal(queried,0);
});
