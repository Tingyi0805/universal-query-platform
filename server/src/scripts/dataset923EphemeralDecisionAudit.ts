/**
 * UQP 923 / F5 synthetic transaction atomicity probe on an ephemeral SQL2019 instance.
 *
 * The audit receipt table below is deliberately SYNTHETIC; it is NOT uqp.AuditLog.
 * This verifies SQL-level transaction/ledger/FK/CAS/rollback behavior only.
 * No runtime Writer, real AuditLog schema, security Scope grant or delivery flag.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import sql from "mssql";

const datasetId = 101, ownerId = 301;
const auditTable = "[uqp].[CiSyntheticAuditReceipt]";
const code = "SCOPE_REVOKED";
const exactIdPattern = /^[1-9][0-9]{0,18}$/u;

function req(tx: sql.Transaction) {
  return new sql.Request(tx)
    .input("datasetId",sql.BigInt,datasetId)
    .input("ownerId",sql.BigInt,ownerId);
}
async function ownerState(pool: sql.ConnectionPool) {
  const result = await pool.request()
    .input("datasetId",sql.BigInt,datasetId)
    .input("ownerId",sql.BigInt,ownerId)
    .query(`SELECT State, ScopeRowVersion FROM uqp.DatasetSecurityScope
      WHERE DatasetId=@datasetId AND UserId=@ownerId AND ScopeKind=N'OWNER'`);
  assert.equal(result.recordset.length,1);
  const row=result.recordset[0];
  if(typeof row.State!=="string" || !Buffer.isBuffer(row.ScopeRowVersion)
    || row.ScopeRowVersion.length!==8) throw new Error("F5_INVALID_SCOPE_STATE_OR_VERSION");
  return { state: row.State as string, version: row.ScopeRowVersion as Buffer };
}
async function receiptCount(pool: sql.ConnectionPool) {
  const result=await pool.request().query(`
    SELECT (SELECT COUNT_BIG(*) FROM ${auditTable}) AS Receipts,
           (SELECT COUNT_BIG(*) FROM uqp.DatasetSecurityDecision) AS Decisions`);
  return { receipts: String(result.recordset[0].Receipts),
           decisions: String(result.recordset[0].Decisions) };
}
async function owned<T>(pool: sql.ConnectionPool, fn:(tx:sql.Transaction)=>Promise<T>):Promise<T>{
  const tx=new sql.Transaction(pool);
  await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  let open=true;
  try{
    const v=await fn(tx);
    await tx.commit();open=false;return v;
  }finally{if(open)await tx.rollback().catch(()=>undefined);}
}
async function mutateScope(tx:sql.Transaction, requestId:string, previous:Buffer) {
  const result=await req(tx)
    .input("requestId",sql.UniqueIdentifier,requestId)
    .input("expected",sql.VarBinary(8),previous)
    .query(`
      UPDATE uqp.DatasetSecurityScope WITH (UPDLOCK,HOLDLOCK)
      SET State=N'REVOKED', LastRequestId=@requestId,
          LastReasonCode=N'SCOPE_REVOKED',ChangedByUserId=@ownerId,
          ChangedAt=SYSUTCDATETIME()
      OUTPUT inserted.ScopeRowVersion AS NewVersion
      WHERE DatasetId=@datasetId AND UserId=@ownerId AND ScopeKind=N'OWNER'
        AND State=N'ACTIVE' AND ScopeRowVersion=@expected`);
  assert.equal(result.recordset.length,1,"F5 scope update requires exact CAS");
  const next=result.recordset[0]?.NewVersion;
  if(!Buffer.isBuffer(next)||next.length!==8||next.equals(previous))
    throw new Error("F5_NO_FRESH_SCOPE_ROWVERSION");
  return next as Buffer;
}
async function appendReceipt(tx:sql.Transaction, requestId:string, good=true) {
  await req(tx).input("requestId",sql.UniqueIdentifier,requestId)
    .input("event",sql.NVarChar(32),good ? code : "INVALID_EVENT")
    .query(`INSERT INTO ${auditTable}(RequestId,ActorUserId,EventCode)
      VALUES(@requestId,@ownerId,@event)`);
  const r=await req(tx).input("requestId",sql.UniqueIdentifier,requestId)
    .query(`SELECT CONVERT(varchar(25), Id) AS ExactId
      FROM ${auditTable} WHERE RequestId=@requestId`);
  const v=r.recordset[0]?.ExactId;
  if(typeof v!=="string"||!exactIdPattern.test(v)
    || BigInt(v)<=BigInt(Number.MAX_SAFE_INTEGER))throw new Error("F5_AUDIT_ID_NOT_EXACT_BIGINT");
  return v as string;
}
async function insertDecision(
  tx:sql.Transaction,requestId:string,previous:Buffer,next:Buffer,
  options:{ badAction?:boolean }={}
){
  const r=await req(tx)
    .input("requestId",sql.UniqueIdentifier,requestId)
    .input("previous",sql.VarBinary(8),previous)
    .input("next",sql.VarBinary(8),next)
    .input("txRef",sql.UniqueIdentifier,randomUUID())
    .input("incarnation",sql.UniqueIdentifier,randomUUID())
    .query(`
      INSERT INTO uqp.DatasetSecurityDecision
        (DatasetId,Kind,SnapshotId,SubjectUserId,ScopeKind,RequestId,CommandDigest,
        ActorId,ActorTokenVersion,Action,ReasonCode,PreviousState,NextState,
        PreviousStateVersion,NextStateVersion,AuthorizationEvidenceJson,DetailsJson,
        AuditLogId,TransactionReference,PlatformIncarnation,DecidedAt)
      OUTPUT inserted.Id AS DecisionId
      SELECT @datasetId,N'SCOPE',NULL,@ownerId,N'OWNER',@requestId,
        HASHBYTES('SHA2_256',N'CI_SYNTHETIC_SCOPE_REVOKE'),
        @ownerId,1,
        ${options.badAction?"N'INVALID_ACTION'":"N'REVOKE_SCOPE'"},
        N'SCOPE_REVOKED',N'ACTIVE',N'REVOKED',
        @previous,@next,N'{"test":"synthetic"}',N'{"writes":"atomic"}',
        ar.Id,@txRef,@incarnation,SYSUTCDATETIME()
      FROM ${auditTable} ar WHERE ar.RequestId=@requestId`);
  assert.equal(r.recordset.length,1,"F5 decision must have exact audit receipt");
}
async function assertBaseline(pool:sql.ConnectionPool,version:Buffer) {
  const state=await ownerState(pool);
  assert.equal(state.state,"ACTIVE");
  assert.ok(state.version.equals(version),"rollback must preserve scope rowversion");
  assert.deepEqual(await receiptCount(pool),{receipts:"0",decisions:"0"});
}

export async function test923SyntheticDecisionAuditAtomicity(pool:sql.ConnectionPool){
  await pool.request().batch(`
    CREATE TABLE ${auditTable} (
      Id BIGINT IDENTITY(9007199254740994,1) NOT NULL
        CONSTRAINT PK_CiSyntheticAuditReceipt PRIMARY KEY,
      RequestId UNIQUEIDENTIFIER NOT NULL CONSTRAINT UQ_CiSyntheticAuditReceipt_Request UNIQUE,
      ActorUserId BIGINT NOT NULL,
      EventCode NVARCHAR(32) NOT NULL,
      CONSTRAINT CK_CiSyntheticAuditReceipt_Event CHECK (EventCode=N'SCOPE_REVOKED')
    )`);
  const initial=await ownerState(pool);
  assert.equal(initial.state,"ACTIVE","F5 baseline after Scope CAS probe");
  assert.deepEqual(await receiptCount(pool),{receipts:"0",decisions:"0"});

  // Fail the synthetic Audit receipt AFTER the Scope head was updated.
  let auditRejected=false;
  try{
    await owned(pool,async tx=>{
      const id=randomUUID();
      await mutateScope(tx,id,initial.version);
      await appendReceipt(tx,id,false);
    });
  }catch{auditRejected=true;}
  assert.equal(auditRejected,true,"invalid audit event must fail");
  await assertBaseline(pool,initial.version);
  console.log("UQP923_F5_SYNTHETIC_AUDIT_FAILURE: HEAD_AND_RECEIPT_ROLLED_BACK");

  // Audit INSERT succeeds but Decision CHECK fails. All three objects roll back.
  let ledgerRejected=false;
  try{
    await owned(pool,async tx=>{
      const id=randomUUID();
      const next=await mutateScope(tx,id,initial.version);
      await appendReceipt(tx,id,true);
      await insertDecision(tx,id,initial.version,next,{badAction:true});
    });
  }catch{ledgerRejected=true;}
  assert.equal(ledgerRejected,true,"invalid decision must fail");
  await assertBaseline(pool,initial.version);
  console.log("UQP923_F5_SYNTHETIC_LEDGER_FAILURE: HEAD_AND_AUDIT_ROLLED_BACK");

  const committedId=randomUUID();
  const exactAuditId=await owned(pool,async tx=>{
    const next=await mutateScope(tx,committedId,initial.version);
    const auditId=await appendReceipt(tx,committedId,true);
    await insertDecision(tx,committedId,initial.version,next);
    return auditId;
  });
  assert.ok(BigInt(exactAuditId)>BigInt(Number.MAX_SAFE_INTEGER));
  const state=await ownerState(pool);
  assert.equal(state.state,"REVOKED");
  assert.ok(!state.version.equals(initial.version),"committed Scope must change version");
  assert.deepEqual(await receiptCount(pool),{receipts:"1",decisions:"1"});
  const verified=await pool.request()
    .input("requestId",sql.UniqueIdentifier,committedId)
    .query(`SELECT CONVERT(varchar(25),d.AuditLogId) AS DecisionAuditId,
      CONVERT(varchar(25),r.Id) AS ReceiptId,
      d.Action, d.PreviousState, d.NextState, s.State
      FROM uqp.DatasetSecurityDecision d
      JOIN ${auditTable} r ON r.Id=d.AuditLogId AND r.RequestId=d.RequestId
      JOIN uqp.DatasetSecurityScope s ON s.DatasetId=d.DatasetId
        AND s.UserId=d.SubjectUserId AND s.ScopeKind=d.ScopeKind
      WHERE d.RequestId=@requestId`);
  assert.equal(verified.recordset.length,1);
  assert.equal(verified.recordset[0].DecisionAuditId,exactAuditId);
  assert.equal(verified.recordset[0].ReceiptId,exactAuditId);
  assert.equal(verified.recordset[0].Action,"REVOKE_SCOPE");
  assert.equal(verified.recordset[0].PreviousState,"ACTIVE");
  assert.equal(verified.recordset[0].NextState,"REVOKED");
  assert.equal(verified.recordset[0].State,"REVOKED");
  console.log("UQP923_F5_SYNTHETIC_ATOMIC_COMMIT: SCOPE_DECISION_AUDIT_RECEIPT_LINKED");
  console.log("UQP923_F5_SYNTHETIC_BIGINT_AUDIT_RECEIPT: EXACT_STRING_GREATER_THAN_2_POW_53");

  // DB uniqueness rejects a second ledger for the same request identifier.
  // This is NOT the service-layer idempotent read/reply algorithm.
  let duplicateRejected=false;
  try {
    await owned(pool,async tx=>{
      const b=await req(tx).input("requestId",sql.UniqueIdentifier,committedId)
        .query(`INSERT INTO ${auditTable}(RequestId,ActorUserId,EventCode)
          VALUES(@requestId,@ownerId,N'SCOPE_REVOKED')`);
      assert.ok(b.rowsAffected.length>=0);
    });
  }catch{duplicateRejected=true;}
  assert.equal(duplicateRejected,true,"duplicate request must not write another audit receipt");
  assert.deepEqual(await receiptCount(pool),{receipts:"1",decisions:"1"});
  console.log("UQP923_F5_SYNTHETIC_DUPLICATE_REQUEST: REJECTED_WITH_NO_PARTIAL_WRITE");
  console.log("F5_PRODUCTION_AUDIT_WRITER=NOT_RUN; OWNER_AUTHORIZATION=NOT_RUN; DELIVERY_ALLOWED=false");
}
