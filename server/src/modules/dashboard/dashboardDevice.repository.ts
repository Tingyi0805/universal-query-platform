import crypto from "node:crypto";
import sql from "mssql";
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
    createdAtUtc: row.CreatedAtUtc ? new Date(row.CreatedAtUtc).toISOString() : null,
    revokedAtUtc: row.RevokedAtUtc ? new Date(row.RevokedAtUtc).toISOString() : null,
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
      ORDER BY IsActive DESC, CreatedAtUtc DESC, Id DESC
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
      WHERE ddd.IsActive=1
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
    `);

  if (!result.recordset[0]) {
    throw new Error("DASHBOARD_DEVICE_NOT_FOUND");
  }

  return mapRow(result.recordset[0]);
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

export async function validateDashboardDisplayDevice(
  dashboardId: number,
  token: string,
  clientIp: string,
) {
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
        AND IsActive=1
        AND (ExpiresAtUtc IS NULL OR ExpiresAtUtc > SYSUTCDATETIME())
    `);

  const row = result.recordset[0];
  if (!row) return null;

  const normalizedClientIp = normalizeClientIp(clientIp);
  if (
    Boolean(row.EnforceIpRestriction) &&
    !matchesIpRestriction(
      normalizedClientIp,
      row.AllowedIp == null ? null : String(row.AllowedIp),
      row.AllowedCidr == null ? null : String(row.AllowedCidr),
    )
  ) {
    return null;
  }

  await pool.request()
    .input("id", sql.BigInt, row.Id)
    .query(`
      UPDATE uqp.DashboardDisplayDevice
      SET LastUsedAtUtc=SYSUTCDATETIME()
      WHERE Id=@id
    `);

  return mapRow(row);
}
