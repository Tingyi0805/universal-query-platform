import assert from "node:assert/strict";
import test from "node:test";
import type sql from "mssql";
import {
  chartLocalJwtWriterCreateSql,CHART_LOCAL_JWT_WRITER_RELEASE_APPROVED,
  createDormantLocalJwtChartCreate,createReleaseDisabledLocalJwtChartCreate,
} from "./dashboardChartLocalJwtSqlCreate.js";
import {planDormantChartCreate} from "./dashboardChartAtomicCreate.contract.js";
import {chartWriterIdentitySql} from "./dashboardChartWriterBoundary.js";

const plan=planDormantChartCreate({
  dashboardId:7,profileId:22,actorId:8,tokenVersion:3,
  requestId:"00000000-0000-4000-8000-000000000011",
  config:{version:1,chartType:"BAR",dataSourceKey:"PRIMARY",
    categoryColumn:"ROOM",valueColumn:"TOTAL",valueMode:"QUERY_RESULT",
    maxPoints:20,showLegend:true},
  placement:{x:80,y:80,width:600,height:360},
});
assert(plan);
const digest="a".repeat(64);
const sid={platform:"AA",writer:"BB"};
const receipt={WidgetId:"88",AuditLogId:"9007199254740993",
  SealRevision:"0011223344556677",Digest:plan.config.sha256};
const zero=Object.fromEntries([
  "Sysadmin","ServerControl","ServerImpersonateAny","ServerAlterLogins",
  "ServerAlterRoles","ServerSelectAllUserData","DbOwner","DbDdlAdmin",
  "DbSecurityAdmin","DbDataWriter","DbDataReader","DbAccessAdmin",
  "DbAlterAnyUser","DbAlterAnyRole","DbAlterAnySchema","DbControl",
  "SchemaControl","SchemaAlter","ImpersonateWriter","CreateAlter",
  "PermitInsert","SealInsert","LedgerInsert","ReviewUpdate",
  "WidgetInsert","WidgetUpdate","WidgetDelete",
].map(key=>[key,0]));
const identity=(originalSid:string,exec:number)=>({
  ...zero,DbName:"UQP_CH_TEST",ServerName:"CI-SQL",
  OriginalSid:originalSid,EffectiveUser:exec?"chartWriter":"app",
  ProcedureId:123,ProcedureSha256:digest,CreateExecute:exec,
});
function fixture(){
  let enabled=false,platformCalls=0,writerPoolCalls=0,writes=0;
  let platformIdentity:Record<string,unknown>=identity("AA",0);
  let writerIdentity:Record<string,unknown>=identity("BB",1);
  let writerRows:unknown[]=[receipt];
  let captured:Record<string,unknown>={};
  function pool(kind:"platform"|"writer"):sql.ConnectionPool{
    return {request:()=>{
      const inputs:Record<string,unknown>={};
      const request={
        input:(name:string,_type:unknown,value:unknown)=>{
          inputs[name]=value;return request;
        },
        query:async(statement:string)=>{
          if(statement===chartWriterIdentitySql)
            return {recordset:[kind==="platform"?platformIdentity:writerIdentity]};
          assert.equal(kind,"writer");
          assert.equal(statement,chartLocalJwtWriterCreateSql);
          writes++;captured=inputs;
          return {recordset:writerRows};
        },
      };
      return request;
    }} as unknown as sql.ConnectionPool;
  }
  const platform=pool("platform"),writer=pool("writer");
  const dependencies={
    enabled:()=>enabled,
    getPlatformPool:async()=>{platformCalls++;return platform;},
    getWriterPool:async()=>{writerPoolCalls++;return writer;},
    approvedWriterSha256:digest,
    approvedSids:sid,
  };
  return {
    execute:createDormantLocalJwtChartCreate(dependencies),
    dependencies,platform,writer,
    allow:()=>{enabled=true;},
    replacePlatform:(p:Record<string,unknown>)=>{platformIdentity=p;},
    replaceWriter:(w:Record<string,unknown>)=>{writerIdentity=w;},
    setRows:(rows:unknown[])=>{writerRows=rows;},
    get platformCalls(){return platformCalls;},
    get writerPoolCalls(){return writerPoolCalls;},
    get writes(){return writes;},
    get captured(){return captured;},
  };
}

