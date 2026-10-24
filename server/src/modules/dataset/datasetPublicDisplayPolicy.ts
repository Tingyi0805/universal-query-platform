import type { DatasetSensitiveColumn } from "./datasetSensitiveColumn.repository.js";
import { assertDatasetSensitivityPolicy, type DeviceMaskMode } from "../dashboard/dashboardDeviceMasking.js";

/** Proposed Dataset-owned public display policy: explicit positive grants only.
 * This pure evaluator is intentionally NOT wired to playback until persistent
 * versioned confirmation and migration gates are implemented. */
export type PublicDisplayGrant = { columnName: string; permitted: boolean };
export type PublicDisplayPolicy = { confirmed: boolean; sensitivityVersion: number; grants: PublicDisplayGrant[] };
export function resolveDatasetPublicDisplayMasks(
  sensitivity: { version: number; columns: DatasetSensitiveColumn[] },
  publicPolicy: PublicDisplayPolicy | null | undefined,
  resultColumns: readonly string[],
): Record<string, DeviceMaskMode> {
  assertDatasetSensitivityPolicy(sensitivity);
  const result: Record<string, DeviceMaskMode> = {};
  // Reject ambiguous result aliases even before any approval can be evaluated.
  const aliases = resultColumns.map(name => name.toUpperCase());
  if (aliases.some(name => !name.trim()) || new Set(aliases).size !== aliases.length)
    throw new Error("DASHBOARD_COLUMNS_AMBIGUOUS");
  // Every sensitivity-policy edit invalidates older public display confirmations.
  if (!publicPolicy?.confirmed || publicPolicy.sensitivityVersion !== sensitivity.version || !Array.isArray(publicPolicy.grants)) return result;
  const grantNames = new Set<string>();
  for (const grant of publicPolicy.grants) {
    if (!grant || typeof grant.columnName !== "string" || !grant.columnName.trim() ||
      grant.columnName !== grant.columnName.trim() || typeof grant.permitted !== "boolean" ||
      grantNames.has(grant.columnName.toUpperCase())) return result;
    grantNames.add(grant.columnName.toUpperCase());
  }
  for (const name of resultColumns) {
    const grants = publicPolicy.grants.filter(g => g && typeof g.columnName === "string" && g.columnName.toUpperCase() === name.toUpperCase());
    const rules = sensitivity.columns.filter(r => r.columnName.toUpperCase() === name.toUpperCase());
    if (grants.length !== 1 || grants[0]!.permitted !== true || rules.length !== 1) continue;
    const rule = rules[0]!;
    if (rule.deviceMaskMode === "OMIT" || (rule.sensitivityType !== "OTHER" && rule.deviceMaskMode === "NONE")) continue;
    result[name] = rule.deviceMaskMode;
  }
  return result;
}
