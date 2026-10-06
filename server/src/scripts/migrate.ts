import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sql from "mssql";
import { getPlatformDbPool, closePlatformDbPool } from "../config/database.js";
import { logger } from "../config/logger.js";

const migrationsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../database/migrations",
);

function splitBatches(script: string): string[] {
  return script
    .split(/^\s*GO\s*$/gim)
    .map((batch) => batch.trim())
    .filter(Boolean);
}

async function main() {
  const pool = await getPlatformDbPool();
  if (!pool) throw new Error("Platform SQL Server is not configured.");

  await pool.request().batch(`
    IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = 'uqp')
      EXEC('CREATE SCHEMA uqp');

    IF OBJECT_ID('uqp.SchemaMigration', 'U') IS NULL
    BEGIN
      CREATE TABLE uqp.SchemaMigration (
        FileName NVARCHAR(255) NOT NULL PRIMARY KEY,
        AppliedAtUtc DATETIME2(0) NOT NULL DEFAULT SYSUTCDATETIME()
      );
    END
  `);

  const files = (await readdir(migrationsDir))
    .filter((file) => /^\d+_.*\.sql$/i.test(file))
    .sort((a, b) => a.localeCompare(b));

  const appliedResult = await pool.request().query(
    "SELECT FileName FROM uqp.SchemaMigration",
  );
  const applied = new Set(appliedResult.recordset.map((row) => String(row.FileName)));

  for (const file of files) {
    if (applied.has(file)) {
      logger.info({ migration: file }, "Migration already applied");
      continue;
    }

    const script = await readFile(path.join(migrationsDir, file), "utf8");
    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
      const batches = splitBatches(script);

      for (let index = 0; index < batches.length; index += 1) {
        try {
          await new sql.Request(transaction).batch(batches[index]);
        } catch (error) {
          logger.error(
            { err: error, migration: file, batch: index + 1, batchCount: batches.length },
            "Migration batch failed",
          );
          throw error;
        }
      }

      await new sql.Request(transaction)
        .input("fileName", sql.NVarChar(255), file)
        .query("INSERT INTO uqp.SchemaMigration (FileName) VALUES (@fileName)");

      await transaction.commit();
      logger.info({ migration: file }, "Migration applied");
    } catch (error) {
      logger.error({ err: error, migration: file }, "Migration failed");

      try {
        await transaction.rollback();
      } catch (rollbackError) {
        logger.warn(
          { err: rollbackError, migration: file },
          "Migration rollback was not required or could not be completed",
        );
      }

      throw error;
    }
  }

  logger.info("Database migrations completed");
}

main()
  .then(async () => {
    await closePlatformDbPool();
    process.exit(0);
  })
  .catch(async (error) => {
    logger.error({ err: error }, "Database migration process failed");
    await closePlatformDbPool().catch(() => undefined);
    process.exit(1);
  });
