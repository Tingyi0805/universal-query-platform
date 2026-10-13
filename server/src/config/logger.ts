import pino from "pino";
import { env } from "./env.js";

export const loggerOptions = {
  level: env.LOG_LEVEL,
  base: {
    service: "universal-query-platform-server",
    environment: env.NODE_ENV,
  },
  redact: {
    paths: [
      "req.headers.authorization",
      'req.headers["x-dashboard-device-token"]',
      'req.headers["x-workstation-credential"]',
      "req.headers.cookie",
      "res.headers.set-cookie",
      "pin",
      "*.pin",
      "token",
      "*.token",
      "secret",
      "*.secret",
      "pinHash", "*.pinHash", "passwordHash", "*.passwordHash",
      "secretHash", "*.secretHash", "tokenHash", "*.tokenHash",
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
};

export const logger = pino(loggerOptions);
