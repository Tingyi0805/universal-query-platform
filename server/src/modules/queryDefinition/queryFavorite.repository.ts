import sql from "mssql";
import { getPlatformDbPool } from "../../config/database.js";
import { getEffectiveQueryAccess } from "./queryDefinition.repository.js";

async function requirePool() {
  const pool = await getPlatformDbPool();
  if (!pool) throw new Error("PLATFORM_DB_NOT_CONFIGURED");
  return pool;
}

export async function setQueryFavorite(
  userId: number,
  queryId: number,
  isFavorite: boolean,
): Promise<void> {
  const query = await getEffectiveQueryAccess(userId, queryId);
  if (!query?.canView) throw new Error("QUERY_NOT_FOUND");

  const pool = await requirePool();

  if (isFavorite) {
    await pool.request()
      .input("userId", sql.BigInt, userId)
      .input("queryId", sql.BigInt, queryId)
      .query(`
        IF NOT EXISTS (
          SELECT 1
          FROM uqp.UserQueryFavorite
          WHERE UserId=@userId AND QueryDefinitionId=@queryId
        )
        BEGIN
          INSERT INTO uqp.UserQueryFavorite (UserId, QueryDefinitionId)
          VALUES (@userId, @queryId);
        END
      `);
    return;
  }

  await pool.request()
    .input("userId", sql.BigInt, userId)
    .input("queryId", sql.BigInt, queryId)
    .query(`
      DELETE FROM uqp.UserQueryFavorite
      WHERE UserId=@userId AND QueryDefinitionId=@queryId
    `);
}
