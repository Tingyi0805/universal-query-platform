import { maskDeviceValue, validCustomMask, type DeviceMaskMode, type CustomMaskConfig } from "../dashboard/dashboardDeviceMasking.js";

export type DatasetDeliveryRule = Readonly<{
  columnName: string;
  mode: DeviceMaskMode;
  customMask?: CustomMaskConfig | null;
}>;

/**
 * A policy is trusted only after its repository has read the rules and revision
 * as one consistent snapshot. A positive revision also distinguishes an
 * explicitly confirmed empty policy from a missing policy.
 */
export type ConfirmedDatasetDeliveryPolicy = Readonly<{
  state: "CONFIRMED";
  version: string;
  rules: readonly DatasetDeliveryRule[];
  patientAuditOnlyColumns?: readonly string[];
}>;

export type DatasetDeliveryColumn = Readonly<{ name: string; [key: string]: unknown }>;
export type DatasetDeliveryColumnMetadata = Readonly<{ columnName: string; [key: string]: unknown }>;
export type DatasetDeliveryMetadata = Readonly<Record<string, readonly DatasetDeliveryColumnMetadata[]>>;

export type DatasetDeliveryInput = Readonly<{
  policy: ConfirmedDatasetDeliveryPolicy | null | undefined;
  columns: readonly DatasetDeliveryColumn[];
  rows: readonly Readonly<Record<string, unknown>>[];
  metadata?: DatasetDeliveryMetadata;
}>;

export type DatasetDeliveryOutput = {
  columns: DatasetDeliveryColumn[];
  rows: Record<string, unknown>[];
  metadata: Record<string, DatasetDeliveryColumnMetadata[]>;
};

export type DatasetDeliveryPolicyErrorCode =
  | "DATASET_DELIVERY_POLICY_REQUIRED"
  | "DATASET_DELIVERY_POLICY_INVALID"
  | "DATASET_DELIVERY_COLUMNS_AMBIGUOUS"
  | "DATASET_DELIVERY_RESULT_INVALID";

/** Error messages intentionally contain a stable code only, never row data. */
export class DatasetDeliveryPolicyError extends Error {
  constructor(public readonly code: DatasetDeliveryPolicyErrorCode) {
    super(code);
    this.name = "DatasetDeliveryPolicyError";
  }
}

function fail(code: DatasetDeliveryPolicyErrorCode): never {
  throw new DatasetDeliveryPolicyError(code);
}

function canonicalColumnName(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 256) {
    fail("DATASET_DELIVERY_POLICY_INVALID");
  }
  return value.toUpperCase();
}

function validatePolicy(policy: ConfirmedDatasetDeliveryPolicy | null | undefined): Map<string, DatasetDeliveryRule> {
  if (!policy || policy.state !== "CONFIRMED") fail("DATASET_DELIVERY_POLICY_REQUIRED");
  if (!/^[1-9][0-9]*$/u.test(policy.version) || !Array.isArray(policy.rules)) {
    fail("DATASET_DELIVERY_POLICY_INVALID");
  }

  const rules = new Map<string, DatasetDeliveryRule>();
  for (const rule of policy.rules) {
    if (!rule || typeof rule !== "object") fail("DATASET_DELIVERY_POLICY_INVALID");
    const key = canonicalColumnName(rule.columnName);
    if (rules.has(key) || !["NONE", "CUSTOM", "FULL", "OMIT", "NAME", "MRN", "PHONE", "GENERIC"].includes(rule.mode)) {
      fail("DATASET_DELIVERY_POLICY_INVALID");
    }
    if (rule.mode === "CUSTOM" ? !validCustomMask(rule.customMask) : rule.customMask != null) {
      fail("DATASET_DELIVERY_POLICY_INVALID");
    }
    rules.set(key, rule);
  }

  if (policy.patientAuditOnlyColumns !== undefined && !Array.isArray(policy.patientAuditOnlyColumns)) {
    fail("DATASET_DELIVERY_POLICY_INVALID");
  }
  const auditOnly = new Set<string>();
  for (const columnName of policy.patientAuditOnlyColumns ?? []) {
    const key = canonicalColumnName(columnName);
    if (auditOnly.has(key) || rules.get(key)?.mode !== "OMIT") {
      fail("DATASET_DELIVERY_POLICY_INVALID");
    }
    auditOnly.add(key);
  }
  return rules;
}

