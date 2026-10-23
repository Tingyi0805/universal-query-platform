/**
 * F1 CAS mechanics PROBE ONLY in the disposable SQL Server 2019 Actions DB.
 * Tests actual 923 Scope PK range locking, genuine rowversion CAS and rollback.
 * Not the production Writer: no Owner grant, authorization, ledger or Audit module.
 */
import assert from "node:assert/strict";
import sql from "mssql";

const datasetId = 101, sourceId = 201, ownerId = 301, rollbackUserId = 302;
const scopeSql = `
  SELECT ScopeRowVersion
  FROM uqp.DatasetSecurityScope WITH (UPDLOCK, HOLDLOCK, INDEX(PK_DatasetSecurityScope))
  WHERE DatasetId=@datasetId AND UserId=@userId AND ScopeKind=N'OWNER'`;

function scopeRequest(transaction: sql.Transaction, userId: number) {
  return new sql.Request(transaction)
    .input("datasetId", sql.BigInt, datasetId)
    .input("userId", sql.BigInt, userId);
}

async function failSafeRollback(tx: sql.Transaction, begun: boolean) {
  if (begun) await tx.rollback().catch(() => undefined);
}

export async function test923ScopeCasInDisposableSqlServer(
  poolA: sql.ConnectionPool,
  openPeer: () => Promise<sql.ConnectionPool>,
) {
  // The calling runner already verified the ephemeral host, SQL Server 2019
  // engine, synthetic DB name and exact 923 catalog before reaching this point.
  await poolA.request().batch(`
    INSERT INTO uqp.Dataset (Id) VALUES (${datasetId});
    INSERT INTO uqp.DataSource (Id) VALUES (${sourceId});
    INSERT INTO uqp.AppUser (Id) VALUES (${ownerId}),(${rollbackUserId});
  `);
  const poolB = await openPeer();
  try {
    const a = new sql.Transaction(poolA), b = new sql.Transaction(poolB);
    let aStarted = false, bStarted = false;
    try {
      await a.begin(sql.ISOLATION_LEVEL.SERIALIZABLE); aStarted = true;
      await b.begin(sql.ISOLATION_LEVEL.SERIALIZABLE); bStarted = true;
      const sidA = (await new sql.Request(a).query("SELECT @@SPID AS SessionId")).recordset[0]?.SessionId;
      const sidB = (await new sql.Request(b).query("SELECT @@SPID AS SessionId")).recordset[0]?.SessionId;
      assert.ok(Number.isSafeInteger(sidA) && Number.isSafeInteger(sidB) && sidA !== sidB,
        "CAS must use two independent SQL connections");

      const first = await scopeRequest(a, ownerId).query(scopeSql);
      assert.equal(first.recordset.length, 0, "First CAS must target missing scope row");
      let lockError: unknown = null;
      try {
        // Separate SQL connection tries the SAME empty PK predicate while the
        // first retains the SERIALIZABLE UPDLOCK/HOLDLOCK key-range lock.
        await scopeRequest(b, ownerId).query("SET LOCK_TIMEOUT 800; " + scopeSql);
      } catch (error) { lockError = error; }
      const sqlNumber = (lockError as { number?: number } | null)?.number;
      assert.equal(sqlNumber, 1222, "Second connection must be blocked by PK range lock");
      await b.rollback(); bStarted = false;

      const insert = await scopeRequest(a, ownerId).query(`
        INSERT INTO uqp.DatasetSecurityScope
          (DatasetId, UserId, ScopeKind, BoundDataSourceId, State,
           ParentOwnerUserId, ParentOwnerKind, ChangedByUserId,
           LastRequestId, LastReasonCode, GrantedAt, ChangedAt)
        OUTPUT CONVERT(varchar(16),inserted.ScopeRowVersion,2) AS NewVersion
        VALUES (@datasetId,@userId,N'OWNER',${sourceId},N'REVOKED',
          NULL,NULL,@userId,NEWID(),N'OWNER_APPOINTED',SYSUTCDATETIME(),SYSUTCDATETIME())`);
      assert.equal(insert.recordset.length, 1);
      const version = String(insert.recordset[0].NewVersion).toLowerCase();
      assert.match(version, /^[0-9a-f]{16}$/u);
      await a.commit(); aStarted = false;
      console.log("UQP923_CAS_EMPTY_PREDICATE_TWO_SPIDS: CONFLICT_1222, FIRST_WRITE_COMMITTED");

      const txNew = new sql.Transaction(poolA);
      let newStarted = false;
      try {
        await txNew.begin(sql.ISOLATION_LEVEL.SERIALIZABLE); newStarted = true;
        const fresh = await scopeRequest(txNew, ownerId).query(scopeSql);
        assert.equal(fresh.recordset.length, 1, "Second CAS must observe existing scope");
        await txNew.commit(); newStarted = false;
      } finally { await failSafeRollback(txNew, newStarted); }

      // Same previously observed version: exactly one CAS UPDATE can succeed.
      const updater = new sql.Transaction(poolA);
      let updateStarted = false;
      try {
        await updater.begin(sql.ISOLATION_LEVEL.SERIALIZABLE); updateStarted = true;
        const result = await scopeRequest(updater, ownerId)
          .input("expected", sql.Binary(8), Buffer.from(version, "hex"))
          .query(`
            UPDATE uqp.DatasetSecurityScope WITH (UPDLOCK, HOLDLOCK)
            SET State=N'ACTIVE', LastRequestId=NEWID(), ChangedAt=SYSUTCDATETIME()
            OUTPUT CONVERT(varchar(16),inserted.ScopeRowVersion,2) AS NewVersion
            WHERE DatasetId=@datasetId AND UserId=@userId AND ScopeKind=N'OWNER'
              AND ScopeRowVersion=@expected`);
        assert.equal(result.recordset.length, 1);
        assert.notEqual(String(result.recordset[0].NewVersion).toLowerCase(), version);
        await updater.commit(); updateStarted = false;
      } finally { await failSafeRollback(updater, updateStarted); }
      const rejected = await poolB.request()
        .input("datasetId", sql.BigInt, datasetId)
        .input("userId", sql.BigInt, ownerId)
        .input("expected", sql.Binary(8), Buffer.from(version, "hex"))
        .query(`
          UPDATE uqp.DatasetSecurityScope
          SET State=N'REVOKED', LastRequestId=NEWID()
          WHERE DatasetId=@datasetId AND UserId=@userId AND ScopeKind=N'OWNER'
            AND ScopeRowVersion=@expected`);
      assert.equal(rejected.rowsAffected[0], 0, "Stale ROWVERSION CAS must update zero rows");
      console.log("UQP923_CAS_ROWVERSION: ONE_UPDATE, STALE_UPDATE_ZERO");

      const rollback = new sql.Transaction(poolB);
      let rollbackStarted = false;
      try {
        await rollback.begin(sql.ISOLATION_LEVEL.SERIALIZABLE); rollbackStarted = true;
        const inserted = await scopeRequest(rollback, rollbackUserId).query(`
          INSERT INTO uqp.DatasetSecurityScope
            (DatasetId,UserId,ScopeKind,BoundDataSourceId,State,
             ParentOwnerUserId,ParentOwnerKind,ChangedByUserId,
             LastRequestId,LastReasonCode,GrantedAt,ChangedAt)
          VALUES (@datasetId,@userId,N'OWNER',${sourceId},N'REVOKED',
            NULL,NULL,${ownerId},NEWID(),N'OWNER_APPOINTED',
            SYSUTCDATETIME(),SYSUTCDATETIME())`);
        assert.equal(inserted.rowsAffected[0], 1);
        await rollback.rollback(); rollbackStarted = false;
      } finally { await failSafeRollback(rollback, rollbackStarted); }
      const remaining = await poolA.request()
        .input("userId", sql.BigInt, rollbackUserId)
        .query("SELECT COUNT_BIG(*) AS C FROM uqp.DatasetSecurityScope WHERE UserId=@userId");
      assert.equal(Number(remaining.recordset[0]?.C), 0, "Rollback must not persist scope");
      console.log("UQP923_CAS_ROLLBACK: NO_PERSISTED_SCOPE");
    } finally {
      await failSafeRollback(b, bStarted);
      await failSafeRollback(a, aStarted);
    }
  } finally {
    await poolB.close().catch(() => undefined);
  }
}
