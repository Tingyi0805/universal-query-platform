import assert from "node:assert/strict";
import {test} from "node:test";
import {randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import type sql from "mssql";
import {createDatasetScopeManagement} from "./datasetScopeManagement.repository.js";
import {scopeCommand,scopeDigest,exactScopeId,DatasetScopeError,explicitSystemAdminCapabilities} from "./datasetScopeManagement.js";
import {parseExact923AuditId} from "./dataset923ExactAuditReceipt.js";

const inc="b8e87273-cef0-4ccc-aec3-6d18d592eec4",v="0000000000000001",next="0000000000000002";
const command=()=>scopeCommand.parse({requestId:randomUUID(),action:"GRANT",expectedVersion:"MISSING",definitionVersion:v,configurationVersion:v,parentOwnerUserId:null,parentOwnerVersion:null});
function fixture(){
  const log:string[]=[];
  const state={admin:true,ready:true,eligible:true,effective:true,versionConflict:false,fail:"",rollbackFails:false,commitFails:false,
    priorDigest:null as Buffer|null,changed:false,actorVersion:1,finalTokenChanged:false,driverNumber:229};
  const tx={on(){return tx;},async begin(){log.push("begin");},async commit(){log.push("commit");if(state.commitFails)throw Error("synthetic_private_sql");},async rollback(){log.push("rollback");if(state.rollbackFails)throw Error("synthetic_private_sql");}};
  const query=async(_tx:unknown,text:string,params:Record<string,unknown>={})=>{
    const stage=/\/\* scope:([^*]+) \*\//.exec(text)?.[1]??"other";log.push(stage);
    if(state.fail===stage)throw Object.assign(new Error("password=synthetic_private_sql"),{number:state.driverNumber});
    let rows:unknown[]=[];
    if(stage==="admin")rows=state.admin?[{TokenVersion:1}]:[];
    if(stage==="ready")rows=[{Ready:state.ready?1:0}];
    if(stage==="replay"&&state.priorDigest)rows=[{CommandDigest:state.priorDigest,Id:"9007199254740994",AuditId:"9007199254740995"}];
    if(stage==="dataset")rows=[{Id:params.datasetId,Name:"synthetic",DataSourceId:"4",DefinitionRowVersion:Buffer.from(v,"hex"),ConfigurationRowVersion:Buffer.from(v,"hex"),IsActive:true,IsArchived:false,SourceActive:true}];
    if(stage==="rows"&&state.changed)rows=[{UserId:"9007199254740993",ScopeKind:"OWNER",State:"ACTIVE",ScopeRowVersion:Buffer.from(next,"hex"),BoundDataSourceId:"4",ParentOwnerUserId:null,Effective:state.effective?1:0}];
    if(stage==="subjects")rows=state.eligible?[{Id:params.userId,TokenVersion:1}]:[];
    if(stage==="cas"){assert.equal(typeof params.userId,"string");state.changed=true;rows=state.versionConflict?[]:[{Version:Buffer.from(next,"hex")}];}
    if(stage==="receipt")rows=[{Id:"9007199254740995"}];
    if(stage==="decision")rows=[{Id:"9007199254740994"}];
    return {recordset:rows} as sql.IResult<any>;
  };
  const store=createDatasetScopeManagement({pool:async()=>({} as sql.ConnectionPool),enabled:()=>true,incarnation:()=>inc,
    identity:async()=>({userId:5,tokenVersion:state.finalTokenChanged&&state.changed?2:1,permissions:[]}),
    transaction:()=>tx as unknown as sql.Transaction,query:query as any,
    audit:async(_tx,input)=>{log.push("audit");assert.equal(input.datasetId,"9007199254740996");if(state.fail==="audit")throw Error("synthetic_private_sql");return "9007199254740995";}});
  return {store,state,log,run:(c=command())=>store.mutate("Bearer synthetic","9007199254740996","9007199254740993","OWNER",c)};
}
test("Mock new Writer contract: owned CAS/binding/audit/decision/revalidation precede commit; never delivery",async()=>{
  const f=fixture(),r=await f.run();assert.equal(r.auditLogId,"9007199254740995");assert.equal(r.decisionId,"9007199254740994");assert.equal(r.deliveryAllowed,false);
  const positions=["owner","admin","ready","replay","dataset","rows","subjects","cas","binding","audit","receipt","decision","commit"].map(s=>f.log.indexOf(s));
  assert.ok(positions.every((n,i)=>n>=0&&(i===0||n>positions[i-1]!)));assert.equal(f.log.filter(s=>s==="admin").length,2);
});
for(const stage of ["owner","admin","ready","cas","binding","audit","receipt","decision"]){
  test(`Mock ${stage} failure rolls back and never commits or leaks diagnostics`,async()=>{
    const f=fixture();f.state.fail=stage;await assert.rejects(f.run(),(e:unknown)=>e instanceof DatasetScopeError&&!e.message.includes("synthetic_private_sql"));
    assert.ok(f.log.includes("rollback"));assert.ok(!f.log.includes("commit"));
  });
}
test("matching RequestId only re-reads exact receipt, never mutates again",async()=>{
  const f=fixture(),c=command();f.state.priorDigest=Buffer.from(scopeDigest("5","9007199254740996","9007199254740993","OWNER",c,inc),"hex");
  assert.equal((await f.run(c)).replayed,true);assert.ok(!f.log.includes("cas"));assert.ok(!f.log.includes("audit"));
});
test("RequestId collision refuses another decision",async()=>{const f=fixture();f.state.priorDigest=Buffer.alloc(32);await assert.rejects(f.run(),{code:"SCOPE_REQUEST_CONFLICT"});assert.ok(!f.log.includes("cas"));});
for(const [key,code] of [["admin","SCOPE_ADMIN_REQUIRED"],["ready","SCOPE_924_OR_IMMUTABLE_LEDGER_REQUIRED"],["eligible","SCOPE_SUBJECT_INELIGIBLE"],["effective","SCOPE_FINAL_REVALIDATION_FAILED"]] as const){
  test(`Mock ${key} fail-closed`,async()=>{const f=fixture();f.state[key]=false;await assert.rejects(f.run(),{code});assert.ok(!f.log.includes("commit"));});
}
test("CAS affectedRows zero and stale expected epoch reject",async()=>{
  const f=fixture();f.state.versionConflict=true;await assert.rejects(f.run(),{code:"SCOPE_VERSION_CONFLICT"});assert.ok(!f.log.includes("audit"));
  const other=fixture();await assert.rejects(other.run({...command(),expectedVersion:v}),{code:"SCOPE_VERSION_CONFLICT"});assert.ok(!other.log.includes("cas"));
});
test("final TokenVersion change cannot commit",async()=>{const f=fixture();f.state.finalTokenChanged=true;await assert.rejects(f.run(),{code:"TOKEN_REVOKED"});assert.ok(f.log.includes("rollback"));});
test("commit and rollback unknown stay unknown, never success",async()=>{
  const f=fixture();f.state.commitFails=true;await assert.rejects(f.run(),{code:"SCOPE_COMMIT_UNKNOWN"});
  const g=fixture();g.state.fail="audit";g.state.rollbackFails=true;await assert.rejects(g.run(),{code:"SCOPE_ROLLBACK_UNKNOWN"});
});
test("fixed command rejects extra fields, unsafe Number IDs, fake states and malformed revisions",()=>{
  const c=command();for(const bad of [{...c,confirmed:true},{...c,action:"ACTIVE"},{...c,definitionVersion:"0"},{...c,expectedVersion:"0000000000000000"}])assert.equal(scopeCommand.safeParse(bad).success,false);
  for(const id of [9007199254740992,"01","-1","9223372036854775808"])assert.equal(exactScopeId.safeParse(id).success,false);
  assert.equal(exactScopeId.parse("9223372036854775807"),"9223372036854775807");
  assert.throws(()=>parseExact923AuditId(9007199254740992));
});
test("no global capability or caller flag produces a reviewer without a current parent",async()=>{
  const f=fixture();await assert.rejects(f.store.mutate("Bearer synthetic","9007199254740996","9007199254740993","REVIEWER",command()),{code:"SCOPE_OWNER_INVALID"});assert.ok(!f.log.includes("cas"));
});
test("new sensitive capabilities require explicit selection for SYSTEM_ADMIN; existing capabilities remain",()=>{
  const all=["MANAGE_USERS","MANAGE_DATASET_SECURITY_SCOPE","CONFIRM_DATASET_CLASSIFICATION"];
  assert.deepEqual(explicitSystemAdminCapabilities(all,[]),["MANAGE_USERS"]);
  assert.deepEqual(explicitSystemAdminCapabilities(all,["MANAGE_DATASET_SECURITY_SCOPE"]),all.slice(0,2));
  assert.deepEqual(explicitSystemAdminCapabilities(all,all),all);
});
for(const number of [1205,1222])test(`Mock driver ${number} rejects and rolls back without retry`,async()=>{
  const f=fixture();f.state.fail="cas";f.state.driverNumber=number;await assert.rejects(f.run(),{code:"SCOPE_TRANSACTION_CONFLICT"});
  assert.equal(f.log.filter(s=>s==="begin").length,1);assert.ok(f.log.includes("rollback"));
});
test("feature and incarnation are mandatory before opening a platform transaction",async()=>{
  let connections=0;
  const pool=async()=>{connections++;return null;};
  for(const deps of [{enabled:()=>false,incarnation:()=>inc},{enabled:()=>true,incarnation:()=>undefined}]){
    const s=createDatasetScopeManagement({...deps,pool});await assert.rejects(()=>s.list("Bearer synthetic","1"),{code:"SCOPE_MANAGEMENT_NOT_CONFIGURED"});
  }
  assert.equal(connections,0);
});
test("924 remains an independent review draft: no installed 923 schema or account/role grants changed",async()=>{
  const sql=await readFile(new URL("../../../../database/drafts/924_dataset_security_scope_binding.sql",import.meta.url),"utf8");
  const code=sql.replace(/^\s*--.*$/gm,"");
  assert.doesNotMatch(code,/ALTER TABLE|SchemaMigration|INSERT\s+(?:INTO\s+)?uqp\.(?:AppUser|RolePermission|UserRole|DatasetSecurityScope)\b/i);
  assert.doesNotMatch(code,/REFERENCES uqp\.DatasetSecurityScope\(/);
  assert.match(code,/DENY UPDATE,DELETE ON OBJECT::uqp.DatasetSecurityDecision TO public/);
  assert.match(code,/SubjectTokenVersion INT NOT NULL/);assert.match(code,/ParentScopeVersion BINARY\(8\) NULL/);
});
