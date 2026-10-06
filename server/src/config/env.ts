import "dotenv/config";
import { z } from "zod";

const optionalString = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().optional(),
);

const envBoolean = (defaultValue: boolean) =>
  z.preprocess((value) => {
    if (value === undefined || value === null || value === "") return defaultValue;
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (normalized === "true" || normalized === "1" || normalized === "yes") return true;
      if (normalized === "false" || normalized === "0" || normalized === "no") return false;
    }
    return value;
  }, z.boolean());

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  CLIENT_ORIGIN: z.string().default("http://localhost:5173"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),

  PLATFORM_DB_SERVER: optionalString,
  PLATFORM_DB_DATABASE: optionalString,
  PLATFORM_DB_USER: optionalString,
  PLATFORM_DB_PASSWORD: optionalString,
  PLATFORM_DB_ENCRYPT: envBoolean(false),
  PLATFORM_DB_TRUST_SERVER_CERTIFICATE: envBoolean(true),

  JWT_SECRET: optionalString,
  JWT_EXPIRES_IN: z.string().default("8h"),
  BOOTSTRAP_ADMIN_TOKEN: optionalString,
  DATASOURCE_ENCRYPTION_KEY: optionalString,
});

export const env = envSchema.parse(process.env);
