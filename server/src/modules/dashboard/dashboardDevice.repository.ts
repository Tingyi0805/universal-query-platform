import crypto from "node:crypto";
import { getTokenSessionState } from "../auth/auth.repository.js";
import sql from "mssql";
import { QuerySourceError } from "./dashboardQuerySources.service.js";
import { getPlatformDbPool } from "../../config/database.js";
import { matchesIpRestriction, normalizeClientIp } from "./dashboardDeviceIp.js";

async function requirePool() {
  const pool = await getPlatformDbPool();
  if (!pool) throw new Error("PLATFORM_DB_NOT_CONFIGURED");
  return pool;
}

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

function mapRow(row: any) {
  return {
    id: Number(row.Id),
    dashboardId: Number(row.DashboardId),
    deviceName: String(row.DeviceName),
    isActive: Boolean(row.IsActive),
    enforceIpRestriction: Boolean(row.EnforceIpRestriction),
    allowedIp: row.AllowedIp == null ? null : String(row.AllowedIp),
    allowedCidr: row.AllowedCidr == null ? null : String(row.AllowedCidr),
    expiresAtUtc: row.ExpiresAtUtc ? new Date(row.ExpiresAtUtc).toISOString() : null,
    lastUsedAtUtc: row.LastUsedAtUtc ? new Date(row.LastUsedAtUtc).toISOString() : null,
    createdByUserId: Number(row.CreatedByUserId),
    queryModeGrantVersion: row.QueryModeGrantVersion == null ? null : Number(row.QueryModeGrantVersion),
    delegatorTokenVersion: row.DelegatorTokenVersion == null ? null : Number(row.DelegatorTokenVersion),
    createdAtUtc: row.CreatedAtUtc ? new Date(row.CreatedAtUtc).toISOString() : null,
    revokedAtUtc: row.RevokedAtUtc ? new Date(row.RevokedAtUtc).toISOString() : null,
    archivedAtUtc: row.ArchivedAtUtc ? new Date(row.ArchivedAtUtc).toISOString() : null,
  };
}

export async function createDashboardDisplayDevice(input: {
  dashboardId: number;
  deviceName: string;
  createdByUserId: number;
  expiresDays?: number | null;
  enforceIpRestriction?: boolean;
  allowedIp?: string | null;
  allowedCidr?: string | null;
}) {
  const pool = await requirePool();
  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);
  const expiresAtUtc =
    input.expiresDays && input.expiresDays > 0
      ? new Date(Date.now() + input.expiresDays * 24 * 60 * 60 * 1000)
      : null;

  const result = await pool.request()
    .input("dashboardId", sql.BigInt, input.dashboardId)
    .input("deviceName", sql.NVarChar(200), input.deviceName)
    .input("tokenHash", sql.Char(64), tokenHash)
    .input("expiresAtUtc", sql.DateTime2, expiresAtUtc)
    .input("createdByUserId", sql.BigInt, input.createdByUserId)
    .input("enforceIpRestriction", sql.Bit, Boolean(input.enforceIpRestriction))
    .input("allowedIp", sql.NVarChar(64), input.allowedIp?.trim() || null)
    .input("allowedCidr", sql.NVarChar(64), input.allowedCidr?.trim() || null)
    .query(`
      INSERT INTO uqp.DashboardDisplayDevice (
        DashboardId, DeviceName, TokenHash, ExpiresAtUtc, CreatedByUserId,
        EnforceIpRestriction, AllowedIp, AllowedCidr
      )
      OUTPUT INSERTED.*
      VALUES (
        @dashboardId,@deviceName,@tokenHash,@expiresAtUtc,@createdByUserId,
        @enforceIpRestriction,@allowedIp,@allowedCidr
      )
    `);

  return { device: mapRow(result.recordset[0]), token };
}

export async function listDashboardDisplayDevices(dashboardId: number) {
  const pool = await requirePool();
  const result = await pool.request()
    .input("dashboardId", sql.BigInt, dashboardId)
    .query(`
      SELECT *
      FROM uqp.DashboardDisplayDevice
      WHERE DashboardId=@dashboardId
      ORDER BY CASE WHEN ArchivedAtUtc IS NULL THEN 0 ELSE 1 END, IsActive DESC, CreatedAtUtc DESC, Id DESC
    `);
  return result.recordset.map(mapRow);
}

