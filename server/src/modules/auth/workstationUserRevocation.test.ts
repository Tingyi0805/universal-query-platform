import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createIsolatedUserRevocationWriter } from "./workstationUserRevocation.js";
import { workstationUserRevocationSql as sql } from "./workstationUserRevocationSql.js";
import { workstationSessionRepositorySql } from "./workstationSessionSqlStatements.js";
import type { WorkstationSqlRequest, WorkstationSqlTransaction } from "./workstationSessionSql.repository.js";
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const hash="$2b$12$"+"a".repeat(53); // Synthetic, not a user's hash.
const scope=(w="9007199254740993",n=1)=>({workstationId:w,deviceSessionId:id(n),revision:"0000000000000001",
  generation:"9007199254740993",incarnation:id(n+10),requestId:id(n+20),correlationId:id(n+30)});
const input=(extra:Record<string,unknown>={})=>({operation:"REVOKE_AUTHORIZATION",actorUserId:"3",actorTokenVersion:5,
  targetUserId:"9007199254740993",expectedTokenVersion:7,scopes:[scope()],...extra});
type Row=Record<string,unknown>;
type Options={ override?:(name:string,values:Row,rows:Row[],state:State)=>Row[]; fail?:string; number?:number;
 commitUnknown?:boolean; rollbackUnknown?:boolean; gate?:()=>Promise<void>; release?:()=>void };
type State={ events:string[]; queries:{name:string;values:Row}[]; pending:string[]; committed:string[];
 token:number; isActive:boolean; roles:string[]; operators:Row[]; legacy:Row[]; requestIds:Set<string>;
 unchanged:{deviceProof:string;credentialVersion:number;otherUserToken:number;otherOperator:string;dashboardToken:string} };
