/**
 * F5 acceptance: atomic SCOPE CAS + genuine uqp.AuditLog + 923 Decision.
 * Executed ONLY in the disposable GitHub Actions SQL Server 2019 database.
 * Synthetic authorization evidence, not a runtime security issuer or API.
 */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import sql from "mssql";
import { writeExact923AuditReceipt } from "../modules/dataset/dataset923ExactAuditReceipt.js";

const datasetId=101, ownerId=301;
const hexDigest=createHash("sha256").update("F5_REAL_AUDIT_SCOPE_DECISION_SYNTHETIC_V1").digest("hex");
const correctAuditId=(value:string)=>{if(!/^[1-9][0-9]{0,18}$/u.test(value))throw Error("F5_NOT_EXACT_AUDIT_ID");return value;};

function request(tx:sql.Transaction){
  return new sql.Request(tx).input("datasetId",sql.BigInt,datasetId).input("ownerId",sql.BigInt,ownerId);
}
async function readHead(pool:sql.ConnectionPool){
  const r=await pool.request().input("datasetId",sql.BigInt,datasetId)
    .input("ownerId",sql.BigInt,ownerId)
    .query(`SELECT State,ScopeRowVersion FROM uqp.DatasetSecurityScope
      WHERE DatasetId=@datasetId AND UserId=@ownerId AND ScopeKind=N'OWNER'`);
  assert.equal(r.recordset.length,1);
  const row=r.recordset[0];
  assert.ok(Buffer.isBuffer(row.ScopeRowVersion)&&row.ScopeRowVersion.length===8);
  return {state:String(row.State),version:row.ScopeRowVersion as Buffer};
}
async function counts(pool:sql.ConnectionPool){
  const r=await pool.request().query(`SELECT
    (SELECT COUNT_BIG(*) FROM uqp.AuditLog) AS Audits,
    (SELECT COUNT_BIG(*) FROM uqp.DatasetSecurityDecision) AS Decisions`);
  return {audits:String(r.recordset[0].Audits), decisions:String(r.recordset[0].Decisions)};
}
async function execute(
  pool:sql.ConnectionPool, reqId:string, opts:{invalidDecision?:boolean;rollbackOnly?:boolean}={},
){
  const tx=new sql.Transaction(pool);
  await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  let active=true;
  try{
    const locked=await request(tx).query(`
      SELECT State,ScopeRowVersion,BoundDataSourceId
      FROM uqp.DatasetSecurityScope WITH (UPDLOCK,HOLDLOCK,INDEX(PK_DatasetSecurityScope))
      WHERE DatasetId=@datasetId AND UserId=@ownerId AND ScopeKind=N'OWNER'`);
    assert.equal(locked.recordset.length,1);
    const old=locked.recordset[0];
    assert.equal(old.State,"REVOKED");
    assert.equal(String(old.BoundDataSourceId),"201");
    assert.ok(Buffer.isBuffer(old.ScopeRowVersion)&&old.ScopeRowVersion.length===8);
    const oldVersion=old.ScopeRowVersion as Buffer;
    const result=await request(tx)
      .input("requestId",sql.UniqueIdentifier,reqId)
      .input("expected",sql.VarBinary(8),oldVersion)
      .query(`UPDATE uqp.DatasetSecurityScope
        SET State=N'ACTIVE',LastReasonCode=N'OWNER_APPOINTED',
          LastRequestId=@requestId,ChangedByUserId=@ownerId,
          ChangedAt=SYSUTCDATETIME()
        OUTPUT inserted.ScopeRowVersion AS NextVersion
        WHERE DatasetId=@datasetId AND UserId=@ownerId AND ScopeKind=N'OWNER'
          AND State=N'REVOKED' AND ScopeRowVersion=@expected`);
    assert.equal(result.recordset.length,1);
    const nextVersion=result.recordset[0].NextVersion;
    assert.ok(Buffer.isBuffer(nextVersion)&&nextVersion.length===8&&!nextVersion.equals(oldVersion));

    // Real AuditLog receipt is inserted within the SAME transaction.
    const auditId=correctAuditId(await writeExact923AuditReceipt(tx,{
      datasetId,actorUserId:ownerId,kind:"SCOPE",action:"GRANT_SCOPE",
      requestId:reqId,commandDigestHex:hexDigest,
    }));
    const ledger=await request(tx)
      .input("requestId",sql.UniqueIdentifier,reqId)
      .input("digest",sql.VarBinary(32),Buffer.from(hexDigest,"hex"))
      .input("previous",sql.VarBinary(8),oldVersion)
      .input("next",sql.VarBinary(8),nextVersion)
      .input("auditId",sql.VarChar(20),auditId)
      .input("transactionReference",sql.UniqueIdentifier,randomUUID())
      .input("incarnation",sql.UniqueIdentifier,randomUUID())
      .query(`INSERT INTO uqp.DatasetSecurityDecision
        (DatasetId,Kind,SnapshotId,SubjectUserId,ScopeKind,RequestId,CommandDigest,
         ActorId,ActorTokenVersion,Action,ReasonCode,PreviousState,NextState,
         PreviousStateVersion,NextStateVersion,AuthorizationEvidenceJson,DetailsJson,
         AuditLogId,TransactionReference,PlatformIncarnation,DecidedAt)
        OUTPUT CONVERT(varchar(20),inserted.Id) AS ExactDecisionId
        VALUES (@datasetId,N'SCOPE',NULL,@ownerId,N'OWNER',@requestId,@digest,
          @ownerId,1,${opts.invalidDecision?"N'INVALID_ACTION'":"N'GRANT_SCOPE'"},
          N'OWNER_APPOINTED',N'REVOKED',N'ACTIVE',
          @previous,@next,N'{"scope":"SYNTHETIC_TEST_ONLY"}',
          N'{"purpose":"F5_SQL2019_ATOMICITY_PROBE"}',
          CONVERT(bigint,@auditId),@transactionReference,@incarnation,SYSUTCDATETIME())`);
    assert.equal(ledger.recordset.length,1);
    const decisionId=String(ledger.recordset[0].ExactDecisionId);
    assert.match(decisionId,/^[1-9][0-9]*$/u);
    if(opts.rollbackOnly){
      await tx.rollback();active=false;
      return {auditId,decisionId};
    }
    await tx.commit();active=false;
    return {auditId,decisionId};
  }finally{if(active)await tx.rollback().catch(()=>undefined);}
}
export async function test923RealAuditScopeDecisionOnDisposableSql2019(pool:sql.ConnectionPool){
  const start=await readHead(pool);
  assert.equal(start.state,"REVOKED","Prerequisite: synthetic 923 scope CAS probe revoked owner");
  const initial=await counts(pool);
  assert.equal(initial.audits,"1","Prerequisite: genuine AuditLog receipt test committed one entry");

  // Fail after real AuditLog insertion; all three writes must rollback.
  const invalidId=randomUUID();
  await assert.rejects(()=>execute(pool,invalidId,{invalidDecision:true}));
  assert.deepEqual(await counts(pool),initial);
  const afterFailure=await readHead(pool);
  assert.equal(afterFailure.state,start.state);
  assert.ok(afterFailure.version.equals(start.version));
  console.log("UQP923_REAL_AUDIT_DECISION_CONSTRAINT_FAILURE: SCOPE_AUDIT_DECISION_ROLLED_BACK");

  // Even a valid decision cannot outlive caller rollback.
  await execute(pool,randomUUID(),{rollbackOnly:true});
  assert.deepEqual(await counts(pool),initial);
  const afterRollback=await readHead(pool);
  assert.equal(afterRollback.state,start.state);
  assert.ok(afterRollback.version.equals(start.version));
  console.log("UQP923_REAL_AUDIT_DECISION_ROLLBACK: NO_ORPHAN_SUCCESS");

  const validId=randomUUID();
  const persisted=await execute(pool,validId);
  const final=await readHead(pool);
  assert.equal(final.state,"ACTIVE");
  assert.ok(!final.version.equals(start.version));
  const end=await counts(pool);
  assert.equal(BigInt(end.audits),BigInt(initial.audits)+1n);
  assert.equal(BigInt(end.decisions),BigInt(initial.decisions)+1n);
  const result=await pool.request().input("reqId",sql.UniqueIdentifier,validId)
    .query(`SELECT CONVERT(varchar(20),d.Id) AS DecisionId,
      CONVERT(varchar(20),d.AuditLogId) AS DecisionAuditId,
      CONVERT(varchar(20),a.Id) AS ReceiptId,
      d.Action,d.Kind,d.PreviousState,d.NextState,a.EventType,
      a.EventCategory,a.IsImportant,a.Status
      FROM uqp.DatasetSecurityDecision d
      JOIN uqp.AuditLog a ON a.Id=d.AuditLogId
      WHERE d.RequestId=@reqId`);
  assert.equal(result.recordset.length,1);
  const row=result.recordset[0];
  assert.equal(row.DecisionId,persisted.decisionId);
  assert.equal(row.DecisionAuditId,persisted.auditId);
  assert.equal(row.ReceiptId,persisted.auditId);
  assert.equal(row.Action,"GRANT_SCOPE");
  assert.equal(row.Kind,"SCOPE");
  assert.equal(row.PreviousState,"REVOKED");
  assert.equal(row.NextState,"ACTIVE");
  assert.equal(row.EventType,"DATASET_SECURITY_DECISION");
  assert.equal(row.EventCategory,"SECURITY");
  assert.equal(row.IsImportant,true);
  assert.equal(row.Status,"SUCCESS");
  console.log("UQP923_REAL_AUDIT_SCOPE_DECISION: ATOMIC_COMMIT_EXACT_AUDIT_ID");

  // Duplicate RequestId must not yield another AuditLog or immutable Decision.
  await assert.rejects(()=>execute(pool,validId));
  assert.deepEqual(await counts(pool),end);
  console.log("UQP923_REAL_AUDIT_SCOPE_DECISION_DUPLICATE: NO_NEW_RECEIPT");

  // Deliberately no production token, admin scope grant, authenticated endpoint,
  // or source-bound snapshot. All runtime preview gates remain closed.
  console.log("F2_PRODUCTION_AUTHORIZATION=NOT_RUN; F3_SOURCE_FENCE=NOT_RUN; DATA_PREVIEW=false");
}