export async function listExpiringDashboardDisplayDevices(days = 30) {
  const pool = await requirePool();
  const result = await pool.request()
    .input("days", sql.Int, days)
    .query(`
      SELECT ddd.*, d.Name AS DashboardName, d.Code AS DashboardCode
      FROM uqp.DashboardDisplayDevice ddd
      INNER JOIN uqp.Dashboard d ON d.Id=ddd.DashboardId
      WHERE ddd.IsActive=1 AND ddd.ArchivedAtUtc IS NULL
        AND ddd.ExpiresAtUtc IS NOT NULL
        AND ddd.ExpiresAtUtc <= DATEADD(DAY, @days, SYSUTCDATETIME())
      ORDER BY ddd.ExpiresAtUtc ASC, ddd.Id ASC
    `);

  const now = Date.now();
  return result.recordset.map((row: any) => {
    const mapped = mapRow(row);
    const expiresAtMs = mapped.expiresAtUtc ? new Date(mapped.expiresAtUtc).getTime() : NaN;
    const daysRemaining = Number.isFinite(expiresAtMs)
      ? Math.ceil((expiresAtMs - now) / 86_400_000)
      : null;

    return {
      ...mapped,
      dashboardName: String(row.DashboardName),
      dashboardCode: String(row.DashboardCode),
      daysRemaining,
    };
  });
}

export async function updateDashboardDisplayDeviceSettings(input: {
  dashboardId: number;
  deviceId: number;
  deviceName: string;
  enforceIpRestriction: boolean;
  allowedIp?: string | null;
  allowedCidr?: string | null;
}) {
  const pool = await requirePool();
  const result = await pool.request()
    .input("dashboardId", sql.BigInt, input.dashboardId)
    .input("deviceId", sql.BigInt, input.deviceId)
    .input("deviceName", sql.NVarChar(200), input.deviceName)
    .input("enforceIpRestriction", sql.Bit, input.enforceIpRestriction)
    .input("allowedIp", sql.NVarChar(64), input.enforceIpRestriction ? input.allowedIp?.trim() || null : null)
    .input("allowedCidr", sql.NVarChar(64), input.enforceIpRestriction ? input.allowedCidr?.trim() || null : null)
    .query(`
      UPDATE uqp.DashboardDisplayDevice
      SET DeviceName=@deviceName,
          EnforceIpRestriction=@enforceIpRestriction,
          AllowedIp=@allowedIp,
          AllowedCidr=@allowedCidr
      OUTPUT INSERTED.*
      WHERE Id=@deviceId
        AND DashboardId=@dashboardId
        AND IsActive=1
        AND ArchivedAtUtc IS NULL
    `);

  if (!result.recordset[0]) {
    throw new Error("DASHBOARD_DEVICE_NOT_FOUND");
  }

  return mapRow(result.recordset[0]);
}

export async function reissueDashboardDisplayDeviceToken(
  dashboardId: number,
  deviceId: number,
) {
  const pool = await requirePool();
  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);
  const tx = new sql.Transaction(pool);
  await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  try {
  const dashboard = (await new sql.Request(tx).input("id", sql.BigInt, dashboardId)
    .query("SELECT * FROM uqp.Dashboard WITH (UPDLOCK,HOLDLOCK) WHERE Id=@id")).recordset[0];
  if (!dashboard) throw new QuerySourceError("DASHBOARD_NOT_FOUND", 404);
  if (String(dashboard.QueryMode ?? "LEGACY") !== "LEGACY") throw new QuerySourceError("QUERY_MODE_DEVICE_CREDENTIAL_REQUIRED");
  const result = await new sql.Request(tx)
    .input("dashboardId", sql.BigInt, dashboardId)
    .input("deviceId", sql.BigInt, deviceId)
    .input("tokenHash", sql.Char(64), tokenHash)
    .query(`
      UPDATE uqp.DashboardDisplayDevice
      SET TokenHash=@tokenHash,
          LastUsedAtUtc=NULL
      OUTPUT INSERTED.*
      WHERE Id=@deviceId
        AND DashboardId=@dashboardId
        AND IsActive=1
    `);

  if (!result.recordset[0]) {
    throw new Error("DASHBOARD_DEVICE_NOT_FOUND");
  }
  await tx.commit();
  return {
    device: mapRow(result.recordset[0]),
    token,
  };
  } catch (error) { await tx.rollback().catch(() => undefined); throw error; }
}

