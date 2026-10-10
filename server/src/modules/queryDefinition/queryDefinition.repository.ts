import sql from "mssql";
import { getPlatformDbPool } from "../../config/database.js";
import type { QueryDefinitionInput, QueryDefinitionRecord } from "./queryDefinition.types.js";
import {
  snapshotDatasetVersion,
  snapshotQueryVersion,
} from "../version/version.repository.js";

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
    isArchived: Boolean(row.IsArchived),
    publishedAtUtc: row.PublishedAtUtc ? new Date(row.PublishedAtUtc).toISOString() : null,
    archivedAtUtc: row.ArchivedAtUtc ? new Date(row.ArchivedAtUtc).toISOString() : null,
    archivedByUserId: row.ArchivedByUserId == null ? null : Number(row.ArchivedByUserId),
    auditCount: Number(row.AuditCount ?? 0),
  };
}

export async function listQueryDefinitions(): Promise<QueryDefinitionRecord[]> {
  const pool = await requirePool();
  const result = await pool.request().query(`
    SELECT q.*, d.Name AS DatasetName,
           (SELECT COUNT(1) FROM uqp.AuditLog a WHERE a.QueryDefinitionId=q.Id) AS AuditCount,
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
           (SELECT COUNT(1) FROM uqp.AuditLog a WHERE a.QueryDefinitionId=q.Id) AS AuditCount,
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
      SELECT
        @code,@name,@description,@categoryId,@icon,@datasetId,
        @sortOrder,@allowExcelExport,@isActive
      FROM uqp.Dataset d
      WHERE d.Id=@datasetId AND d.IsArchived=0
    `);

  if (!result.recordset[0]) throw new Error("DATASET_ARCHIVED_OR_NOT_FOUND");
  return Number(result.recordset[0].Id);
}

