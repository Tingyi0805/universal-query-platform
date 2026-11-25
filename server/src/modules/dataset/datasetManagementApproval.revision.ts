/** SQL Server ROWVERSION is an 8-byte native binary value.
 * Read the Buffer from mssql/Tedious, never roundtrip it through VARCHAR.
 * All unknown shapes remain rejected; no string/number fallback. */
export function decodeDatasetApprovalRevision(value: unknown): string | null {
  if (!Buffer.isBuffer(value) || value.length !== 8) return null;
  return value.toString("hex");
}
