import sql from "mssql";
import { getPlatformDbPool } from "../../config/database.js";
import type { QueryCategoryInput, QueryCategoryRecord } from "./queryCategory.types.js";

async function requirePool() {
  const pool = await getPlatformDbPool();
  if (!pool) throw new Error("PLATFORM_DB_NOT_CONFIGURED");
  return pool;
}

function mapRow(row: any): QueryCategoryRecord {
  return {
    id: Number(row.Id),
    code: String(row.Code),
    name: String(row.Name),
    sortOrder: Number(row.SortOrder),
    isActive: Boolean(row.IsActive),
    queryCount: Number(row.QueryCount ?? 0),
  };
}

export async function listQueryCategories(): Promise<QueryCategoryRecord[]> {
  const pool = await requirePool();
  const result = await pool.request().query(`
    SELECT
      c.Id,
      c.Code,
      c.Name,
      c.SortOrder,
      c.IsActive,
      COUNT(q.Id) AS QueryCount
    FROM uqp.QueryCategory c
    LEFT JOIN uqp.QueryDefinition q ON q.CategoryId=c.Id
    GROUP BY c.Id, c.Code, c.Name, c.SortOrder, c.IsActive
    ORDER BY c.SortOrder, c.Name
  `);
  return result.recordset.map(mapRow);
}

export async function createQueryCategory(input: QueryCategoryInput): Promise<number> {
  const pool = await requirePool();
  const result = await pool.request()
    .input("code", sql.NVarChar(100), input.code)
    .input("name", sql.NVarChar(100), input.name)
    .input("sortOrder", sql.Int, input.sortOrder)
    .input("isActive", sql.Bit, input.isActive)
    .query(`
      INSERT INTO uqp.QueryCategory (Code, Name, SortOrder, IsActive)
      OUTPUT INSERTED.Id
      VALUES (@code,@name,@sortOrder,@isActive)
    `);
  return Number(result.recordset[0].Id);
}

export async function updateQueryCategory(id: number, input: QueryCategoryInput): Promise<void> {
  const pool = await requirePool();
  const result = await pool.request()
    .input("id", sql.BigInt, id)
    .input("code", sql.NVarChar(100), input.code)
    .input("name", sql.NVarChar(100), input.name)
    .input("sortOrder", sql.Int, input.sortOrder)
    .input("isActive", sql.Bit, input.isActive)
    .query(`
      UPDATE uqp.QueryCategory
      SET Code=@code,
          Name=@name,
          SortOrder=@sortOrder,
          IsActive=@isActive,
          UpdatedAtUtc=SYSUTCDATETIME()
      WHERE Id=@id;
      SELECT @@ROWCOUNT AS Affected;
    `);
  if (Number(result.recordset[0]?.Affected ?? 0) === 0) {
    throw new Error("QUERY_CATEGORY_NOT_FOUND");
  }
}

export async function getQueryCategoryDeleteImpact(id: number) {
  const pool = await requirePool();
  const result = await pool.request()
    .input("id", sql.BigInt, id)
    .query(`
      SELECT
        CASE WHEN EXISTS (SELECT 1 FROM uqp.QueryCategory WHERE Id=@id) THEN 1 ELSE 0 END AS ExistsFlag,
        (SELECT COUNT(1) FROM uqp.QueryDefinition WHERE CategoryId=@id) AS QueryCount
    `);
  const row = result.recordset[0];
  if (!row || !Boolean(row.ExistsFlag)) throw new Error("QUERY_CATEGORY_NOT_FOUND");
  const queryCount = Number(row.QueryCount ?? 0);
  return { canDelete: queryCount === 0, queryCount };
}

export async function deleteQueryCategory(id: number): Promise<void> {
  const pool = await requirePool();
  const impact = await getQueryCategoryDeleteImpact(id);
  if (!impact.canDelete) throw new Error("QUERY_CATEGORY_IN_USE");

  const result = await pool.request()
    .input("id", sql.BigInt, id)
    .query("DELETE FROM uqp.QueryCategory WHERE Id=@id; SELECT @@ROWCOUNT AS Affected;");

  if (Number(result.recordset[0]?.Affected ?? 0) === 0) {
    throw new Error("QUERY_CATEGORY_NOT_FOUND");
  }
}
