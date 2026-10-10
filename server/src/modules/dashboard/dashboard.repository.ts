import sql from "mssql";
import { getPlatformDbPool } from "../../config/database.js";

export type DashboardInput = {
  code: string;
  name: string;
  description: string | null;
  queryDefinitionId: number;
  refreshSeconds: number;
  displayMode: "TABLE" | "BIG_SCREEN";
  displayTitle: string | null;
  pageSize: number;
  pageSeconds: number;
  showClock: boolean;
  showPageNumber: boolean;
  showCountdown: boolean;
  parameters: Record<string, unknown>;
  isActive: boolean;
};

async function requirePool() {
  const pool = await getPlatformDbPool();
  if (!pool) throw new Error("PLATFORM_DB_NOT_CONFIGURED");
  return pool;
}

function mapRow(row: any) {
  let parameters: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(String(row.ParametersJson ?? "{}"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) parameters = parsed;
  } catch {
    parameters = {};
  }

  return {
    id: Number(row.Id),
    code: String(row.Code),
    name: String(row.Name),
    description: row.Description == null ? null : String(row.Description),
    queryDefinitionId: Number(row.QueryDefinitionId),
    queryCode: String(row.QueryCode),
    queryName: String(row.QueryName),
    refreshSeconds: Number(row.RefreshSeconds),
    displayMode: String(row.DisplayMode ?? "BIG_SCREEN") as "TABLE" | "BIG_SCREEN",
    displayTitle: row.DisplayTitle == null ? null : String(row.DisplayTitle),
    pageSize: Number(row.PageSize ?? 5),
    pageSeconds: Number(row.PageSeconds ?? 20),
    showClock: Boolean(row.ShowClock ?? true),
    showPageNumber: Boolean(row.ShowPageNumber ?? true),
    showCountdown: Boolean(row.ShowCountdown ?? true),
    parameters,
    isActive: Boolean(row.IsActive),
    createdAtUtc: row.CreatedAtUtc ? new Date(row.CreatedAtUtc).toISOString() : null,
    updatedAtUtc: row.UpdatedAtUtc ? new Date(row.UpdatedAtUtc).toISOString() : null,
  };
}

async function assertUsablePublishedQuery(pool: sql.ConnectionPool, queryDefinitionId: number) {
  const result = await pool.request()
    .input("queryDefinitionId", sql.BigInt, queryDefinitionId)
    .query(`
      SELECT q.Id
      FROM uqp.QueryDefinition q
      INNER JOIN uqp.Dataset d
        ON d.Id=q.DatasetId AND d.IsActive=1 AND d.IsArchived=0
      INNER JOIN uqp.DataSource s
        ON s.Id=d.DataSourceId AND s.IsActive=1
      WHERE q.Id=@queryDefinitionId
        AND q.IsPublished=1
        AND q.IsActive=1
        AND q.IsArchived=0
        AND NOT EXISTS (
          SELECT 1
          FROM uqp.DatasetParameter dp
          INNER JOIN uqp.Dataset lookupDataset
            ON lookupDataset.Id=dp.LookupDatasetId
          WHERE dp.DatasetId=d.Id
            AND lookupDataset.IsArchived=1
        )
    `);

  if (!result.recordset[0]) throw new Error("DASHBOARD_QUERY_NOT_AVAILABLE");
}

export async function listDashboards() {
  const pool = await requirePool();
  const result = await pool.request().query(`
    SELECT d.Id, d.Code, d.Name, d.Description, d.QueryDefinitionId,
           d.RefreshSeconds, d.DisplayMode, d.DisplayTitle, d.PageSize, d.PageSeconds,
           d.ShowClock, d.ShowPageNumber, d.ShowCountdown,
           d.ParametersJson, d.IsActive,
           d.CreatedAtUtc, d.UpdatedAtUtc,
           q.Code AS QueryCode, q.Name AS QueryName
    FROM uqp.Dashboard d
    INNER JOIN uqp.QueryDefinition q ON q.Id=d.QueryDefinitionId
    ORDER BY d.Name, d.Code
  `);
  return result.recordset.map(mapRow);
}

