import sql from "mssql";
import { env } from "./env.js";
import { logger } from "./logger.js";

let pool: sql.ConnectionPool | null = null;

export const isPlatformDbConfigured = () =>
  Boolean(env.PLATFORM_DB_SERVER && env.PLATFORM_DB_DATABASE && env.PLATFORM_DB_USER && env.PLATFORM_DB_PASSWORD);

export async function getPlatformDbPool(): Promise<sql.ConnectionPool | null> {
  if (!isPlatformDbConfigured()) return null;
  if (pool?.connected) return pool;

  pool = await new sql.ConnectionPool({
    server: env.PLATFORM_DB_SERVER!,
    port: env.PLATFORM_DB_PORT,
    database: env.PLATFORM_DB_DATABASE!,
    user: env.PLATFORM_DB_USER!,
    password: env.PLATFORM_DB_PASSWORD!,
    options: {
      encrypt: env.PLATFORM_DB_ENCRYPT,
      trustServerCertificate: env.PLATFORM_DB_TRUST_SERVER_CERTIFICATE,
    },
    pool: { min: 0, max: 10, idleTimeoutMillis: 30_000 },
  }).connect();

  logger.info("Platform SQL Server pool connected");
  return pool;
}

export async function closePlatformDbPool() {
  if (!pool) return;
  await pool.close();
  pool = null;
}