test("Option A release factory is inert: zero SQL pool acquisition",async()=>{
  const f=fixture();
  assert.equal(CHART_LOCAL_JWT_WRITER_RELEASE_APPROVED,false);
  const production=createReleaseDisabledLocalJwtChartCreate(
    f.dependencies.getPlatformPool,f.dependencies.getWriterPool);
  assert.equal(await production(plan),null);
  assert.equal(f.platformCalls,0);
  assert.equal(f.writerPoolCalls,0);
  assert.equal(f.writes,0);
  assert.equal(await f.execute(plan),null);
  assert.equal(f.platformCalls,0);
});

test("Option A cannot acquire a connection without SHA256 and SQL SID pins",async()=>{
  const f=fixture();f.allow();
  for(const missing of [
    {...f.dependencies,approvedWriterSha256:null},
    {...f.dependencies,approvedWriterSha256:"bad"},
    {...f.dependencies,approvedSids:null},
  ]){
    assert.equal(await createDormantLocalJwtChartCreate(missing)(plan),null);
  }
  assert.equal(f.platformCalls,0);
});

test("Option A synthetic two-login Writer accepts only canonical typed plan and exact receipt",async()=>{
  const f=fixture();f.allow();
  const result=await f.execute(plan);
  assert.deepEqual(result,receipt);
  assert.equal(f.platformCalls,1);
  assert.equal(f.writerPoolCalls,1);
  assert.equal(f.writes,1);
  assert.deepEqual(f.captured,{
    dashboard:7,profile:22,actor:8,token:3,
    requestId:plan.requestId,source:"PRIMARY",config:plan.config.json,
    x:80,y:80,width:600,height:360,
  });
  assert.doesNotMatch(chartLocalJwtWriterCreateSql,
    /@GrantId|@Secret|@Signature|@SqlMac|Bearer|JWT/i);
});

test("Option A denies SID drift, privilege escalation, missing procedure EXECUTE",async()=>{
  for(const bad of [
    {...identity("BB",1),OriginalSid:"CC"},
    {...identity("BB",1),DbOwner:1},
    {...identity("BB",1),WidgetInsert:1},
    {...identity("BB",1),ProcedureSha256:"b".repeat(64)},
    {...identity("BB",1),CreateExecute:0},
  ]){
    const f=fixture();f.allow();f.replaceWriter(bad);
    assert.equal(await f.execute(plan),null);
    assert.equal(f.writes,0);
  }
});

test("Option A does not share platform SQL login or accept bad plans",async()=>{
  const f=fixture();f.allow();
  const same=createDormantLocalJwtChartCreate({
    ...f.dependencies,getWriterPool:async()=>f.platform,
  });
  assert.equal(await same(plan),null);
  assert.equal(f.writes,0);
  for(const bad of [
    {...plan,actorId:0},
    {...plan,tokenVersion:0},
    {...plan,sourceKey:"OTHER"},
    {...plan,config:{...plan.config,json:"tampered"}},
    {...plan,config:{...plan.config,sha256:"0".repeat(64)}},
    {...plan,placement:{...plan.placement,width:80}},
  ])assert.equal(await f.execute(bad),null);
  assert.equal(f.writes,0);
});

test("Option A never acknowledges invalid, multi-row or secret-leaking Writer receipt",async()=>{
  for(const rows of [
    [],[receipt,receipt],
    [{...receipt,ActorId:8}],
    [{...receipt,Sql:"PATIENT_ID"}],
    [{...receipt,Digest:"0".repeat(64)}],
    [{...receipt,AuditLogId:9007199254740993}],
    [{...receipt,WidgetId:9007199254740993}],
  ]){
    const f=fixture();f.allow();f.setRows(rows);
    assert.equal(await f.execute(plan),null);
    assert.equal(f.writes,1);
  }
});
