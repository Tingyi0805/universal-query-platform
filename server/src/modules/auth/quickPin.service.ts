import bcrypt from "bcryptjs";
import sql from "mssql";
import { getPlatformDbPool } from "../../config/database.js";
import { findUserById } from "./auth.repository.js";

const PIN_COST = 12;
export const DEFAULT_PIN_LENGTH = 6;

export function isAllowedPinLength(value: number): boolean {
  return Number.isInteger(value) && value >= 6 && value <= 8;
}

export function validateQuickPinLength(pin: string, length: number): boolean {
  return isAllowedPinLength(length) && pin.length === length && validateQuickPin(pin);
}

export async function getConfiguredPinLength(): Promise<number> {
  const pool = await getPlatformDbPool();
  if (!pool) return DEFAULT_PIN_LENGTH;
  const result = await pool.request().query("SELECT TOP (1) PinLength FROM uqp.QuickPinPolicy WHERE Id=1");
  const length = Number(result.recordset[0]?.PinLength ?? DEFAULT_PIN_LENGTH);
  return isAllowedPinLength(length) ? length : DEFAULT_PIN_LENGTH;
}
const blocked = new Set(["000000", "111111", "123456", "654321", "12345678", "87654321", "121212", "112233", "123123"]);

export function validateQuickPin(pin: string): boolean {
  return /^\d{6,8}$/.test(pin) && !blocked.has(pin) &&
    !/^(\d)\1+$/.test(pin) &&
    !("0123456789".includes(pin) || "9876543210".includes(pin)) &&
    !/^(\d{2})\1{2,3}$/.test(pin);
}

export async function enrollQuickPin(userId: number, password: string, pin: string): Promise<"OK" | "INVALID_CREDENTIALS" | "PIN_WEAK" | "NOT_CONFIGURED"> {
  if (!validateQuickPinLength(pin, await getConfiguredPinLength())) return "PIN_WEAK";
  const user = await findUserById(userId);
  if (user === undefined) return "NOT_CONFIGURED";
  if (!user || !user.isActive || user.authProvider !== "LOCAL" || !user.passwordHash) return "INVALID_CREDENTIALS";
  if (!await bcrypt.compare(password, user.passwordHash)) return "INVALID_CREDENTIALS";
  const pool = await getPlatformDbPool();
  if (!pool) return "NOT_CONFIGURED";
  const hash = await bcrypt.hash(pin, PIN_COST);
  await pool.request().input("userId", sql.BigInt, userId)
    .input("pinHash", sql.NVarChar(512), hash).query(`
    SET XACT_ABORT ON;
    BEGIN TRANSACTION;
    UPDATE uqp.UserQuickPin WITH (UPDLOCK, SERIALIZABLE)
       SET PinHash=@pinHash, PinVersion=PinVersion+1, IsEnabled=1,
           FailedAttempts=0, LockedUntilUtc=NULL, UpdatedAtUtc=SYSUTCDATETIME()
     WHERE UserId=@userId;
    IF @@ROWCOUNT=0
      INSERT INTO uqp.UserQuickPin (UserId, PinHash, IsEnabled)
      VALUES (@userId, @pinHash, 1);
    UPDATE uqp.SharedWorkstationSession SET RevokedAtUtc=SYSUTCDATETIME()
     WHERE UserId=@userId AND RevokedAtUtc IS NULL;
    COMMIT TRANSACTION;
    `);
  return "OK";
}

export async function revokeQuickPin(userId: number, password: string): Promise<"OK" | "INVALID_CREDENTIALS" | "NOT_CONFIGURED"> {
  const user = await findUserById(userId);
  if (user === undefined) return "NOT_CONFIGURED";
  if (!user || !user.isActive || user.authProvider !== "LOCAL" || !user.passwordHash || !await bcrypt.compare(password, user.passwordHash)) return "INVALID_CREDENTIALS";
  const pool = await getPlatformDbPool();
  if (!pool) return "NOT_CONFIGURED";
  await pool.request().input("userId", sql.BigInt, userId).query(`
    SET XACT_ABORT ON;
    BEGIN TRANSACTION;
    UPDATE uqp.UserQuickPin SET IsEnabled=0, PinVersion=PinVersion+1,
      FailedAttempts=0, LockedUntilUtc=NULL, UpdatedAtUtc=SYSUTCDATETIME() WHERE UserId=@userId;
    UPDATE uqp.SharedWorkstationSession SET RevokedAtUtc=SYSUTCDATETIME()
      WHERE UserId=@userId AND RevokedAtUtc IS NULL;
    COMMIT TRANSACTION;
  `);
  return "OK";
}
