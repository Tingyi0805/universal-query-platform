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


const manuallyVerifiableMigrations: Record<string, string> = {
  "900_dashboard_device_archive.sql": `
    SELECT CASE WHEN
      COL_LENGTH('uqp.DashboardDisplayDevice','ArchivedAtUtc') IS NOT NULL
      AND OBJECT_ID('uqp.DashboardDeviceArchivePolicy','U') IS NOT NULL
      AND OBJECT_ID('uqp.DashboardDeviceArchiveHistory','U') IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM sys.indexes
        WHERE object_id=OBJECT_ID('uqp.DashboardDisplayDevice')
          AND name='IX_DashboardDisplayDevice_ArchiveSweep'
      )
      AND EXISTS (
        SELECT 1 FROM sys.indexes
        WHERE object_id=OBJECT_ID('uqp.DashboardDeviceArchiveHistory')
          AND name='IX_DashboardDeviceArchiveHistory_Dashboard'
      )
      AND EXISTS (
        SELECT 1 FROM sys.check_constraints
        WHERE parent_object_id=OBJECT_ID('uqp.DashboardDeviceArchivePolicy')
          AND name='CK_DashboardDeviceArchivePolicy_Days'
      )
      AND EXISTS (
        SELECT 1 FROM sys.check_constraints
        WHERE parent_object_id=OBJECT_ID('uqp.DashboardDeviceArchiveHistory')
          AND name='CK_DashboardDeviceArchiveHistory_Mode'
      )
      AND EXISTS (
        SELECT 1 FROM sys.foreign_keys
        WHERE parent_object_id=OBJECT_ID('uqp.DashboardDeviceArchivePolicy')
          AND referenced_object_id=OBJECT_ID('uqp.Dashboard')
      )
    THEN 1 ELSE 0 END AS IsComplete
  `,
};

async function isManuallyComplete(pool: sql.ConnectionPool, file: string): Promise<boolean | null> {
  const query = manuallyVerifiableMigrations[file];
  if (!query) return null;
  const result = await pool.request().query(query);
  return result.recordset[0]?.IsComplete === 1;
}

/** Strictly scoped range for the reviewed 915 -> 919 upgrade. Never defaults to execute. */
export function resolveMigrationScope(args: string[], files: string[], applied: Set<string>) {
  if (args[0] !== "apply-range") return null;
  if (args.length !== 3 || args[1] !== "916" || args[2] !== "919")
    throw new Error("MIGRATION_RANGE_NOT_APPROVED");
  const expected = [
    "916_workstation_management.sql",
    "917_dashboard_query_source_model.sql",
    "918_dashboard_query_playback_mode.sql",
    "919_dashboard_dataset_security_contract.sql",
  ];
  if (expected.some(file => !files.includes(file) || applied.has(file)))
    throw new Error("MIGRATION_RANGE_FILES_OR_LEDGER_MISMATCH");
  const outside = files.filter(file => !expected.includes(file) && !applied.has(file));
  if (outside.length || applied.size !== files.length - expected.length ||
      [...applied].some(file => !files.includes(file)))
    throw new Error("MIGRATION_BASELINE_NOT_EXACT_915");
  return new Set(expected);
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

  const args = process.argv.slice(2);
  const command = args[0] ?? "apply";
  const scope = resolveMigrationScope(args, files, applied);
  if (!["apply", "status", "adopt", "apply-range"].includes(command)) throw new Error("Usage: db:migrate [status | adopt <exact-migration-file>]");
  if (command === "adopt" && (args.length !== 2 || !files.includes(args[1]!))) throw new Error("Specify an existing migration filename for adoption.");
  if (command !== "adopt" && command !== "apply-range" && args.length > (command === "apply" ? 0 : 1)) throw new Error("Unexpected migration arguments.");

  for (const file of files) {
    if (scope && !scope.has(file)) continue;
    if (command === "adopt" && file !== args[1]) continue;
    if (command === "status") {
      const verified = applied.has(file) ? null : await isManuallyComplete(pool, file);
      logger.info({ migration: file, state: applied.has(file) ? "RECORDED" : verified === true ? "MANUALLY_APPLIED_UNRECORDED" : verified === false ? "NOT_COMPLETE" : "UNRECORDED_REQUIRES_REVIEW" }, "Migration status");
      continue;
    }
    if (applied.has(file)) {
      logger.info({ migration: file }, "Migration already applied");
      continue;
    }

    if (command === "adopt") {
      const complete = await isManuallyComplete(pool, file);
      if (complete !== true) throw new Error(`Cannot adopt ${file}: full schema verification is unavailable or incomplete.`);
      await pool.request().input("fileName", sql.NVarChar(255), file).query("INSERT INTO uqp.SchemaMigration (FileName) VALUES (@fileName)");
      logger.info({ migration: file }, "Verified manually applied migration recorded");
      continue;
    }
    const complete = await isManuallyComplete(pool, file);
    if (complete === true) throw new Error(`Migration ${file} appears manually applied but is not recorded. Run db:migrate:status, then db:migrate:adopt -- ${file} after reviewing the schema.`);
    if (complete === false && file in manuallyVerifiableMigrations) {
      logger.info({ migration: file }, "Schema not complete; normal migration will run (may require manual reconciliation if partially applied)");
    }
    const script = await readFile(path.join(migrationsDir, file), "utf8");
    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
      const batches = splitBatches(script);

      for (let index = 0; index < batches.length; index += 1) {
        try {
          await new sql.Request(transaction).batch(batches[index]!);
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