function fixture(command=input(),options:Options={}) {
  const scopes=command.scopes as ReturnType<typeof scope>[];
  const state:State={events:[],queries:[],pending:[],committed:[],token:7,isActive:true,roles:["8"],
    operators:scopes.map(s=>({WorkstationId:s.workstationId,DeviceSessionId:s.deviceSessionId,Generation:s.generation,
      Incarnation:s.incarnation,Revision:s.revision,StateCode:"OPERATOR_ACTIVE",OperatorSessionId:id(90)})),
    legacy:[{SessionId:id(90),WorkstationId:scopes[0]?.workstationId??"1"}],requestIds:new Set(),
    unchanged:{deviceProof:"SYNTHETIC_PROOF",credentialVersion:4,otherUserToken:9,otherOperator:id(87),dashboardToken:"SYNTHETIC_DASHBOARD"}};
  if (scopes.length>1) for (let i=0;i<scopes.length;i++) state.operators[i]!.OperatorSessionId=i===0?id(90):null;
  const baseline=structuredClone({token:state.token,isActive:state.isActive,roles:state.roles,operators:state.operators,legacy:state.legacy});
  const tx:WorkstationSqlTransaction={
    async begin(level) { assert.equal(level,4); state.events.push("begin"); },
    async commit() {state.events.push("commit"); if(options.commitUnknown) throw Error("SENSITIVE_SQL"); state.committed=[...state.pending]; options.release?.();},
    async rollback() {state.events.push("rollback"); if(options.rollbackUnknown) throw Error("SENSITIVE_ROLLBACK");
      Object.assign(state,structuredClone(baseline)); state.pending=[];state.requestIds.clear(); options.release?.();},
  };
  const writer=createIsolatedUserRevocationWriter({getPool:async()=>({}),transaction:()=>tx,newUuid:()=>id(99),request(owner){
    assert.equal(owner,tx); const values:Row={};
    const req:WorkstationSqlRequest={input(name,_type,value){values[name]=value;return req;},async query(text){
      const name=text===workstationSessionRepositorySql.acquireGate?"gate":text.startsWith("WITH ExpectedColumn(")?"columns":Object.entries(sql).find(([,t])=>t===text)?.[0];
      assert.ok(name,"only reviewed fixed statements"); state.events.push(name);state.queries.push({name,values:{...values}});
      if(name==="gate") await options.gate?.();
      if(options.fail===name) throw Object.assign(Error("SENSITIVE_PIN_CREDENTIAL_SQL"),{number:options.number??1205});
      let rows:Row[]=[];
      switch(name){
        case "gate": rows=[{GateResult:0}];break;
        case "schema": rows=[{SchemaReady:1}];break;
        case "accountSchema": rows=[{AccountSchemaReady:1}];break;
        case "readAccountRequest": rows=[];break;
        case "reserveAccount": rows=[{RequestId:values.requestId}];break;
        case "accountAudit":rows=[{AuditLogId:"9007199254741099"}];break;
        case "accountDecision":rows=[{RequestId:values.requestId,AuditLogId:values.auditLogId,DecisionId:"9007199254741199"}];break;
        case "columns": rows=Array.from({length:70},()=>({ResultSet:"R2_COLUMNS",Status:"MATCH"}));break;
        case "user": rows=[{UserId:values.userId,TokenVersion:values.userId===command.targetUserId?state.token:5,
          IsActive:values.userId===command.targetUserId?state.isActive:true,AuthProvider:"LOCAL"}];break;
        case "admin":rows=[{Allowed:1}];break;
        case "targetAdmin":rows=[{IsAdmin:0}];break;
        case "operators":rows=structuredClone(state.operators);break;
        case "legacy":rows=structuredClone(state.legacy);break;
        case "binding":rows=[{WorkstationId:values.workstationId,DeviceSessionId:values.deviceSessionId}];break;
        case "readRequest":rows=state.requestIds.has(values.requestId as string)?[{RequestId:values.requestId}]:[];break;
        case "role":rows=[{RoleId:values.roleId}];break;
        case "reserve":state.requestIds.add(values.requestId as string);rows=[{RequestId:values.requestId}];break;
        case "userCas":state.token++;if(values.operation==="DISABLE")state.isActive=false;rows=[{NextTokenVersion:state.token}];break;
        case "deleteRoles":state.roles=[];break;
        case "insertRole":state.roles.push(values.roleId as string);rows=[{RoleId:values.roleId}];break;
        case "revokeLegacy":rows=state.legacy.map(l=>({SessionId:l.SessionId}));state.legacy=[];break;
        case "operatorCas":{
          const index=state.operators.findIndex(o=>o.WorkstationId===values.workstationId);assert.ok(index>=0);
          state.operators.splice(index,1);
          rows=[{Revision:"0000000000000002",Generation:(BigInt(values.generation as string)+1n).toString(),Incarnation:values.nextIncarnation}];break;
        }
        case "audit":rows=[{AuditLogId:(9007199254740995n+BigInt(state.pending.filter(n=>n==="audit").length)).toString()}];break;
        case "decision":rows=[{RequestId:values.requestId,DecisionId:(9007199254740997n+BigInt(state.pending.filter(n=>n==="decision").length)).toString(),AuditLogId:values.auditLogId}];break;
        case "remaining":rows=[{LegacyRemaining:String(state.legacy.length),OperatorRemaining:String(state.operators.length)}];break;
      }
      if(["reserveAccount","accountAudit","accountDecision","reserve","userCas","deleteRoles","insertRole","revokeLegacy","operatorCas","audit","decision"].includes(name))state.pending.push(name);
      return {recordset:options.override?.(name,values,rows,state)??rows,rowsAffected:[]};
    }};return req;
  }});
  return {state,writer,run:()=>writer.execute(command)};
}
for(const operation of ["REVOKE_AUTHORIZATION","DISABLE","CHANGE_PASSWORD","REPLACE_ROLES"])test("single-user atomic operation: "+operation,async()=>{
  const c=input({operation,...operation==="CHANGE_PASSWORD"?{passwordHash:hash}:{},...operation==="REPLACE_ROLES"?{roleIds:["9007199254740995","9"]}:{}});
  const f=fixture(c);const before=structuredClone(f.state.unchanged);const r=await f.run();
  assert.equal(r.status,"COMMIT_ACKNOWLEDGED");assert.equal(r.authority,"NONE");assert.equal(r.runtimeEnabled,false);assert.equal(r.productionReady,false);
  assert.equal(r.receipts[0]?.auditLogId,"9007199254740995");assert.equal(f.state.token,8);
  assert.deepEqual(f.state.unchanged,before);assert.equal(f.state.legacy.length,0);assert.equal(f.state.operators.length,0);
  assert.equal(f.state.events.at(-1),"commit");assert.ok(!f.state.events.includes("rollback"));
  assert.deepEqual(f.state.events.slice(0,3),["begin","gate","schema"]);
  assert.ok(f.state.events.indexOf("reserve")<f.state.events.indexOf("userCas"));
  assert.ok(f.state.events.indexOf("audit")<f.state.events.indexOf("decision"));
  if(operation==="REPLACE_ROLES")assert.deepEqual(f.state.roles,["9","9007199254740995"]);
  assert.ok(!JSON.stringify(r).includes(hash));
});
test("multiple workstations use exact BIGINT ordering and separate request/audit/decision receipts",async()=>{
  const c=input({scopes:[scope("9007199254740993",1),scope("9007199254740992",2)]});
  const f=fixture(c);assert.equal((await f.run()).status,"COMMIT_ACKNOWLEDGED");
  assert.deepEqual(f.state.queries.filter(q=>q.name==="binding").map(q=>q.values.workstationId),["9007199254740992","9007199254740993"]);
  assert.equal(f.state.pending.filter(n=>n==="decision").length,2);
});
test("unlinked historical legacy belonging to target is revoked by UserId; credential lineage is not inferred",async()=>{
  const f=fixture();f.state.legacy.push({SessionId:id(91),WorkstationId:"800"});
  assert.equal((await f.run()).status,"COMMIT_ACKNOWLEDGED");
  assert.equal(f.state.queries.find(q=>q.name==="revokeLegacy")?.values.targetUserId,"9007199254740993");
});
test("no legacy session still supports persisted PIN operator and no device is revoked",async()=>{
  const f=fixture();f.state.legacy=[];f.state.operators[0]!.OperatorSessionId=null;
  assert.equal((await f.run()).status,"COMMIT_ACKNOWLEDGED");
  assert.ok(!Object.values(sql).some(s=>/UPDATE\s+uqp\.(?:SharedWorkstationDeviceSession|SharedWorkstationCredential)\b/.test(s)));
});
const rejectionCases:[string,string,(name:string,values:Row,rows:Row[],state:State)=>Row[]][]=[
  ["expired actor token","ACTOR_REVOKED",(n,v,r)=>n==="user"&&v.userId==="3"?[{...r[0],TokenVersion:4}]:r],
  ["disabled actor","ACTOR_REVOKED",(n,v,r)=>n==="user"&&v.userId==="3"?[{...r[0],IsActive:false}]:r],
  ["role string cannot replace live capability","ACTOR_FORBIDDEN",(n,v,r)=>n==="admin"?[{Allowed:0}]:r],
  ["target token CAS","USER_CAS_CONFLICT",(n,v,r)=>n==="user"&&v.userId!=="3"?[{...r[0],TokenVersion:6}]:r],
  ["changed scope","SCOPE_CHANGED",(n,v,r)=>n==="operators"?[]:r],
  ["RowVersion drift","OPERATOR_CAS_CONFLICT",(n,v,r)=>n==="operators"?[{...r[0],Revision:"0000000000000003"}]:r],
  ["ABA generation","OPERATOR_CAS_CONFLICT",(n,v,r)=>n==="operators"?[{...r[0],Generation:"9007199254740995"}]:r],
  ["incarnation drift","OPERATOR_CAS_CONFLICT",(n,v,r)=>n==="operators"?[{...r[0],Incarnation:id(78)}]:r],
  ["device binding absent","DEVICE_BINDING_UNPROVEN",(n,v,r)=>n==="binding"?[]:r],
  ["request replay","REQUEST_REPLAY",(n,v,r)=>n==="readRequest"?[{RequestId:id(21)}]:r],
  ["broken legacy link","LEGACY_LINK_UNPROVEN",(n,v,r)=>n==="legacy"?[]:r],
  ["duplicate legacy","LEGACY_SCOPE_UNPROVEN",(n,v,r)=>n==="legacy"?[...r,...r]:r],
  ["unsafe legacy identity","LEGACY_SCOPE_UNPROVEN",(n,v,r)=>n==="legacy"?[{...r[0],WorkstationId:9007199254740992}]:r],
  ["missing column","SCHEMA_COLUMNS_UNPROVEN",(n,v,r)=>n==="columns"?r.slice(1):r],
  ["different column","SCHEMA_COLUMNS_UNPROVEN",(n,v,r)=>n==="columns"?[{...r[0],Status:"DIFFERENT"},...r.slice(1)]:r],
  ["partial schema","SCHEMA_UNPROVEN",(n,v,r)=>n==="schema"?[]:r],
  ["unknown gate result","GATE_DENIED",(n,v,r)=>n==="gate"?[{GateResult:2}]:r],
  ["gate denied","GATE_DENIED",(n,v,r)=>n==="gate"?[{GateResult:-1}]:r],
  ["user CAS zero rows","USER_CAS_CONFLICT",(n,v,r)=>n==="userCas"?[]:r],
  ["operator CAS zero rows","OPERATOR_CAS_CONFLICT",(n,v,r)=>n==="operatorCas"?[]:r],
  ["operator CAS duplicate rows","OPERATOR_CAS_CONFLICT",(n,v,r)=>n==="operatorCas"?[...r,...r]:r],
  ["legacy count mismatch","LEGACY_REVOCATION_MISMATCH",(n,v,r)=>n==="revokeLegacy"?[]:r],
  ["reservation receipt mismatch","REQUEST_RECEIPT_INVALID",(n,v,r)=>n==="reserve"?[{RequestId:id(89)}]:r],
  ["Number audit ID","AUDIT_RECEIPT_INVALID",(n,v,r)=>n==="audit"?[{AuditLogId:9007199254740992}]:r],
  ["decision correlation mismatch","DECISION_RECEIPT_INVALID",(n,v,r)=>n==="decision"?[{...r[0],AuditLogId:"4"}]:r],
  ["remaining user session","REVOCATION_INCOMPLETE",(n,v,r)=>n==="remaining"?[{LegacyRemaining:"1",OperatorRemaining:"0"}]:r],
  ["final actor revoked","FINAL_ACTOR_CONFLICT",(n,v,r,s)=>n==="user"&&v.userId==="3"&&s.token===8?[{...r[0],TokenVersion:6}]:r],
];
for(const [label,code,override] of rejectionCases)test("rejects/rolls back: "+label,async()=>{
  const f=fixture(input(),{override});const r=await f.run();assert.equal(r.status,"REJECTED");assert.equal(r.code,code);
  assert.equal(f.state.token,7);assert.deepEqual(f.state.committed,[]);assert.equal(f.state.events.at(-1),"rollback");assert.equal(r.receipts.length,0);
});
for(const fail of ["schema","user","reserve","userCas","revokeLegacy","operatorCas","audit","decision","remaining"])
  for(const number of [1205,1222,229])test(`SQL fault ${fail}/${number} has no success, leaks or automatic retry`,async()=>{
    const f=fixture(input(),{fail,number});const r=await f.run();assert.equal(r.status,"REJECTED");assert.equal(f.state.token,7);
    assert.equal(f.state.events.filter(n=>n===fail).length,1);assert.deepEqual(f.state.committed,[]);
    assert.ok(!JSON.stringify(r).includes("SENSITIVE"));
  });
