import sql from "mssql";
import { getPlatformDbPool } from "../../config/database.js";

async function requirePool() {
  const pool = await getPlatformDbPool();
  if (!pool) throw new Error("PLATFORM_DB_NOT_CONFIGURED");
  return pool;
}

export async function countUsers(): Promise<number | undefined> {
  const pool = await getPlatformDbPool();
  if (!pool) return undefined;
  const result = await pool.request().query("SELECT COUNT(1) AS Cnt FROM uqp.AppUser");
  return Number(result.recordset[0]?.Cnt ?? 0);
}

export async function createInitialAdmin(input: { username: string; displayName: string; passwordHash: string; }): Promise<void> {
  const pool = await requirePool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

  try {
    const countResult = await new sql.Request(transaction)
      .query("SELECT COUNT(1) AS Cnt FROM uqp.AppUser WITH (UPDLOCK, HOLDLOCK)");
    if (Number(countResult.recordset[0]?.Cnt ?? 0) > 0) throw new Error("BOOTSTRAP_ALREADY_COMPLETED");

    const userResult = await new sql.Request(transaction)
      .input("username", sql.NVarChar(100), input.username)
      .input("displayName", sql.NVarChar(200), input.displayName)
      .input("passwordHash", sql.NVarChar(255), input.passwordHash)
      .query(`
        INSERT INTO uqp.AppUser (Username, DisplayName, PasswordHash, AuthProvider, IsActive)
        OUTPUT INSERTED.Id
        VALUES (@username, @displayName, @passwordHash, 'LOCAL', 1)
      `);

    await new sql.Request(transaction)
      .input("userId", sql.BigInt, userResult.recordset[0].Id)
      .query(`
        INSERT INTO uqp.UserRole (UserId, RoleId)
        SELECT @userId, Id FROM uqp.Role WHERE Code = 'SYSTEM_ADMIN'
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
    SELECT u.Id, u.Username, u.DisplayName, u.AuthProvider, u.IsActive,
      STRING_AGG(r.Code, ',') WITHIN GROUP (ORDER BY r.Code) AS RoleCodes
    FROM uqp.AppUser u
    LEFT JOIN uqp.UserRole ur ON ur.UserId = u.Id
    LEFT JOIN uqp.Role r ON r.Id = ur.RoleId
    GROUP BY u.Id, u.Username, u.DisplayName, u.AuthProvider, u.IsActive
    ORDER BY u.Username
  `);
  return result.recordset.map((row) => ({
    id: Number(row.Id), username: String(row.Username), displayName: String(row.DisplayName),
    authProvider: String(row.AuthProvider), isActive: Boolean(row.IsActive),
    roles: row.RoleCodes ? String(row.RoleCodes).split(",") : [],
  }));
}

export async function listRoles() {
  const pool = await getPlatformDbPool();
  if (!pool) return undefined;
  const result = await pool.request().query(`
    SELECT r.Id, r.Code, r.Name, r.Description, r.IsSystem, r.IsActive,
      STRING_AGG(p.Code, ',') WITHIN GROUP (ORDER BY p.Code) AS PermissionCodes
    FROM uqp.Role r
    LEFT JOIN uqp.RolePermission rp ON rp.RoleId = r.Id
    LEFT JOIN uqp.Permission p ON p.Id = rp.PermissionId
    GROUP BY r.Id, r.Code, r.Name, r.Description, r.IsSystem, r.IsActive
    ORDER BY r.IsSystem DESC, r.Code
  `);
  return result.recordset.map((row) => ({
    id: Number(row.Id), code: String(row.Code), name: String(row.Name),
    description: row.Description ? String(row.Description) : null,
    isSystem: Boolean(row.IsSystem), isActive: Boolean(row.IsActive),
    permissions: row.PermissionCodes ? String(row.PermissionCodes).split(",") : [],
  }));
}

export async function listPermissions() {
  const pool = await requirePool();
  const result = await pool.request().query("SELECT Id, Code, Name, Description FROM uqp.Permission ORDER BY Code");
  return result.recordset.map((row) => ({
    id: Number(row.Id), code: String(row.Code), name: String(row.Name),
    description: row.Description ? String(row.Description) : null,
  }));
}

export async function createUser(input: { username: string; displayName: string; passwordHash: string; roleCodes: string[]; }) {
  const pool = await requirePool();
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const user = await new sql.Request(tx)
      .input("username", sql.NVarChar(100), input.username)
      .input("displayName", sql.NVarChar(200), input.displayName)
      .input("passwordHash", sql.NVarChar(255), input.passwordHash)
      .query(`
        INSERT INTO uqp.AppUser (Username, DisplayName, PasswordHash, AuthProvider, IsActive)
        OUTPUT INSERTED.Id VALUES (@username, @displayName, @passwordHash, 'LOCAL', 1)
      `);
    const userId = user.recordset[0].Id;
    for (const code of [...new Set(input.roleCodes)]) {
      await new sql.Request(tx).input("userId", sql.BigInt, userId).input("code", sql.NVarChar(100), code)
        .query(`INSERT INTO uqp.UserRole (UserId, RoleId)
                SELECT @userId, Id FROM uqp.Role WHERE Code=@code AND IsActive=1`);
    }
    await tx.commit();
    return Number(userId);
  } catch (error) { await tx.rollback(); throw error; }
}

