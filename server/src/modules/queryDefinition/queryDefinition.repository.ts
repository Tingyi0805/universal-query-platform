import sql from "mssql";
import { getPlatformDbPool } from "../../config/database.js";
import type { QueryDefinitionInput, QueryDefinitionRecord } from "./queryDefinition.types.js";

async function requirePool() {
  const pool = await getPlatformDbPool();
  if (!pool) throw new Error("PLATFORM_DB_NOT_CONFIGURED");
  return pool;
}

function mapRow(row: any): QueryDefinitionRecord {
  return {
    id: Number(row.Id),
    code: String(row.Code),
    name: String(row.Name),
    description: row.Description == null ? null : String(row.Description),
    categoryId: row.CategoryId == null ? null : Number(row.CategoryId),
    category: row.CategoryName == null ? null : String(row.CategoryName),
    categorySortOrder: Number(row.CategorySortOrder ?? 0),
    icon: String(row.Icon),
    datasetId: Number(row.DatasetId),
    datasetName: row.DatasetName == null ? undefined : String(row.DatasetName),
    sortOrder: Number(row.SortOrder),
    allowExcelExport: Boolean(row.AllowExcelExport),
    isPublished: Boolean(row.IsPublished),
    isActive: Boolean(row.IsActive),
    publishedAtUtc: row.PublishedAtUtc ? new Date(row.PublishedAtUtc).toISOString() : null,
  };
}

export async function listQueryDefinitions(): Promise<QueryDefinitionRecord[]> {
  const pool = await requirePool();
  const result = await pool.request().query(`
    SELECT q.*, d.Name AS DatasetName,
           c.Name AS CategoryName,
           ISNULL(c.SortOrder, 2147483647) AS CategorySortOrder
    FROM uqp.QueryDefinition q
    INNER JOIN uqp.Dataset d ON d.Id=q.DatasetId
    LEFT JOIN uqp.QueryCategory c ON c.Id=q.CategoryId
    ORDER BY ISNULL(c.SortOrder, 2147483647), c.Name, q.SortOrder, q.Name
  `);
  return result.recordset.map(mapRow);
}

export async function getQueryDefinition(id: number): Promise<QueryDefinitionRecord | null> {
  const pool = await requirePool();
  const result = await pool.request().input("id", sql.BigInt, id).query(`
    SELECT q.*, d.Name AS DatasetName,
           c.Name AS CategoryName,
           ISNULL(c.SortOrder, 2147483647) AS CategorySortOrder
    FROM uqp.QueryDefinition q
    INNER JOIN uqp.Dataset d ON d.Id=q.DatasetId
    LEFT JOIN uqp.QueryCategory c ON c.Id=q.CategoryId
    WHERE q.Id=@id
  `);
  return result.recordset[0] ? mapRow(result.recordset[0]) : null;
}

export async function createQueryDefinition(input: QueryDefinitionInput): Promise<number> {
  const pool = await requirePool();
  const result = await pool.request()
    .input("code", sql.NVarChar(100), input.code)
    .input("name", sql.NVarChar(200), input.name)
    .input("description", sql.NVarChar(1000), input.description)
    .input("categoryId", sql.BigInt, input.categoryId)
    .input("icon", sql.NVarChar(100), input.icon)
    .input("datasetId", sql.BigInt, input.datasetId)
    .input("sortOrder", sql.Int, input.sortOrder)
    .input("allowExcelExport", sql.Bit, input.allowExcelExport)
    .input("isActive", sql.Bit, input.isActive)
    .query(`
      INSERT INTO uqp.QueryDefinition (
        Code, Name, Description, CategoryId, Icon, DatasetId,
        SortOrder, AllowExcelExport, IsActive
      )
      OUTPUT INSERTED.Id
      VALUES (
        @code,@name,@description,@categoryId,@icon,@datasetId,
        @sortOrder,@allowExcelExport,@isActive
      )
    `);
  return Number(result.recordset[0].Id);
}

