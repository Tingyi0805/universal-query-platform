/**
 * Uses the real 006+016 UQP AuditLog shape on the disposable SQL Server 2019
 * test database. Confirms that the future 923 transaction-only Audit writer
 * produces exact BIGINT receipts and participates in caller rollback.
 *
 * This is an integration test of a low-level primitive, NOT an authorized
 * DatasetSecurityDecision writer, source fence, or preview permission.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import sql from "mssql";
import {
  writeExact923AuditReceipt,
  parseExact923AuditId,
  type Dataset923AuditInput,
} from "../modules/dataset/dataset923ExactAuditReceipt.js";

const datasetId=101;
const actorUserId=301;
const commandDigestHex="a".repeat(64);
const makeInput=():Dataset923AuditInput=>({
  datasetId,actorUserId,kind:"SCOPE",action:"REVOKE_SCOPE",
  requestId:randomUUID(),commandDigestHex,
});

async function auditCount(pool:sql.ConnectionPool):Promise<number>{
  const r=await pool.request().query("SELECT COUNT_BIG(*) AS C FROM uqp.AuditLog");
  return Number(r.recordset[0]?.C);
}

async function inOwnedTransaction<T>(
  pool:sql.ConnectionPool,
  fn:(tx:sql.Transaction)=>Promise<T>,commit:boolean,
):Promise<T>{
  const tx=new sql.Transaction(pool);
  await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  let active=true;
  try{
    const result=await fn(tx);
    if(commit){await tx.commit();active=false;}
    else{await tx.rollback();active=false;}
    return result;
  }finally{
    if(active)await tx.rollback().catch(()=>undefined);
  }
}

export async function test923ExactAuditReceiptOnDisposableSql2019(pool:sql.ConnectionPool){
  // Real 006 AuditLog mandatory fields, FKs, status CHECK and 016 category
  // additions. An identity seed > MAX_SAFE_INTEGER tests BIGINT round-trip
  // without converting the actual audit id to Number in JS.
  const setup=[
    `CREATE TABLE uqp.AuditLog (
      Id BIGINT IDENTITY(9007199254740994,1) NOT NULL PRIMARY KEY,
      EventType NVARCHAR(50) NOT NULL,
      UserId BIGINT NULL,
      QueryDefinitionId BIGINT NULL,
      DatasetId BIGINT NULL,
      Status NVARCHAR(20) NOT NULL,
      ParametersJson NVARCHAR(MAX) NULL,
      ResultRowCount INT NULL,
      DurationMs INT NULL,
      IpAddress NVARCHAR(100) NULL,
      UserAgent NVARCHAR(500) NULL,
      ErrorCode NVARCHAR(200) NULL,
      CreatedAtUtc DATETIME2(0) NOT NULL
        CONSTRAINT DF_923SyntheticAuditCreated DEFAULT SYSUTCDATETIME(),
      CompletedAtUtc DATETIME2(0) NULL,
      EventCategory NVARCHAR(20) NOT NULL
        CONSTRAINT DF_923SyntheticAuditCategory DEFAULT (N'SYSTEM'),
      IsImportant BIT NOT NULL CONSTRAINT DF_923SyntheticAuditImportant DEFAULT (0),
      CONSTRAINT FK_923SyntheticAudit_User FOREIGN KEY(UserId) REFERENCES uqp.AppUser(Id),
      CONSTRAINT FK_923SyntheticAudit_Dataset FOREIGN KEY(DatasetId) REFERENCES uqp.Dataset(Id),
      CONSTRAINT CK_923SyntheticAudit_Status CHECK(Status IN (N'STARTED',N'SUCCESS',N'FAILED')),
      CONSTRAINT CK_923SyntheticAudit_Category CHECK(EventCategory IN (N'SECURITY',N'CONFIG',N'USAGE',N'SYSTEM'))
    )`,
  ];
  for(const ddl of setup)await pool.request().batch(ddl);
  assert.equal(await auditCount(pool),0);

  // Receipt INSERT rolls back with the caller-owned transaction.
  const rejected=await inOwnedTransaction(pool,tx=>
    writeExact923AuditReceipt(tx,makeInput()),false);
  assert.ok(BigInt(parseExact923AuditId(rejected))>BigInt(Number.MAX_SAFE_INTEGER));
  assert.equal(await auditCount(pool),0,"Rollback must not leave a SUCCESS audit receipt");
  console.log("UQP923_REAL_AUDIT_RECEIPT_ROLLBACK: NO_PERSISTED_SUCCESS");

  // Input fails before any SQL write, regardless of current transaction.
  const bad:Dataset923AuditInput={...makeInput(),commandDigestHex:"not-sha256"};
  await assert.rejects(async()=>inOwnedTransaction(pool,tx=>
    writeExact923AuditReceipt(tx,bad),true),{code:"923_AUDIT_INPUT_INVALID"});
  assert.equal(await auditCount(pool),0,"Rejected input must not leave audit records");

  // Success path returns the exact decimal BIGINT from real AuditLog.
  const command=makeInput();
  const exact=await inOwnedTransaction(pool,tx=>
    writeExact923AuditReceipt(tx,command),true);
  assert.ok(BigInt(exact)>BigInt(Number.MAX_SAFE_INTEGER));
  const q=await pool.request()
    .input("auditId",sql.VarChar(20),exact)
    .query(`SELECT CONVERT(varchar(20),Id) AS ExactId,UserId,DatasetId,
      EventType,EventCategory,IsImportant,Status,ParametersJson
      FROM uqp.AuditLog WHERE Id=CONVERT(bigint,@auditId)`);
  assert.equal(q.recordset.length,1);
  const row=q.recordset[0];
  assert.equal(row.ExactId,exact);
  assert.equal(row.UserId,actorUserId);
  assert.equal(row.DatasetId,datasetId);
  assert.equal(row.EventType,"DATASET_SECURITY_DECISION");
  assert.equal(row.EventCategory,"SECURITY");
  assert.equal(row.IsImportant,true);
  assert.equal(row.Status,"SUCCESS");
  assert.deepEqual(JSON.parse(String(row.ParametersJson)),{
    requestId:command.requestId.toLowerCase(),
    kind:"SCOPE",action:"REVOKE_SCOPE",commandDigest:commandDigestHex,
  });
  assert.equal(await auditCount(pool),1);
  console.log("UQP923_REAL_AUDIT_RECEIPT_COMMIT: EXACT_BIGINT_LINK_AND_MINIMAL_SECURITY_EVENT");

  // This AuditLog receipt alone grants no authority or implicit Dataset
  // policy state: the real owner/decision service is intentionally unmounted.
  console.log("UQP923_REAL_OWNER_WRITER=NOT_RUN; SOURCE_FENCE=NOT_RUN; PREVIEW_ALLOWED=false");
}
