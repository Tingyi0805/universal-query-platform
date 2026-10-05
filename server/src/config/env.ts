import "dotenv/config";
import { z } from "zod";

const optionalString = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().optional(),
);

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  CLIENT_ORIGIN: z.string().default("http://localhost:5173"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),

  PLATFORM_DB_SERVER: optionalString,
  PLATFORM_DB_DATABASE: optionalString,
  PLATFORM_DB_USER: optionalString,
  PLATFORM_DB_PASSWORD: optionalString,
  PLATFORM_DB_ENCRYPT: z.coerce.boolean().default(false),
  PLATFORM_DB_TRUST_SERVER_CERTIFICATE: z.coerce.boolean().default(true),

  JWT_SECRET: optionalString,
  JWT_EXPIRES_IN: z.string().default("8h"),
});

export const env = envSchema.parse(process.env);
