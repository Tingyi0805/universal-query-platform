import {
  maskDeviceValue,
  type CustomMaskConfig,
  type DashboardMaskMode,
  type DeviceMaskMode,
} from "../dashboard/dashboardDeviceMasking.js";
import { parseApprovalVersion, parseConfigurationVersion } from "../securityContract/securityContract.js";
import {
  applyDatasetDeliveryPolicy,
  type DatasetDeliveryRule,
} from "./datasetDeliveryPolicy.js";

export type LegacyDatasetMaskRule = Readonly<{
  columnName: string;
  sensitivityType: string;
  mode: DeviceMaskMode | string;
  customMask?: CustomMaskConfig | null;
}>;

export type LegacyDashboardMaskRule = Readonly<{
  sourceKey: string;
  columnName: string;
  mode: DashboardMaskMode | string;
  customMask?: CustomMaskConfig | null;
}>;

export type LegacyDashboardMaskPolicy = Readonly<{
  dashboardId: number;
  version: string;
  expectedVersion: string;
  rules: readonly LegacyDashboardMaskRule[];
}>;

export type ConvertedDatasetMaskRule = Readonly<{
  columnName: string;
  sensitivityType: string;
  mode: "CUSTOM" | "OMIT";
  customMask?: CustomMaskConfig;
}>;

export type LegacyMaskConversionImpact = Readonly<{
  columnName: string;
  sensitivityType: string;
  fromMode: DeviceMaskMode;
  toMode: "CUSTOM" | "OMIT" | "UNSET";
  protection: "EQUIVALENT" | "STRONGER";
  proof: "SYNTHETIC_EDGE_CASES_AND_DISCLOSURE_BOUNDS";
}>;

export type DashboardMaskConversionBlocker = Readonly<{
  dashboardId: number;
  sourceKey: string;
  columnName: string;
  dashboardMode: DashboardMaskMode;
  reason: "DASHBOARD_POLICY_STRONGER";
}>;

export type LegacyMaskConversionResult = Readonly<{
  status: "READY" | "BLOCKED";
  sourceVersion: string;
  convertedRules: readonly ConvertedDatasetMaskRule[] | null;
  impacts: readonly LegacyMaskConversionImpact[];
  blockers: readonly DashboardMaskConversionBlocker[];
}>;

export type LegacyMaskConversionErrorCode =
  | "DATASET_LEGACY_POLICY_INVALID"
  | "DATASET_LEGACY_POLICY_VERSION_CONFLICT"
  | "DATASET_LEGACY_PROTECTION_PROOF_FAILED";

/** The message is intentionally a stable code and never contains rule values or row data. */
export class LegacyMaskConversionError extends Error {
  constructor(public readonly code: LegacyMaskConversionErrorCode) {
    super(code);
    this.name = "LegacyMaskConversionError";
  }
}

type ConvertedAction = Readonly<{
  mode: "CUSTOM" | "OMIT" | "UNSET";
  customMask?: CustomMaskConfig;
}>;

const datasetModes = new Set<string>(["NONE", "NAME", "MRN", "PHONE", "GENERIC", "FULL", "OMIT", "CUSTOM"]);
const dashboardModes = new Set<string>([...datasetModes, "INHERIT"]);

function fail(code: LegacyMaskConversionErrorCode): never {
  throw new LegacyMaskConversionError(code);
}

function canonicalColumnName(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 256) {
    fail("DATASET_LEGACY_POLICY_INVALID");
  }
  return value.toUpperCase();
}

function validSensitivityType(value: unknown): value is string {
  return typeof value === "string" && /^[A-Z0-9_]{1,64}$/u.test(value);
}

function validCustomMask(value: unknown): value is CustomMaskConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const config = value as Partial<CustomMaskConfig>;
  // This legacy conversion proof covers retention only, never new range rules.
  if (config.start !== undefined || config.end !== undefined) return false;
  return Number.isInteger(config.prefix) && Number.isInteger(config.suffix)
    && Number(config.prefix) >= 0 && Number(config.prefix) <= 100
    && Number(config.suffix) >= 0 && Number(config.suffix) <= 100
    && typeof config.symbol === "string" && Array.from(config.symbol).length === 1
    && !/[\r\n\t]/u.test(config.symbol);
}

function assertNoUnexpectedCustom(mode: string, customMask: unknown): void {
  if (mode === "CUSTOM" ? !validCustomMask(customMask) : customMask != null) {
    fail("DATASET_LEGACY_POLICY_INVALID");
  }
}

/**
 * Legacy MRN/PHONE slice UTF-16 code units and completely mask short values.
 * No single Unicode-aware CUSTOM configuration can preserve both guarantees,
 * so those modes conservatively become OMIT. GENERIC becomes a zero-disclosure
 * CUSTOM mask and therefore does not expose surrogate pairs.
 */