export async function getDashboard(id: number) {
  const pool = await requirePool();
  const result = await pool.request()
    .input("id", sql.BigInt, id)
    .query(`
      SELECT d.Id, d.Code, d.Name, d.Description, d.QueryDefinitionId,
             d.RefreshSeconds, d.DisplayMode, d.DisplayTitle, d.PageSize, d.PageSeconds,
           d.ShowClock, d.ShowPageNumber, d.ShowCountdown,
           d.ParametersJson, d.IsActive,
             d.CreatedAtUtc, d.UpdatedAtUtc,
             q.Code AS QueryCode, q.Name AS QueryName
      FROM uqp.Dashboard d
      INNER JOIN uqp.QueryDefinition q ON q.Id=d.QueryDefinitionId
      WHERE d.Id=@id
    `);
  return result.recordset[0] ? mapRow(result.recordset[0]) : null;
}

export async function createDashboard(input: DashboardInput, userId: number): Promise<number> {
  const pool = await requirePool();
  await assertUsablePublishedQuery(pool, input.queryDefinitionId);

  const result = await pool.request()
    .input("code", sql.NVarChar(100), input.code)
    .input("name", sql.NVarChar(200), input.name)
    .input("description", sql.NVarChar(1000), input.description)
    .input("queryDefinitionId", sql.BigInt, input.queryDefinitionId)
    .input("refreshSeconds", sql.Int, input.refreshSeconds)
    .input("displayMode", sql.NVarChar(20), input.displayMode)
    .input("displayTitle", sql.NVarChar(200), input.displayTitle)
    .input("pageSize", sql.Int, input.pageSize)
    .input("pageSeconds", sql.Int, input.pageSeconds)
    .input("showClock", sql.Bit, input.showClock)
    .input("showPageNumber", sql.Bit, input.showPageNumber)
    .input("showCountdown", sql.Bit, input.showCountdown)
    .input("parametersJson", sql.NVarChar(sql.MAX), JSON.stringify(input.parameters))
    .input("isActive", sql.Bit, input.isActive)
    .input("userId", sql.BigInt, userId)
    .query(`
      INSERT INTO uqp.Dashboard (
        Code, Name, Description, QueryDefinitionId,
        RefreshSeconds, DisplayMode, DisplayTitle, PageSize, PageSeconds,
        ShowClock, ShowPageNumber, ShowCountdown,
        ParametersJson, IsActive, CreatedByUserId, UpdatedByUserId
      )
      OUTPUT INSERTED.Id
      VALUES (
        @code,@name,@description,@queryDefinitionId,
        @refreshSeconds,@displayMode,@displayTitle,@pageSize,@pageSeconds,
        @showClock,@showPageNumber,@showCountdown,
        @parametersJson,@isActive,@userId,@userId
      )
    `);

  return Number(result.recordset[0].Id);
}

export async function updateDashboard(id: number, input: DashboardInput, userId: number): Promise<void> {
  const pool = await requirePool();
  await assertUsablePublishedQuery(pool, input.queryDefinitionId);

  const result = await pool.request()
    .input("id", sql.BigInt, id)
    .input("code", sql.NVarChar(100), input.code)
    .input("name", sql.NVarChar(200), input.name)
    .input("description", sql.NVarChar(1000), input.description)
    .input("queryDefinitionId", sql.BigInt, input.queryDefinitionId)
    .input("refreshSeconds", sql.Int, input.refreshSeconds)
    .input("displayMode", sql.NVarChar(20), input.displayMode)
    .input("displayTitle", sql.NVarChar(200), input.displayTitle)
    .input("pageSize", sql.Int, input.pageSize)
    .input("pageSeconds", sql.Int, input.pageSeconds)
    .input("showClock", sql.Bit, input.showClock)
    .input("showPageNumber", sql.Bit, input.showPageNumber)
    .input("showCountdown", sql.Bit, input.showCountdown)
    .input("parametersJson", sql.NVarChar(sql.MAX), JSON.stringify(input.parameters))
    .input("isActive", sql.Bit, input.isActive)
    .input("userId", sql.BigInt, userId)
    .query(`
      UPDATE uqp.Dashboard
      SET Code=@code,
          Name=@name,
          Description=@description,
          QueryDefinitionId=@queryDefinitionId,
          RefreshSeconds=@refreshSeconds,
          DisplayMode=@displayMode,
          DisplayTitle=@displayTitle,
          PageSize=@pageSize,
          PageSeconds=@pageSeconds,
          ShowClock=@showClock,
          ShowPageNumber=@showPageNumber,
          ShowCountdown=@showCountdown,
          ParametersJson=@parametersJson,
          IsActive=@isActive,
          UpdatedByUserId=@userId,
          UpdatedAtUtc=SYSUTCDATETIME()
      WHERE Id=@id;
      SELECT @@ROWCOUNT AS Affected;
    `);

  if (Number(result.recordset[0]?.Affected ?? 0) === 0) {
    throw new Error("DASHBOARD_NOT_FOUND");
  }
}

