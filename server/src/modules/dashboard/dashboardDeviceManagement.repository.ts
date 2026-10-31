import { requireDeviceLifecycleSchema } from "./dashboardDeviceLifecycleSchema.js";
import { renewDashboardDisplayDevice } from "./dashboardDevice.repository.js";
import sql from "mssql";
import { createHash } from "node:crypto";
import { getTokenSessionState } from "../auth/auth.repository.js";
import { requireSecuritySchema } from "../securityContract/securityContract.repository.js";
import { readDashboardApprovalEvidence } from "./dashboardApproval.repository.js";
import { queryModeSchemaReady } from "./dashboardQueryMode.repository.js";
import { createQuerySourceStore, defaultQuerySourceDependencies } from "./dashboardQuerySources.repository.js";
import { QuerySourceError } from "./dashboardQuerySources.service.js";
import { devicePlacementSchema, type DeviceMetadata } from "./dashboardDeviceManagement.schema.js";
import type { DeviceManagementStore, DeviceManagementTransaction } from "./dashboardDeviceManagement.service.js";

export async function deviceManagementSchemaReady(request: sql.Request) {
  const result = await request.query(`SELECT CASE WHEN
    COL_LENGTH('uqp.DashboardDisplayDevice','SharedWorkstationId')=8
    AND COL_LENGTH('uqp.DashboardDisplayDevice','TokenHash')=64
    AND COL_LENGTH('uqp.DashboardDisplayDevice','AllowedIp')=128
    AND COL_LENGTH('uqp.DashboardDisplayDevice','AllowedCidr')=128
    AND COL_LENGTH('uqp.DashboardDisplayDevice','EnforceIpRestriction')=1
    AND COL_LENGTH('uqp.DashboardDisplayDevice','ArchivedAtUtc') IS NOT NULL
    AND OBJECT_ID('uqp.DashboardDevicePlaybackSettings','U') IS NOT NULL
    AND COL_LENGTH('uqp.SharedWorkstation','PurposeCode') IS NOT NULL
    AND COL_LENGTH('uqp.SharedWorkstation','RetiredAtUtc') IS NOT NULL
    AND (SELECT COUNT(*) FROM sys.foreign_keys WHERE is_disabled=0 AND is_not_trusted=0 AND
      ((parent_object_id=OBJECT_ID('uqp.DashboardDisplayDevice') AND name IN
        ('FK_DashboardDisplayDevice_Dashboard','FK_DashboardDisplayDevice_CreatedByUser','FK_DisplayDevice_Workstation'))
      OR (parent_object_id=OBJECT_ID('uqp.DashboardDevicePlaybackSettings') AND name='FK_DashboardDevicePlaybackSettings_Device')))=4
    AND EXISTS (SELECT 1 FROM sys.key_constraints k
      JOIN sys.index_columns i ON i.object_id=k.parent_object_id AND i.index_id=k.unique_index_id
      JOIN sys.columns c ON c.object_id=i.object_id AND c.column_id=i.column_id
      JOIN sys.indexes x ON x.object_id=k.parent_object_id AND x.index_id=k.unique_index_id
      WHERE k.parent_object_id=OBJECT_ID('uqp.DashboardDevicePlaybackSettings') AND k.type='PK'
        AND c.name='DeviceId' AND i.key_ordinal=1 AND x.is_disabled=0
        AND (SELECT COUNT(*) FROM sys.index_columns z WHERE z.object_id=k.parent_object_id AND z.index_id=k.unique_index_id AND z.key_ordinal>0)=1)
    AND (SELECT COUNT(*) FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID('uqp.DashboardDevicePlaybackSettings')
      AND name IN ('CK_DashboardDevicePlaybackSettings_Browser','CK_DashboardDevicePlaybackSettings_Screen','CK_DashboardDevicePlaybackSettings_Size')
      AND is_disabled=0 AND is_not_trusted=0)=3
    THEN 1 ELSE 0 END AS DeviceManagementReady`);
  return Boolean(result.recordset[0]?.DeviceManagementReady);
}
export const defaultDeviceManagementDependencies = { ...defaultQuerySourceDependencies, session: getTokenSessionState,
  securitySchema: requireSecuritySchema, modeSchema: queryModeSchemaReady, deviceSchema: deviceManagementSchemaReady, lifecycleSchema: requireDeviceLifecycleSchema };
