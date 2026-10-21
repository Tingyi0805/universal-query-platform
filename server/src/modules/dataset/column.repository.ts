import sql from "mssql";
import { getPlatformDbPool } from "../../config/database.js";
import type { QueryColumn } from "../../query/query.types.js";

async function requirePool() {
  const pool = await getPlatformDbPool();
  if (!pool) throw new Error("PLATFORM_DB_NOT_CONFIGURED");
  return pool;
}

export async function syncDatasetColumns(datasetId: number, columns: QueryColumn[]): Promise<void> {
  const pool = await requirePool();
  const tx = new sql.Transaction(pool);
  await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

  try {
    // Serialize metadata refresh against sensitivity-rule edits. Do not silently
    // orphan protections when a SQL alias disappears or is renamed.
    await new sql.Request(tx).input("datasetId", sql.BigInt, datasetId)
      .query("SELECT Id FROM uqp.Dataset WITH (UPDLOCK, HOLDLOCK) WHERE Id=@datasetId");
    const rules = await new sql.Request(tx).input("datasetId", sql.BigInt, datasetId)
      .query("SELECT ColumnName FROM uqp.DatasetSensitiveColumn WITH (HOLDLOCK) WHERE DatasetId=@datasetId");
    const nextNames = new Set(columns.map((column) => column.name.toUpperCase()));
    if (rules.recordset.some((rule) => !nextNames.has(String(rule.ColumnName).toUpperCase()))) {
      throw new Error("DATASET_SENSITIVITY_COLUMNS_STALE");
    }
    await new sql.Request(tx)
      .input("datasetId", sql.BigInt, datasetId)
      .query("DELETE FROM uqp.DatasetColumn WHERE DatasetId=@datasetId");

    for (let index = 0; index < columns.length; index += 1) {
      const column = columns[index]!;
      await new sql.Request(tx)
        .input("datasetId", sql.BigInt, datasetId)
        .input("columnName", sql.NVarChar(256), column.name)
        .input("dataType", sql.NVarChar(100), column.dataType ?? null)
        .input("ordinal", sql.Int, index)
        .query(`
          INSERT INTO uqp.DatasetColumn (DatasetId, ColumnName, DataType, [Ordinal])
          VALUES (@datasetId,@columnName,@dataType,@ordinal)
        `);
    }

    await tx.commit();
  } catch (error) {
    await tx.rollback();
    throw error;
  }
}

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