test("commit unknown neither retries nor pretends rollback; rollback failure is unknown",async()=>{
  const a=fixture(input(),{commitUnknown:true});assert.equal((await a.run()).status,"COMMIT_UNKNOWN");
  assert.ok(!a.state.events.includes("rollback"));assert.equal(a.state.events.filter(n=>n==="commit").length,1);
  const b=fixture(input(),{fail:"audit",rollbackUnknown:true});assert.equal((await b.run()).status,"ROLLBACK_UNKNOWN");
});
for(const change of [{targetUserId:9007199254740992},{targetUserId:"01"},{expectedTokenVersion:2147483647},
  {operation:"DELETE_USER"},{scopes:[]},{scopes:[scope(),scope()]},{unexpected:true}])test("unsafe/unsupported command never enters SQL: "+Object.keys(change).join(),async()=>{
    const f=fixture();const r=await f.writer.execute({...input(),...change});assert.equal(r.status,"REJECTED");assert.deepEqual(f.state.events,[]);
  });
test("getters and Proxy hooks never execute, including nested scopes and arrays",async()=>{
  let hooks=0;const f=fixture();const getter={...input()};Object.defineProperty(getter,"operation",{get(){hooks++;throw Error("SECRET");}});
  const proxy=new Proxy({}, {getPrototypeOf(){hooks++;throw Error("SECRET");},ownKeys(){hooks++;throw Error("SECRET");}});
  for(const c of [getter,proxy,input({scopes:[proxy]}),input({scopes:new Proxy([],{get(){hooks++;throw Error("SECRET");}})})])
    assert.equal((await f.writer.execute(c)).status,"REJECTED");
  assert.equal(hooks,0);assert.deepEqual(f.state.events,[]);
});
test("default adapter cannot obtain platform pool or mutate a user",async()=>{
  const r=await createIsolatedUserRevocationWriter().execute(input());assert.equal(r.code,"DATABASE_UNAVAILABLE");
});
test("SYSTEM_ADMIN disable/membership edits refuse before writes, preserving last-admin protection",async()=>{
  for(const operation of ["DISABLE","REPLACE_ROLES"]){
    const f=fixture(input({operation,...operation==="REPLACE_ROLES"?{roleIds:[]}: {}}),{override:(n,v,r)=>n==="targetAdmin"?[{IsAdmin:1}]:r});
    assert.equal((await f.run()).code,"SYSTEM_ADMIN_SCOPE_BLOCKED");assert.deepEqual(f.state.pending,[]);
  }
});
test("two synthetic owners queue on one gate; stale second CAS rejects before business DML",async()=>{
  let entered!:()=>void, allowFirst!:()=>void, unlockFirst!:()=>void;
  const firstGate=new Promise<void>(r=>entered=r), holdFirst=new Promise<void>(r=>allowFirst=r),
    gateFree=new Promise<void>(r=>unlockFirst=r);
  const a=fixture(input(),{gate:async()=>{entered();await holdFirst;},release:()=>unlockFirst()});
  const b=fixture(input(),{gate:async()=>{await gateFree;},override:(n,v,r)=>n==="user"&&v.userId!=="3"?[{...r[0],TokenVersion:8}]:r});
  const p=a.run();await firstGate;const q=b.run();assert.ok(!b.state.events.includes("schema"));allowFirst();
  assert.equal((await p).status,"COMMIT_ACKNOWLEDGED");assert.equal((await q).code,"USER_CAS_CONFLICT");assert.deepEqual(b.state.pending,[]);
});