function convertMode(mode: DeviceMaskMode, customMask: CustomMaskConfig | null | undefined): ConvertedAction {
  if (mode === "NONE") return { mode: "UNSET" };
  if (mode === "OMIT" || mode === "FULL") return { mode: "OMIT" };
  if (mode === "CUSTOM") return { mode: "CUSTOM", customMask: { ...customMask! } };
  if (mode === "NAME") return { mode: "CUSTOM", customMask: { prefix: 1, suffix: 1, symbol: "○" } };
  if (mode === "MRN" || mode === "PHONE") return { mode: "OMIT" };
  return { mode: "CUSTOM", customMask: { prefix: 0, suffix: 0, symbol: "○" } };
}

function convertedValue(value: unknown, action: ConvertedAction): unknown {
  if (action.mode === "UNSET") return value;
  return maskDeviceValue(value, action.mode, action.customMask);
}

function proofValues(symbols: readonly string[]): readonly unknown[] {
  const excluded = new Set(symbols);
  const candidates = [
    "", "A", "AB", "ABC", "ABCD", "ABCDE", "ABCDEFGH",
    "甲", "甲乙", "甲乙丙", "甲乙丙丁戊",
    "😀", "😀🧪", "😀🧪🌐", "😀🧪🌐🚀🧭",
    "!@#", "!@#$%^&*", null,
  ];
  return candidates.filter((value) => value == null
    || !Array.from(String(value)).some((character) => excluded.has(character)));
}

function visibleSourceCharacters(source: string, output: unknown): Set<string> {
  if (typeof output !== "string") return new Set();
  return new Set(Array.from(source).filter((character) => output.includes(character)));
}

function assertSyntheticProof(oldMode: DeviceMaskMode, oldCustom: CustomMaskConfig | null | undefined, action: ConvertedAction): void {
  const symbols = ["○", oldCustom?.symbol, action.customMask?.symbol].filter((value): value is string => !!value);
  for (const value of proofValues(symbols)) {
    const oldOutput = maskDeviceValue(value, oldMode, oldCustom);
    const newOutput = convertedValue(value, action);
    if (oldOutput === undefined && newOutput !== undefined) fail("DATASET_LEGACY_PROTECTION_PROOF_FAILED");
    if (oldMode === "FULL" && newOutput !== undefined) fail("DATASET_LEGACY_PROTECTION_PROOF_FAILED");
    if (typeof value === "string") {
      const oldVisible = visibleSourceCharacters(value, oldOutput);
      const newlyVisible = [...visibleSourceCharacters(value, newOutput)].some((character) => !oldVisible.has(character));
      if (newlyVisible) fail("DATASET_LEGACY_PROTECTION_PROOF_FAILED");
    }
  }
}

function actionNoWeakerThan(action: ConvertedAction, dashboardMode: DashboardMaskMode,
  dashboardCustom: CustomMaskConfig | null | undefined): boolean {
  if (action.mode === "OMIT") return true;
  if (dashboardMode === "INHERIT" || dashboardMode === "NONE") return true;
  if (dashboardMode === "OMIT" || dashboardMode === "FULL" || action.mode === "UNSET") return false;
  const target = action.customMask!;
  // A zero-retention CUSTOM reveals no source character under any string length.
  if (target.prefix === 0 && target.suffix === 0) return true;
  if (dashboardMode === "CUSTOM") {
    return target.prefix === dashboardCustom!.prefix && target.suffix === dashboardCustom!.suffix
      && target.symbol === dashboardCustom!.symbol;
  }
  // Legacy NAME is Unicode-aware: prefix-only is stricter, and 1/1 is its
  // conservative equivalent. A suffix without the prefix would reveal a new
  // character for two-character values.
  if (dashboardMode === "NAME") {
    return target.prefix <= 1 && target.suffix <= 1 && (target.suffix === 0 || target.prefix === 1);
  }
  // MRN, PHONE and GENERIC use UTF-16 slicing and special short-value rules.
  // No non-zero Unicode CUSTOM setting is provably no weaker for every value.
  return false;
}

function validateConvertedRules(version: string, rules: readonly ConvertedDatasetMaskRule[]): void {
  const deliveryRules: DatasetDeliveryRule[] = rules.map((rule) => ({
    columnName: rule.columnName,
    mode: rule.mode,
    ...(rule.mode === "CUSTOM" ? { customMask: rule.customMask } : {}),
  }));
  try {
    applyDatasetDeliveryPolicy({
      policy: { state: "CONFIRMED", version, rules: deliveryRules },
      columns: [],
      rows: [],
    });
  } catch {
    fail("DATASET_LEGACY_POLICY_INVALID");
  }
}

/**
 * Builds a review-only conversion plan. It has no repository, transaction, or
 * write side effects. A BLOCKED result deliberately withholds converted rules
 * so callers cannot accidentally apply a partial plan.
 */
