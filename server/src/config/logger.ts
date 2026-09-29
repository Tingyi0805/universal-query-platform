import pino from "pino";
import { env } from "./env.js";

export const logger = pino({
  level: env.LOG_LEVEL,
  base: {
    service: "universal-query-platform-server",
    environment: env.NODE_ENV,
  },
});