export async function deleteDashboard(id: number): Promise<void> {
  const pool = await requirePool();
  const result = await pool.request()
    .input("id", sql.BigInt, id)
    .query(`
      DELETE FROM uqp.Dashboard WHERE Id=@id;
      SELECT @@ROWCOUNT AS Affected;
    `);

  if (Number(result.recordset[0]?.Affected ?? 0) === 0) {
    throw new Error("DASHBOARD_NOT_FOUND");
  }
}

export async function listDashboardsPaged(input: {
  page: number;
  pageSize: number;
  search?: string;
  status: "ACTIVE" | "INACTIVE" | "ALL";
  displayMode?: "TABLE" | "BIG_SCREEN";
}) {
  const pool = await requirePool();
  const offset = (input.page - 1) * input.pageSize;
  const search = input.search?.trim() || null;
  const displayMode = input.displayMode ?? null;

  const result = await pool.request()
    .input("offset", sql.Int, offset)
    .input("pageSize", sql.Int, input.pageSize)
    .input("search", sql.NVarChar(200), search)
    .input("status", sql.NVarChar(20), input.status)
    .input("displayMode", sql.NVarChar(20), displayMode)
    .query(`
      SELECT d.Id, d.Code, d.Name, d.Description, d.QueryDefinitionId,
             d.RefreshSeconds, d.DisplayMode, d.DisplayTitle, d.PageSize, d.PageSeconds,
             d.ShowClock, d.ShowPageNumber, d.ShowCountdown,
             d.ParametersJson, d.IsActive,
             d.CreatedAtUtc, d.UpdatedAtUtc,
             q.Code AS QueryCode, q.Name AS QueryName
      FROM uqp.Dashboard d
      INNER JOIN uqp.QueryDefinition q ON q.Id=d.QueryDefinitionId
      WHERE (
        @search IS NULL OR
        d.Code LIKE '%' + @search + '%' OR
        d.Name LIKE '%' + @search + '%' OR
        ISNULL(d.Description, '') LIKE '%' + @search + '%' OR
        q.Code LIKE '%' + @search + '%' OR
        q.Name LIKE '%' + @search + '%'
      )
      AND (@displayMode IS NULL OR d.DisplayMode=@displayMode)
      AND (
        @status='ALL' OR
        (@status='ACTIVE' AND d.IsActive=1) OR
        (@status='INACTIVE' AND d.IsActive=0)
      )
      ORDER BY d.Name, d.Code
      OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY;

      SELECT COUNT(1) AS Total
      FROM uqp.Dashboard d
      INNER JOIN uqp.QueryDefinition q ON q.Id=d.QueryDefinitionId
      WHERE (
        @search IS NULL OR
        d.Code LIKE '%' + @search + '%' OR
        d.Name LIKE '%' + @search + '%' OR
        ISNULL(d.Description, '') LIKE '%' + @search + '%' OR
        q.Code LIKE '%' + @search + '%' OR
        q.Name LIKE '%' + @search + '%'
      )
      AND (@displayMode IS NULL OR d.DisplayMode=@displayMode)
      AND (
        @status='ALL' OR
        (@status='ACTIVE' AND d.IsActive=1) OR
        (@status='INACTIVE' AND d.IsActive=0)
      );
    `);

  const recordsets = result.recordsets as any[];
  return {
    items: (recordsets[0] ?? []).map(mapRow),
    total: Number(recordsets[1]?.[0]?.Total ?? 0),
  };
}