export function planLegacyDatasetMaskConversion(input: Readonly<{
  sourceVersion: string;
  expectedVersion: string;
  rules: readonly LegacyDatasetMaskRule[];
  dashboardPolicies: readonly LegacyDashboardMaskPolicy[];
}>): LegacyMaskConversionResult {
  try {
    parseConfigurationVersion(input.sourceVersion, false);
    parseConfigurationVersion(input.expectedVersion, false);
  } catch {
    fail("DATASET_LEGACY_POLICY_INVALID");
  }
  if (input.sourceVersion !== input.expectedVersion) fail("DATASET_LEGACY_POLICY_VERSION_CONFLICT");
  if (!Array.isArray(input.rules) || !Array.isArray(input.dashboardPolicies)) {
    fail("DATASET_LEGACY_POLICY_INVALID");
  }

  const actions = new Map<string, ConvertedAction>();
  const sourceRules = new Map<string, LegacyDatasetMaskRule>();
  const convertedRules: ConvertedDatasetMaskRule[] = [];
  const impacts: LegacyMaskConversionImpact[] = [];
  for (const rule of input.rules) {
    if (!rule || typeof rule !== "object") fail("DATASET_LEGACY_POLICY_INVALID");
    const key = canonicalColumnName(rule.columnName);
    if (sourceRules.has(key) || !validSensitivityType(rule.sensitivityType) || !datasetModes.has(rule.mode)
      || (rule.sensitivityType !== "OTHER" && rule.mode === "NONE")) {
      fail("DATASET_LEGACY_POLICY_INVALID");
    }
    const mode = rule.mode as DeviceMaskMode;
    assertNoUnexpectedCustom(mode, rule.customMask);
    const action = convertMode(mode, rule.customMask);
    assertSyntheticProof(mode, rule.customMask, action);
    sourceRules.set(key, rule);
    actions.set(key, action);
    if (action.mode !== "UNSET") {
      convertedRules.push({
        columnName: rule.columnName,
        sensitivityType: rule.sensitivityType,
        mode: action.mode,
        ...(action.mode === "CUSTOM" ? { customMask: { ...action.customMask! } } : {}),
      });
    }
    impacts.push({
      columnName: rule.columnName,
      sensitivityType: rule.sensitivityType,
      fromMode: mode,
      toMode: action.mode,
      protection: mode === "NONE" || mode === "OMIT" || mode === "CUSTOM" ? "EQUIVALENT" : "STRONGER",
      proof: "SYNTHETIC_EDGE_CASES_AND_DISCLOSURE_BOUNDS",
    });
  }
  validateConvertedRules(input.sourceVersion, convertedRules);

  const blockers: DashboardMaskConversionBlocker[] = [];
  const dashboardIds = new Set<number>();
  for (const policy of input.dashboardPolicies) {
    if (!policy || typeof policy !== "object" || !Number.isSafeInteger(policy.dashboardId) || policy.dashboardId <= 0
      || !Array.isArray(policy.rules)) fail("DATASET_LEGACY_POLICY_INVALID");
    try {
      parseApprovalVersion(policy.version);
      parseApprovalVersion(policy.expectedVersion);
    } catch {
      fail("DATASET_LEGACY_POLICY_INVALID");
    }
    if (policy.version !== policy.expectedVersion) fail("DATASET_LEGACY_POLICY_VERSION_CONFLICT");
    if (dashboardIds.has(policy.dashboardId)) fail("DATASET_LEGACY_POLICY_INVALID");
    dashboardIds.add(policy.dashboardId);
    const seenDashboardRules = new Set<string>();
    for (const rule of policy.rules) {
      if (!rule || typeof rule !== "object"
        || typeof rule.sourceKey !== "string" || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/u.test(rule.sourceKey)
        || !dashboardModes.has(rule.mode)) fail("DATASET_LEGACY_POLICY_INVALID");
      const key = canonicalColumnName(rule.columnName);
      const dashboardKey = `${rule.sourceKey.toUpperCase()}:${key}`;
      if (seenDashboardRules.has(dashboardKey)) fail("DATASET_LEGACY_POLICY_INVALID");
      seenDashboardRules.add(dashboardKey);
      const mode = rule.mode as DashboardMaskMode;
      const sourceRule = sourceRules.get(key);
      const inheritedCustom = mode === "CUSTOM" && rule.customMask == null && sourceRule?.mode === "CUSTOM"
        ? sourceRule.customMask : rule.customMask;
      if (mode === "CUSTOM" && inheritedCustom == null) {
        // Historical Dashboard CUSTOM without a Dataset CUSTOM fails closed to OMIT.
        if ((actions.get(key) ?? { mode: "UNSET" }).mode !== "OMIT") blockers.push({
          dashboardId: policy.dashboardId, sourceKey: rule.sourceKey, columnName: rule.columnName,
          dashboardMode: mode, reason: "DASHBOARD_POLICY_STRONGER",
        });
        continue;
      }
      assertNoUnexpectedCustom(mode, inheritedCustom);
      const action = actions.get(key) ?? { mode: "UNSET" as const };
      if (!actionNoWeakerThan(action, mode, inheritedCustom)) blockers.push({
        dashboardId: policy.dashboardId,
        sourceKey: rule.sourceKey,
        columnName: rule.columnName,
        dashboardMode: mode,
        reason: "DASHBOARD_POLICY_STRONGER",
      });
    }
  }

  return {
    status: blockers.length > 0 ? "BLOCKED" : "READY",
    sourceVersion: input.sourceVersion,
    convertedRules: blockers.length > 0 ? null : convertedRules,
    impacts,
    blockers,
  };
}
