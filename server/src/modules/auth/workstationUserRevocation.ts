import { createHash, randomUUID } from "node:crypto";
import { types } from "node:util";
import { readFileSync } from "node:fs";
import sql from "mssql";
import { exactSqlBigintReceipt } from "./workstationSqlCommitGate.js";
import { workstationSessionRepositorySql } from "./workstationSessionSqlStatements.js";
import { workstationUserRevocationSql as statements } from "./workstationUserRevocationSql.js";
import type { WorkstationSqlRequest, WorkstationSqlTransaction } from "./workstationSessionSql.repository.js";

type Scope = Readonly<{ workstationId: string; deviceSessionId: string; revision: string; generation: string;
  incarnation: string; requestId: string; correlationId: string }>;
type Command = Readonly<{ operation: "REVOKE_AUTHORIZATION" | "DISABLE" | "CHANGE_PASSWORD" | "REPLACE_ROLES";
  actorUserId: string; actorTokenVersion: number; targetUserId: string; expectedTokenVersion: number;
  account?: Readonly<{requestId:string;correlationId:string}>; scopes: readonly Scope[]; roleIds?: readonly string[]; passwordHash?: string }>;
type Dependencies = Readonly<{ getPool: () => Promise<unknown | null>;
  transaction: (pool: unknown) => WorkstationSqlTransaction;
  request: (tx: WorkstationSqlTransaction) => WorkstationSqlRequest; newUuid: () => string }>;