export async function updateQueryDefinition(id: number, input: QueryDefinitionInput): Promise<void> {
  const pool = await requirePool();
  const tx = new sql.Transaction(pool);
  await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

  try {
    const currentResult = await new sql.Request(tx)
      .input("id", sql.BigInt, id)
      .query(`
        SELECT TOP (1)
          Name, Description, CategoryId, Icon, DatasetId,
          SortOrder, AllowExcelExport, IsActive, IsPublished
        FROM uqp.QueryDefinition WITH (UPDLOCK, HOLDLOCK)
        WHERE Id=@id
      `);

    const current = currentResult.recordset[0];
    if (!current) throw new Error("QUERY_DEFINITION_NOT_FOUND");

    const changed =
      String(current.Name) !== input.name ||
      (current.Description == null ? null : String(current.Description)) !== input.description ||
      (current.CategoryId == null ? null : Number(current.CategoryId)) !== input.categoryId ||
      String(current.Icon) !== input.icon ||
      Number(current.DatasetId) !== input.datasetId ||
      Number(current.SortOrder) !== input.sortOrder ||
      Boolean(current.AllowExcelExport) !== input.allowExcelExport ||
      Boolean(current.IsActive) !== input.isActive;

    await new sql.Request(tx)
      .input("id", sql.BigInt, id)
      .input("name", sql.NVarChar(200), input.name)
      .input("description", sql.NVarChar(1000), input.description)
      .input("categoryId", sql.BigInt, input.categoryId)
      .input("icon", sql.NVarChar(100), input.icon)
      .input("datasetId", sql.BigInt, input.datasetId)
      .input("sortOrder", sql.Int, input.sortOrder)
      .input("allowExcelExport", sql.Bit, input.allowExcelExport)
      .input("isActive", sql.Bit, input.isActive)
      .input("changed", sql.Bit, changed)
      .query(`
        UPDATE uqp.QueryDefinition SET
          Name=@name,
          Description=@description,
          CategoryId=@categoryId,
          Icon=@icon,
          DatasetId=@datasetId,
          SortOrder=@sortOrder,
          AllowExcelExport=@allowExcelExport,
          IsActive=@isActive,
          IsPublished=CASE WHEN @changed=1 THEN 0 ELSE IsPublished END,
          PublishedAtUtc=CASE WHEN @changed=1 THEN NULL ELSE PublishedAtUtc END,
          PublishedByUserId=CASE WHEN @changed=1 THEN NULL ELSE PublishedByUserId END,
          UpdatedAtUtc=CASE WHEN @changed=1 THEN SYSUTCDATETIME() ELSE UpdatedAtUtc END
        WHERE Id=@id
      `);

    await tx.commit();
  } catch (error) {
    await tx.rollback();
    throw error;
  }
}

export async function publishQueryDefinition(id: number, userId: number): Promise<void> {
  const pool = await requirePool();
  const result = await pool.request()
    .input("id", sql.BigInt, id)
    .input("userId", sql.BigInt, userId)
    .query(`
      UPDATE q SET
        IsPublished=1,
        PublishedAtUtc=SYSUTCDATETIME(),
        PublishedByUserId=@userId,
        UpdatedAtUtc=SYSUTCDATETIME()
      FROM uqp.QueryDefinition q
      INNER JOIN uqp.Dataset d ON d.Id=q.DatasetId
      INNER JOIN uqp.DataSource s ON s.Id=d.DataSourceId
      WHERE q.Id=@id AND q.IsActive=1 AND d.IsActive=1 AND s.IsActive=1;
      SELECT @@ROWCOUNT AS Affected;
    `);
  if (Number(result.recordset[0]?.Affected ?? 0) === 0) throw new Error("QUERY_NOT_PUBLISHABLE");
}

export async function unpublishQueryDefinition(id: number): Promise<void> {
  const pool = await requirePool();
  const result = await pool.request().input("id", sql.BigInt, id).query(`
    UPDATE uqp.QueryDefinition
    SET IsPublished=0, PublishedAtUtc=NULL, PublishedByUserId=NULL, UpdatedAtUtc=SYSUTCDATETIME()
    WHERE Id=@id;
    SELECT @@ROWCOUNT AS Affected;
  `);
  if (Number(result.recordset[0]?.Affected ?? 0) === 0) throw new Error("QUERY_DEFINITION_NOT_FOUND");
}

export async function deleteQueryDefinition(id: number): Promise<void> {
  const pool = await requirePool();
  const result = await pool.request().input("id", sql.BigInt, id)
    .query("DELETE FROM uqp.QueryDefinition WHERE Id=@id; SELECT @@ROWCOUNT AS Affected;");
  if (Number(result.recordset[0]?.Affected ?? 0) === 0) throw new Error("QUERY_DEFINITION_NOT_FOUND");
}

