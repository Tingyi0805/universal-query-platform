import sql from "mssql";
import { getPlatformDbPool } from "../../config/database.js";

export type AuthUserRecord = {
  id: number;
  username: string;
  displayName: string;
  passwordHash: string | null;
  isActive: boolean;
  authProvider: "LOCAL" | "AD" | "ORACLE";
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
        Id, Username, DisplayName, PasswordHash, IsActive, AuthProvider
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
    permissions: permissionResult.recordset.map((x) => String(x.Code)),
  };
}
