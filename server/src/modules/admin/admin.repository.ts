import sql from "mssql";
import { getPlatformDbPool } from "../../config/database.js";

export async function countUsers(): Promise<number | undefined> {
  const pool = await getPlatformDbPool();
  if (!pool) return undefined;
  const result = await pool.request().query("SELECT COUNT(1) AS Cnt FROM uqp.AppUser");
  return Number(result.recordset[0]?.Cnt ?? 0);
}

export async function createInitialAdmin(input: {
  username: string;
  displayName: string;
  passwordHash: string;
}): Promise<void> {
  const pool = await getPlatformDbPool();
  if (!pool) throw new Error("PLATFORM_DB_NOT_CONFIGURED");

  const transaction = new sql.Transaction(pool);
  await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

  try {
    const countResult = await new sql.Request(transaction)
      .query("SELECT COUNT(1) AS Cnt FROM uqp.AppUser WITH (UPDLOCK, HOLDLOCK)");

    if (Number(countResult.recordset[0]?.Cnt ?? 0) > 0) {
      throw new Error("BOOTSTRAP_ALREADY_COMPLETED");
    }

    const userResult = await new sql.Request(transaction)
      .input("username", sql.NVarChar(100), input.username)
      .input("displayName", sql.NVarChar(200), input.displayName)
      .input("passwordHash", sql.NVarChar(255), input.passwordHash)
      .query(`
        INSERT INTO uqp.AppUser (Username, DisplayName, PasswordHash, AuthProvider, IsActive)
        OUTPUT INSERTED.Id
        VALUES (@username, @displayName, @passwordHash, 'LOCAL', 1)
      `);

    const userId = userResult.recordset[0].Id;

    await new sql.Request(transaction)
      .input("userId", sql.BigInt, userId)
      .query(`
        INSERT INTO uqp.UserRole (UserId, RoleId)
        SELECT @userId, Id
        FROM uqp.Role
        WHERE Code = 'SYSTEM_ADMIN'
      `);

    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

export async function listUsers() {
  const pool = await getPlatformDbPool();
  if (!pool) return undefined;

  const result = await pool.request().query(`
    SELECT
      u.Id,
      u.Username,
      u.DisplayName,
      u.AuthProvider,
      u.IsActive,
      STRING_AGG(r.Code, ',') WITHIN GROUP (ORDER BY r.Code) AS RoleCodes
    FROM uqp.AppUser u
    LEFT JOIN uqp.UserRole ur ON ur.UserId = u.Id
    LEFT JOIN uqp.Role r ON r.Id = ur.RoleId
    GROUP BY u.Id, u.Username, u.DisplayName, u.AuthProvider, u.IsActive
    ORDER BY u.Username
  `);

  return result.recordset.map((row) => ({
    id: Number(row.Id),
    username: String(row.Username),
    displayName: String(row.DisplayName),
    authProvider: String(row.AuthProvider),
    isActive: Boolean(row.IsActive),
    roles: row.RoleCodes ? String(row.RoleCodes).split(",") : [],
  }));
}

export async function listRoles() {
  const pool = await getPlatformDbPool();
  if (!pool) return undefined;

  const result = await pool.request().query(`
    SELECT Id, Code, Name, Description, IsSystem, IsActive
    FROM uqp.Role
    ORDER BY IsSystem DESC, Code
  `);

  return result.recordset.map((row) => ({
    id: Number(row.Id),
    code: String(row.Code),
    name: String(row.Name),
    description: row.Description ? String(row.Description) : null,
    isSystem: Boolean(row.IsSystem),
    isActive: Boolean(row.IsActive),
  }));
}
