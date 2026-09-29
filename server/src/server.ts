import { createServer } from "node:http";
import { app } from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";

const server = createServer(app);

server.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, "Server started");
});

const shutdown = (signal: string) => {
  logger.info({ signal }, "Shutdown requested");

  server.close((error) => {
    if (error) {
      logger.error({ err: error }, "Graceful shutdown failed");
      process.exit(1);
    }

    logger.info("Server stopped");
    process.exit(0);
  });

  setTimeout(() => {
    logger.error("Forced shutdown after timeout");
    process.exit(1);
  }, 10_000).unref();
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
