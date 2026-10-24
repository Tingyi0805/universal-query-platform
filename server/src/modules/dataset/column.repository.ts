import sql from "mssql";
import { getPlatformDbPool } from "../../config/database.js";
import type { QueryColumn } from "../../query/query.types.js";

async function requirePool() {
  const pool = await getPlatformDbPool();
  if (!pool) throw new Error("PLATFORM_DB_NOT_CONFIGURED");
  return pool;
}

export class DatasetColumnSyncError extends Error {
  constructor(readonly code: "DATASET_COLUMN_SYNC_CONFLICT" | "DATASET_SENSITIVITY_COLUMNS_STALE" | "DATASET_COLUMN_SYNC_FAILED") {
    super(code); this.name = "DatasetColumnSyncError";
  }
}
type SyncOptions = {
  dataSourceId: number; definitionVersion: string; configurationVersion: string; userId: number;
  reauthorize: (transaction: sql.Transaction) => Promise<void>;
};
export function createDatasetColumnRepository(deps = {
  getPool: requirePool, transaction: (pool: sql.ConnectionPool) => new sql.Transaction(pool),
  request: (transaction: sql.Transaction) => new sql.Request(transaction),
}) {
  return { async syncDatasetColumns(datasetId: number, columns: QueryColumn[], options: SyncOptions): Promise<void> {
    if (!columns.length || columns.length > 4096 || columns.some(c => !c.name || c.name.length > 256
      || c.name.trim() !== c.name || /[\x00-\x1f\x7f]/u.test(c.name) || !c.dataType || c.dataType.length > 100)
      || new Set(columns.map(c => c.name.toUpperCase())).size !== columns.length
      || !/^[0-9a-f]{16}$/u.test(options.definitionVersion) || !/^[0-9a-f]{16}$/u.test(options.configurationVersion))
      throw new DatasetColumnSyncError("DATASET_COLUMN_SYNC_FAILED");
    const tx = deps.transaction(await deps.getPool());
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    const request = () => deps.request(tx);
    try {
      await request().query("SET XACT_ABORT ON");
      const check = async () => {
        const result = await request().input("datasetId", sql.BigInt, datasetId).input("sourceId", sql.BigInt, options.dataSourceId).query(`
          SELECT CONVERT(VARCHAR(16),d.DefinitionRowVersion,2) AS DefinitionVersion,
            CONVERT(VARCHAR(16),s.ConfigurationRowVersion,2) AS ConfigurationVersion
          FROM uqp.Dataset d WITH (UPDLOCK,HOLDLOCK)
          INNER JOIN uqp.DataSource s WITH (HOLDLOCK) ON s.Id=d.DataSourceId
          WHERE d.Id=@datasetId AND s.Id=@sourceId AND d.IsActive=1 AND d.IsArchived=0 AND s.IsActive=1`);
        const row = result.recordset[0];
        if (result.recordset.length !== 1 || String(row.DefinitionVersion).toLowerCase() !== options.definitionVersion
          || String(row.ConfigurationVersion).toLowerCase() !== options.configurationVersion)
          throw new DatasetColumnSyncError("DATASET_COLUMN_SYNC_CONFLICT");
        const parameters = await request().input("datasetId", sql.BigInt, datasetId)
          .query("SELECT TOP (1) Id FROM uqp.DatasetParameter WITH (HOLDLOCK) WHERE DatasetId=@datasetId");
        if (parameters.recordset.length) throw new DatasetColumnSyncError("DATASET_COLUMN_SYNC_CONFLICT");
        await options.reauthorize(tx);
      };
      await check();
      // DatasetColumn is an editable display catalogue, not patient/Native Type
      // evidence. Preserve every existing rule; never infer or create new rules.
      const rules = await request().input("datasetId", sql.BigInt, datasetId)
        .query("SELECT ColumnName FROM uqp.DatasetSensitiveColumn WITH (HOLDLOCK) WHERE DatasetId=@datasetId");
      const next = new Set(columns.map(column => column.name.toUpperCase()));
      if (rules.recordset.some(rule => !next.has(String(rule.ColumnName).toUpperCase())))
        throw new DatasetColumnSyncError("DATASET_SENSITIVITY_COLUMNS_STALE");
      await request().input("datasetId", sql.BigInt, datasetId).query("DELETE FROM uqp.DatasetColumn WHERE DatasetId=@datasetId");
      for (const [ordinal, column] of columns.entries()) {
        await request().input("datasetId", sql.BigInt, datasetId).input("columnName", sql.NVarChar(256), column.name)
          .input("dataType", sql.NVarChar(100), column.dataType).input("ordinal", sql.Int, ordinal)
          .query("INSERT INTO uqp.DatasetColumn (DatasetId,ColumnName,DataType,[Ordinal]) VALUES (@datasetId,@columnName,@dataType,@ordinal)");
      }
      await request().input("datasetId", sql.BigInt, datasetId).input("userId", sql.BigInt, options.userId)
        .input("details", sql.NVarChar(1000), JSON.stringify({ purpose: "DISPLAY_COLUMN_OPTIONS_ONLY", columnCount: columns.length,
          definitionVersion: options.definitionVersion, configurationVersion: options.configurationVersion }))
        .query(`INSERT INTO uqp.AuditLog (EventType,EventCategory,IsImportant,UserId,DatasetId,Status,ParametersJson,CompletedAtUtc)
          VALUES ('DATASET_COLUMNS_SYNCHRONIZED','CONFIG',1,@userId,@datasetId,'SUCCESS',@details,SYSUTCDATETIME())`);
      await check();
      await tx.commit();
    } catch (error) {
      try { await tx.rollback(); } catch { /* Never return success on rollback failure. */ }
      if (error instanceof DatasetColumnSyncError) throw error;
      throw new DatasetColumnSyncError("DATASET_COLUMN_SYNC_FAILED");
    }
  } };
}
export const { syncDatasetColumns } = createDatasetColumnRepository();

export async function listDatasetColumns(datasetId: number, transaction?: sql.Transaction) {
  const request = transaction ? new sql.Request(transaction) : (await requirePool()).request();
  const result = await request
    .input("datasetId", sql.BigInt, datasetId)
    .query(`
      SELECT ColumnName, DataType, [Ordinal] AS Ordinal
      FROM uqp.DatasetColumn
      WHERE DatasetId=@datasetId
      ORDER BY [Ordinal]
    `);

  return result.recordset.map((row) => ({
    name: String(row.ColumnName),
    dataType: row.DataType == null ? null : String(row.DataType),
    ordinal: Number(row.Ordinal),
  }));
}
