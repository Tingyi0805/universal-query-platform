import sql from "mssql";
import { getPlatformDbPool } from "../../config/database.js";
import { extractParameterNames } from "../../query/queryCompiler.js";
import type { DatasetInput, DatasetRecord } from "./dataset.types.js";

async function requirePool() {
  const pool = await getPlatformDbPool();
  if (!pool) throw new Error("PLATFORM_DB_NOT_CONFIGURED");
  return pool;
}

function mapDataset(row: any): DatasetRecord {
  return {
    id: Number(row.Id),
    code: String(row.Code),
    name: String(row.Name),
    description: row.Description ? String(row.Description) : null,
    dataSourceId: Number(row.DataSourceId),
    dataSourceName: row.DataSourceName ? String(row.DataSourceName) : undefined,
    dataSourceType: row.DataSourceType ?? undefined,
    sqlText: String(row.SqlText),
    maxRows: Number(row.MaxRows),
    queryTimeoutSec: row.QueryTimeoutSec == null ? null : Number(row.QueryTimeoutSec),
    isActive: Boolean(row.IsActive),
    isArchived: Boolean(row.IsArchived),
    archivedAtUtc: row.ArchivedAtUtc ? new Date(row.ArchivedAtUtc).toISOString() : null,
    archivedByUserId: row.ArchivedByUserId == null ? null : Number(row.ArchivedByUserId),
    parameterNames: extractParameterNames(String(row.SqlText)),
  };
}

export async function listDatasets(): Promise<DatasetRecord[]> {
  const pool = await requirePool();
  const result = await pool.request().query(`
    SELECT d.Id, d.Code, d.Name, d.Description, d.DataSourceId, d.SqlText,
           d.MaxRows, d.QueryTimeoutSec, d.IsActive,
           d.IsArchived, d.ArchivedAtUtc, d.ArchivedByUserId,
           s.Name AS DataSourceName, s.Type AS DataSourceType
    FROM uqp.Dataset d
    INNER JOIN uqp.DataSource s ON s.Id=d.DataSourceId
    ORDER BY d.Name, d.Code
  `);
  return result.recordset.map(mapDataset);
}

export async function getDataset(id: number): Promise<DatasetRecord | null> {
  const pool = await requirePool();
  const result = await pool.request().input("id", sql.BigInt, id).query(`
    SELECT d.Id, d.Code, d.Name, d.Description, d.DataSourceId, d.SqlText,
           d.MaxRows, d.QueryTimeoutSec, d.IsActive,
           d.IsArchived, d.ArchivedAtUtc, d.ArchivedByUserId,
           s.Name AS DataSourceName, s.Type AS DataSourceType
    FROM uqp.Dataset d
    INNER JOIN uqp.DataSource s ON s.Id=d.DataSourceId
    WHERE d.Id=@id
  `);
  return result.recordset[0] ? mapDataset(result.recordset[0]) : null;
}

export async function createDataset(input: DatasetInput): Promise<number> {
  const pool = await requirePool();
  const result = await pool.request()
    .input("code", sql.NVarChar(100), input.code)
    .input("name", sql.NVarChar(200), input.name)
    .input("description", sql.NVarChar(1000), input.description)
    .input("dataSourceId", sql.BigInt, input.dataSourceId)
    .input("sqlText", sql.NVarChar(sql.MAX), input.sqlText)
    .input("maxRows", sql.Int, input.maxRows)
    .input("queryTimeoutSec", sql.Int, input.queryTimeoutSec)
    .input("isActive", sql.Bit, input.isActive)
    .query(`
      INSERT INTO uqp.Dataset (
        Code, Name, Description, DataSourceId, SqlText,
        MaxRows, QueryTimeoutSec, IsActive
      )
      OUTPUT INSERTED.Id
      VALUES (
        @code,@name,@description,@dataSourceId,@sqlText,
        @maxRows,@queryTimeoutSec,@isActive
      )
    `);
  return Number(result.recordset[0].Id);
}

export async function updateDataset(id: number, input: DatasetInput): Promise<void> {
  const pool = await requirePool();
  const tx = new sql.Transaction(pool);
  await tx.begin();

  try {
    const result = await new sql.Request(tx)
      .input("id", sql.BigInt, id)
      .input("name", sql.NVarChar(200), input.name)
      .input("description", sql.NVarChar(1000), input.description)
      .input("dataSourceId", sql.BigInt, input.dataSourceId)
      .input("sqlText", sql.NVarChar(sql.MAX), input.sqlText)
      .input("maxRows", sql.Int, input.maxRows)
      .input("queryTimeoutSec", sql.Int, input.queryTimeoutSec)
      .input("isActive", sql.Bit, input.isActive)
      .query(`
        UPDATE uqp.Dataset SET
          Name=@name, Description=@description, DataSourceId=@dataSourceId,
          SqlText=@sqlText, MaxRows=@maxRows, QueryTimeoutSec=@queryTimeoutSec,
          IsActive=@isActive, UpdatedAtUtc=SYSUTCDATETIME()
        WHERE Id=@id AND IsArchived=0;
        SELECT @@ROWCOUNT AS Affected;
      `);

    if (Number(result.recordset[0]?.Affected ?? 0) === 0) {
      const exists = await new sql.Request(tx)
        .input("id", sql.BigInt, id)
        .query("SELECT IsArchived FROM uqp.Dataset WHERE Id=@id");
      if (exists.recordset[0]?.IsArchived) throw new Error("DATASET_ARCHIVED");
      throw new Error("DATASET_NOT_FOUND");
    }

    await new sql.Request(tx)
      .input("datasetId", sql.BigInt, id)
      .query(`
        UPDATE uqp.QueryDefinition
        SET IsPublished=0,
            PublishedAtUtc=NULL,
            PublishedByUserId=NULL,
            UpdatedAtUtc=SYSUTCDATETIME()
        WHERE DatasetId=@datasetId AND IsPublished=1
      `);

    await tx.commit();
  } catch (error) {
    await tx.rollback();
    throw error;
  }
}

