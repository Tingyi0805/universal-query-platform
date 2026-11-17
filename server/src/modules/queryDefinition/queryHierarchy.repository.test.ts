import test from "node:test";
import assert from "node:assert/strict";
import sql from "mssql";
import {createQueryHierarchyRepository,hierarchyCatalogSql} from "./queryHierarchy.repository.js";
import {graph} from "./queryHierarchy.testFixture.js";
import {readFileSync} from "node:fs";
async function mock(run:(f:Awaited<ReturnType<typeof setup>>)=>Promise<void>){
 const original={Transaction:sql.Transaction,Request:sql.Request};const f=await setup();
 try{await run(f);}finally{Object.assign(sql,original);}
}
async function setup(){
 const state={previous:"MISSING",next:"2".repeat(16),fail:"",admin:true,commits:0,rollbacks:0,writes:0,audits:0,validations:0,params:[] as Record<string,unknown>[],statements:[] as string[],isolation:0};
 class Tx{async begin(level:number){state.isolation=level;}async commit(){state.commits++;if(state.fail==="commit")throw Error("PRIVATE_COMMIT");}async rollback(){state.rollbacks++;if(state.fail==="rollback")throw Error("PRIVATE_ROLLBACK");}}
 class Request{p:Record<string,unknown>={};constructor(readonly tx?:unknown){} input(n:string,_t:unknown,v:unknown){this.p[n]=v;return this;}async query(text:string){
  state.statements.push(text);state.params.push(this.p);if(text===hierarchyCatalogSql&&state.fail==="schema")throw Error("PRIVATE_PARTIAL");
  if(text.includes("SELECT u.Id"))return {recordset:state.admin?[{Id:8}]:[]};
  if(text.includes("SELECT ConfigRowVersion"))return {recordset:state.previous==="MISSING"?[]:[{ConfigRowVersion:Buffer.from(state.previous,"hex")}]};
  if(text.includes("OUTPUT inserted.ConfigRowVersion")){state.writes++;if(state.fail==="dml"||state.fail==="rollback")throw Error("PRIVATE_DML");return {recordset:state.fail==="cas"?[]:[{Revision:Buffer.from(state.next,"hex")}]};}
  return {recordset:[]};
 }}
 Object.assign(sql,{Transaction:Tx,Request});
 const pool={request:()=>new Request()} as any,identity=async()=>({userId:8,tokenVersion:1,permissions:["VIEW_QUERY","EXECUTE_QUERY","PUBLISH_QUERY"]});
 const repo=createQueryHierarchyRepository({getPool:async()=>pool,audit:async(_input,tx)=>{assert(tx instanceof Tx);state.audits++;if(state.fail==="audit")throw Error("PRIVATE_AUDIT");return state.fail==="receipt"?9007199254740992:91;}});
 const validate=async(tx:sql.Transaction)=>{assert(tx instanceof Tx);state.validations++;return {root:state.fail==="binding"&&state.validations===2?"b".repeat(64):"a".repeat(64),detail:"c".repeat(64)};};
 return {state,repo,identity,validate};
}
test("configuration CAS, server-derived bindings and mandatory Audit share one SERIALIZABLE transaction",async()=>mock(async f=>{
 const r=await f.repo.save(1,graph(),"MISSING",f.identity,f.validate);assert.equal(r.revision,f.state.next);
 assert.deepEqual([f.state.commits,f.state.rollbacks,f.state.writes,f.state.audits,f.state.validations],[1,0,1,1,2]);assert.equal(f.state.isolation,sql.ISOLATION_LEVEL.SERIALIZABLE);
 assert(f.state.statements.some(s=>s.includes("UPDLOCK,HOLDLOCK")));assert(f.state.statements.some(s=>s.includes("SET XACT_ABORT ON")));
 assert(f.state.params.some(p=>typeof p.graph==="string"&&JSON.parse(p.graph).version===1));assert(f.state.params.some(p=>typeof p.bindings==="string"));
}));
test("stale expected revision refuses before any configuration or Audit write",async()=>mock(async f=>{
 f.state.previous="1".repeat(16);await assert.rejects(f.repo.save(1,graph(),"MISSING",f.identity,f.validate),/CAS_CONFLICT/);
 assert.deepEqual([f.state.writes,f.state.audits,f.state.rollbacks],[0,0,1]);
}));
for(const failure of ["schema","audit","receipt","dml","cas","binding","rollback","commit"])
 test(`${failure}: no success or automatic retry; unknown transaction outcome remains unknown`,async()=>mock(async f=>{
  f.state.fail=failure;await assert.rejects(f.repo.save(1,graph(),"MISSING",f.identity,f.validate));
  assert.equal(f.state.commits,failure==="commit"?1:0);assert.equal(f.state.rollbacks,failure==="commit"?0:1);assert(f.state.writes<=1);
 }));
test("inactive/non-admin cannot write configuration even with JWT permission strings",async()=>mock(async f=>{
 f.state.admin=false;await assert.rejects(f.repo.save(1,graph(),"MISSING",f.identity,f.validate),/FORBIDDEN/);assert.equal(f.state.writes+f.state.audits,0);
}));
test("929 is a non-runner additive review source, independent of CHART928, with FK/CHECK/ROWVERSION and no grants",()=>{
 const ddl=readFileSync(new URL("../../../../database/review/929_query_hierarchy.sql.txt",import.meta.url),"utf8");
 assert.match(ddl,/IF @@TRANCOUNT<>1/);assert.match(ddl,/BindingJson NVARCHAR\(MAX\) NOT NULL/);assert.match(ddl,/ConfigRowVersion ROWVERSION NOT NULL/);
 assert.match(ddl,/ON DELETE NO ACTION/);assert.doesNotMatch(ddl,/\b(?:DROP|DELETE FROM|UPDATE uqp|GRANT|CREATE LOGIN|INSERT.*SchemaMigration)\b/i);
 const env=readFileSync(new URL("../../config/env.ts",import.meta.url),"utf8");assert.match(env,/WORKSTATION_PIN_RUNTIME: envBoolean\(false\)/);
 assert.match(hierarchyCatalogSql,/is_not_trusted/);assert.match(hierarchyCatalogSql,/sys\.foreign_key_columns/);assert.match(hierarchyCatalogSql,/HAS_PERMS_BY_NAME/);
});