export async function renewDashboardDisplayDevice(
  dashboardId: number,
  deviceId: number,
  extendDays = 365,
) {
  const pool = await requirePool();
  const result = await pool.request()
    .input("dashboardId", sql.BigInt, dashboardId)
    .input("deviceId", sql.BigInt, deviceId)
    .input("extendDays", sql.Int, extendDays)
    .query(`
      UPDATE uqp.DashboardDisplayDevice
      SET ExpiresAtUtc=DATEADD(
            DAY,
            @extendDays,
            CASE
              WHEN ExpiresAtUtc IS NOT NULL AND ExpiresAtUtc > SYSUTCDATETIME()
                THEN ExpiresAtUtc
              ELSE SYSUTCDATETIME()
            END
          )
      OUTPUT INSERTED.*
      WHERE Id=@deviceId
        AND DashboardId=@dashboardId
        AND IsActive=1
    `);

  if (!result.recordset[0]) {
    throw new Error("DASHBOARD_DEVICE_NOT_FOUND");
  }

  return mapRow(result.recordset[0]);
}

export async function revokeDashboardDisplayDevice(dashboardId: number, deviceId: number) {
  const pool = await requirePool();
  const result = await pool.request()
    .input("dashboardId", sql.BigInt, dashboardId)
    .input("deviceId", sql.BigInt, deviceId)
    .query(`
      UPDATE uqp.DashboardDisplayDevice
      SET IsActive=0,
          RevokedAtUtc=SYSUTCDATETIME()
      WHERE Id=@deviceId AND DashboardId=@dashboardId AND IsActive=1;
      SELECT @@ROWCOUNT AS Affected;
    `);

  if (Number(result.recordset[0]?.Affected ?? 0) === 0) {
    throw new Error("DASHBOARD_DEVICE_NOT_FOUND");
  }
}

export async function checkDashboardDisplayDevice(
  dashboardId: number,
  token: string,
  clientIp: string,
) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return { status: "INVALID_TOKEN" as const };
  const pool = await requirePool();
  const tokenHash = hashToken(token);
  const result = await pool.request()
    .input("dashboardId", sql.BigInt, dashboardId)
    .input("tokenHash", sql.Char(64), tokenHash)
    .query(`
      SELECT TOP (1) *
      FROM uqp.DashboardDisplayDevice
      WHERE DashboardId=@dashboardId
        AND TokenHash=@tokenHash

    `);

  const row = result.recordset[0];
  if (!row) return { status: "INVALID_TOKEN" as const };
  if (!Boolean(row.IsActive) || row.RevokedAtUtc != null || row.ArchivedAtUtc != null) return { status: "DISABLED" as const };
  if (row.ExpiresAtUtc != null && new Date(row.ExpiresAtUtc).getTime() <= Date.now()) return { status: "EXPIRED" as const };

  if (row.SharedWorkstationId != null) {
    const station = (await pool.request().input("workstationId", sql.BigInt, row.SharedWorkstationId)
      .query("SELECT * FROM uqp.SharedWorkstation WHERE Id=@workstationId")).recordset[0];
    if (!station || !station.IsActive || station.RetiredAtUtc || station.PurposeCode !== "DASHBOARD") return { status: "DISABLED" as const };
  }
  // Device playback is delegated by a designer; removing that authority revokes the delegation.
  const owner = await getTokenSessionState(Number(row.CreatedByUserId));
  if (!owner?.isActive || !owner.permissions.includes("DESIGN_QUERY")) return { status: "DISABLED" as const };
  if (row.DelegatorTokenVersion != null && Number(row.DelegatorTokenVersion) !== owner.tokenVersion) return { status: "DISABLED" as const };

  const normalizedClientIp = normalizeClientIp(clientIp);
  if (
    Boolean(row.EnforceIpRestriction) &&
    !matchesIpRestriction(
      normalizedClientIp,
      row.AllowedIp == null ? null : String(row.AllowedIp),
      row.AllowedCidr == null ? null : String(row.AllowedCidr),
    )
  ) {
    return { status: "IP_RESTRICTED" as const };
  }

  await pool.request()
    .input("id", sql.BigInt, row.Id)
    .query(`
      UPDATE uqp.DashboardDisplayDevice
      SET LastUsedAtUtc=SYSUTCDATETIME()
      WHERE Id=@id
    `);

  return { status: "VALID" as const, device: { ...mapRow(row), authorizationRevision: owner.tokenVersion } };
}