const defaults: Dependencies = {
  getPool: async () => null, // Never use the shared platform database implicitly.
  transaction: pool => new sql.Transaction(pool as sql.ConnectionPool) as unknown as WorkstationSqlTransaction,
  request: tx => new sql.Request(tx as unknown as sql.Transaction) as unknown as WorkstationSqlRequest, newUuid: randomUUID,
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const REVISION = /^[0-9a-f]{16}$/;
const MAX = 9223372036854775807n;
const version = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0 && v <= 2147483647;
const generation = (v: unknown): v is string => typeof v === "string" && /^(0|[1-9][0-9]{0,18})$/.test(v) && BigInt(v) <= MAX;
const uuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
const exactSort = (a: string, b: string) => BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0;
function plain(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) throw Error("INVALID_COMMAND");
  const d = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(d).some(k => typeof k !== "string" || !allowed.includes(k) || !("value" in d[k]!))) throw Error("INVALID_COMMAND");
  return Object.fromEntries(Object.entries(d).map(([k,v]) => [k,v.value]));
}
function array(value: unknown, max: number): unknown[] {
  if (!value || typeof value !== "object" || types.isProxy(value) || !Array.isArray(value) || Object.getPrototypeOf(value)!==Array.prototype) throw Error("INVALID_COMMAND");
  const d = Object.getOwnPropertyDescriptors(value) as Record<string, PropertyDescriptor>, length = d.length?.value;
  if (!Number.isInteger(length) || length < 0 || length > max || Reflect.ownKeys(d).length !== length+1) throw Error("INVALID_COMMAND");
  return Array.from({length}, (_,i) => { const item=d[String(i)]; if (!item || !("value" in item)) throw Error("INVALID_COMMAND"); return item.value; });
}
function command(value: unknown): Command {
  const c=plain(value,["operation","actorUserId","actorTokenVersion","targetUserId","expectedTokenVersion","scopes","roleIds","passwordHash","account"]);
  if (typeof c.operation!=="string" || !["REVOKE_AUTHORIZATION","DISABLE","CHANGE_PASSWORD","REPLACE_ROLES"].includes(c.operation) ||
      !exactSqlBigintReceipt(c.actorUserId) || !exactSqlBigintReceipt(c.targetUserId) ||
      !version(c.actorTokenVersion) || !version(c.expectedTokenVersion) || c.expectedTokenVersion===2147483647) throw Error("INVALID_COMMAND");
  const scopes=array(c.scopes,32).map(v => {
    const s=plain(v,["workstationId","deviceSessionId","revision","generation","incarnation","requestId","correlationId"]);
    if (!exactSqlBigintReceipt(s.workstationId) || !uuid(s.deviceSessionId) || typeof s.revision!=="string" || !REVISION.test(s.revision) ||
        !generation(s.generation) || BigInt(s.generation)===MAX || !uuid(s.incarnation) || !uuid(s.requestId) || !uuid(s.correlationId)) throw Error("INVALID_COMMAND");
    return Object.freeze(s) as Scope;
  }).sort((a,b)=>exactSort(a.workstationId,b.workstationId));
  if ("account" in c) {
    const account=plain(c.account,["requestId","correlationId"]);
    if(!uuid(account.requestId)||!uuid(account.correlationId)) throw Error("INVALID_COMMAND");
    if(scopes.some(s=>s.requestId===account.requestId||s.correlationId===account.correlationId)) throw Error("INVALID_COMMAND");
    c.account=Object.freeze(account);
  }
  if (scopes.length===0 && !c.account) throw Error("NO_DEVICE_DECISION_SCHEMA_BLOCKED");
  for (const key of ["workstationId","requestId","correlationId","deviceSessionId"] as const)
    if (new Set(scopes.map(s=>s[key])).size!==scopes.length) throw Error("INVALID_COMMAND");
  if (c.operation==="CHANGE_PASSWORD") {
    if (typeof c.passwordHash!=="string" || !/^\$2[aby]\$(?:1[0-6])\$[./A-Za-z0-9]{53}$/.test(c.passwordHash)) throw Error("INVALID_COMMAND");
  } else if ("passwordHash" in c) throw Error("INVALID_COMMAND");
  if (c.operation==="REPLACE_ROLES") {
    const roles=array(c.roleIds,64);
    if (roles.some(r=>!exactSqlBigintReceipt(r)) || new Set(roles).size!==roles.length) throw Error("INVALID_COMMAND");
    c.roleIds=Object.freeze((roles as string[]).sort(exactSort));
  } else if ("roleIds" in c) throw Error("INVALID_COMMAND");
  return Object.freeze({...c,scopes:Object.freeze(scopes)}) as Command;
}
// Reuse the reviewed read-only R2 column contract; no database discovery or repair.
// The existing R3-R5 witness is not an exact installer certificate. Runtime stays blocked.
function columnWitness(): string {
  const text=readFileSync(new URL("../../../../tools/sqlserver-acceptance/drafts/926/926_catalog_readonly.sql",import.meta.url),"utf8");
  const start=text.indexOf("WITH ExpectedColumn("), end=text.indexOf("/* R3:",start);
  if(start<0 || end<0) throw Error("CATALOG_CONTRACT_UNAVAILABLE");
  return text.slice(start,end)
    .replace("WHERE o.schema_id=SCHEMA_ID(N'uqp')", "WHERE o.schema_id=SCHEMA_ID(N'uqp') AND (o.name<>N'QuickPinPolicy' OR c.column_id>=4)")
    .replace("LEFT JOIN ActualColumn AS a", "FULL OUTER JOIN ActualColumn AS a");
}
const zero = (v: unknown) => v===0 || v==="0" || v===0n;
const policy = Object.freeze({ authority:"NONE" as const,runtimeEnabled:false as const,productionReady:false as const,sqlAcceptance:"NOT_RUN" as const });
type Status="COMMIT_ACKNOWLEDGED"|"REJECTED"|"COMMIT_UNKNOWN"|"ROLLBACK_UNKNOWN";
const outcome=(status:Status,code:string,receipts:readonly Readonly<{auditLogId:string;decisionId:string}>[]=[])=>
  Object.freeze({...policy,status,code,receipts:Object.freeze(receipts.map(r=>Object.freeze({...r})))});