export async function updateQueryDefinition(id: number, input: QueryDefinitionInput, userId?: number): Promise<void> {
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
        WHERE Id=@id AND IsArchived=0
      `);

    const current = currentResult.recordset[0];
    if (!current) {
      const exists = await new sql.Request(tx)
        .input("id", sql.BigInt, id)
        .query("SELECT IsArchived FROM uqp.QueryDefinition WHERE Id=@id");
      if (exists.recordset[0]?.IsArchived) throw new Error("QUERY_ARCHIVED");
      throw new Error("QUERY_DEFINITION_NOT_FOUND");
    }

    const datasetResult = await new sql.Request(tx)
      .input("datasetId", sql.BigInt, input.datasetId)
      .query("SELECT Id, IsArchived FROM uqp.Dataset WHERE Id=@datasetId");

    const selectedDataset = datasetResult.recordset[0];
    if (!selectedDataset) throw new Error("DATASET_NOT_FOUND");
    if (selectedDataset.IsArchived) throw new Error("DATASET_ARCHIVED");

    const changed =
      String(current.Name) !== input.name ||
      (current.Description == null ? null : String(current.Description)) !== input.description ||
      (current.CategoryId == null ? null : Number(current.CategoryId)) !== input.categoryId ||
      String(current.Icon) !== input.icon ||
      Number(current.DatasetId) !== input.datasetId ||
      Number(current.SortOrder) !== input.sortOrder ||
      Boolean(current.AllowExcelExport) !== input.allowExcelExport ||
      Boolean(current.IsActive) !== input.isActive;

    if (changed && userId) {
      await snapshotQueryVersion(tx, id, userId, "QUERY_UPDATE");
    }

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
  const tx = new sql.Transaction(pool);
  await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

  try {
    const result = await new sql.Request(tx)
      .input("id", sql.BigInt, id)
      .input("userId", sql.BigInt, userId)
      .query(`
        UPDATE q SET
          IsPublished=1,
          PublishedAtUtc=SYSUTCDATETIME(),
          PublishedByUserId=@userId,
          UpdatedAtUtc=SYSUTCDATETIME()
        OUTPUT INSERTED.DatasetId
        FROM uqp.QueryDefinition q
        INNER JOIN uqp.Dataset d ON d.Id=q.DatasetId
        INNER JOIN uqp.DataSource s ON s.Id=d.DataSourceId
        WHERE q.Id=@id AND q.IsActive=1 AND q.IsArchived=0
          AND d.IsActive=1 AND d.IsArchived=0 AND s.IsActive=1
          AND NOT EXISTS (
            SELECT 1
            FROM uqp.DatasetParameter dp
            INNER JOIN uqp.Dataset lookupDataset ON lookupDataset.Id=dp.LookupDatasetId
            WHERE dp.DatasetId=d.Id AND lookupDataset.IsArchived=1
          );
      `);

    const datasetId = result.recordset[0]?.DatasetId == null
      ? null
      : Number(result.recordset[0].DatasetId);

    if (!datasetId) throw new Error("QUERY_NOT_PUBLISHABLE");

    await snapshotQueryVersion(tx, id, userId, "PUBLISHED_SNAPSHOT");
    await snapshotDatasetVersion(tx, datasetId, userId, "PUBLISHED_SNAPSHOT");

    const lookupDatasets = await new sql.Request(tx)
      .input("datasetId", sql.BigInt, datasetId)
      .query(`
        SELECT DISTINCT LookupDatasetId
        FROM uqp.DatasetParameter
        WHERE DatasetId=@datasetId
          AND LookupDatasetId IS NOT NULL
          AND LookupDatasetId<>@datasetId
      `);

    for (const row of lookupDatasets.recordset) {
      await snapshotDatasetVersion(
        tx,
        Number(row.LookupDatasetId),
        userId,
        "PUBLISHED_SNAPSHOT",
      );
    }

    await tx.commit();
  } catch (error) {
    await tx.rollback();
    throw error;
  }
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
  const impact = await getQueryDefinitionDeleteImpact(id);
  if (!impact.canDelete) throw new Error("QUERY_HAS_HISTORY");

  const result = await pool.request().input("id", sql.BigInt, id)
    .query("DELETE FROM uqp.QueryDefinition WHERE Id=@id; SELECT @@ROWCOUNT AS Affected;");
  if (Number(result.recordset[0]?.Affected ?? 0) === 0) throw new Error("QUERY_DEFINITION_NOT_FOUND");
}

export async function archiveQueryDefinition(id: number, userId: number): Promise<void> {
  const pool = await requirePool();
  const result = await pool.request()
    .input("id", sql.BigInt, id)
    .input("userId", sql.BigInt, userId)
    .query(`
      UPDATE uqp.QueryDefinition
      SET IsArchived=1,
          IsPublished=0,
          IsActive=0,
          PublishedAtUtc=NULL,
          PublishedByUserId=NULL,
          ArchivedAtUtc=SYSUTCDATETIME(),
          ArchivedByUserId=@userId,
          UpdatedAtUtc=SYSUTCDATETIME()
      WHERE Id=@id AND IsArchived=0;
      SELECT @@ROWCOUNT AS Affected;
    `);
  if (Number(result.recordset[0]?.Affected ?? 0) === 0) {
    const exists = await getQueryDefinition(id);
    if (!exists) throw new Error("QUERY_DEFINITION_NOT_FOUND");
    throw new Error("QUERY_ALREADY_ARCHIVED");
  }
}

export async function restoreQueryDefinition(id: number): Promise<void> {
  const pool = await requirePool();
  const result = await pool.request()
    .input("id", sql.BigInt, id)
    .query(`
      UPDATE uqp.QueryDefinition
      SET IsArchived=0,
          IsPublished=0,
          IsActive=0,
          PublishedAtUtc=NULL,
          PublishedByUserId=NULL,
          ArchivedAtUtc=NULL,
          ArchivedByUserId=NULL,
          UpdatedAtUtc=SYSUTCDATETIME()
      WHERE Id=@id AND IsArchived=1;
      SELECT @@ROWCOUNT AS Affected;
    `);
  if (Number(result.recordset[0]?.Affected ?? 0) === 0) {
    const exists = await getQueryDefinition(id);
    if (!exists) throw new Error("QUERY_DEFINITION_NOT_FOUND");
    throw new Error("QUERY_NOT_ARCHIVED");
  }
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
           CASE WHEN f.UserId IS NULL THEN 0 ELSE 1 END AS IsFavorite,
           recent.LastUsedAtUtc,
           CASE WHEN ISNULL(ra.CanView,0)=1 OR ISNULL(ua.CanView,0)=1 THEN 1 ELSE 0 END AS EffectiveCanView,
           CASE WHEN ISNULL(ra.CanExecute,0)=1 OR ISNULL(ua.CanExecute,0)=1 THEN 1 ELSE 0 END AS EffectiveCanExecute,
           CASE WHEN ISNULL(ra.CanExport,0)=1 OR ISNULL(ua.CanExport,0)=1 THEN 1 ELSE 0 END AS EffectiveCanExport
    FROM uqp.QueryDefinition q
    INNER JOIN uqp.Dataset d ON d.Id=q.DatasetId AND d.IsActive=1 AND d.IsArchived=0
    INNER JOIN uqp.DataSource s ON s.Id=d.DataSourceId AND s.IsActive=1
    LEFT JOIN uqp.QueryCategory c ON c.Id=q.CategoryId
    LEFT JOIN RoleAccess ra ON ra.QueryDefinitionId=q.Id
    LEFT JOIN UserAccess ua ON ua.QueryDefinitionId=q.Id
    LEFT JOIN uqp.UserQueryFavorite f
      ON f.QueryDefinitionId=q.Id AND f.UserId=@userId
    OUTER APPLY (
      SELECT MAX(a.CreatedAtUtc) AS LastUsedAtUtc
      FROM uqp.AuditLog a
      WHERE a.UserId=@userId
        AND a.QueryDefinitionId=q.Id
        AND a.EventType='QUERY_EXECUTE'
        AND a.Status='SUCCESS'
    ) recent
    WHERE q.IsPublished=1 AND q.IsActive=1 AND q.IsArchived=0
      AND NOT EXISTS (
        SELECT 1
        FROM uqp.DatasetParameter dp
        INNER JOIN uqp.Dataset lookupDataset ON lookupDataset.Id=dp.LookupDatasetId
        WHERE dp.DatasetId=d.Id AND lookupDataset.IsArchived=1
      )
      AND (ISNULL(ra.CanView,0)=1 OR ISNULL(ua.CanView,0)=1)
    ORDER BY ISNULL(c.SortOrder, 2147483647), c.Name, q.SortOrder, q.Name
  `);

  return result.recordset.map((row) => ({
    ...mapRow(row),
    canView: Boolean(row.EffectiveCanView),
    canExecute: Boolean(row.EffectiveCanExecute),
    canExport: Boolean(row.EffectiveCanExport) && Boolean(row.AllowExcelExport),
    isFavorite: Boolean(row.IsFavorite),
    lastUsedAtUtc: row.LastUsedAtUtc ? new Date(row.LastUsedAtUtc).toISOString() : null,
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

export async function listQueryDefinitionsPaged(input: {
  page: number;
  pageSize: number;
  search?: string;
  status: "PUBLISHED" | "DRAFT" | "ARCHIVED" | "ALL";
  categoryId?: number;
}) {
  const pool = await requirePool();
  const offset = (input.page - 1) * input.pageSize;
  const search = input.search?.trim() || null;
  const categoryId = input.categoryId ?? null;

  const result = await pool.request()
    .input("offset", sql.Int, offset)
    .input("pageSize", sql.Int, input.pageSize)
    .input("search", sql.NVarChar(200), search)
    .input("status", sql.NVarChar(20), input.status)
    .input("categoryId", sql.BigInt, categoryId)
    .query(`
      SELECT q.*, d.Name AS DatasetName,
             (SELECT COUNT(1) FROM uqp.AuditLog a WHERE a.QueryDefinitionId=q.Id) AS AuditCount,
             c.Name AS CategoryName,
             ISNULL(c.SortOrder, 2147483647) AS CategorySortOrder
      FROM uqp.QueryDefinition q
      INNER JOIN uqp.Dataset d ON d.Id=q.DatasetId
      LEFT JOIN uqp.QueryCategory c ON c.Id=q.CategoryId
      WHERE (
        @search IS NULL OR
        q.Code LIKE '%' + @search + '%' OR
        q.Name LIKE '%' + @search + '%' OR
        ISNULL(q.Description, '') LIKE '%' + @search + '%' OR
        d.Code LIKE '%' + @search + '%' OR
        d.Name LIKE '%' + @search + '%'
      )
      AND (@categoryId IS NULL OR q.CategoryId=@categoryId)
      AND (
        @status='ALL' OR
        (@status='ARCHIVED' AND q.IsArchived=1) OR
        (@status='PUBLISHED' AND q.IsArchived=0 AND q.IsPublished=1) OR
        (@status='DRAFT' AND q.IsArchived=0 AND q.IsPublished=0)
      )
      ORDER BY ISNULL(c.SortOrder, 2147483647), c.Name, q.SortOrder, q.Name
      OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY;

      SELECT COUNT(1) AS Total
      FROM uqp.QueryDefinition q
      INNER JOIN uqp.Dataset d ON d.Id=q.DatasetId
      LEFT JOIN uqp.QueryCategory c ON c.Id=q.CategoryId
      WHERE (
        @search IS NULL OR
        q.Code LIKE '%' + @search + '%' OR
        q.Name LIKE '%' + @search + '%' OR
        ISNULL(q.Description, '') LIKE '%' + @search + '%' OR
        d.Code LIKE '%' + @search + '%' OR
        d.Name LIKE '%' + @search + '%'
      )
      AND (@categoryId IS NULL OR q.CategoryId=@categoryId)
      AND (
        @status='ALL' OR
        (@status='ARCHIVED' AND q.IsArchived=1) OR
        (@status='PUBLISHED' AND q.IsArchived=0 AND q.IsPublished=1) OR
        (@status='DRAFT' AND q.IsArchived=0 AND q.IsPublished=0)
      );
    `);

  const recordsets = result.recordsets as any[];
  return {
    items: (recordsets[0] ?? []).map(mapRow),
    total: Number(recordsets[1]?.[0]?.Total ?? 0),
  };
}