export async function validateDashboardDisplayDevice(dashboardId: number, token: string, clientIp: string) {
  const result = await checkDashboardDisplayDevice(dashboardId, token, clientIp);
  return result.status === "VALID" ? result.device : null;
}

export async function getDashboardDeviceArchivePolicy(dashboardId: number) {
  const pool = await requirePool();
  const result = await pool.request().input("dashboardId", sql.BigInt, dashboardId).query(`
    SELECT AutoArchiveEnabled, RetentionDays
    FROM uqp.DashboardDeviceArchivePolicy WHERE DashboardId=@dashboardId
  `);
  return {
    enabled: result.recordset[0] ? Boolean(result.recordset[0].AutoArchiveEnabled) : true,
    retentionDays: result.recordset[0] ? Number(result.recordset[0].RetentionDays) : 90,
  };
}

export async function setDashboardDeviceArchivePolicy(
  dashboardId: number, enabled: boolean, retentionDays: number, userId: number,
) {
  const pool = await requirePool();
  await pool.request()
    .input("dashboardId", sql.BigInt, dashboardId)
    .input("enabled", sql.Bit, enabled)
    .input("retentionDays", sql.Int, retentionDays)
    .input("userId", sql.BigInt, userId)
    .query(`
      UPDATE uqp.DashboardDeviceArchivePolicy
      SET AutoArchiveEnabled=@enabled, RetentionDays=@retentionDays,
          UpdatedByUserId=@userId, UpdatedAtUtc=SYSUTCDATETIME()
      WHERE DashboardId=@dashboardId;
      IF @@ROWCOUNT=0
        INSERT INTO uqp.DashboardDeviceArchivePolicy
          (DashboardId,AutoArchiveEnabled,RetentionDays,UpdatedByUserId)
        VALUES (@dashboardId,@enabled,@retentionDays,@userId);
    `);
  return { enabled, retentionDays };
}

export async function archiveDashboardDevices(dashboardId: number, deviceIds: number[], userId: number) {
  const pool = await requirePool();
  const request = pool.request()
    .input("dashboardId", sql.BigInt, dashboardId)
    .input("userId", sql.BigInt, userId);
  const ids = [...new Set(deviceIds)];
  ids.forEach((id, index) => request.input("device" + index, sql.BigInt, id));
  const result = await request.query(`
    UPDATE uqp.DashboardDisplayDevice
    SET ArchivedAtUtc=SYSUTCDATETIME()
    OUTPUT INSERTED.DashboardId, INSERTED.Id, 'MANUAL', @userId, INSERTED.ArchivedAtUtc
    INTO uqp.DashboardDeviceArchiveHistory
      (DashboardId, DeviceId, ArchiveMode, ArchivedByUserId, ArchivedAtUtc)
    WHERE DashboardId=@dashboardId AND Id IN (${ids.map((_, index) => "@device" + index).join(",")})
      AND IsActive=0 AND ArchivedAtUtc IS NULL;
    SELECT @@ROWCOUNT AS Archived;
  `);
  return Number(result.recordset[0]?.Archived ?? 0);
}

export async function autoArchiveDashboardDevices(): Promise<number> {
  const pool = await requirePool();
  const result = await pool.request().query(`
    ;WITH Candidates AS (
      SELECT TOP (200) ddd.Id, ddd.DashboardId, ddd.ArchivedAtUtc
      FROM uqp.DashboardDisplayDevice ddd
      LEFT JOIN uqp.DashboardDeviceArchivePolicy p ON p.DashboardId=ddd.DashboardId
      WHERE ddd.IsActive=0 AND ddd.ArchivedAtUtc IS NULL
        AND ddd.RevokedAtUtc IS NOT NULL
        AND COALESCE(p.AutoArchiveEnabled, CONVERT(BIT,1))=1
        AND ddd.RevokedAtUtc <= DATEADD(DAY, -COALESCE(p.RetentionDays,90), SYSUTCDATETIME())
    )
    UPDATE Candidates SET ArchivedAtUtc=SYSUTCDATETIME()
    OUTPUT INSERTED.DashboardId, INSERTED.Id, 'AUTO', NULL, INSERTED.ArchivedAtUtc
    INTO uqp.DashboardDeviceArchiveHistory
      (DashboardId, DeviceId, ArchiveMode, ArchivedByUserId, ArchivedAtUtc);
    SELECT @@ROWCOUNT AS Archived;
  `);
  return Number(result.recordset[0]?.Archived ?? 0);
}

