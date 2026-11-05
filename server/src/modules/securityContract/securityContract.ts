/** Stage 1 primitives only. No route, flag, migration runner or database connection. */
export type SecurityContractCode = "SECURITY_SCHEMA_REQUIRED" | "SECURITY_VERSION_INVALID" | "SECURITY_VERSION_EXHAUSTED";

export class SecurityContractError extends Error {
  readonly status: number;
  constructor(readonly code: SecurityContractCode) {
    super(code);
    this.name = "SecurityContractError";
    this.status = code === "SECURITY_SCHEMA_REQUIRED" ? 503 : code === "SECURITY_VERSION_EXHAUSTED" ? 409 : 400;
  }
}

export const MAX_CONFIGURATION_VERSION = 9223372036854775807n;
export function parseConfigurationVersion(value: unknown, allowUnconfigured = true): bigint {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,18})$(?![\s\S])/.test(value))
    throw new SecurityContractError("SECURITY_VERSION_INVALID");
  const version = BigInt(value);
  if (version > MAX_CONFIGURATION_VERSION || (!allowUnconfigured && version === 0n))
    throw new SecurityContractError("SECURITY_VERSION_INVALID");
  return version;
}

export function nextConfigurationVersion(value: unknown): string {
  const version = parseConfigurationVersion(value);
  if (version === MAX_CONFIGURATION_VERSION) throw new SecurityContractError("SECURITY_VERSION_EXHAUSTED");
  return String(version + 1n);
}

export function parseApprovalVersion(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$(?![\s\S])/.test(value))
    throw new SecurityContractError("SECURITY_VERSION_INVALID");
  return value;
}

/** Evidence must be obtained from catalog inspection, never a feature flag or migration filename.
 * This is not a catalog probe. Stage 2 must supply current evidence in its transaction.
 */
export const securitySchemaRequirements = [
  "prerequisites", "configurationVersion", "configurationDefault", "configurationCheck",
  "dashboardRowVersion", "sourceRowVersion", "metadataColumns", "metadataPrimaryKey",
  "metadataForeignKey", "metadataJsonCheck", "trustedConstraints",
] as const;
export type SecuritySchemaEvidence = Partial<Record<typeof securitySchemaRequirements[number], boolean>>;
export function assertSecuritySchema(evidence: SecuritySchemaEvidence | null | undefined): void {
  if (!securitySchemaRequirements.every(key => evidence?.[key] === true))
    throw new SecurityContractError("SECURITY_SCHEMA_REQUIRED");
}