function validateColumns(columns: readonly DatasetDeliveryColumn[]): Map<string, DatasetDeliveryColumn> {
  if (!Array.isArray(columns)) fail("DATASET_DELIVERY_RESULT_INVALID");
  const result = new Map<string, DatasetDeliveryColumn>();
  for (const column of columns) {
    if (!column || typeof column !== "object") fail("DATASET_DELIVERY_RESULT_INVALID");
    let key: string;
    try {
      key = canonicalColumnName(column.name);
    } catch {
      fail("DATASET_DELIVERY_RESULT_INVALID");
    }
    if (result.has(key)) fail("DATASET_DELIVERY_COLUMNS_AMBIGUOUS");
    result.set(key, column);
  }
  return result;
}

function rowValuesByColumn(
  row: Readonly<Record<string, unknown>>,
  declaredColumns: ReadonlyMap<string, DatasetDeliveryColumn>,
): Map<string, unknown> {
  if (!row || typeof row !== "object" || Array.isArray(row)) fail("DATASET_DELIVERY_RESULT_INVALID");
  const values = new Map<string, unknown>();
  for (const [name, value] of Object.entries(row)) {
    const key = name.toUpperCase();
    if (!declaredColumns.has(key) || values.has(key)) fail("DATASET_DELIVERY_RESULT_INVALID");
    values.set(key, value);
  }
  return values;
}

/**
 * Applies a previously authenticated Dataset policy to data that has already
 * completed required server-side disclosure auditing. This pure function does
 * not authorize callers, query databases, cache data, or mutate its inputs.
 */
export function applyDatasetDeliveryPolicy(input: DatasetDeliveryInput): DatasetDeliveryOutput {
  const rules = validatePolicy(input.policy);
  const declaredColumns = validateColumns(input.columns);
  if (!Array.isArray(input.rows)) fail("DATASET_DELIVERY_RESULT_INVALID");

  const visibleColumns = input.columns.filter((column) => { const rule = rules.get(column.name.toUpperCase()); return rule && rule.mode !== "OMIT"; });
  const visibleNames = new Set(visibleColumns.map((column) => column.name.toUpperCase()));
  const columns = visibleColumns.map((column) => ({ ...column }));

  const rows = input.rows.map((row) => {
    const values = rowValuesByColumn(row, declaredColumns);
    const entries: Array<[string, unknown]> = [];
    for (const column of visibleColumns) {
      const key = column.name.toUpperCase();
      if (!values.has(key)) continue;
      const value = values.get(key);
      const rule = rules.get(key);
      try {
        entries.push([column.name, maskDeviceValue(value, rule!.mode, rule!.customMask)]);
      } catch {
        fail("DATASET_DELIVERY_RESULT_INVALID");
      }
    }
    return Object.fromEntries(entries);
  });

  const metadataCollections: Array<[string, DatasetDeliveryColumnMetadata[]]> = [];
  if (input.metadata !== undefined) {
    if (!input.metadata || typeof input.metadata !== "object" || Array.isArray(input.metadata)) {
      fail("DATASET_DELIVERY_RESULT_INVALID");
    }
    for (const [collection, entries] of Object.entries(input.metadata)) {
      if (!Array.isArray(entries)) fail("DATASET_DELIVERY_RESULT_INVALID");
      const visibleEntries = entries.flatMap((entry) => {
        if (!entry || typeof entry !== "object") fail("DATASET_DELIVERY_RESULT_INVALID");
        let key: string;
        try {
          key = canonicalColumnName(entry.columnName);
        } catch {
          fail("DATASET_DELIVERY_RESULT_INVALID");
        }
        return visibleNames.has(key) ? [{ ...entry }] : [];
      });
      metadataCollections.push([collection, visibleEntries]);
    }
  }

  return { columns, rows, metadata: Object.fromEntries(metadataCollections) };
}
