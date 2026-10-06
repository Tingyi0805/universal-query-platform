import sql from "mssql";
import { getPlatformDbPool } from "../../config/database.js";

async function requirePool() {
  const pool = await getPlatformDbPool();
  if (!pool) throw new Error("PLATFORM_DB_NOT_CONFIGURED");
  return pool;
}

export async function getQueryAccessConfiguration(queryId: number) {
  const pool = await requirePool();

  const [roles, roleAccess, userAccess] = await Promise.all([
    pool.request().query(`
      SELECT Id, Code, Name, IsActive
      FROM uqp.Role
      WHERE IsActive=1
      ORDER BY IsSystem DESC, Code
    `),
    pool.request().input("queryId", sql.BigInt, queryId).query(`
      SELECT RoleId, CanView, CanExecute, CanExport
      FROM uqp.RoleQueryAccess
      WHERE QueryDefinitionId=@queryId
    `),
    pool.request().input("queryId", sql.BigInt, queryId).query(`
      SELECT a.UserId, a.CanView, a.CanExecute, a.CanExport,
             u.Username, u.DisplayName, u.IsActive
      FROM uqp.UserQueryAccess a
      INNER JOIN uqp.AppUser u ON u.Id=a.UserId
      WHERE a.QueryDefinitionId=@queryId
      ORDER BY u.Username
    `),
  ]);

  return {
    roles: roles.recordset.map((row) => ({
      id: Number(row.Id),
      code: String(row.Code),
      name: String(row.Name),
      isActive: Boolean(row.IsActive),
    })),
    roleAccess: roleAccess.recordset.map((row) => ({
      roleId: Number(row.RoleId),
      canView: Boolean(row.CanView),
      canExecute: Boolean(row.CanExecute),
      canExport: Boolean(row.CanExport),
    })),
    userAccess: userAccess.recordset.map((row) => ({
      userId: Number(row.UserId),
      username: String(row.Username),
      displayName: String(row.DisplayName),
      isActive: Boolean(row.IsActive),
      canView: Boolean(row.CanView),
      canExecute: Boolean(row.CanExecute),
      canExport: Boolean(row.CanExport),
    })),
  };
}

export async function replaceQueryAccess(
  queryId: number,
  input: {
    roles: { roleId: number; canView: boolean; canExecute: boolean; canExport: boolean }[];
    users: { userId: number; canView: boolean; canExecute: boolean; canExport: boolean }[];
  },
): Promise<void> {
  const pool = await requirePool();
  const tx = new sql.Transaction(pool);
  await tx.begin();

  try {
    const query = await new sql.Request(tx)
      .input("queryId", sql.BigInt, queryId)
      .query("SELECT Id FROM uqp.QueryDefinition WHERE Id=@queryId");
    if (!query.recordset[0]) throw new Error("QUERY_DEFINITION_NOT_FOUND");

    await new sql.Request(tx)
      .input("queryId", sql.BigInt, queryId)
      .query("DELETE FROM uqp.RoleQueryAccess WHERE QueryDefinitionId=@queryId; DELETE FROM uqp.UserQueryAccess WHERE QueryDefinitionId=@queryId;");

    for (const access of input.roles) {
      await new sql.Request(tx)
        .input("queryId", sql.BigInt, queryId)
        .input("roleId", sql.BigInt, access.roleId)
        .input("canView", sql.Bit, access.canView)
        .input("canExecute", sql.Bit, access.canExecute)
        .input("canExport", sql.Bit, access.canExport)
        .query(`
          INSERT INTO uqp.RoleQueryAccess (
            RoleId, QueryDefinitionId, CanView, CanExecute, CanExport
          )
          SELECT @roleId, @queryId, @canView, @canExecute, @canExport
          WHERE EXISTS (SELECT 1 FROM uqp.Role WHERE Id=@roleId)
        `);
    }

    for (const access of input.users) {
      await new sql.Request(tx)
        .input("queryId", sql.BigInt, queryId)
        .input("userId", sql.BigInt, access.userId)
        .input("canView", sql.Bit, access.canView)
        .input("canExecute", sql.Bit, access.canExecute)
        .input("canExport", sql.Bit, access.canExport)
        .query(`
          INSERT INTO uqp.UserQueryAccess (
            UserId, QueryDefinitionId, CanView, CanExecute, CanExport
          )
          SELECT @userId, @queryId, @canView, @canExecute, @canExport
          WHERE EXISTS (SELECT 1 FROM uqp.AppUser WHERE Id=@userId)
        `);
    }

    await tx.commit();
  } catch (error) {
    await tx.rollback();
    throw error;
  }
}


export async function searchQueryAccessUsers(searchText: string, limit = 20) {
  const pool = await requirePool();
  const search = searchText.trim();
  if (search.length < 1) return [];

  const safeLimit = Math.min(Math.max(limit, 1), 50);
  const result = await pool.request()
    .input("search", sql.NVarChar(100), `%${search}%`)
    .input("limit", sql.Int, safeLimit)
    .query(`
      SELECT TOP (@limit) Id, Username, DisplayName, IsActive
      FROM uqp.AppUser
      WHERE IsActive=1
        AND (Username LIKE @search OR DisplayName LIKE @search)
      ORDER BY
        CASE WHEN Username=@search THEN 0
             WHEN Username LIKE @search + '%' THEN 1
             ELSE 2 END,
        Username
    `);

  return result.recordset.map((row) => ({
    id: Number(row.Id),
    username: String(row.Username),
    displayName: String(row.DisplayName),
    isActive: Boolean(row.IsActive),
  }));
}
