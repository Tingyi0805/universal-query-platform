import sql from "mssql";
import type { RuntimeIdentity } from "../queryDefinition/queryDelivery.js";

/**
 * Pre-confirmation guard for 923 Dataset-scoped authorization.
 * Does NOT grant a scope, verify a source fence, or authorize row delivery.
 * Call only with a caller-owned SERIALIZABLE SQL transaction whose lifetime
 * covers the entire confirmation write + audit/decision + commit.
 */
export class Dataset923ScopeAuthorizationError extends Error {
  constructor(readonly code: "923_SCOPE_AUTHORIZATION_REQUIRED" | "923_SCOPE_INVALID_INPUT") {
    super(code); this.name = "Dataset923ScopeAuthorizationError";
  }
}

export type Dataset923ScopeProof = Readonly<{
  datasetId: number;
  dataSourceId: number;
  actorId: number;
  tokenVersion: number;
  scopeKind: "OWNER" | "REVIEWER";
  ownerId: number;
  ownerTokenVersion: number;
  actorScopeEpochHex: string;
  ownerScopeEpochHex: string;
}>;

const invalid = (): never => { throw new Dataset923ScopeAuthorizationError("923_SCOPE_AUTHORIZATION_REQUIRED"); };
function epoch(value: unknown): string {
  if (!Buffer.isBuffer(value) || value.length !== 8 || value.equals(Buffer.alloc(8))) return invalid();
  return value.toString("hex");
}

export async function require923DatasetConfirmationScope(
  transaction: sql.Transaction,
  verifyIdentity: (transaction: sql.Transaction) => Promise<RuntimeIdentity>,
  datasetId: number,
): Promise<Dataset923ScopeProof> {
  if (!transaction || !Number.isSafeInteger(datasetId) || datasetId <= 0 || !verifyIdentity)
    throw new Dataset923ScopeAuthorizationError("923_SCOPE_INVALID_INPUT");
  // Recheck the signed token/session within the owned transaction, rather than
  // treating role names from a previously decoded JWT as sufficient.
  const actor = await verifyIdentity(transaction);
  if (!Number.isSafeInteger(actor?.userId) || actor.userId <= 0 ||
      !Number.isSafeInteger(actor.tokenVersion) || actor.tokenVersion <= 0 ||
      !Array.isArray(actor.permissions) ||
      !actor.permissions.includes("CONFIRM_DATASET_CLASSIFICATION")) return invalid();

  const result = await new sql.Request(transaction)
    .input("datasetId",sql.BigInt,datasetId)
    .input("actorId",sql.BigInt,actor.userId)
    .query(`
      SELECT d.Id AS DatasetId,d.DataSourceId,
        u.TokenVersion AS ActorTokenVersion,
        sc.ScopeKind,sc.ScopeRowVersion AS ActorScopeVersion,
        o.Id AS OwnerUserId,o.TokenVersion AS OwnerTokenVersion,
        CASE WHEN sc.ScopeKind=N'OWNER' THEN sc.ScopeRowVersion
          ELSE parent.ScopeRowVersion END AS OwnerScopeVersion
      FROM uqp.Dataset d WITH (HOLDLOCK)
      JOIN uqp.DataSource ds WITH (HOLDLOCK)
        ON ds.Id=d.DataSourceId AND ds.IsActive=1
      JOIN uqp.AppUser u WITH (HOLDLOCK)
        ON u.Id=@actorId AND u.IsActive=1
      JOIN uqp.DatasetSecurityScope sc WITH (HOLDLOCK,INDEX(PK_DatasetSecurityScope))
        ON sc.DatasetId=d.Id AND sc.UserId=u.Id AND sc.State=N'ACTIVE'
          AND sc.BoundDataSourceId=d.DataSourceId
      LEFT JOIN uqp.DatasetSecurityScope parent WITH (HOLDLOCK)
        ON parent.DatasetId=d.Id AND parent.UserId=sc.ParentOwnerUserId
           AND parent.ScopeKind=N'OWNER' AND parent.State=N'ACTIVE'
           AND parent.BoundDataSourceId=d.DataSourceId
      JOIN uqp.AppUser o WITH (HOLDLOCK)
        ON o.Id=CASE WHEN sc.ScopeKind=N'OWNER' THEN u.Id ELSE parent.UserId END
        AND o.IsActive=1
      WHERE d.Id=@datasetId AND d.IsActive=1 AND d.IsArchived=0
        AND ((sc.ScopeKind=N'OWNER' AND sc.ParentOwnerUserId IS NULL
               AND sc.ParentOwnerKind IS NULL)
          OR (sc.ScopeKind=N'REVIEWER' AND sc.ParentOwnerKind=N'OWNER'
               AND parent.UserId IS NOT NULL AND parent.UserId<>u.Id))
        AND EXISTS (
          SELECT 1 FROM uqp.UserRole ur WITH (HOLDLOCK)
          JOIN uqp.Role r WITH (HOLDLOCK) ON r.Id=ur.RoleId AND r.IsActive=1
          JOIN uqp.RolePermission rp WITH (HOLDLOCK) ON rp.RoleId=r.Id
          JOIN uqp.Permission p WITH (HOLDLOCK) ON p.Id=rp.PermissionId
          WHERE ur.UserId=u.Id AND p.Code=N'CONFIRM_DATASET_CLASSIFICATION'
        )
    `);
  if (result.recordset.length !== 1) return invalid();
  const row=result.recordset[0];
  if (Number(row.ActorTokenVersion)!==actor.tokenVersion ||
      !Number.isSafeInteger(Number(row.OwnerTokenVersion)) ||
      Number(row.OwnerTokenVersion)<=0) return invalid();
  const scopeKind=row.ScopeKind;
  if (scopeKind!=="OWNER" && scopeKind!=="REVIEWER") return invalid();
  const ownerId=Number(row.OwnerUserId),dataSourceId=Number(row.DataSourceId);
  if (!Number.isSafeInteger(ownerId)||ownerId<=0 ||
      !Number.isSafeInteger(dataSourceId)||dataSourceId<=0 ||
      (scopeKind==="OWNER" && ownerId!==actor.userId) ||
      (scopeKind==="REVIEWER" && ownerId===actor.userId)) return invalid();
  return Object.freeze({
    datasetId,dataSourceId,actorId:actor.userId,tokenVersion:actor.tokenVersion,
    scopeKind,ownerId,ownerTokenVersion:Number(row.OwnerTokenVersion),
    actorScopeEpochHex:epoch(row.ActorScopeVersion),
    ownerScopeEpochHex:epoch(row.OwnerScopeVersion),
  });
}
