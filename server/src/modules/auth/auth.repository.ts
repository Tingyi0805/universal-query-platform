import sql from "mssql";
import { getPlatformDbPool } from "../../config/database.js";

export type AuthUserRecord = {
  id: number;
  username: string;
  displayName: string;
  passwordHash: string | null;
  isActive: boolean;
  authProvider: "LOCAL" | "AD" | "ORACLE";
  tokenVersion: number;
  permissions: string[];
};

export async function findUserByUsername(username: string): Promise<AuthUserRecord | null | undefined> {
  const pool = await getPlatformDbPool();
  if (!pool) return undefined;

  const userResult = await pool
    .request()
    .input("username", sql.NVarChar(100), username)
    .query(`
      SELECT TOP (1)
        Id, Username, DisplayName, PasswordHash, IsActive, AuthProvider, TokenVersion
      FROM uqp.AppUser
      WHERE Username = @username
    `);

  const row = userResult.recordset[0];
  if (!row) return null;

  const permissionResult = await pool
    .request()
    .input("userId", sql.BigInt, row.Id)
    .query(`
      SELECT DISTINCT p.Code
      FROM uqp.UserRole ur
      INNER JOIN uqp.Role r ON r.Id = ur.RoleId AND r.IsActive = 1
      INNER JOIN uqp.RolePermission rp ON rp.RoleId = r.Id
      INNER JOIN uqp.Permission p ON p.Id = rp.PermissionId
      WHERE ur.UserId = @userId
      ORDER BY p.Code
    `);

  return {
    id: Number(row.Id),
    username: row.Username,
    displayName: row.DisplayName,
    passwordHash: row.PasswordHash,
    isActive: Boolean(row.IsActive),
    authProvider: row.AuthProvider,
    tokenVersion: Number(row.TokenVersion ?? 1),
    permissions: permissionResult.recordset.map((x) => String(x.Code)),
  };
}


export async function findUserById(userId: number): Promise<AuthUserRecord | null | undefined> {
  const pool = await getPlatformDbPool();
  if (!pool) return undefined;

  const userResult = await pool
    .request()
    .input("userId", sql.BigInt, userId)
    .query(`
      SELECT TOP (1)
        Id, Username, DisplayName, PasswordHash, IsActive, AuthProvider, TokenVersion
      FROM uqp.AppUser
      WHERE Id = @userId
    `);

  const row = userResult.recordset[0];
  if (!row) return null;

  const permissionResult = await pool
    .request()
    .input("userId", sql.BigInt, row.Id)
    .query(`
      SELECT DISTINCT p.Code
      FROM uqp.UserRole ur
      INNER JOIN uqp.Role r ON r.Id = ur.RoleId AND r.IsActive = 1
      INNER JOIN uqp.RolePermission rp ON rp.RoleId = r.Id
      INNER JOIN uqp.Permission p ON p.Id = rp.PermissionId
      WHERE ur.UserId = @userId
      ORDER BY p.Code
    `);

  return {
    id: Number(row.Id),
    username: row.Username,
    displayName: row.DisplayName,
    passwordHash: row.PasswordHash,
    isActive: Boolean(row.IsActive),
    authProvider: row.AuthProvider,
    tokenVersion: Number(row.TokenVersion ?? 1),
    permissions: permissionResult.recordset.map((x) => String(x.Code)),
  };
}

export async function updateOwnLocalPassword(userId: number, passwordHash: string): Promise<void> {
  const pool = await getPlatformDbPool();
  if (!pool) throw new Error("AUTH_NOT_CONFIGURED");

  const result = await pool
    .request()
    .input("userId", sql.BigInt, userId)
    .input("passwordHash", sql.NVarChar(255), passwordHash)
    .query(`
      UPDATE uqp.AppUser
      SET PasswordHash=@passwordHash,
          TokenVersion=TokenVersion+1,
          UpdatedAtUtc=SYSUTCDATETIME()
      WHERE Id=@userId AND IsActive=1 AND AuthProvider='LOCAL';
      SELECT @@ROWCOUNT AS Affected;
    `);

  if (Number(result.recordset[0]?.Affected ?? 0) === 0) {
    throw new Error("USER_NOT_FOUND_OR_NOT_LOCAL");
  }
}


export async function getTokenSessionState(userId: number): Promise<{
  isActive: boolean;
  tokenVersion: number;
} | null | undefined> {
  const pool = await getPlatformDbPool();
  if (!pool) return undefined;

  const result = await pool.request()
    .input("userId", sql.BigInt, userId)
    .query(`
      SELECT TOP (1) IsActive, TokenVersion
      FROM uqp.AppUser
      WHERE Id=@userId
    `);

  const row = result.recordset[0];
  if (!row) return null;

  return {
    isActive: Boolean(row.IsActive),
    tokenVersion: Number(row.TokenVersion ?? 1),
  };
}
