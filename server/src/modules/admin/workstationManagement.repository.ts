import sql from "mssql";
import { legacyWorkstationWriterFenceSql } from "../auth/workstationLegacyWriterFence.js";
import { getPlatformDbPool } from "../../config/database.js";
import { listSharedWorkstations } from "./sharedWorkstation.repository.js";
import {
  canDeleteUnusedWorkstation,
  type Grants,
} from "./workstationManagement.js";
export type ManagementDeps = {
  getPool: typeof getPlatformDbPool;
  transaction: (pool: sql.ConnectionPool) => sql.Transaction;
  request: (tx: sql.Transaction) => sql.Request;
  legacyList: typeof listSharedWorkstations;
};
const readinessSql = `SELECT CASE WHEN COL_LENGTH('uqp.SharedWorkstation','RetiredAtUtc') IS NOT NULL
 AND COL_LENGTH('uqp.SharedWorkstation','PurposeCode') IS NOT NULL
 AND COL_LENGTH('uqp.SharedWorkstation','SortOrder') IS NOT NULL
 AND COL_LENGTH('uqp.SharedWorkstation','LastUsedAtUtc') IS NOT NULL
 AND OBJECT_ID('uqp.WorkstationAudience','U') IS NOT NULL
 AND OBJECT_ID('uqp.WorkstationAudienceMember','U') IS NOT NULL
 AND OBJECT_ID('uqp.SharedWorkstationAudience','U') IS NOT NULL
 AND COL_LENGTH('uqp.DashboardDisplayDevice','SharedWorkstationId') IS NOT NULL THEN 1 ELSE 0 END AS Ready`;
