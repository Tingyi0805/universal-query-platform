import { proveDatasetFilterChange } from "./datasetFilterProof.js";
import { listDatasetParameters } from "./parameter.repository.js";
import { coerceRuntimeParameters } from "./parameter.service.js";
import { runtimeParameterDefinitions } from "./parameterSync.js";
import { writeAuditEvent } from "../audit/audit.repository.js";
import { invalidatePatientMetadata } from "./patientAuditContract.repository.js";
import sql from "mssql";
import { getPlatformDbPool } from "../../config/database.js";
import { extractParameterNames } from "../../query/queryCompiler.js";
import type { DatasetInput, DatasetRecord } from "./dataset.types.js";
import { snapshotDatasetVersion } from "../version/version.repository.js";

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

export async function getDataset(id: number, transaction?: sql.Transaction): Promise<DatasetRecord | null> {
  const request = transaction ? new sql.Request(transaction) : (await requirePool()).request();
  const result = await request.input("id", sql.BigInt, id).query(`
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

export const createDatasetUpdater = (deps = {
  getPool: requirePool,
  createTransaction: (pool: sql.ConnectionPool) => new sql.Transaction(pool),
  createRequest: (tx: sql.Transaction) => new sql.Request(tx),
  snapshotVersion: snapshotDatasetVersion,
  invalidateMetadata: invalidatePatientMetadata,
  listParameters: listDatasetParameters,
  audit: writeAuditEvent,
}) => async (id: number, input: DatasetInput, userId?: number,
  auditContext: { ipAddress?: string | null; userAgent?: string | null } = {}): Promise<void> => {
  const pool = await deps.getPool();
  const tx = deps.createTransaction(pool);
  await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

  try {
    // Re-read the current definition under the same parent/range locks as the
    // policy and dependents. A stale client cannot supply its own "before" proof.
    let filterProof: ReturnType<typeof proveDatasetFilterChange> = null;
    const existing = await deps.createRequest(tx).input("id", sql.BigInt, id)
      .query("SELECT SqlText, DataSourceId, IsArchived FROM uqp.Dataset WITH (UPDLOCK, HOLDLOCK) WHERE Id=@id");
    if (!existing.recordset.length) throw new Error("DATASET_NOT_FOUND");
    if (existing.recordset[0].IsArchived) throw new Error("DATASET_ARCHIVED");
    if (existing.recordset.length &&
        (String(existing.recordset[0].SqlText) !== input.sqlText || Number(existing.recordset[0].DataSourceId) !== input.dataSourceId)) {
      const protectedRules = await deps.createRequest(tx).input("id", sql.BigInt, id)
        .query("SELECT ColumnName FROM uqp.DatasetSensitiveColumn WITH (HOLDLOCK) WHERE DatasetId=@id");
      if (protectedRules.recordset.length) {
        if (Number(existing.recordset[0].DataSourceId) === input.dataSourceId) filterProof = proveDatasetFilterChange(
          String(existing.recordset[0].SqlText), input.sqlText, protectedRules.recordset.map(row => String(row.ColumnName)));
        if (!filterProof || !Number.isSafeInteger(userId) || userId! < 1) throw new Error("DATASET_SENSITIVITY_REVIEW_REQUIRED");
        // Output lineage is fixed by the proof. Also verify the parameter
        // contract for every existing primary/extra/legacy Dashboard binding.
        const primary = await deps.createRequest(tx).input("id", sql.BigInt, id).query(`
          SELECT d.ParametersJson FROM uqp.Dashboard d WITH (HOLDLOCK)
          INNER JOIN uqp.QueryDefinition q WITH (HOLDLOCK) ON q.Id=d.QueryDefinitionId
          WHERE q.DatasetId=@id`);
        const extra = await deps.createRequest(tx).input("id", sql.BigInt, id).query(`
          IF OBJECT_ID(N'uqp.DashboardDataSource',N'U') IS NOT NULL
          BEGIN
            IF COL_LENGTH(N'uqp.DashboardDataSource',N'QueryDefinitionId') IS NOT NULL
              EXEC sys.sp_executesql N'SELECT ds.ParametersJson FROM uqp.DashboardDataSource ds WITH (HOLDLOCK)
                LEFT JOIN uqp.QueryDefinition q WITH (HOLDLOCK) ON q.Id=ds.QueryDefinitionId
                WHERE ds.DatasetId=@id OR q.DatasetId=@id',N'@id BIGINT',@id=@id;
            ELSE
              EXEC sys.sp_executesql N'SELECT ds.ParametersJson FROM uqp.DashboardDataSource ds WITH (HOLDLOCK)
                WHERE ds.DatasetId=@id',N'@id BIGINT',@id=@id;
          END
          ELSE SELECT CAST(NULL AS NVARCHAR(MAX)) AS ParametersJson WHERE 1=0;`);
        // Lookup execution supplies no caller values; all parameters must be
        // resolvable from the saved definition if this Dataset supplies options.
        const lookups = await deps.createRequest(tx).input("id", sql.BigInt, id).query(
          "SELECT TOP (1) DatasetId FROM uqp.DatasetParameter WITH (HOLDLOCK) WHERE LookupDatasetId=@id");
        const bindings = [...primary.recordset, ...extra.recordset];
        if (bindings.length || lookups.recordset.length) {
          try {
            const definitions = runtimeParameterDefinitions(input.sqlText, await deps.listParameters(id, tx));
            if (lookups.recordset.length) coerceRuntimeParameters(definitions, {});
            for (const row of bindings) {
              const values: unknown = JSON.parse(row.ParametersJson);
              if (!values || typeof values !== "object" || Array.isArray(values)) throw new Error("UNPROVEN_BINDING");
              coerceRuntimeParameters(definitions, values as Record<string, unknown>);
            }
          } catch { throw new Error("DATASET_SENSITIVITY_REVIEW_REQUIRED"); }
        }
      }
      await deps.invalidateMetadata(tx, id);
    }
    if (userId) {
      await deps.snapshotVersion(tx, id, userId, "DATASET_UPDATE");
    }

    const result = await deps.createRequest(tx)
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
      const exists = await deps.createRequest(tx)
        .input("id", sql.BigInt, id)
        .query("SELECT IsArchived FROM uqp.Dataset WHERE Id=@id");
      if (exists.recordset[0]?.IsArchived) throw new Error("DATASET_ARCHIVED");
      throw new Error("DATASET_NOT_FOUND");
    }

    await deps.createRequest(tx)
      .input("datasetId", sql.BigInt, id)
      .query(`
        UPDATE uqp.QueryDefinition
        SET IsPublished=0,
            PublishedAtUtc=NULL,
            PublishedByUserId=NULL,
            UpdatedAtUtc=SYSUTCDATETIME()
        WHERE DatasetId=@datasetId AND IsPublished=1
      `);

    if (filterProof) await deps.audit({ eventType: "DATASET_SQL_FILTER_UPDATED", userId, datasetId: id,
      parameters: { proof: filterProof.kind }, ...auditContext }, tx);
    await tx.commit();
  } catch (error) {
    try { await tx.rollback(); } catch { /* Preserve the original failure; never report success. */ }
    throw error;
  }
};
export const updateDataset = createDatasetUpdater();

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
        UPDATE q
        SET IsPublished=0,
            PublishedAtUtc=NULL,
            PublishedByUserId=NULL,
            UpdatedAtUtc=SYSUTCDATETIME()
        FROM uqp.QueryDefinition q
        WHERE q.IsPublished=1
          AND (
            q.DatasetId=@datasetId
            OR EXISTS (
              SELECT 1
              FROM uqp.DatasetParameter dp
              WHERE dp.DatasetId=q.DatasetId
                AND dp.LookupDatasetId=@datasetId
            )
          )
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
  const transaction = new sql.Transaction(pool);
  await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  try {
    // Lock the parent Dataset row before checking references; FK inserts must
    // validate this parent and cannot race with a successful deletion.
    const result = await new sql.Request(transaction).input("id", sql.BigInt, id).query(`
      IF NOT EXISTS (SELECT 1 FROM uqp.Dataset WITH (UPDLOCK, HOLDLOCK) WHERE Id=@id)
        THROW 51021, 'DATASET_NOT_FOUND', 1;
      IF EXISTS (SELECT 1 FROM uqp.QueryDefinition WITH (HOLDLOCK) WHERE DatasetId=@id)
         OR EXISTS (SELECT 1 FROM uqp.DatasetParameter WITH (HOLDLOCK) WHERE LookupDatasetId=@id)
         OR EXISTS (SELECT 1 FROM uqp.AuditLog WITH (HOLDLOCK) WHERE DatasetId=@id)
        THROW 51022, 'DATASET_IN_USE', 1;
      DELETE FROM uqp.Dataset WHERE Id=@id;
      SELECT @@ROWCOUNT AS Affected;
    `);
    if (Number(result.recordset[0]?.Affected ?? 0) !== 1) throw new Error("DATASET_NOT_FOUND");
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    const number = (error as { number?: number })?.number;
    if (number === 51021) throw new Error("DATASET_NOT_FOUND");
    if (number === 51022 || number === 547) throw new Error("DATASET_IN_USE");
    throw error;
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
      (SELECT COUNT(1) FROM uqp.DatasetParameter WHERE LookupDatasetId=@id) AS LookupReferenceCount,
      (SELECT COUNT(1) FROM uqp.AuditLog WHERE DatasetId=@id) AS AuditCount
  `);
  const row = result.recordset[0];
  if (!row || !Boolean(row.ExistsFlag)) throw new Error("DATASET_NOT_FOUND");
  const queryCount = Number(row.QueryCount ?? 0);
  const lookupReferenceCount = Number(row.LookupReferenceCount ?? 0);
  const auditCount = Number(row.AuditCount ?? 0);
  return {
    canDelete: queryCount === 0 && lookupReferenceCount === 0 && auditCount === 0,
    queryCount,
    lookupReferenceCount,
    auditCount,
  };
}

