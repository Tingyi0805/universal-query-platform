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
  await tx.begin();

  try {
    await new sql.Request(tx)
      .input("datasetId", sql.BigInt, datasetId)
      .query("DELETE FROM uqp.DatasetColumn WHERE DatasetId=@datasetId");

    for (let index = 0; index < columns.length; index += 1) {
      const column = columns[index];
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

export async function listDatasetColumns(datasetId: number) {
  const pool = await requirePool();
  const result = await pool.request()
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