export function createDeviceManagementStore(deps = defaultDeviceManagementDependencies): DeviceManagementStore {
  const store = createQuerySourceStore({ ...deps, extend(transaction, base) {
    const request = () => deps.createRequest(transaction);
    const scoped = (id: number) => request().input("dashboardId", sql.BigInt, id);
    const metadata = (id: number, value: DeviceMetadata) => scoped(id).input("deviceName", sql.NVarChar(200), value.deviceName)
      .input("enforceIpRestriction", sql.Bit, value.enforceIpRestriction).input("allowedIp", sql.NVarChar(64), value.allowedIp)
      .input("allowedCidr", sql.NVarChar(64), value.allowedCidr).input("expiresAtUtc", sql.DateTime2(0), value.expiresAtUtc === null ? null : new Date(value.expiresAtUtc));
    return Object.assign(base, {
      async lifecycleReady() {
        try { await deps.lifecycleSchema(request()); }
        catch { throw new QuerySourceError("DASHBOARD_DEVICE_LIFECYCLE_SCHEMA_REQUIRED", 503); }
      },
      async lifecycleDevice(id, deviceId, action) {
        const result = await scoped(id).input("deviceId", sql.BigInt, deviceId).query(`
          DECLARE @eventTime DATETIME2(0)=SYSUTCDATETIME();
          DECLARE @changed TABLE (Id BIGINT);
          UPDATE uqp.DashboardDisplayDevice SET IsActive=${action === "SUSPEND" ? "0" : "1"},
            SuspendedAtUtc=${action === "SUSPEND" ? "@eventTime" : "NULL"},ReenrollmentRequired=1,
            TokenHash=CONVERT(CHAR(64),HASHBYTES('SHA2_256',CRYPT_GEN_RANDOM(32)),2),
            QueryModeGrantVersion=NULL,DelegatorTokenVersion=NULL
          OUTPUT INSERTED.Id INTO @changed
          WHERE DashboardId=@dashboardId AND Id=@deviceId AND RevokedAtUtc IS NULL AND ArchivedAtUtc IS NULL
            AND (ExpiresAtUtc IS NULL OR ExpiresAtUtc>SYSUTCDATETIME())
            AND ${action === "SUSPEND" ? "IsActive=1 AND SuspendedAtUtc IS NULL" : "IsActive=0 AND SuspendedAtUtc IS NOT NULL AND ReenrollmentRequired=1"};
          SELECT Id,@eventTime AS EventTime FROM @changed;`);
        if (result.recordset.length !== 1) throw new QuerySourceError("DASHBOARD_DEVICE_NOT_EDITABLE");
        return new Date(result.recordset[0].EventTime).toISOString();
      },
      async securityReady() {
        await deps.securitySchema(request());
        if (!await deps.modeSchema(request()) || !await deps.deviceSchema(request())) throw new QuerySourceError("DASHBOARD_DEVICE_SCHEMA_REQUIRED", 503);
      },
      async actor(actor, safety = false) {
        const session = await deps.session(actor.userId, transaction);
        if (!session?.isActive || session.tokenVersion !== actor.tokenVersion) throw new QuerySourceError("TOKEN_REVOKED", 401);
        if (!(safety ? ["DESIGN_QUERY"] : ["DESIGN_QUERY", "EXECUTE_QUERY"]).every(p => session.permissions.includes(p))) throw new QuerySourceError("FORBIDDEN", 403);
      },
      evidence: (id: number) => readDashboardApprovalEvidence(id, request),
      async records(id) {
        // Stable field order; deliberately excludes LastUsedAtUtc (playback activity is not a configuration edit).
        const rows = (await scoped(id).query(`SELECT *
          FROM uqp.DashboardDisplayDevice WITH (UPDLOCK,HOLDLOCK) WHERE DashboardId=@dashboardId ORDER BY Id`)).recordset;
        const placements = (await scoped(id).query(`SELECT p.* FROM uqp.DashboardDevicePlaybackSettings p WITH (UPDLOCK,HOLDLOCK)
          INNER JOIN uqp.DashboardDisplayDevice d ON d.Id=p.DeviceId WHERE d.DashboardId=@dashboardId ORDER BY p.DeviceId`)).recordset;
        const date = (v: unknown) => v == null ? null : new Date(String(v)).toISOString();
        return rows.map(row => {
          if (typeof row.TokenHash !== "string" || !/^[a-f0-9]{64}$/i.test(row.TokenHash)) throw new QuerySourceError("DASHBOARD_DEVICE_STATE_INVALID", 503);
          const saved = placements.find(p => Number(p.DeviceId) === Number(row.Id));
          const parsed = saved ? devicePlacementSchema.safeParse({ browser: saved.Browser, screenNumber: Number(saved.ScreenNumber),
            fullscreen: Boolean(saved.Fullscreen), windowX: Number(saved.WindowX), windowY: Number(saved.WindowY),
            windowWidth: Number(saved.WindowWidth), windowHeight: Number(saved.WindowHeight) }) : null;
          if (saved && (Number(saved.DashboardId) !== id || !parsed?.success)) throw new QuerySourceError("DASHBOARD_DEVICE_STATE_INVALID", 503);
          return { id: Number(row.Id), dashboardId: id, deviceName: String(row.DeviceName), createdByUserId: Number(row.CreatedByUserId),
            sharedWorkstationId: row.SharedWorkstationId == null ? null : Number(row.SharedWorkstationId), isActive: Boolean(row.IsActive),
            suspendedAtUtc: date(row.SuspendedAtUtc), reenrollmentRequired: row.ReenrollmentRequired == null ? null : row.ReenrollmentRequired,
            expiresAtUtc: date(row.ExpiresAtUtc), revokedAtUtc: date(row.RevokedAtUtc), archivedAtUtc: date(row.ArchivedAtUtc),
            enforceIpRestriction: Boolean(row.EnforceIpRestriction), allowedIp: row.AllowedIp == null ? null : String(row.AllowedIp),
            allowedCidr: row.AllowedCidr == null ? null : String(row.AllowedCidr),
            queryModeGrantVersion: row.QueryModeGrantVersion == null ? null : Number(row.QueryModeGrantVersion),
            delegatorTokenVersion: row.DelegatorTokenVersion == null ? null : Number(row.DelegatorTokenVersion),
            credentialFingerprint: createHash("sha256").update(row.TokenHash).digest("hex"), placement: parsed?.success ? parsed.data : null };
        });
      },
      async delegation(device, modeVersion) {
        const owner = await deps.session(device.createdByUserId, transaction);
        if (!owner?.isActive || !["DESIGN_QUERY", "EXECUTE_QUERY"].every(p => owner.permissions.includes(p))) throw new QuerySourceError("QUERY_DEVICE_DELEGATION_INVALID", 403);
        if(modeVersion!==undefined && (!Number.isSafeInteger(modeVersion) || device.queryModeGrantVersion!==modeVersion || device.delegatorTokenVersion!==owner.tokenVersion))throw new QuerySourceError("QUERY_DEVICE_DELEGATION_INVALID",403);
        if (device.sharedWorkstationId !== null) {
          const station = (await request().input("id", sql.BigInt, device.sharedWorkstationId)
            .query("SELECT IsActive,RetiredAtUtc,PurposeCode FROM uqp.SharedWorkstation WITH (HOLDLOCK) WHERE Id=@id")).recordset[0];
          if (!station?.IsActive || station.RetiredAtUtc || station.PurposeCode !== "DASHBOARD") throw new QuerySourceError("QUERY_DEVICE_WORKSTATION_INVALID");
        }
      },
      async createDevice(id, ownerId, value) {
        // TokenHash is NOT NULL/UNIQUE. Store a database-generated unusable tombstone;
        // no plaintext secret exists or leaves SQL; null grants cannot authorize Query-only playback.
        const result = await metadata(id, value).input("ownerId", sql.BigInt, ownerId).query(`INSERT INTO uqp.DashboardDisplayDevice
          (DashboardId,DeviceName,CreatedByUserId,SharedWorkstationId,IsActive,ExpiresAtUtc,EnforceIpRestriction,AllowedIp,AllowedCidr,
           TokenHash,QueryModeGrantVersion,DelegatorTokenVersion)
          OUTPUT INSERTED.Id VALUES (@dashboardId,@deviceName,@ownerId,NULL,1,@expiresAtUtc,@enforceIpRestriction,@allowedIp,@allowedCidr,
           CONVERT(CHAR(64),HASHBYTES('SHA2_256',CRYPT_GEN_RANDOM(32)),2),NULL,NULL)`);
        const deviceId = Number(result.recordset[0]?.Id);
        if (!Number.isSafeInteger(deviceId) || deviceId < 1) throw new QuerySourceError("DASHBOARD_DEVICE_STATE_INVALID", 503);
        return deviceId;
      },
      async updateMetadata(id, deviceId, value) {
        const result = await metadata(id, value).input("deviceId", sql.BigInt, deviceId).query(`UPDATE uqp.DashboardDisplayDevice SET
          DeviceName=@deviceName,EnforceIpRestriction=@enforceIpRestriction,AllowedIp=@allowedIp,AllowedCidr=@allowedCidr,ExpiresAtUtc=@expiresAtUtc,
          TokenHash=CONVERT(CHAR(64),HASHBYTES('SHA2_256',CRYPT_GEN_RANDOM(32)),2),QueryModeGrantVersion=NULL,DelegatorTokenVersion=NULL,LastUsedAtUtc=NULL
          WHERE DashboardId=@dashboardId AND Id=@deviceId AND IsActive=1 AND RevokedAtUtc IS NULL AND ArchivedAtUtc IS NULL
            AND (ExpiresAtUtc IS NULL OR ExpiresAtUtc>SYSUTCDATETIME())`);
        if (result.rowsAffected[0] !== 1) throw new QuerySourceError("DASHBOARD_DEVICE_VERSION_CONFLICT");
      },
      async updatePlacement(id, deviceId, value) {
        await scoped(id).input("deviceId", sql.BigInt, deviceId)
          .input("browser", sql.NVarChar(10), value.browser).input("screenNumber", sql.Int, value.screenNumber).input("fullscreen", sql.Bit, value.fullscreen)
          .input("windowX", sql.Int, value.windowX).input("windowY", sql.Int, value.windowY)
          .input("windowWidth", sql.Int, value.windowWidth).input("windowHeight", sql.Int, value.windowHeight).query(`
          IF NOT EXISTS (SELECT 1 FROM uqp.DashboardDisplayDevice WHERE DashboardId=@dashboardId AND Id=@deviceId
            AND IsActive=1 AND RevokedAtUtc IS NULL AND ArchivedAtUtc IS NULL AND (ExpiresAtUtc IS NULL OR ExpiresAtUtc>SYSUTCDATETIME()))
            THROW 51030,'DASHBOARD_DEVICE_VERSION_CONFLICT',1;
          UPDATE uqp.DashboardDevicePlaybackSettings SET Browser=@browser,ScreenNumber=@screenNumber,Fullscreen=@fullscreen,
            WindowX=@windowX,WindowY=@windowY,WindowWidth=@windowWidth,WindowHeight=@windowHeight,UpdatedAtUtc=SYSUTCDATETIME()
            WHERE DashboardId=@dashboardId AND DeviceId=@deviceId;
          IF @@ROWCOUNT=0 INSERT INTO uqp.DashboardDevicePlaybackSettings
            (DashboardId,DeviceId,Browser,ScreenNumber,Fullscreen,WindowX,WindowY,WindowWidth,WindowHeight)
            VALUES (@dashboardId,@deviceId,@browser,@screenNumber,@fullscreen,@windowX,@windowY,@windowWidth,@windowHeight);`);
      },
      async renewDevice(id,deviceId,days) {
        const device=await renewDashboardDisplayDevice(id,deviceId,days,request());
        if(!device.expiresAtUtc)throw new QuerySourceError("DASHBOARD_DEVICE_VERSION_CONFLICT");
        return device.expiresAtUtc;
      },
      async touch(id) {
        const result = await scoped(id).query("UPDATE uqp.Dashboard SET UpdatedAtUtc=SYSUTCDATETIME() WHERE Id=@dashboardId");
        if (result.rowsAffected[0] !== 1) throw new QuerySourceError("DASHBOARD_DEVICE_VERSION_CONFLICT");
      },
      async deviceAudit(id, actor, action, deviceId, invalidated, renewal) {
        const result = await deps.writeAuditEvent({ eventType: `DASHBOARD_DEVICE_${action}`, userId: actor.userId,
          ipAddress: actor.ipAddress, userAgent: actor.userAgent,
          parameters: { dashboardId: id, deviceId, credentialIssued: false, deviceCredentialsInvalidated: invalidated, ...(renewal ?? {}) } }, transaction);
        if (!Number.isSafeInteger(result) || result < 1) throw new QuerySourceError("DASHBOARD_DEVICE_AUDIT_REQUIRED", 503);
      },
    } satisfies Partial<DeviceManagementTransaction>);
  } });
  return { async transaction(work) {
    try { return await store.transaction(tx => work(tx as DeviceManagementTransaction)); }
    catch (error) {
      if ([1205, 1222, 51030].includes(Number((error as { number?: number })?.number))) throw new QuerySourceError("DASHBOARD_DEVICE_VERSION_CONFLICT");
      throw error;
    }
  } };
}
export const deviceManagementStore = createDeviceManagementStore();
