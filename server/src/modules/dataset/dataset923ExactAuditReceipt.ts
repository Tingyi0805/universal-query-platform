import sql from "mssql";

/**
 * Exact AuditLog receipt for future 923 owned transactions.
 *
 * This primitive NEVER starts/commits its own transaction. It does not change
 * DatasetSecurityScope/Decision, grant roles, or enable preview. Only a future
 * reviewed 923 writer with real actor/scope/fence checks may invoke it.
 * Do not use legacy writeAuditEvent(), which returns Number(AuditLog.Id).
 */
export class Dataset923AuditReceiptError extends Error {
  constructor(readonly code: "923_AUDIT_INPUT_INVALID" | "923_AUDIT_ID_NOT_EXACT") {
    super(code);
    this.name = "Dataset923AuditReceiptError";
  }
}

export type Dataset923AuditKind = "SCOPE" | "SNAPSHOT" | "CONFIRMATION";
export type Dataset923AuditAction =
  | "GRANT_SCOPE" | "REVOKE_SCOPE" | "COLLECT_METADATA"
  | "INVALIDATE" | "CONFIRM" | "REJECT" | "REVOKE";

export type Dataset923AuditInput = Readonly<{
  datasetId: number | string;
  actorUserId: number | string;
  kind: Dataset923AuditKind;
  action: Dataset923AuditAction;
  requestId: string;
  commandDigestHex: string;
}>;

const operations: Readonly<Record<Dataset923AuditKind, readonly Dataset923AuditAction[]>> = {
  SCOPE: ["GRANT_SCOPE", "REVOKE_SCOPE"],
  SNAPSHOT: ["COLLECT_METADATA", "INVALIDATE"],
  CONFIRMATION: ["CONFIRM", "REJECT", "REVOKE", "INVALIDATE"],
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const sha256 = /^[a-f0-9]{64}$/iu;
// SQL Server BIGINT: 1 to 9223372036854775807, returned as canonical decimal string.
export function parseExact923AuditId(value: unknown): string {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,18}$/u.test(value)) {
    throw new Dataset923AuditReceiptError("923_AUDIT_ID_NOT_EXACT");
  }
  const n = BigInt(value);
  if (n > 9223372036854775807n) {
    throw new Dataset923AuditReceiptError("923_AUDIT_ID_NOT_EXACT");
  }
  return value;
}

function validate(input: Dataset923AuditInput): string {
  if (!exactEntity(input.datasetId) || !exactEntity(input.actorUserId) ||
      !Object.prototype.hasOwnProperty.call(operations, input.kind) ||
      !operations[input.kind]?.includes(input.action) ||
      !uuid.test(input.requestId) || !sha256.test(input.commandDigestHex)) {
    throw new Dataset923AuditReceiptError("923_AUDIT_INPUT_INVALID");
  }
  const details = JSON.stringify({
    requestId: input.requestId.toLowerCase(), kind: input.kind, action: input.action,
    commandDigest: input.commandDigestHex.toLowerCase(),
  });
  if (Buffer.byteLength(details, "utf16le") > 16384) {
    throw new Dataset923AuditReceiptError("923_AUDIT_INPUT_INVALID");
  }
  return details;
}

function exactEntity(value:number|string):string {
  if(typeof value==="number") {
    if(!Number.isSafeInteger(value)||value<=0) throw new Dataset923AuditReceiptError("923_AUDIT_INPUT_INVALID");
    return value.toString();
  }
  return parseExact923AuditId(value);
}

/**
 * Must be invoked inside the same caller-owned SERIALIZABLE transaction as
 * the Scope/Confirmation CAS and the immutable DatasetSecurityDecision INSERT.
 * This does not verify the transaction isolation or any authorization on its
 * own; future orchestration must enforce both.
 */
export async function writeExact923AuditReceipt(
  transaction: sql.Transaction,
  input: Dataset923AuditInput,
): Promise<string> {
  if (!transaction) throw new Dataset923AuditReceiptError("923_AUDIT_INPUT_INVALID");
  const details = validate(input);
  const result = await new sql.Request(transaction)
    .input("datasetId", sql.VarChar(20), exactEntity(input.datasetId))
    .input("actorId", sql.VarChar(20), exactEntity(input.actorUserId))
    .input("parameters", sql.NVarChar(sql.MAX), details)
    .query(`
      DECLARE @Written TABLE (Id BIGINT NOT NULL);
      INSERT INTO uqp.AuditLog
        (EventType,EventCategory,IsImportant,UserId,QueryDefinitionId,DatasetId,
         Status,ParametersJson,IpAddress,UserAgent,ErrorCode,CompletedAtUtc)
      OUTPUT INSERTED.Id INTO @Written(Id)
      VALUES
        (N'DATASET_SECURITY_DECISION',N'SECURITY',1,CONVERT(bigint,@actorId),NULL,CONVERT(bigint,@datasetId),
         N'SUCCESS',@parameters,NULL,NULL,NULL,SYSUTCDATETIME());
      SELECT CONVERT(varchar(20),Id) AS ExactAuditId FROM @Written;
    `);
  if (result.recordset.length !== 1) {
    throw new Dataset923AuditReceiptError("923_AUDIT_ID_NOT_EXACT");
  }
  return parseExact923AuditId(result.recordset[0]?.ExactAuditId);
}
