/**
 * F2 scoped authorization READ-ONLY rehearsal. Disposable SQL Server 2019
 * synthetic base identities only; not a production signer or confirmed policy.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import sql from "mssql";
import { require923DatasetConfirmationScope, Dataset923ScopeAuthorizationError } from "../modules/dataset/dataset923ScopeConfirmationGate.js";
import type { RuntimeIdentity } from "../modules/queryDefinition/queryDelivery.js";

const ownerId=301,reviewerId=302,datasetId=101,sourceId=201;
async function check(pool:sql.ConnectionPool,actor:RuntimeIdentity,id=datasetId){
  const tx=new sql.Transaction(pool);
  await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  try {
    const proof=await require923DatasetConfirmationScope(tx,async()=>actor,id);
    await tx.rollback();
    return proof;
  }catch(e){await tx.rollback().catch(()=>undefined);throw e;}
}
async function rejected(pool:sql.ConnectionPool,actor:RuntimeIdentity,id=datasetId){
  await assert.rejects(()=>check(pool,actor,id),Dataset923ScopeAuthorizationError);
}
function actor(id:number,permissions=["CONFIRM_DATASET_CLASSIFICATION"],tokenVersion=1):RuntimeIdentity{
  return {userId:id,tokenVersion,permissions};
}
export async function test923ScopeConfirmationGateOnSyntheticSql2019(pool:sql.ConnectionPool){
  // No Permission/Role is installed by migration 923. Ensure global permissions
  // do not substitute for a direct per-Dataset owner/reviewer Scope.
  await pool.request().batch(`
    CREATE TABLE uqp.Role(Id BIGINT NOT NULL PRIMARY KEY,Code NVARCHAR(100) NOT NULL,
      IsActive BIT NOT NULL,IsSystem BIT NOT NULL);
    CREATE TABLE uqp.Permission(Id BIGINT NOT NULL PRIMARY KEY,Code NVARCHAR(100) NOT NULL);
    CREATE TABLE uqp.UserRole(UserId BIGINT NOT NULL,RoleId BIGINT NOT NULL,
      CONSTRAINT PK_CiSyntheticUserRole PRIMARY KEY(UserId,RoleId));
    CREATE TABLE uqp.RolePermission(RoleId BIGINT NOT NULL,PermissionId BIGINT NOT NULL,
      CONSTRAINT PK_CiSyntheticRolePermission PRIMARY KEY(RoleId,PermissionId));
    INSERT INTO uqp.Role(Id,Code,IsActive,IsSystem)
      VALUES(1,N'CLASSIFICATION_APPROVER',1,0);
    INSERT INTO uqp.Permission(Id,Code)
      VALUES(1,N'CONFIRM_DATASET_CLASSIFICATION');
    INSERT INTO uqp.UserRole(UserId,RoleId) VALUES(301,1),(302,1);
  `);
  // Even an active OWNER Scope cannot confirm without the explicit capability.
  await rejected(pool,actor(ownerId));
  await pool.request().query("INSERT INTO uqp.RolePermission(RoleId,PermissionId) VALUES(1,1)");
  await rejected(pool,actor(ownerId,[]));
  await rejected(pool,actor(ownerId,["DESIGN_QUERY","EXECUTE_QUERY"]));
  const own=await check(pool,actor(ownerId));
  assert.equal(own.actorId,ownerId);
  assert.equal(own.ownerId,ownerId);
  assert.equal(own.scopeKind,"OWNER");
  assert.equal(own.ownerScopeEpochHex,own.actorScopeEpochHex);
  assert.match(own.ownerScopeEpochHex,/^[0-9a-f]{16}$/u);
  assert.equal(own.dataSourceId,sourceId);
  console.log("UQP923_F2_OWNER_SCOPE_GATE: EXPLICIT_SCOPE_AND_PERMISSION_REQUIRED");

  // Granting a system-wide classification role to an unrelated user is
  // insufficient; require their own Scope of the same Dataset.
  await rejected(pool,actor(reviewerId));
  await pool.request().query("INSERT INTO uqp.Dataset(Id,IsActive,IsArchived) VALUES(102,1,0)");
  await rejected(pool,actor(ownerId),102);
  await pool.request()
    .input("id",sql.UniqueIdentifier,randomUUID())
    .query(`INSERT INTO uqp.DatasetSecurityScope
      (DatasetId,UserId,ScopeKind,BoundDataSourceId,State,
       ParentOwnerUserId,ParentOwnerKind,ChangedByUserId,
       LastRequestId,LastReasonCode,GrantedAt,ChangedAt)
      VALUES(101,302,N'REVIEWER',201,N'ACTIVE',301,N'OWNER',301,
       @id,N'REVIEWER_APPOINTED',SYSUTCDATETIME(),SYSUTCDATETIME())`);
  const reviewer=await check(pool,actor(reviewerId));
  assert.equal(reviewer.scopeKind,"REVIEWER");
  assert.equal(reviewer.ownerId,ownerId);
  assert.notEqual(reviewer.actorScopeEpochHex,reviewer.ownerScopeEpochHex);
  await rejected(pool,actor(reviewerId,["CONFIRM_DATASET_CLASSIFICATION"],2));
  console.log("UQP923_F2_REVIEWER: CANNOT_CONFIRM_UNSCOPED_DATASET_OR_STALE_TOKEN");

  // Revoked parent owner immediately invalidates delegated Reviewer.
  await pool.request().input("newId",sql.UniqueIdentifier,randomUUID())
    .query(`UPDATE uqp.DatasetSecurityScope
      SET State=N'REVOKED',LastRequestId=@newId,
      LastReasonCode=N'SCOPE_REVOKED',ChangedAt=SYSUTCDATETIME()
      WHERE DatasetId=101 AND UserId=301 AND ScopeKind=N'OWNER'`);
  await rejected(pool,actor(ownerId));
  await rejected(pool,actor(reviewerId));
  console.log("UQP923_F2_PARENT_REVOKE: OWNER_AND_REVIEWER_CLOSED");

  // Source rebound cannot silently carry prior Scope.
  await pool.request().input("newId",sql.UniqueIdentifier,randomUUID())
    .query(`UPDATE uqp.DatasetSecurityScope
      SET State=N'ACTIVE',LastRequestId=@newId,
      LastReasonCode=N'SCOPE_REBOUND',ChangedAt=SYSUTCDATETIME()
      WHERE DatasetId=101 AND UserId=301 AND ScopeKind=N'OWNER'`);
  await pool.request().query("INSERT INTO uqp.DataSource(Id,IsActive) VALUES(202,1)");
  await pool.request().query("UPDATE uqp.Dataset SET DataSourceId=202 WHERE Id=101");
  await rejected(pool,actor(ownerId));
  await rejected(pool,actor(reviewerId));
  console.log("UQP923_F2_SOURCE_REBIND: NO_IMPLICIT_SCOPE_TRANSFER");
  console.log("F2_PRODUCTION_SCOPE_ASSIGNMENT=NOT_RUN; F3_SOURCE_FENCE=NOT_RUN; DATA_PREVIEW=false");
}
