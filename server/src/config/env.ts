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
  PLATFORM_TIME_ZONE: z.string().default("Asia/Taipei"),

  TRUST_PROXY_ENABLED: envBoolean(false),
  TRUST_PROXY_ADDRESSES: z.string().default("127.0.0.1,::1"),
  CLIENT_IP_DIAGNOSTICS: envBoolean(false),

  PLATFORM_DB_SERVER: optionalString,
  PLATFORM_DB_PORT: z.coerce.number().int().min(1).max(65535).default(1433),
  PLATFORM_DB_DATABASE: optionalString,
  PLATFORM_DB_USER: optionalString,
  PLATFORM_DB_PASSWORD: optionalString,
  PLATFORM_DB_ENCRYPT: envBoolean(false),
  PLATFORM_DB_TRUST_SERVER_CERTIFICATE: envBoolean(true),

  JWT_SECRET: optionalString,
  JWT_EXPIRES_IN: z.string().default("8h"),
  BOOTSTRAP_ADMIN_TOKEN: optionalString,
  DATASOURCE_ENCRYPTION_KEY: optionalString,
  ORACLE_DRIVER_MODE: z.enum(["THIN", "THICK"]).default("THIN"),
  ORACLE_CLIENT_LIB_DIR: optionalString,
});

const parsedEnv = envSchema.parse(process.env);

export const env = {
  ...parsedEnv,
  CLIENT_ORIGINS: parsedEnv.CLIENT_ORIGIN
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  TRUSTED_PROXY_ADDRESSES: parsedEnv.TRUST_PROXY_ADDRESSES
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
};
