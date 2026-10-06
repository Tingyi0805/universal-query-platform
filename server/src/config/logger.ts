import pino from "pino";
import { env } from "./env.js";

export const logger = pino({
  level: env.LOG_LEVEL,
  base: {
    service: "universal-query-platform-server",
    environment: env.NODE_ENV,
  },
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "res.headers.set-cookie",
      "password",
      "currentPassword",
      "newPassword",
      "confirmPassword",
      "*.password",
      "*.currentPassword",
      "*.newPassword",
      "*.confirmPassword",
      "odbcConnectionString",
      "*.odbcConnectionString",
      "connectionString",
      "*.connectionString",
    ],
    censor: "[REDACTED]",
  },
});