test("installed column contract reuses read-only witness before DML, not a caller schema assertion",async()=>{
  const f=fixture();assert.equal((await f.run()).status,"COMMIT_ACKNOWLEDGED");
  const used=f.state.queries.map(q=>q.name);assert.ok(used.indexOf("columns")<used.indexOf("reserve"));
  assert.match(sql.schema,/VIEW DEFINITION/);assert.match(sql.schema,/is_not_trusted/);assert.match(sql.schema,/is_instead_of_trigger/);
  assert.match(sql.operatorCas,/OperatorUserId=CONVERT\(BIGINT,@targetUserId\)/);
  assert.match(sql.revokeLegacy,/WHERE UserId=CONVERT\(BIGINT,@targetUserId\)/);assert.doesNotMatch(sql.revokeLegacy,/CredentialId/);
});
for(const [operation,extra,code,override] of [
  ["CHANGE_PASSWORD",{passwordHash:hash},"PASSWORD_PROVIDER_BLOCKED",(n:string,v:Row,r:Row[])=>n==="user"&&v.userId!=="3"?[{...r[0],AuthProvider:"AD"}]:r],
  ["REPLACE_ROLES",{roleIds:["9"]},"ROLE_UNPROVEN",(n:string,v:Row,r:Row[])=>n==="role"?[]:r],
] as const)test("business constraints reject before DML: "+code,async()=>{
  const f=fixture(input({operation,...extra}),{override});assert.equal((await f.run()).code,code);assert.deepEqual(f.state.pending,[]);
});
test("all per-device audits and decisions roll back if second operator CAS fails",async()=>{
  let cas=0;const f=fixture(input({scopes:[scope("9007199254740992",1),scope("9007199254740993",2)]}),{
    override:(n,v,r)=>n==="operatorCas"&&++cas===2?[]:r,
  });
  const r=await f.run();assert.equal(r.status,"REJECTED");assert.equal(r.receipts.length,0);
  assert.ok(f.state.events.includes("decision"));assert.deepEqual(f.state.committed,[]);assert.equal(f.state.token,7);
});
test("self TokenVersion revocation invalidates own token, with explicit final actor version handling",async()=>{
  const f=fixture(input({actorUserId:"9007199254740993",actorTokenVersion:7}));
  assert.equal((await f.run()).status,"COMMIT_ACKNOWLEDGED");assert.equal(f.state.token,8);
});
test("unsafe nested role arrays, overflow and unknown slots fail before SQL",async()=>{
  const f=fixture();let hooks=0;const roles=new Proxy([],{get(){hooks++;throw Error("SECRET");}});
  for(const c of [input({operation:"REPLACE_ROLES",roleIds:roles}),input({operation:"REPLACE_ROLES",roleIds:[9007199254740992]}),
    input({scopes:[{...scope(),generation:"9223372036854775807"}]}),input({scopes:[{...scope(),unknown:"SECRET"}]}),
    input({operation:"CHANGE_PASSWORD",passwordHash:"PLAINTEXT_NOT_ALLOWED"})]){
      const r=await f.writer.execute(c);assert.equal(r.status,"REJECTED");assert.ok(!JSON.stringify(r).includes("SECRET"));
  }
  assert.equal(hooks,0);assert.deepEqual(f.state.events,[]);
});