export async function archiveDataset(id: number, userId: number): Promise<void> {
  const pool = await requirePool();
  const tx = new sql.Transaction(pool);
  await tx.begin();

  try {
    const result = await new sql.Request(tx)
      .input("id", sql.BigInt, id)
      .input("userId", sql.BigInt, userId)
      .query(`
        UPDATE uqp.Dataset
        SET IsArchived=1,
            IsActive=0,
            ArchivedAtUtc=SYSUTCDATETIME(),
            ArchivedByUserId=@userId,
            UpdatedAtUtc=SYSUTCDATETIME()
        WHERE Id=@id AND IsArchived=0;
        SELECT @@ROWCOUNT AS Affected;
      `);

    if (Number(result.recordset[0]?.Affected ?? 0) === 0) {
      const exists = await new sql.Request(tx)
        .input("id", sql.BigInt, id)
        .query("SELECT IsArchived FROM uqp.Dataset WHERE Id=@id");
      if (!exists.recordset[0]) throw new Error("DATASET_NOT_FOUND");
      throw new Error("DATASET_ALREADY_ARCHIVED");
    }

    await new sql.Request(tx)
      .input("datasetId", sql.BigInt, id)
      .query(`
        UPDATE uqp.QueryDefinition
        SET IsPublished=0,
            PublishedAtUtc=NULL,
            PublishedByUserId=NULL,
            UpdatedAtUtc=SYSUTCDATETIME()
        WHERE DatasetId=@datasetId AND IsPublished=1
      `);

    await tx.commit();
  } catch (error) {
    await tx.rollback();
    throw error;
  }
}

export async function restoreDataset(id: number): Promise<void> {
  const pool = await requirePool();
  const result = await pool.request()
    .input("id", sql.BigInt, id)
    .query(`
      UPDATE uqp.Dataset
      SET IsArchived=0,
          IsActive=0,
          ArchivedAtUtc=NULL,
          ArchivedByUserId=NULL,
          UpdatedAtUtc=SYSUTCDATETIME()
      WHERE Id=@id AND IsArchived=1;
      SELECT @@ROWCOUNT AS Affected;
    `);

  if (Number(result.recordset[0]?.Affected ?? 0) === 0) {
    const exists = await getDataset(id);
    if (!exists) throw new Error("DATASET_NOT_FOUND");
    throw new Error("DATASET_NOT_ARCHIVED");
  }
}

export async function deleteDataset(id: number): Promise<void> {
  const pool = await requirePool();
  const impact = await getDatasetDeleteImpact(id);
  if (!impact.canDelete) throw new Error("DATASET_IN_USE");

  const result = await pool.request().input("id", sql.BigInt, id)
    .query("DELETE FROM uqp.Dataset WHERE Id=@id; SELECT @@ROWCOUNT AS Affected;");
  if (Number(result.recordset[0]?.Affected ?? 0) === 0) {
    throw new Error("DATASET_NOT_FOUND");
  }
}

export async function listDesignerDataSources() {
  const pool = await requirePool();
  const result = await pool.request().query(`
    SELECT Id, Code, Name, Type
    FROM uqp.DataSource
    WHERE IsActive=1
    ORDER BY Name, Code
  `);
  return result.recordset.map((row) => ({
    id: Number(row.Id),
    code: String(row.Code),
    name: String(row.Name),
    type: String(row.Type),
  }));
}


export async function getDatasetDeleteImpact(id: number) {
  const pool = await requirePool();
  const result = await pool.request().input("id", sql.BigInt, id).query(`
    SELECT
      CASE WHEN EXISTS (SELECT 1 FROM uqp.Dataset WHERE Id=@id) THEN 1 ELSE 0 END AS ExistsFlag,
      (SELECT COUNT(1) FROM uqp.QueryDefinition WHERE DatasetId=@id) AS QueryCount,
      (SELECT COUNT(1) FROM uqp.DatasetParameter WHERE LookupDatasetId=@id) AS LookupReferenceCount
  `);
  const row = result.recordset[0];
  if (!row || !Boolean(row.ExistsFlag)) throw new Error("DATASET_NOT_FOUND");
  const queryCount = Number(row.QueryCount ?? 0);
  const lookupReferenceCount = Number(row.LookupReferenceCount ?? 0);
  return {
    canDelete: queryCount === 0 && lookupReferenceCount === 0,
    queryCount,
    lookupReferenceCount,
  };
}
