import { createServer } from "node:http";
import { app } from "./app.js";
import { closePlatformDbPool } from "./config/database.js";
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { autoArchiveDashboardDevices } from "./modules/dashboard/dashboardDevice.repository.js";

const server = createServer(app);

server.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, "Server started");
});

// Hourly, idempotent, database-backed sweep. Never deletes device or audit records.
let archiveSweepRunning = false;
const archiveTimer = setInterval(async () => {
  if (archiveSweepRunning || shuttingDown) return;
  archiveSweepRunning = true;
  try {
    const archivedCount = await autoArchiveDashboardDevices();
    if (archivedCount > 0) logger.info({ archivedCount }, "Dashboard devices auto-archived");
  } catch (error) {
    logger.warn({ err: error }, "Dashboard device archive sweep skipped (check migrations/database)");
  } finally { archiveSweepRunning = false; }
}, 60 * 60 * 1000);
archiveTimer.unref();

let shuttingDown = false;

const shutdown = async (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(archiveTimer);

  logger.info({ signal }, "Shutdown requested");

  const forceTimer = setTimeout(() => {
    logger.error("Forced shutdown after timeout");
    process.exit(1);
  }, 10_000);
  forceTimer.unref();

  server.close(async (error) => {
    if (error) {
      logger.error({ err: error }, "HTTP server shutdown failed");
      process.exit(1);
    }

    try {
      await closePlatformDbPool();
      clearTimeout(forceTimer);
      logger.info("Server stopped");
      process.exit(0);
    } catch (dbError) {
      logger.error({ err: dbError }, "Database shutdown failed");
      process.exit(1);
    }
  });
};

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
