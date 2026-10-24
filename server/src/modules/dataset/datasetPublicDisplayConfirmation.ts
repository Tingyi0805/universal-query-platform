import { createHash } from "node:crypto";
import type { DatasetSensitiveColumn } from "./datasetSensitiveColumn.repository.js";
import { assertDatasetSensitivityPolicy } from "../dashboard/dashboardDeviceMasking.js";
import {validPublicDisplayGrants, type PublicDisplayGrant, type PublicDisplayPolicy } from "./datasetPublicDisplayPolicy.js";

/** Pure, fail-closed write contract. Persistence/API must provide locked current
 * sensitivity revision and the last confirmed digest in the same transaction. */
export class PublicDisplayConfirmationError extends Error {
  constructor(readonly code: string) { super(code); }
}
export function publicDisplayDigest(policy: PublicDisplayPolicy | null): string | null {
  if (!policy) return null;
  return createHash("sha256").update(JSON.stringify([policy.confirmed, policy.sensitivityVersion,
    [...policy.grants].sort((a, b) => a.columnName.localeCompare(b.columnName)).map(g => [g.columnName, g.permitted])])).digest("hex");
}
export function confirmDatasetPublicDisplay(
  sensitivity: { version: number; columns: DatasetSensitiveColumn[] },
  previous: PublicDisplayPolicy | null,
  input: { expectedSensitivityVersion: number; expectedPolicyDigest: string | null; grants: PublicDisplayGrant[] },
): PublicDisplayPolicy {
  assertDatasetSensitivityPolicy(sensitivity);
  if (sensitivity.version !== input.expectedSensitivityVersion)
    throw new PublicDisplayConfirmationError("PUBLIC_DISPLAY_SENSITIVITY_VERSION_CONFLICT");
  if (publicDisplayDigest(previous) !== input.expectedPolicyDigest)
    throw new PublicDisplayConfirmationError("PUBLIC_DISPLAY_VERSION_CONFLICT");
  if (!validPublicDisplayGrants(input.grants) || sensitivity.version<1)
    throw new PublicDisplayConfirmationError("PUBLIC_DISPLAY_GRANTS_INVALID");
  const seen = new Set<string>();
  for (const grant of input.grants) {
    if (!grant || typeof grant.columnName !== "string" || !grant.columnName.trim() ||
      grant.columnName !== grant.columnName.trim() || grant.columnName.length > 256 ||
      typeof grant.permitted !== "boolean" || seen.has(grant.columnName.toUpperCase()))
      throw new PublicDisplayConfirmationError("PUBLIC_DISPLAY_GRANTS_INVALID");
    seen.add(grant.columnName.toUpperCase());
    const matches = sensitivity.columns.filter(rule => rule.columnName.toUpperCase() === grant.columnName.toUpperCase());
    if (matches.length !== 1 || (grant.permitted && (matches[0]!.deviceMaskMode === "OMIT" ||
      matches[0]!.sensitivityType !== "OTHER" && matches[0]!.deviceMaskMode === "NONE")))
      throw new PublicDisplayConfirmationError("PUBLIC_DISPLAY_POLICY_DENIED");
  }
  // Preserve an explicit negative decision and never auto-approve missing columns.
  return { confirmed: true, sensitivityVersion: sensitivity.version,
    grants: input.grants.map(g => ({ columnName: g.columnName, permitted: g.permitted })) };
}