export function createWorkstationManagementRepository(deps: ManagementDeps) {
  async function pool() {
    const p = await deps.getPool();
    if (!p) throw new Error("PLATFORM_DB_NOT_CONFIGURED");
    return p;
  }
  async function requireSchema(p: sql.ConnectionPool) {
    if (!Number((await p.request().query(readinessSql)).recordset[0]?.Ready))
      throw new Error("WORKSTATION_SCHEMA_REQUIRED");
  }
  async function audit(
    tx: sql.Transaction,
    actor: number,
    event: string,
    details: Record<string, unknown>,
  ) {
    await deps
      .request(tx)
      .input("actor", sql.BigInt, actor)
      .input("event", sql.NVarChar(50), event)
      .input("details", sql.NVarChar(sql.MAX), JSON.stringify(details)).query(`
        INSERT INTO uqp.AuditLog (EventType,EventCategory,IsImportant,UserId,Status,ParametersJson,CompletedAtUtc)
        VALUES (@event,'SECURITY',1,@actor,'SUCCESS',@details,SYSUTCDATETIME())`);
  }
  async function transaction<T>(
    run: (tx: sql.Transaction) => Promise<T>,
  ): Promise<T> {
    const p = await pool();
    await requireSchema(p);
    const tx = deps.transaction(p);
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    try {
      await deps.request(tx).query(legacyWorkstationWriterFenceSql);
      // Single config lock establishes one lock order for copy, membership, lifecycle and binding.
      await deps.request(tx).query(`DECLARE @lock INT;
        EXEC @lock=sys.sp_getapplock @Resource='uqp.workstation.config', @LockMode='Exclusive', @LockOwner='Transaction', @LockTimeout=5000;
        IF @lock<0 THROW 50001, 'WORKSTATION_CONFIG_BUSY', 1;`);
      const result = await run(tx);
      await tx.commit();
      return result;
    } catch (error) {
      await tx.rollback().catch(() => undefined);
      throw error;
    }
  }
  async function workstation(
    tx: sql.Transaction,
    id: number,
    version?: number,
  ) {
    const result = await deps
      .request(tx)
      .input("id", sql.BigInt, id)
      .query(
        "SELECT * FROM uqp.SharedWorkstation WITH (UPDLOCK,HOLDLOCK) WHERE Id=@id",
      );
    const row = result.recordset[0];
    if (!row) throw new Error("WORKSTATION_NOT_FOUND");
    if (row.RetiredAtUtc) throw new Error("WORKSTATION_RETIRED");
    if (version !== undefined && Number(row.CredentialVersion) !== version)
      throw new Error("WORKSTATION_VERSION_STALE");
    return row;
  }
  async function invalidate(
    tx: sql.Transaction,
    id: number,
    disableDevices = true,
  ) {
    await deps.request(tx).input("id", sql.BigInt, id).query(`
      UPDATE uqp.SharedWorkstation SET CredentialVersion=CredentialVersion+1,PinLoginEnabled=0,UpdatedAtUtc=SYSUTCDATETIME() WHERE Id=@id;
      UPDATE uqp.SharedWorkstationCredential SET IsRevoked=1,RevokedAtUtc=SYSUTCDATETIME() WHERE WorkstationId=@id AND IsRevoked=0;
      UPDATE uqp.SharedWorkstationSession SET RevokedAtUtc=SYSUTCDATETIME() WHERE WorkstationId=@id AND RevokedAtUtc IS NULL;
      ${
        disableDevices
          ? `UPDATE uqp.DashboardDisplayDevice SET IsActive=0,RevokedAtUtc=SYSUTCDATETIME(),
        TokenHash=CONVERT(VARCHAR(64),HASHBYTES('SHA2_256',CONVERT(VARBINARY(16),NEWID())),2)
        WHERE SharedWorkstationId=@id;`
          : ""
      }`);
  }
  async function list() {
    const p = await pool();
    const ready =
      Number((await p.request().query(readinessSql)).recordset[0]?.Ready) === 1;
    if (!ready)
      return {
        schemaReady: false,
        workstations: ((await deps.legacyList()) ?? []).map((w) => ({
          ...w,
          id: Number(w.id),
          purposeCode: "SHARED_QUERY",
          sortOrder: 0,
          retiredAtUtc: null,
        })),
      };
    const rows = (
      await p.request()
        .query(`SELECT Id AS id,WorkstationCode AS workstationCode,DisplayName AS displayName,
      PlatformCode AS platformCode,PurposeCode AS purposeCode,SortOrder AS sortOrder,IsActive AS isActive,
      PinLoginEnabled AS pinLoginEnabled,CredentialVersion AS credentialVersion,RetiredAtUtc AS retiredAtUtc
      FROM uqp.SharedWorkstation ORDER BY SortOrder,DisplayName,Id`)
    ).recordset;
    return {
      schemaReady: true,
      workstations: rows.map((w) => ({
        ...w,
        id: Number(w.id),
        credentialVersion: Number(w.credentialVersion),
        sortOrder: Number(w.sortOrder),
      })),
    };
  }
  async function create(
    input: {
      workstationCode: string;
      displayName: string;
      platformCode: string;
      purposeCode: string;
      sortOrder: number;
    },
    actor: number,
  ) {
    return transaction(async (tx) => {
      const result = await deps
        .request(tx)
        .input("code", sql.NVarChar(100), input.workstationCode)
        .input("name", sql.NVarChar(200), input.displayName)
        .input("platform", sql.NVarChar(20), input.platformCode)
        .input("purpose", sql.NVarChar(30), input.purposeCode)
        .input("sort", sql.Int, input.sortOrder)
        .query(`INSERT INTO uqp.SharedWorkstation (WorkstationCode,DisplayName,PlatformCode,PurposeCode,SortOrder,IsActive,PinLoginEnabled)
          OUTPUT INSERTED.Id VALUES (@code,@name,@platform,@purpose,@sort,0,0)`);
      const id = Number(result.recordset[0].Id);
      await audit(tx, actor, "SHARED_WORKSTATION_CREATED", {
        workstationId: id,
      });
      return { id };
    });
  }
  async function metadata(
    id: number,
    input: {
      displayName: string;
      purposeCode: string;
      sortOrder: number;
      isActive: boolean;
      expectedVersion: number;
    },
    actor: number,
  ) {
    return transaction(async (tx) => {
      const old = await workstation(tx, id, input.expectedVersion);
      if (old.PurposeCode !== input.purposeCode) {
        const binding = await deps
          .request(tx)
          .input("id", sql.BigInt, id)
          .query(
            "SELECT Id FROM uqp.DashboardDisplayDevice WHERE SharedWorkstationId=@id",
          );
        if (binding.recordset.length)
          throw new Error("WORKSTATION_PURPOSE_BOUND");
      }
      await deps
        .request(tx)
        .input("id", sql.BigInt, id)
        .input("name", sql.NVarChar(200), input.displayName)
        .input("purpose", sql.NVarChar(30), input.purposeCode)
        .input("sort", sql.Int, input.sortOrder)
        .input("active", sql.Bit, input.isActive)
        .query(
          "UPDATE uqp.SharedWorkstation SET DisplayName=@name,PurposeCode=@purpose,SortOrder=@sort,IsActive=@active WHERE Id=@id",
        );
      await invalidate(tx, id, !input.isActive);
      await audit(tx, actor, "SHARED_WORKSTATION_UPDATED", {
        workstationId: id,
        isActive: input.isActive,
        purposeCode: input.purposeCode,
      });
    });
  }
  async function retire(id: number, version: number, actor: number) {
    return transaction(async (tx) => {
      await workstation(tx, id, version);
      await deps
        .request(tx)
        .input("id", sql.BigInt, id)
        .query(
          "UPDATE uqp.SharedWorkstation SET IsActive=0,PinLoginEnabled=0,RetiredAtUtc=SYSUTCDATETIME() WHERE Id=@id",
        );
      await invalidate(tx, id, true);
      await audit(tx, actor, "SHARED_WORKSTATION_RETIRED", {
        workstationId: id,
      });
    });
  }
  async function removeUnused(id: number, version: number, actor: number) {
    return transaction(async (tx) => {
      const row = await workstation(tx, id, version);
      const impact = (
        await deps.request(tx).input("id", sql.BigInt, id).query(`SELECT
        (SELECT COUNT_BIG(*) FROM uqp.SharedWorkstationCredential WHERE WorkstationId=@id) AS Credentials,
        (SELECT COUNT_BIG(*) FROM uqp.SharedWorkstationSession WHERE WorkstationId=@id) AS Sessions,
        (SELECT COUNT_BIG(*) FROM uqp.PatientListDisclosure WHERE WorkstationId=@id) AS Disclosures,
        (SELECT COUNT_BIG(*) FROM uqp.DashboardDisplayDevice WHERE SharedWorkstationId=@id) AS Devices`)
      ).recordset[0];
      if (
        !canDeleteUnusedWorkstation({
          isActive: Boolean(row.IsActive),
          retired: Boolean(row.RetiredAtUtc),
          lastUsed: row.LastUsedAtUtc,
          credentials: Number(impact.Credentials),
          sessions: Number(impact.Sessions),
          disclosures: Number(impact.Disclosures),
          devices: Number(impact.Devices),
        })
      )
        throw new Error("WORKSTATION_DELETE_UNSAFE");
      await audit(tx, actor, "SHARED_WORKSTATION_DELETED", {
        workstationId: id,
        workstationCode: row.WorkstationCode,
      });
      await deps.request(tx).input("id", sql.BigInt, id)
        .query(`DELETE FROM uqp.SharedWorkstationAudience WHERE WorkstationId=@id;
        DELETE FROM uqp.SharedWorkstationUser WHERE WorkstationId=@id; DELETE FROM uqp.SharedWorkstation WHERE Id=@id;`);
    });
  }
  async function readGrants(request: sql.Request, id: number) {
    const result = await request.input("id", sql.BigInt, id).query(`
      SELECT UserId FROM uqp.SharedWorkstationUser WHERE WorkstationId=@id AND IsAllowed=1;
      SELECT a.Id,a.Kind FROM uqp.SharedWorkstationAudience wa JOIN uqp.WorkstationAudience a ON a.Id=wa.AudienceId WHERE wa.WorkstationId=@id;`);
    const sets = result.recordsets as sql.IRecordSet<any>[];
    return {
      userIds: sets[0]!.map((row) => Number(row.UserId)),
      departmentIds: sets[1]!
        .filter((a) => a.Kind === "DEPARTMENT")
        .map((a) => Number(a.Id)),
      groupIds: sets[1]!
        .filter((a) => a.Kind === "GROUP")
        .map((a) => Number(a.Id)),
    };
  }
  async function grants(id: number) {
    const p = await pool();
    await requireSchema(p);
    const row = (
      await p
        .request()
        .input("id", sql.BigInt, id)
        .query(
          "SELECT * FROM uqp.SharedWorkstation WHERE Id=@id",
        )
    ).recordset[0];
    if (!row) throw new Error("WORKSTATION_NOT_FOUND");
    return {
      ...(await readGrants(p.request(), id)),
      expectedVersion: Number(row.CredentialVersion),
      workstation: { id:Number(row.Id),workstationCode:String(row.WorkstationCode),displayName:String(row.DisplayName),
        platformCode:String(row.PlatformCode),purposeCode:row.PurposeCode,sortOrder:Number(row.SortOrder),
        isActive:Boolean(row.IsActive),retiredAtUtc:row.RetiredAtUtc??null,credentialVersion:Number(row.CredentialVersion) },
    };
  }
  async function saveGrants(
    id: number,
    input: Grants & { expectedVersion: number },
    actor: number,
    sourceId?: number,
  ) {
    return transaction(async (tx) => {
      await workstation(tx, id, input.expectedVersion);
      let selected: Grants = input;
      if (sourceId !== undefined) {
        await workstation(tx, sourceId);
        selected = await readGrants(deps.request(tx), sourceId);
      }
      const valid = await deps
        .request(tx)
        .input("users", sql.NVarChar(sql.MAX), JSON.stringify(selected.userIds))
        .input(
          "departments",
          sql.NVarChar(sql.MAX),
          JSON.stringify(selected.departmentIds),
        )
        .input(
          "groups",
          sql.NVarChar(sql.MAX),
          JSON.stringify(selected.groupIds),
        ).query(`
        SELECT Id FROM uqp.AppUser WHERE Id IN (SELECT CONVERT(BIGINT,value) FROM OPENJSON(@users));
        SELECT Id FROM uqp.WorkstationAudience WHERE
         ((Kind='DEPARTMENT' AND Id IN (SELECT CONVERT(BIGINT,value) FROM OPENJSON(@departments))) OR
          (Kind='GROUP' AND Id IN (SELECT CONVERT(BIGINT,value) FROM OPENJSON(@groups))));`);
      const sets = valid.recordsets as sql.IRecordSet<any>[];
      if (
        sets[0]!.length !== selected.userIds.length ||
        sets[1]!.length !==
          selected.departmentIds.length + selected.groupIds.length
      )
        throw new Error("WORKSTATION_GRANT_INVALID");
      await deps
        .request(tx)
        .input("id", sql.BigInt, id)
        .input("users", sql.NVarChar(sql.MAX), JSON.stringify(selected.userIds))
        .input(
          "audiences",
          sql.NVarChar(sql.MAX),
          JSON.stringify([...selected.departmentIds, ...selected.groupIds]),
        ).query(`
        DELETE FROM uqp.SharedWorkstationUser WHERE WorkstationId=@id;
        INSERT INTO uqp.SharedWorkstationUser (WorkstationId,UserId,IsAllowed) SELECT @id,CONVERT(BIGINT,value),1 FROM OPENJSON(@users);
        DELETE FROM uqp.SharedWorkstationAudience WHERE WorkstationId=@id;
        INSERT INTO uqp.SharedWorkstationAudience (WorkstationId,AudienceId) SELECT @id,CONVERT(BIGINT,value) FROM OPENJSON(@audiences);`);
      await invalidate(tx, id);
      await audit(tx, actor, "SHARED_WORKSTATION_GRANTS_UPDATED", {
        workstationId: id,
        sourceId: sourceId ?? null,
        ...selected,
      });
    });
  }
  const effectiveSql = `WITH Allowed AS (
    SELECT UserId FROM uqp.SharedWorkstationUser WHERE WorkstationId=@id AND IsAllowed=1
    UNION SELECT am.UserId FROM uqp.SharedWorkstationAudience wa
      JOIN uqp.WorkstationAudience a ON a.Id=wa.AudienceId AND a.IsActive=1
      JOIN uqp.WorkstationAudienceMember am ON am.AudienceId=a.Id WHERE wa.WorkstationId=@id
  )`;
  async function effective(
    id: number,
    search: string,
    page: number,
    pageSize: number,
  ) {
    const p = await pool();
    await requireSchema(p);
    const w = (
      await p
        .request()
        .input("id", sql.BigInt, id)
        .query(
          "SELECT IsActive,RetiredAtUtc,PurposeCode FROM uqp.SharedWorkstation WHERE Id=@id",
        )
    ).recordset[0];
    if (!w) throw new Error("WORKSTATION_NOT_FOUND");
    const req = p
      .request()
      .input("id", sql.BigInt, id)
      .input("search", sql.NVarChar(200), `%${search}%`)
      .input("offset", sql.Int, (page - 1) * pageSize)
      .input("size", sql.Int, pageSize);
    const result =
      await req.query(`${effectiveSql} SELECT u.Id AS userId,u.Username AS username,u.DisplayName AS displayName,
      COUNT(*) OVER() AS total FROM Allowed a JOIN uqp.AppUser u ON u.Id=a.UserId AND u.IsActive=1
      WHERE u.Username LIKE @search OR u.DisplayName LIKE @search ORDER BY u.DisplayName,u.Id OFFSET @offset ROWS FETCH NEXT @size ROWS ONLY;
      ${effectiveSql}, PageUsers AS (
        SELECT u.Id AS UserId FROM Allowed a JOIN uqp.AppUser u ON u.Id=a.UserId AND u.IsActive=1
        WHERE u.Username LIKE @search OR u.DisplayName LIKE @search
        ORDER BY u.DisplayName,u.Id OFFSET @offset ROWS FETCH NEXT @size ROWS ONLY
      ) SELECT DISTINCT ur.UserId,p.Code FROM PageUsers a JOIN uqp.UserRole ur ON ur.UserId=a.UserId
      JOIN uqp.Role r ON r.Id=ur.RoleId AND r.IsActive=1 JOIN uqp.RolePermission rp ON rp.RoleId=r.Id JOIN uqp.Permission p ON p.Id=rp.PermissionId;`);
    const sets = result.recordsets as sql.IRecordSet<any>[];
    const enabled = Boolean(w.IsActive) && !w.RetiredAtUtc;
    return {
      users: sets[0]!.map((u) => ({
        userId: Number(u.userId),
        username: String(u.username),
        displayName: String(u.displayName),
        permissions: sets[1]!
          .filter((p) => Number(p.UserId) === Number(u.userId))
          .map((p) => String(p.Code)),
        workstationEnabled: enabled,
      })),
      total: Number(sets[0]![0]?.total ?? 0),
      pinLoginEnabled: false,
    };
  }
  async function audiences(search: string, page: number, pageSize: number) {
    const p = await pool();
    await requireSchema(p);
    const rows = (
      await p
        .request()
        .input("search", sql.NVarChar(200), `%${search}%`)
        .input("offset", sql.Int, (page - 1) * pageSize)
        .input("size", sql.Int, pageSize)
        .query(
          "SELECT *,COUNT(*) OVER() AS Total FROM uqp.WorkstationAudience WHERE DisplayName LIKE @search OR Code LIKE @search ORDER BY Kind,DisplayName,Id OFFSET @offset ROWS FETCH NEXT @size ROWS ONLY",
        )
    ).recordset;
    return {
      audiences: rows.map((a) => ({
        id: Number(a.Id),
        kind: String(a.Kind),
        code: String(a.Code),
        displayName: String(a.DisplayName),
        isActive: Boolean(a.IsActive),
        revision: Number(a.Revision),
      })),
      total: Number(rows[0]?.Total ?? 0),
    };
  }
  async function audienceMembers(id: number) {
    const p = await pool();
    await requireSchema(p);
    const a = (
      await p
        .request()
        .input("id", sql.BigInt, id)
        .query("SELECT Revision FROM uqp.WorkstationAudience WHERE Id=@id")
    ).recordset[0];
    if (!a) throw new Error("AUDIENCE_NOT_FOUND");
    return {
      userIds: (
        await p
          .request()
          .input("id", sql.BigInt, id)
          .query(
            "SELECT UserId FROM uqp.WorkstationAudienceMember WHERE AudienceId=@id",
          )
      ).recordset.map((u) => Number(u.UserId)),
      expectedRevision: Number(a.Revision),
    };
  }
  async function saveAudience(
    input: {
      kind: string;
      code: string;
      displayName: string;
      isActive: boolean;
      userIds: number[];
      expectedRevision?: number;
    },
    actor: number,
    id?: number,
  ) {
    return transaction(async (tx) => {
      if (id !== undefined) {
        const old = (
          await deps
            .request(tx)
            .input("id", sql.BigInt, id)
            .query(
              "SELECT Kind,Revision FROM uqp.WorkstationAudience WITH (UPDLOCK,HOLDLOCK) WHERE Id=@id",
            )
        ).recordset[0];
        if (!old) throw new Error("AUDIENCE_NOT_FOUND");
        if (
          Number(old.Revision) !== input.expectedRevision ||
          old.Kind !== input.kind
        )
          throw new Error("AUDIENCE_VERSION_STALE");
      }
      const valid = await deps
        .request(tx)
        .input("users", sql.NVarChar(sql.MAX), JSON.stringify(input.userIds))
        .query(
          "SELECT Id FROM uqp.AppUser WHERE Id IN (SELECT CONVERT(BIGINT,value) FROM OPENJSON(@users))",
        );
      if (valid.recordset.length !== input.userIds.length)
        throw new Error("WORKSTATION_GRANT_INVALID");
      const request = deps
        .request(tx)
        .input("kind", sql.NVarChar(20), input.kind)
        .input("code", sql.NVarChar(100), input.code)
        .input("name", sql.NVarChar(200), input.displayName)
        .input("active", sql.Bit, input.isActive);
      if (id === undefined)
        id = Number(
          (
            await request.query(
              "INSERT INTO uqp.WorkstationAudience (Kind,Code,DisplayName,IsActive) OUTPUT INSERTED.Id VALUES (@kind,@code,@name,@active)",
            )
          ).recordset[0].Id,
        );
      else
        await request
          .input("id", sql.BigInt, id)
          .query(
            "UPDATE uqp.WorkstationAudience SET DisplayName=@name,IsActive=@active,Revision=Revision+1 WHERE Id=@id",
          );
      await deps
        .request(tx)
        .input("id", sql.BigInt, id)
        .input("users", sql.NVarChar(sql.MAX), JSON.stringify(input.userIds))
        .query(`
        DELETE FROM uqp.WorkstationAudienceMember WHERE AudienceId=@id;
        INSERT INTO uqp.WorkstationAudienceMember (AudienceId,UserId) SELECT @id,CONVERT(BIGINT,value) FROM OPENJSON(@users);`);
      const affected = (
        await deps
          .request(tx)
          .input("id", sql.BigInt, id)
          .query(
            "SELECT WorkstationId FROM uqp.SharedWorkstationAudience WHERE AudienceId=@id ORDER BY WorkstationId",
          )
      ).recordset;
      for (const w of affected) await invalidate(tx, Number(w.WorkstationId));
      await audit(tx, actor, "WORKSTATION_AUDIENCE_UPDATED", {
        audienceId: id,
        kind: input.kind,
        memberCount: input.userIds.length,
        affectedWorkstations: affected.length,
      });
      return { id };
    });
  }
  async function devices() {
    const p = await pool();
    await requireSchema(p);
    const rows = (
      await p
        .request()
        .query(
          "SELECT Id,DeviceName,DashboardId,SharedWorkstationId,IsActive FROM uqp.DashboardDisplayDevice WHERE ArchivedAtUtc IS NULL ORDER BY Id",
        )
    ).recordset;
    return {
      devices: rows.map((d) => ({
        id: Number(d.Id),
        deviceName: String(d.DeviceName),
        dashboardId: Number(d.DashboardId),
        workstationId:
          d.SharedWorkstationId == null ? null : Number(d.SharedWorkstationId),
        isActive: Boolean(d.IsActive),
      })),
    };
  }
  async function bindDevice(
    id: number,
    deviceId: number,
    version: number,
    actor: number,
  ) {
    return transaction(async (tx) => {
      const w = await workstation(tx, id, version);
      if (w.PurposeCode !== "DASHBOARD")
        throw new Error("WORKSTATION_PURPOSE_INVALID");
      const device = (
        await deps
          .request(tx)
          .input("device", sql.BigInt, deviceId)
          .query(
            "SELECT SharedWorkstationId FROM uqp.DashboardDisplayDevice WITH (UPDLOCK,HOLDLOCK) WHERE Id=@device AND ArchivedAtUtc IS NULL",
          )
      ).recordset[0];
      if (
        !device ||
        (device.SharedWorkstationId != null &&
          Number(device.SharedWorkstationId) !== id)
      )
        throw new Error("WORKSTATION_DEVICE_UNAVAILABLE");
      // Binding always rotates the old token and requires deliberate reactivation/reissue in Dashboard management.
      await deps
        .request(tx)
        .input("id", sql.BigInt, id)
        .input("device", sql.BigInt, deviceId)
        .query(
          "UPDATE uqp.DashboardDisplayDevice SET SharedWorkstationId=@id WHERE Id=@device",
        );
      await invalidate(tx, id, true);
      await audit(tx, actor, "WORKSTATION_DEVICE_BOUND", {
        workstationId: id,
        deviceId,
      });
    });
  }
  return {
    list,
    create,
    metadata,
    retire,
    removeUnused,
    grants,
    saveGrants,
    effective,
    audiences,
    audienceMembers,
    saveAudience,
    devices,
    bindDevice,
  };
}
export const workstationManagement = createWorkstationManagementRepository({
  getPool: getPlatformDbPool,
  transaction: (p) => new sql.Transaction(p),
  request: (tx) => new sql.Request(tx),
  legacyList: listSharedWorkstations,
});
