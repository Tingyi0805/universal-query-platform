import type { DatasetSensitiveColumn } from "./datasetSensitiveColumn.repository.js";
import { assertDatasetSensitivityPolicy, type DeviceMaskMode } from "../dashboard/dashboardDeviceMasking.js";

/** Proposed Dataset-owned public display policy: explicit positive grants only.
 * This pure evaluator is intentionally NOT wired to playback until persistent
 * versioned confirmation and migration gates are implemented. */
export type PublicDisplayGrant = { columnName: string; permitted: boolean };
export type PublicDisplayPolicy = { confirmed: boolean; grants: PublicDisplayGrant[] };
export function resolveDatasetPublicDisplayMasks(
  sensitivity: { version: number; columns: DatasetSensitiveColumn[] },
  publicPolicy: PublicDisplayPolicy | null | undefined,
  resultColumns: readonly string[],
): Record<string, DeviceMaskMode> {
  assertDatasetSensitivityPolicy(sensitivity);
  const result: Record<string, DeviceMaskMode> = {};
  if (!publicPolicy?.confirmed || !Array.isArray(publicPolicy.grants)) return result;
  const seen = new Set<string>();
  for (const name of resultColumns) {
    const normalized = name.toUpperCase();
    if (seen.has(normalized)) throw new Error("DASHBOARD_COLUMNS_AMBIGUOUS");
    seen.add(normalized);
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