test("mandatory constraint and FK manifest covers the existing draft sidecars; no DDL is run",()=>{
  const ddl=readFileSync(new URL("../../../../database/drafts/926_shared_workstation_session_security.sql",import.meta.url),"utf8");
  let count=0;
  for(const match of ddl.matchAll(/CREATE TABLE uqp\.(\w+) \(([\s\S]*?)\n  \);/g))
    for(const c of match[2]!.matchAll(/CONSTRAINT (\w+)\s+(PRIMARY KEY|FOREIGN KEY|CHECK|DEFAULT|UNIQUE)/g)){
      count++;assert.ok(sql.schema.includes("N'"+c[1]+"'"));assert.ok(sql.schema.includes("N'"+match[1]+"'"));
    }
  assert.equal(count,54);assert.match(sql.schema,/sys.foreign_key_columns/);assert.match(sql.schema,/constraint_column_id/);
  assert.match(sql.schema,/delete_referential_action<>0/);assert.match(sql.schema,/is_hypothetical/);
  for(const statement of Object.values(sql))assert.doesNotMatch(statement,/\b(?:CREATE|ALTER|DROP)\s+(?:TABLE|DATABASE|INDEX)/i);
});

const account={requestId:id(201),correlationId:id(202)};
for(const operation of ["DISABLE","REVOKE_AUTHORIZATION","CHANGE_PASSWORD","REPLACE_ROLES"])test("927 account decision without any fabricated device: "+operation,async()=>{
 const f=fixture(input({operation,account,scopes:[],...operation==="CHANGE_PASSWORD"?{passwordHash:hash}:{},...operation==="REPLACE_ROLES"?{roleIds:["9"]}:{}}));
 f.state.legacy=[];
 const r=await f.run();assert.equal(r.status,"COMMIT_ACKNOWLEDGED");assert.equal(r.receipts.length,1);
 assert.equal(f.state.token,8);assert.ok(!f.state.events.includes("binding"));assert.ok(!f.state.events.includes("reserve"));
 assert.ok(f.state.events.indexOf("reserveAccount")<f.state.events.indexOf("userCas"));assert.equal(r.runtimeEnabled,false);
});
test("927 account and every actual operator receipt commit together",async()=>{
 const f=fixture(input({account}));const r=await f.run();assert.equal(r.status,"COMMIT_ACKNOWLEDGED");assert.equal(r.receipts.length,2);
});
for(const name of ["accountSchema","readAccountRequest","reserveAccount","accountAudit","accountDecision"])test("927 step failure rolls back account and session mutations: "+name,async()=>{
 const f=fixture(input({account}),{fail:name});assert.equal((await f.run()).status,"REJECTED");assert.equal(f.state.token,7);assert.deepEqual(f.state.committed,[]);
});
for(const [name,rows,code] of [["accountSchema",[],"ACCOUNT_SCHEMA_UNPROVEN"],["readAccountRequest",[{RequestId:id(201)}],"ACCOUNT_REQUEST_REPLAY"],
 ["accountAudit",[{AuditLogId:9007199254740992}],"ACCOUNT_AUDIT_INVALID"],["accountDecision",[],"ACCOUNT_DECISION_INVALID"]] as const)
 test("927 rejects unsafe/missing evidence: "+code,async()=>{
  const f=fixture(input({account}),{override:(n,v,r)=>n===name?[...rows]:r});assert.equal((await f.run()).code,code);assert.equal(f.state.token,7);
 });
test("927 account commit unknown does not retry",async()=>{
 const f=fixture(input({account,scopes:[]}),{commitUnknown:true});f.state.legacy=[];
 assert.equal((await f.run()).status,"COMMIT_UNKNOWN");assert.ok(!f.state.events.includes("rollback"));
});
test("927 remains a separate additive draft outside migration scanning and creates no fake device",()=>{
 const ddl=readFileSync(new URL("../../../../database/drafts/927_account_revocation_decisions.sql",import.meta.url),"utf8");
 assert.equal((ddl.match(/CREATE TABLE/g)||[]).length,2);assert.match(ddl,/AccountRevocationRequest/);
 assert.doesNotMatch(ddl,/INSERT\s+(?:INTO\s+)?uqp\.(?:AppUser|SharedWorkstation|SchemaMigration)/i);
 assert.doesNotMatch(ddl,/ALTER\s+TABLE\s+uqp\.SharedWorkstation/i);
 assert.match(ddl,/INSTEAD OF UPDATE,DELETE/);assert.match(ddl,/ON DELETE NO ACTION/);
 assert.doesNotMatch(ddl,/FOREIGN KEY\((?:ActorUserId|TargetUserId|AuditLogId)\)/);
});