export async function listDatasetsPaged(input: {
  page: number;
  pageSize: number;
  search?: string;
  status: "ACTIVE" | "INACTIVE" | "ARCHIVED" | "ALL";
  dataSourceId?: number;
}) {
  const pool = await requirePool();
  const offset = (input.page - 1) * input.pageSize;
  const search = input.search?.trim() || null;
  const dataSourceId = input.dataSourceId ?? null;

  const result = await pool.request()
    .input("offset", sql.Int, offset)
    .input("pageSize", sql.Int, input.pageSize)
    .input("search", sql.NVarChar(200), search)
    .input("status", sql.NVarChar(20), input.status)
    .input("dataSourceId", sql.BigInt, dataSourceId)
    .query(`
      SELECT d.Id, d.Code, d.Name, d.Description, d.DataSourceId, d.SqlText,
             d.MaxRows, d.QueryTimeoutSec, d.IsActive,
             d.IsArchived, d.ArchivedAtUtc, d.ArchivedByUserId,
             s.Name AS DataSourceName, s.Type AS DataSourceType
      FROM uqp.Dataset d
      INNER JOIN uqp.DataSource s ON s.Id=d.DataSourceId
      WHERE (
        @search IS NULL OR
        d.Code LIKE '%' + @search + '%' OR
        d.Name LIKE '%' + @search + '%' OR
        ISNULL(d.Description, '') LIKE '%' + @search + '%' OR
        s.Code LIKE '%' + @search + '%' OR
        s.Name LIKE '%' + @search + '%'
      )
      AND (@dataSourceId IS NULL OR d.DataSourceId=@dataSourceId)
      AND (
        @status='ALL' OR
        (@status='ARCHIVED' AND d.IsArchived=1) OR
        (@status='ACTIVE' AND d.IsArchived=0 AND d.IsActive=1) OR
        (@status='INACTIVE' AND d.IsArchived=0 AND d.IsActive=0)
      )
      ORDER BY d.Name, d.Code
      OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY;

      SELECT COUNT(1) AS Total
      FROM uqp.Dataset d
      INNER JOIN uqp.DataSource s ON s.Id=d.DataSourceId
      WHERE (
        @search IS NULL OR
        d.Code LIKE '%' + @search + '%' OR
        d.Name LIKE '%' + @search + '%' OR
        ISNULL(d.Description, '') LIKE '%' + @search + '%' OR
        s.Code LIKE '%' + @search + '%' OR
        s.Name LIKE '%' + @search + '%'
      )
      AND (@dataSourceId IS NULL OR d.DataSourceId=@dataSourceId)
      AND (
        @status='ALL' OR
        (@status='ARCHIVED' AND d.IsArchived=1) OR
        (@status='ACTIVE' AND d.IsArchived=0 AND d.IsActive=1) OR
        (@status='INACTIVE' AND d.IsArchived=0 AND d.IsActive=0)
      );
    `);

  const recordsets = result.recordsets as any[];
  return {
    items: (recordsets[0] ?? []).map(mapDataset),
    total: Number(recordsets[1]?.[0]?.Total ?? 0),
  };
}
