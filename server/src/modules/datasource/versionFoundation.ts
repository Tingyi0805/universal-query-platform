import sql from "mssql";
import { getPlatformDbPool } from "../../config/database.js";

export type FoundationErrorCode = "VERSION_FOUNDATION_INVALID_INPUT" | "VERSION_FOUNDATION_SCHEMA_REQUIRED"
  | "VERSION_FOUNDATION_UNAVAILABLE" | "VERSION_FOUNDATION_SOURCE_INVALID" | "VERSION_FOUNDATION_DATASET_INVALID"
  | "VERSION_FOUNDATION_CONFLICT" | "NATIVE_PARAMETER_CONTRACT_MISSING" | "NATIVE_PARAMETER_CONTRACT_UNCONFIRMED"
  | "NATIVE_PARAMETER_CONTRACT_INVALID" | "NATIVE_PARAMETER_ORACLE_UNSUPPORTED";
export class VersionFoundationError extends Error {
  constructor(readonly code: FoundationErrorCode) { super(code); this.name = "VersionFoundationError"; }
}

export function evidenceId(value: string | bigint): string {
  if ((typeof value !== "string" && typeof value !== "bigint") || !/^[1-9][0-9]{0,18}$/.test(String(value))
    || BigInt(value) > 9223372036854775807n) throw new VersionFoundationError("VERSION_FOUNDATION_INVALID_INPUT");
  return String(value);
}
export function expectedRowVersion(value: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{16}$/.test(value)) throw new VersionFoundationError("VERSION_FOUNDATION_INVALID_INPUT");
  return value;
}
export function rowVersion(value: unknown): string {
  if (!Buffer.isBuffer(value) || value.length !== 8) throw new VersionFoundationError("VERSION_FOUNDATION_SCHEMA_REQUIRED");
  return value.toString("hex");
}
export type VersionRepositoryDependencies = {
  getPool: typeof getPlatformDbPool;
  createTransaction: (pool: sql.ConnectionPool) => sql.Transaction;
  createRequest: (tx: sql.Transaction) => sql.Request;
};
export const versionRepositoryDependencies: VersionRepositoryDependencies = {
  getPool: getPlatformDbPool, createTransaction: pool => new sql.Transaction(pool), createRequest: tx => new sql.Request(tx),
};
export async function versionTransaction<T>(deps: VersionRepositoryDependencies, outer: sql.Transaction | undefined,
  read: (tx: sql.Transaction) => Promise<T>): Promise<T> {
  let tx: sql.Transaction | undefined;
  let begun = false;
  try {
    if (outer) tx = outer;
    else {
      const pool = await deps.getPool();
      if (!pool) throw new VersionFoundationError("VERSION_FOUNDATION_UNAVAILABLE");
      tx = deps.createTransaction(pool);
      await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE); begun = true;
    }
    await deps.createRequest(tx).query(`IF @@TRANCOUNT=0 OR XACT_STATE()<>1
      THROW 51921, 'VERSION_FOUNDATION_TRANSACTION_REQUIRED', 1;
      SET XACT_ABORT ON;`);
    const result = await read(tx);
    if (!outer) await tx.commit();
    return result;
  } catch (error) {
    if (begun && tx) await tx.rollback().catch(() => undefined);
    if (error instanceof VersionFoundationError) throw error;
    // Never attach a raw driver cause, SQL, configuration or credential values.
    throw new VersionFoundationError("VERSION_FOUNDATION_UNAVAILABLE");
  }
}
