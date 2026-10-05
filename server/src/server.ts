import { createServer } from "node:http";
import { app } from "./app.js";
import { closePlatformDbPool } from "./config/database.js";
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";

const server = createServer(app);

server.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, "Server started");
});

let shuttingDown = false;

const shutdown = async (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;

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