export type DevicePlaybackSettings = {
  browser: "chrome" | "edge";
  screenNumber: number;
  fullscreen: boolean;
  windowX: number;
  windowY: number;
  windowWidth: number;
  windowHeight: number;
};

export async function getDevicePlaybackSettings(dashboardId: number, deviceId: number): Promise<DevicePlaybackSettings | null> {
  const pool = await requirePool();
  const result = await pool.request().input("dashboardId", sql.BigInt, dashboardId)
    .input("deviceId", sql.BigInt, deviceId).query(`
      SELECT d.Id, p.Browser, p.ScreenNumber, p.Fullscreen, p.WindowX, p.WindowY, p.WindowWidth, p.WindowHeight
      FROM uqp.DashboardDisplayDevice d
      LEFT JOIN uqp.DashboardDevicePlaybackSettings p ON p.DeviceId=d.Id AND p.DashboardId=d.DashboardId
      WHERE d.DashboardId=@dashboardId AND d.Id=@deviceId AND d.ArchivedAtUtc IS NULL
    `);
  const row = result.recordset[0];
  if (!row) return null;
  return { browser: row.Browser ?? "edge", screenNumber: Number(row.ScreenNumber ?? 2),
    fullscreen: row.Fullscreen == null ? true : Boolean(row.Fullscreen),
    windowX: Number(row.WindowX ?? 1920), windowY: Number(row.WindowY ?? 0),
    windowWidth: Number(row.WindowWidth ?? 1920), windowHeight: Number(row.WindowHeight ?? 1080) };
}

export async function saveDevicePlaybackSettings(dashboardId: number, deviceId: number, input: DevicePlaybackSettings) {
  const pool = await requirePool();
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const request = new sql.Request(tx)
      .input("dashboardId", sql.BigInt, dashboardId).input("deviceId", sql.BigInt, deviceId)
      .input("browser", sql.NVarChar(10), input.browser)
      .input("screenNumber", sql.Int, input.screenNumber)
      .input("fullscreen", sql.Bit, input.fullscreen)
      .input("windowX", sql.Int, input.windowX).input("windowY", sql.Int, input.windowY)
      .input("windowWidth", sql.Int, input.windowWidth).input("windowHeight", sql.Int, input.windowHeight);
    const result = await request.query(`
      UPDATE uqp.DashboardDevicePlaybackSettings SET Browser=@browser,ScreenNumber=@screenNumber,
        Fullscreen=@fullscreen,WindowX=@windowX,WindowY=@windowY,
        WindowWidth=@windowWidth,WindowHeight=@windowHeight,UpdatedAtUtc=SYSUTCDATETIME()
      WHERE DashboardId=@dashboardId AND DeviceId=@deviceId;
      IF @@ROWCOUNT=0
        INSERT INTO uqp.DashboardDevicePlaybackSettings
          (DashboardId,DeviceId,Browser,ScreenNumber,Fullscreen,WindowX,WindowY,WindowWidth,WindowHeight)
        SELECT @dashboardId,@deviceId,@browser,@screenNumber,@fullscreen,@windowX,@windowY,@windowWidth,@windowHeight
        WHERE EXISTS (SELECT 1 FROM uqp.DashboardDisplayDevice
          WHERE DashboardId=@dashboardId AND Id=@deviceId AND IsActive=1 AND ArchivedAtUtc IS NULL);
      SELECT @@ROWCOUNT AS Affected;
    `);
    if (Number(result.recordset[0]?.Affected ?? 0) === 0) throw new Error("DASHBOARD_DEVICE_NOT_FOUND");
    await tx.commit();
  } catch (error) { await tx.rollback(); throw error; }
}
