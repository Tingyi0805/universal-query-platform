import test from "node:test";
import assert from "node:assert/strict";
import sql from "mssql";
import {createIndependentSignerSqlReaders} from "./independentSignerSqlReaders.js";

type SqlResult={recordsets?:unknown[][];recordset?:unknown[]};
function fakePool(response:(statement:string,params:Record<string,unknown>)=>
  Promise<SqlResult>){
  const calls:Array<{statement:string;params:Record<string,unknown>}>=[];
  const pool={request(){
    const params:Record<string,unknown>={};
    return {
      input(name:string,_sqlType:unknown,value:unknown){
        params[name]=value;return this;
      },
      async query(statement:string){
        calls.push({statement,params:{...params}});
        return response(statement,params);
      },
    };
  }} as unknown as sql.ConnectionPool;
  return {pool,calls};
}

test("read-only signer checks active user, TokenVersion and CURRENT DB role permissions",async()=>{
  const h=fakePool(async()=>({recordsets:[
    [{IsActive:true,TokenVersion:7}],
    [{Code:"DESIGN_QUERY"},{Code:"EXECUTE_QUERY"}],
  ]}));
  const s=createIndependentSignerSqlReaders(h.pool);
  assert.deepEqual(await s.readLiveSession(8),{
    isActive:true,tokenVersion:7,
    permissions:["DESIGN_QUERY","EXECUTE_QUERY"],
  });
  assert.deepEqual(h.calls[0]?.params,{userId:8});
  assert.match(h.calls[0]!.statement,/uqp\.AppUser/);
  assert.match(h.calls[0]!.statement,/uqp\.RolePermission/);
  assert.match(h.calls[0]!.statement,/r\.IsActive=1/);
  assert.doesNotMatch(h.calls[0]!.statement,/\bUPDATE\b|\bINSERT\b|\bDELETE\b/i);
  assert.equal(await s.readLiveSession(0),null);
  assert.equal(h.calls.length,1);
});

test("signer must reject missing, malformed or unavailable live user records",async()=>{
  for(const response of [
    {recordsets:[[],[]]},
    {recordsets:[[{IsActive:true,TokenVersion:0}],[]]},
    {recordsets:[[{IsActive:true,TokenVersion:7}]]},
    {recordsets:[]},
  ]){
    const h=fakePool(async()=>response);
    assert.equal(await createIndependentSignerSqlReaders(h.pool)
      .readLiveSession(8),null);
  }
  const broken=fakePool(async()=>{throw Error("private SQL read failed");});
  assert.equal(await createIndependentSignerSqlReaders(broken.pool)
    .readLiveSession(8),null);
});

test("signer SQL scope authorizes only active QUERY_ONLY dashboard/profile, published dataset and view+execute",async()=>{
  const h=fakePool(async()=>({recordset:[{Approved:true}]}));
  const s=createIndependentSignerSqlReaders(h.pool);
  assert.equal(await s.authorizeChartCreate(8,7,22,"PRIMARY"),true);
  assert.deepEqual(h.calls[0]?.params,{
    actorId:8,dashboardId:7,profileId:22,sourceKey:"PRIMARY",
  });
  const sqlText=h.calls[0]!.statement;
  for(const fragment of [
    "d.QueryMode=N'QUERY_ONLY'","d.QueryModeVersion>0",
    "d.QuerySourceMaxRows IS NOT NULL","profile.DashboardId=d.Id",
    "CASE WHEN @sourceKey=N'PRIMARY' THEN d.QueryDefinitionId",
    "ds.QueryBindingRevision>=1","ds.MaxRows IS NOT NULL",
    "ds.DatasetId=q.DatasetId",
    "ds.IsEnabled=1","q.IsPublished=1","q.IsArchived=0",
    "dataset.IsArchived=0","source.IsActive=1",
    "ra.CanView=1","ra.CanExecute=1",
    "ua.CanView=1","ua.CanExecute=1",
    "lookup.IsArchived=1",
  ])assert(sqlText.includes(fragment),fragment);
  assert.doesNotMatch(sqlText,/\bUPDATE\b|\bINSERT\b|\bDELETE\b/i);
  for(const invalid of [
    [0,7,22,"PRIMARY"],[8,0,22,"PRIMARY"],
    [8,7,0,"PRIMARY"],[8,7,22,"unknown-key"],
    [8,7,22,"Primary"],[8,7,22,"primary"],
    [8,7,22,"PRIMARY';DROP TABLE"],[8,7,22,""],
  ]as Array<[number,number,number,string]>)
    assert.equal(await s.authorizeChartCreate(...invalid),false);
  assert.equal(h.calls.length,1);
});

test("unapproved, ambiguous or incompatible SQL scope cannot authorize signing",async()=>{
  for(const response of [
    {recordset:[]},{recordset:[{Approved:false}]},
    {recordset:[{Approved:1}]},
    {recordset:[{Approved:true},{Approved:true}]},
    {},
  ]){
    const h=fakePool(async()=>response);
    assert.equal(await createIndependentSignerSqlReaders(h.pool)
      .authorizeChartCreate(8,7,22,"PRIMARY"),false);
  }
  const h=fakePool(async()=>{throw Error("permission denied");});
  assert.equal(await createIndependentSignerSqlReaders(h.pool)
    .authorizeChartCreate(8,7,22,"PRIMARY"),false);
});

test("Signer SQL cannot substitute a secondary source for PRIMARY even under case-insensitive collation",async()=>{
  const f=fakePool(async()=>({recordset:[{Approved:true}]}));
  const source=createIndependentSignerSqlReaders(f.pool);
  assert.equal(await source.authorizeChartCreate(8,7,22,"PRIMARY"),true);
  assert.equal(await source.authorizeChartCreate(8,7,22,"SURGERY"),true);
  assert.equal(await source.authorizeChartCreate(8,7,22,"Primary"),false);
  assert.equal(f.calls.length,2);
  const sqlText=f.calls[0]!.statement;
  assert.match(sqlText,/LEFT JOIN uqp\.DashboardDataSource ds/);
  assert.match(sqlText,/ds\.SourceKey COLLATE Latin1_General_100_BIN2/);
  // BIN2 string equality still ignores SQL Server's trailing-space padding;
  // require equal byte length after normalizing stored VARCHAR/NVARCHAR.
  assert.match(sqlText,/DATALENGTH\(CONVERT\(nvarchar\(max\),ds\.SourceKey\)\)\s*=\s*DATALENGTH\(@sourceKey\)/);
  assert.match(sqlText,/shadow\.DashboardId=d\.Id/);
  assert.match(sqlText,/shadow\.SourceKey\)=N'PRIMARY'/);
  assert.match(sqlText,/d\.QueryDefinitionId/);
  assert.match(sqlText,/ds\.QueryDefinitionId/);
  assert.match(sqlText,/ds\.DatasetId=q\.DatasetId/);
  assert.doesNotMatch(sqlText,/JOIN uqp\.DashboardDataSource ds ON ds\.DashboardId=d\.Id\s+AND ds\.SourceKey=@sourceKey AND ds\.IsEnabled=1/);
});