export async function updateUser(userId: number, input: { displayName: string; isActive: boolean; roleCodes: string[]; }) {
  const pool = await requirePool();
  const tx = new sql.Transaction(pool);
  await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  try {
    const current = await new sql.Request(tx).input("userId", sql.BigInt, userId).query(`
      SELECT u.IsActive,
        CASE WHEN EXISTS (
          SELECT 1 FROM uqp.UserRole ur JOIN uqp.Role r ON r.Id=ur.RoleId
          WHERE ur.UserId=u.Id AND r.Code='SYSTEM_ADMIN'
        ) THEN 1 ELSE 0 END AS IsSystemAdmin
      FROM uqp.AppUser u WITH (UPDLOCK, HOLDLOCK) WHERE u.Id=@userId
    `);
    if (!current.recordset[0]) throw new Error("USER_NOT_FOUND");

    const willBeAdmin = input.roleCodes.includes("SYSTEM_ADMIN");
    if (Boolean(current.recordset[0].IsSystemAdmin) && (!input.isActive || !willBeAdmin)) {
      const admins = await new sql.Request(tx).query(`
        SELECT COUNT(DISTINCT u.Id) AS Cnt
        FROM uqp.AppUser u
        JOIN uqp.UserRole ur ON ur.UserId=u.Id
        JOIN uqp.Role r ON r.Id=ur.RoleId
        WHERE u.IsActive=1 AND r.Code='SYSTEM_ADMIN'
      `);
      if (Number(admins.recordset[0]?.Cnt ?? 0) <= 1) throw new Error("LAST_SYSTEM_ADMIN");
    }

    await new sql.Request(tx).input("userId", sql.BigInt, userId)
      .input("displayName", sql.NVarChar(200), input.displayName)
      .input("isActive", sql.Bit, input.isActive)
      .query("UPDATE uqp.AppUser SET DisplayName=@displayName, IsActive=@isActive, UpdatedAtUtc=SYSUTCDATETIME() WHERE Id=@userId");

    await new sql.Request(tx).input("userId", sql.BigInt, userId).query("DELETE FROM uqp.UserRole WHERE UserId=@userId");
    for (const code of [...new Set(input.roleCodes)]) {
      await new sql.Request(tx).input("userId", sql.BigInt, userId).input("code", sql.NVarChar(100), code)
        .query("INSERT INTO uqp.UserRole (UserId, RoleId) SELECT @userId, Id FROM uqp.Role WHERE Code=@code AND IsActive=1");
    }
    await tx.commit();
  } catch (error) { await tx.rollback(); throw error; }
}

export async function resetUserPassword(userId: number, passwordHash: string) {
  const pool = await requirePool();
  const result = await pool.request().input("userId", sql.BigInt, userId).input("passwordHash", sql.NVarChar(255), passwordHash)
    .query(`UPDATE uqp.AppUser SET PasswordHash=@passwordHash, UpdatedAtUtc=SYSUTCDATETIME()
            WHERE Id=@userId AND AuthProvider='LOCAL'; SELECT @@ROWCOUNT AS Affected;`);
  if (Number(result.recordset[0]?.Affected ?? 0) === 0) throw new Error("USER_NOT_FOUND_OR_NOT_LOCAL");
}

export async function createRole(input: { code: string; name: string; description?: string | null; permissionCodes: string[]; }) {
  const pool = await requirePool();
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const role = await new sql.Request(tx)
      .input("code", sql.NVarChar(100), input.code)
      .input("name", sql.NVarChar(200), input.name)
      .input("description", sql.NVarChar(500), input.description ?? null)
      .query(`INSERT INTO uqp.Role (Code, Name, Description, IsSystem, IsActive)
              OUTPUT INSERTED.Id VALUES (@code,@name,@description,0,1)`);
    const roleId = role.recordset[0].Id;
    for (const code of [...new Set(input.permissionCodes)]) {
      await new sql.Request(tx).input("roleId", sql.BigInt, roleId).input("code", sql.NVarChar(100), code)
        .query("INSERT INTO uqp.RolePermission (RoleId, PermissionId) SELECT @roleId, Id FROM uqp.Permission WHERE Code=@code");
    }
    await tx.commit();
    return Number(roleId);
  } catch (error) { await tx.rollback(); throw error; }
}

export async function updateRole(roleId: number, input: { name: string; description?: string | null; isActive: boolean; permissionCodes: string[]; }) {
  const pool = await requirePool();
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const role = await new sql.Request(tx).input("roleId", sql.BigInt, roleId).query("SELECT Code, IsSystem FROM uqp.Role WHERE Id=@roleId");
    if (!role.recordset[0]) throw new Error("ROLE_NOT_FOUND");
    if (Boolean(role.recordset[0].IsSystem) && String(role.recordset[0].Code) === "SYSTEM_ADMIN") {
      if (!input.isActive) throw new Error("SYSTEM_ROLE_PROTECTED");

      const allPermissions = await new sql.Request(tx)
        .query("SELECT Code FROM uqp.Permission ORDER BY Code");
      input.permissionCodes = allPermissions.recordset.map((row) => String(row.Code));
    }

    await new sql.Request(tx).input("roleId", sql.BigInt, roleId)
      .input("name", sql.NVarChar(200), input.name)
      .input("description", sql.NVarChar(500), input.description ?? null)
      .input("isActive", sql.Bit, input.isActive)
      .query("UPDATE uqp.Role SET Name=@name, Description=@description, IsActive=@isActive WHERE Id=@roleId");

    await new sql.Request(tx).input("roleId", sql.BigInt, roleId).query("DELETE FROM uqp.RolePermission WHERE RoleId=@roleId");
    for (const code of [...new Set(input.permissionCodes)]) {
      await new sql.Request(tx).input("roleId", sql.BigInt, roleId).input("code", sql.NVarChar(100), code)
        .query("INSERT INTO uqp.RolePermission (RoleId, PermissionId) SELECT @roleId, Id FROM uqp.Permission WHERE Code=@code");
    }
    await tx.commit();
  } catch (error) { await tx.rollback(); throw error; }
}
