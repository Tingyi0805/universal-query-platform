import sql from "mssql";
import { getPlatformDbPool } from "../../config/database.js";

export type DashboardInput = {
  code: string;
  name: string;
  description: string | null;
  queryDefinitionId: number;
  refreshSeconds: number;
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
           d.RefreshSeconds, d.ParametersJson, d.IsActive,
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
             d.RefreshSeconds, d.ParametersJson, d.IsActive,
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
    .input("parametersJson", sql.NVarChar(sql.MAX), JSON.stringify(input.parameters))
    .input("isActive", sql.Bit, input.isActive)
    .input("userId", sql.BigInt, userId)
    .query(`
      INSERT INTO uqp.Dashboard (
        Code, Name, Description, QueryDefinitionId,
        RefreshSeconds, ParametersJson, IsActive,
        CreatedByUserId, UpdatedByUserId
      )
      OUTPUT INSERTED.Id
      VALUES (
        @code,@name,@description,@queryDefinitionId,
        @refreshSeconds,@parametersJson,@isActive,
        @userId,@userId
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