export async function listAccessibleQueries(userId: number) {
  const pool = await requirePool();
  const result = await pool.request().input("userId", sql.BigInt, userId).query(`
    WITH RoleAccess AS (
      SELECT rqa.QueryDefinitionId,
             MAX(CAST(rqa.CanView AS INT)) AS CanView,
             MAX(CAST(rqa.CanExecute AS INT)) AS CanExecute,
             MAX(CAST(rqa.CanExport AS INT)) AS CanExport
      FROM uqp.UserRole ur
      INNER JOIN uqp.Role r ON r.Id=ur.RoleId AND r.IsActive=1
      INNER JOIN uqp.RoleQueryAccess rqa ON rqa.RoleId=r.Id
      WHERE ur.UserId=@userId
      GROUP BY rqa.QueryDefinitionId
    ),
    UserAccess AS (
      SELECT QueryDefinitionId,
             CAST(CanView AS INT) AS CanView,
             CAST(CanExecute AS INT) AS CanExecute,
             CAST(CanExport AS INT) AS CanExport
      FROM uqp.UserQueryAccess
      WHERE UserId=@userId
    )
    SELECT q.Id, q.Code, q.Name, q.Description, q.CategoryId,
           c.Name AS CategoryName,
           ISNULL(c.SortOrder, 2147483647) AS CategorySortOrder,
           q.Icon, q.DatasetId, q.SortOrder, q.AllowExcelExport, q.IsPublished,
           q.IsActive, q.PublishedAtUtc, d.Name AS DatasetName,
           CASE WHEN ISNULL(ra.CanView,0)=1 OR ISNULL(ua.CanView,0)=1 THEN 1 ELSE 0 END AS EffectiveCanView,
           CASE WHEN ISNULL(ra.CanExecute,0)=1 OR ISNULL(ua.CanExecute,0)=1 THEN 1 ELSE 0 END AS EffectiveCanExecute,
           CASE WHEN ISNULL(ra.CanExport,0)=1 OR ISNULL(ua.CanExport,0)=1 THEN 1 ELSE 0 END AS EffectiveCanExport
    FROM uqp.QueryDefinition q
    INNER JOIN uqp.Dataset d ON d.Id=q.DatasetId AND d.IsActive=1
    INNER JOIN uqp.DataSource s ON s.Id=d.DataSourceId AND s.IsActive=1
    LEFT JOIN uqp.QueryCategory c ON c.Id=q.CategoryId
    LEFT JOIN RoleAccess ra ON ra.QueryDefinitionId=q.Id
    LEFT JOIN UserAccess ua ON ua.QueryDefinitionId=q.Id
    WHERE q.IsPublished=1 AND q.IsActive=1
      AND (ISNULL(ra.CanView,0)=1 OR ISNULL(ua.CanView,0)=1)
    ORDER BY ISNULL(c.SortOrder, 2147483647), c.Name, q.SortOrder, q.Name
  `);

  return result.recordset.map((row) => ({
    ...mapRow(row),
    canView: Boolean(row.EffectiveCanView),
    canExecute: Boolean(row.EffectiveCanExecute),
    canExport: Boolean(row.EffectiveCanExport) && Boolean(row.AllowExcelExport),
  }));
}

export async function getEffectiveQueryAccess(userId: number, queryId: number) {
  const queries = await listAccessibleQueries(userId);
  return queries.find((query) => query.id === queryId) ?? null;
}


export async function getQueryDefinitionDeleteImpact(id: number) {
  const pool = await requirePool();
  const result = await pool.request().input("id", sql.BigInt, id).query(`
    SELECT
      CASE WHEN EXISTS (SELECT 1 FROM uqp.QueryDefinition WHERE Id=@id) THEN 1 ELSE 0 END AS ExistsFlag,
      (SELECT COUNT(1) FROM uqp.AuditLog WHERE QueryDefinitionId=@id) AS AuditCount
  `);
  const row = result.recordset[0];
  if (!row || !Boolean(row.ExistsFlag)) throw new Error("QUERY_DEFINITION_NOT_FOUND");
  const auditCount = Number(row.AuditCount ?? 0);
  return { canDelete: auditCount === 0, auditCount };
}