/** Unregistered adapter; explicit isolated pool injection only. No authority/JWT/PIN issuance. */
export function createIsolatedUserRevocationWriter(deps:Dependencies=defaults) {
  return { ...policy, async execute(input:unknown) {
    let c:Command;
    try { c=command(input); } catch (e) { return outcome("REJECTED",e instanceof Error && e.message==="NO_DEVICE_DECISION_SCHEMA_BLOCKED" ? e.message : "INVALID_COMMAND"); }
    let tx:WorkstationSqlTransaction;
    try { const pool=await deps.getPool(); if (!pool) return outcome("REJECTED","DATABASE_UNAVAILABLE"); tx=deps.transaction(pool); }
    catch { return outcome("REJECTED","DATABASE_UNAVAILABLE"); }
    let committing=false;
    let code="TRANSACTION_FAILED";
    const receipts:{auditLogId:string;decisionId:string}[]=[];
    try {
      await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
      const run=async (text:string, values:Record<string,unknown>={}) => {
        const req=deps.request(tx);
        for (const [name,value] of Object.entries(values)) {
          const type=["actorTokenVersion","expectedTokenVersion"].includes(name) ? sql.Int :
            ["deviceSessionId","requestId","correlationId","incarnation","nextIncarnation"].includes(name) ? sql.UniqueIdentifier :
              name==="parameters" ? sql.NVarChar(sql.MAX) : name==="passwordHash" ? sql.NVarChar(255) : sql.VarChar(100);
          req.input(name,type,value);
        }
        return (await req.query(text)).recordset;
      };
      const require=(ok:unknown,reason:string):void=>{ if (!ok) { code=reason; throw Error(reason); } };
      const gate=await run(workstationSessionRepositorySql.acquireGate);
      require(gate.length===1 && [0,1].includes(gate[0]?.GateResult as number),"GATE_DENIED");
      const schema=await run(statements.schema); require(schema.length===1 && schema[0]?.SchemaReady===1,"SCHEMA_UNPROVEN");
      const columns=await run(columnWitness());
      require(columns.length===70 && columns.every(r=>r.ResultSet==="R2_COLUMNS" && r.Status==="MATCH"),"SCHEMA_COLUMNS_UNPROVEN");
      if(c.account){ const r=await run(statements.accountSchema); require(r.length===1&&r[0]?.AccountSchemaReady===1,"ACCOUNT_SCHEMA_UNPROVEN"); }
      // All identity rows in exact BIGINT order, before membership/Session locks.
      const users=new Map<string,Record<string,unknown>>();
      for (const id of [...new Set([c.actorUserId,c.targetUserId])].sort(exactSort)) {
        const rows=await run(statements.user,{userId:id}); require(rows.length===1 && rows[0]?.UserId===id,"USER_UNPROVEN"); users.set(id,rows[0]!);
      }
      const actor=users.get(c.actorUserId)!, target=users.get(c.targetUserId)!;
      require((actor.IsActive===true || actor.IsActive===1) && actor.TokenVersion===c.actorTokenVersion,"ACTOR_REVOKED");
      const admin=await run(statements.admin,{userId:c.actorUserId}); require(admin.length===1 && admin[0]?.Allowed===1,"ACTOR_FORBIDDEN");
      require(target.TokenVersion===c.expectedTokenVersion,"USER_CAS_CONFLICT");
      if (c.operation==="CHANGE_PASSWORD") require(target.AuthProvider==="LOCAL","PASSWORD_PROVIDER_BLOCKED");
      const targetAdmin=await run(statements.targetAdmin,{userId:c.targetUserId});
      require(targetAdmin.length===1 && [0,1].includes(Number(targetAdmin[0]?.IsAdmin)),"TARGET_ROLE_UNPROVEN");
      // Preserve last-admin safety. Removing an admin requires a full membership transaction.
      if (c.operation==="DISABLE" || c.operation==="REPLACE_ROLES") require(targetAdmin[0]?.IsAdmin===0,"SYSTEM_ADMIN_SCOPE_BLOCKED");
      for (const roleId of c.roleIds??[]) {
        const role=await run(statements.role,{roleId}); require(role.length===1 && role[0]?.RoleId===roleId,"ROLE_UNPROVEN");
      }
      const operators=await run(statements.operators,{targetUserId:c.targetUserId});
      require(operators.length===c.scopes.length,"SCOPE_CHANGED");
      for (const s of c.scopes) {
        const rows=operators.filter(r=>r.WorkstationId===s.workstationId);
        require(rows.length===1,"SCOPE_CHANGED"); const row=rows[0]!;
        require(row.DeviceSessionId?.toString().toLowerCase()===s.deviceSessionId && row.Revision===s.revision &&
          row.Generation===s.generation && row.Incarnation?.toString().toLowerCase()===s.incarnation && row.StateCode==="OPERATOR_ACTIVE","OPERATOR_CAS_CONFLICT");
        const binding=await run(statements.binding,{workstationId:s.workstationId,deviceSessionId:s.deviceSessionId});
        require(binding.length===1 && binding[0]?.WorkstationId===s.workstationId &&
          binding[0]?.DeviceSessionId?.toString().toLowerCase()===s.deviceSessionId,"DEVICE_BINDING_UNPROVEN");
        const replay=await run(statements.readRequest,{requestId:s.requestId}); require(replay.length===0,"REQUEST_REPLAY");
      }
      const legacy=await run(statements.legacy,{targetUserId:c.targetUserId});
      require(legacy.length<=256 && legacy.every(r=>uuid(r.SessionId?.toString().toLowerCase()) && exactSqlBigintReceipt(r.WorkstationId)) &&
        new Set(legacy.map(r=>r.SessionId)).size===legacy.length,"LEGACY_SCOPE_UNPROVEN");
      for (const row of operators) if (row.OperatorSessionId!==null) require(
        legacy.some(l=>l.SessionId?.toString().toLowerCase()===row.OperatorSessionId?.toString().toLowerCase() && l.WorkstationId===row.WorkstationId),"LEGACY_LINK_UNPROVEN");
      if(c.account){
        const previous=await run(statements.readAccountRequest,{requestId:c.account.requestId});require(previous.length===0,"ACCOUNT_REQUEST_REPLAY");
        const digest=createHash("sha256").update(JSON.stringify({contract:"ACCOUNT_REVOKE_V1",operation:c.operation,
          actorUserId:c.actorUserId,targetUserId:c.targetUserId,expectedTokenVersion:c.expectedTokenVersion,scopes:c.scopes,roleIds:c.roleIds??null})).digest("hex");
        const r=await run(statements.reserveAccount,{...c.account,actorUserId:c.actorUserId,targetUserId:c.targetUserId,operation:c.operation,digest});
        require(r.length===1&&r[0]?.RequestId?.toString().toLowerCase()===c.account.requestId,"ACCOUNT_REQUEST_INVALID");
      }
      // Reserve per-device requests BEFORE business DML. All roll back together.
      for (const s of c.scopes) {
        const digest=createHash("sha256").update(JSON.stringify({contract:"USER_REVOKE_V1",operation:c.operation,
          targetUserId:c.targetUserId,actorUserId:c.actorUserId,expectedTokenVersion:c.expectedTokenVersion,scope:s,roleIds:c.roleIds??null})).digest("hex");
        const r=await run(statements.reserve,{...s,targetUserId:c.targetUserId,digest});
        require(r.length===1 && r[0]?.RequestId?.toString().toLowerCase()===s.requestId,"REQUEST_RECEIPT_INVALID");
      }
      const changed=await run(statements.userCas,{targetUserId:c.targetUserId,expectedTokenVersion:c.expectedTokenVersion,
        operation:c.operation,passwordHash:c.passwordHash??null});
      require(changed.length===1 && changed[0]?.NextTokenVersion===c.expectedTokenVersion+1,"USER_CAS_CONFLICT");
      if (c.operation==="REPLACE_ROLES") {
        await run(statements.deleteRoles,{targetUserId:c.targetUserId});
        for (const roleId of c.roleIds!) { const r=await run(statements.insertRole,{targetUserId:c.targetUserId,roleId}); require(r.length===1 && r[0]?.RoleId===roleId,"ROLE_WRITE_FAILED"); }
      }
      const revoked=await run(statements.revokeLegacy,{targetUserId:c.targetUserId});
      require(revoked.length===legacy.length && new Set(revoked.map(r=>r.SessionId)).size===legacy.length &&
        revoked.every(r=>legacy.some(l=>l.SessionId===r.SessionId)),"LEGACY_REVOCATION_MISMATCH");
      for (const s of c.scopes) {
        const nextIncarnation=deps.newUuid(); require(uuid(nextIncarnation) && nextIncarnation!==s.incarnation,"INCARNATION_INVALID");
        const next=await run(statements.operatorCas,{...s,targetUserId:c.targetUserId,nextIncarnation}); const n=next[0];
        require(next.length===1 && typeof n?.Revision==="string" && REVISION.test(n.Revision) && n.Revision!==s.revision &&
          generation(n.Generation) && BigInt(n.Generation)===BigInt(s.generation)+1n &&
          n.Incarnation?.toString().toLowerCase()===nextIncarnation,"OPERATOR_CAS_CONFLICT");
        const audit=await run(statements.audit,{actorUserId:c.actorUserId,parameters:JSON.stringify({contract:"USER_REVOKE_V1",
          operation:c.operation,targetUserId:c.targetUserId,requestId:s.requestId,workstationId:s.workstationId,
          previousTokenVersion:c.expectedTokenVersion,nextTokenVersion:c.expectedTokenVersion+1})});
        const auditLogId=audit[0]?.AuditLogId; require(audit.length===1 && exactSqlBigintReceipt(auditLogId),"AUDIT_RECEIPT_INVALID");
        const decision=await run(statements.decision,{...s,targetUserId:c.targetUserId,actorUserId:c.actorUserId,
          nextRevision:n!.Revision,nextGeneration:n!.Generation,nextIncarnation,auditLogId});
        const d=decision[0]; require(decision.length===1 && d?.RequestId?.toString().toLowerCase()===s.requestId &&
          d.AuditLogId===auditLogId && exactSqlBigintReceipt(d.DecisionId) &&
          !receipts.some(r=>r.auditLogId===auditLogId || r.decisionId===d.DecisionId),"DECISION_RECEIPT_INVALID");
        receipts.push({auditLogId:auditLogId as string,decisionId:d!.DecisionId as string});
      }
      const remaining=await run(statements.remaining,{targetUserId:c.targetUserId});
      require(remaining.length===1 && zero(remaining[0]?.LegacyRemaining) &&
        zero(remaining[0]?.OperatorRemaining),"REVOCATION_INCOMPLETE");
      const finalUser=await run(statements.user,{userId:c.targetUserId});
      require(finalUser.length===1 && finalUser[0]?.UserId===c.targetUserId && finalUser[0]?.TokenVersion===c.expectedTokenVersion+1 &&
        (c.operation!=="DISABLE" || finalUser[0]?.IsActive===false || finalUser[0]?.IsActive===0),"FINAL_USER_CONFLICT");
      const finalActor=await run(statements.user,{userId:c.actorUserId});
      const self=c.actorUserId===c.targetUserId;
      require(finalActor.length===1 && finalActor[0]?.UserId===c.actorUserId &&
        finalActor[0]?.TokenVersion===(self ? c.expectedTokenVersion+1 : c.actorTokenVersion) &&
        (self && c.operation==="DISABLE" || finalActor[0]?.IsActive===true || finalActor[0]?.IsActive===1),"FINAL_ACTOR_CONFLICT");
      const finalAdmin=await run(statements.admin,{userId:c.actorUserId});
      require(finalAdmin.length===1 && finalAdmin[0]?.Allowed===1,"FINAL_ACTOR_FORBIDDEN");
      if(c.account){
        const common={...c.account,actorUserId:c.actorUserId,targetUserId:c.targetUserId,operation:c.operation,expectedTokenVersion:c.expectedTokenVersion};
        const a=await run(statements.accountAudit,{actorUserId:c.actorUserId,parameters:JSON.stringify({contract:"ACCOUNT_REVOKE_V1",
          ...common,nextTokenVersion:c.expectedTokenVersion+1,operatorCount:c.scopes.length})});
        const auditLogId=a[0]?.AuditLogId;
        require(a.length===1&&exactSqlBigintReceipt(auditLogId),"ACCOUNT_AUDIT_INVALID");
        const d=await run(statements.accountDecision,{...common,auditLogId});
        require(d.length===1&&exactSqlBigintReceipt(d[0]?.DecisionId)&&d[0]?.AuditLogId===auditLogId&&
          d[0]?.RequestId?.toString().toLowerCase()===c.account.requestId,"ACCOUNT_DECISION_INVALID");
        receipts.push({auditLogId:auditLogId as string,decisionId:d[0]!.DecisionId as string});
      }
      committing=true; await tx.commit(); return outcome("COMMIT_ACKNOWLEDGED","OK",receipts);
    } catch {
      if (committing) return outcome("COMMIT_UNKNOWN","RECONCILIATION_REQUIRED");
      try { await tx.rollback(); return outcome("REJECTED",code); }
      catch { return outcome("ROLLBACK_UNKNOWN","RECONCILIATION_REQUIRED"); }
    }
  }};
}
