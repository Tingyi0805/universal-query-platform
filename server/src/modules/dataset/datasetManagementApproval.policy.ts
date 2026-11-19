import { assertDatasetSensitivityPolicy } from "../dashboard/dashboardDeviceMasking.js";
import type { DatasetSensitiveColumn } from "./datasetSensitiveColumn.repository.js";
import type { PublicDisplayGrant } from "./datasetPublicDisplayPolicy.js";

/** Never infer that a newly discovered column is safe. Only previously reviewed
 * sensitivity rows may produce public grants; all other output stays denied. */
export function managerPlaybackGrants(
  sensitivity: { version: number; columns: DatasetSensitiveColumn[] },
  approve: boolean,
): PublicDisplayGrant[] {
  if (!Number.isSafeInteger(sensitivity.version) || sensitivity.version < 1) {
    throw new Error("MANAGER_APPROVAL_SENSITIVITY_REQUIRED");
  }
  assertDatasetSensitivityPolicy(sensitivity);
  if (!sensitivity.columns.length || sensitivity.columns.length > 300) {
    throw new Error("MANAGER_APPROVAL_SENSITIVITY_REQUIRED");
  }
  const grants = sensitivity.columns.map(rule => ({
    columnName: rule.columnName,
    permitted: approve && (
      rule.deviceMaskMode === "FULL" ||
      rule.deviceMaskMode === "CUSTOM" ||
      (rule.deviceMaskMode === "NONE" && rule.sensitivityType === "OTHER")
    ),
  }));
  if (approve && !grants.some(g => g.permitted)) {
    throw new Error("MANAGER_APPROVAL_NO_SAFE_VISIBLE_COLUMNS");
  }
  return grants;
}
