import sql from "mssql";
import { getPlatformDbPool } from "../../config/database.js";
import { requireSecuritySchema } from "../securityContract/securityContract.repository.js";
import { SecurityContractError, parseConfigurationVersion } from "../securityContract/securityContract.js";
import {
  applyDatasetDeliveryPolicy,
  DatasetDeliveryPolicyError,
  type ConfirmedDatasetDeliveryPolicy,
  type DatasetDeliveryRule,
} from "./datasetDeliveryPolicy.js";

export type DatasetDeliveryVersionEvidence = Readonly<{
  definitionVersion: string;
  sensitivityVersion: string;
  patientAuditVersion: string;
}>;

export type ConfirmedDatasetDeliverySnapshot = DatasetDeliveryVersionEvidence & Readonly<{
  datasetId: number;
  policy: ConfirmedDatasetDeliveryPolicy;
  patientAudit: Readonly<{
    configured: boolean;
    enabled: boolean;
    patientKeyColumn: string | null;
  }>;
}>;

export type DatasetDeliverySnapshotErrorCode =
  | "DATASET_DELIVERY_SCHEMA_REQUIRED"
  | "DATASET_DELIVERY_DATASET_NOT_FOUND"
  | "DATASET_DELIVERY_POLICY_UNCONFIRMED"
  | "DATASET_DELIVERY_POLICY_INVALID"
  | "DATASET_DELIVERY_VERSION_CONFLICT"
  | "DATASET_DELIVERY_POLICY_UNAVAILABLE";

/** Stable codes only: driver messages, SQL and policy values never escape. */
export class DatasetDeliverySnapshotError extends Error {
  constructor(public readonly code: DatasetDeliverySnapshotErrorCode) {
    super(code);
    this.name = "DatasetDeliverySnapshotError";
  }
}

type CatalogColumn = Record<string, unknown>;
const off = (value: unknown) => value === false || value === 0;

// Catalog-only query. Keep optional application columns out of the SQL batch
// until this evidence has passed, so a pre-920 database fails predictably.
export const datasetDefinitionVersionCatalogSql = `
SELECT c.name AS columnName,c.system_type_id AS typeId,c.user_type_id AS userTypeId,
 c.max_length AS maxLength,c.is_nullable AS nullable,c.is_computed AS computed
FROM sys.columns c
WHERE c.object_id=OBJECT_ID(N'uqp.Dataset');`;

export function assertDatasetDefinitionVersionSchema(columns: CatalogColumn[]): void {
  const revision = columns.filter(column => column.typeId === 189);
  if (revision.length !== 1 || revision[0]?.columnName !== "DefinitionRowVersion"
    || revision[0].userTypeId !== 189 || revision[0].maxLength !== 8
    || !off(revision[0].nullable) || !off(revision[0].computed)) {
    throw new DatasetDeliverySnapshotError("DATASET_DELIVERY_SCHEMA_REQUIRED");
  }
}

export async function requireDatasetDefinitionVersionSchema(request: sql.Request): Promise<void> {
  const result = await request.query(datasetDefinitionVersionCatalogSql);
  assertDatasetDefinitionVersionSchema(result.recordset as CatalogColumn[]);
}

function definitionVersion(value: unknown): string {
  if (!Buffer.isBuffer(value) || value.length !== 8) {
    throw new DatasetDeliverySnapshotError("DATASET_DELIVERY_SCHEMA_REQUIRED");
  }
  return value.toString("hex");
}

function confirmedVersion(value: unknown): string {
  try {
    return String(parseConfigurationVersion(value, false));
  } catch {
    throw new DatasetDeliverySnapshotError("DATASET_DELIVERY_POLICY_UNCONFIRMED");
  }
}

function patientVersion(value: unknown): string {
  try {
    return String(parseConfigurationVersion(value, false));
  } catch {
    throw new DatasetDeliverySnapshotError("DATASET_DELIVERY_POLICY_INVALID");
  }
}

function ruleFromRow(row: Record<string, unknown>): DatasetDeliveryRule {
  const mode = String(row.DeviceMaskMode);
  let customMask: unknown = null;
  if (row.CustomMaskJson != null) {
    try {
      customMask = JSON.parse(String(row.CustomMaskJson));
    } catch {
      throw new DatasetDeliverySnapshotError("DATASET_DELIVERY_POLICY_INVALID");
    }
  }
  return {
    columnName: typeof row.ColumnName === "string" ? row.ColumnName : "",
    mode: mode as DatasetDeliveryRule["mode"],
    customMask: customMask as DatasetDeliveryRule["customMask"],
  };
}

export type DatasetDeliveryPolicyRepositoryDependencies = {
  getPool: typeof getPlatformDbPool;
  createTransaction: (pool: sql.ConnectionPool) => sql.Transaction;
  createRequest: (transaction: sql.Transaction) => sql.Request;
  requireSchema: (request: () => sql.Request) => Promise<void>;
};

export function createDatasetDeliveryPolicyRepository(deps: DatasetDeliveryPolicyRepositoryDependencies) {
  async function readConfirmedDatasetDeliverySnapshot(
    datasetId: number,
    expected?: DatasetDeliveryVersionEvidence,
    existingTransaction?: sql.Transaction,
  ): Promise<ConfirmedDatasetDeliverySnapshot> {
    let transaction: sql.Transaction;
    try {
      if (existingTransaction) transaction = existingTransaction;
      else {
        const pool = await deps.getPool();
        if (!pool) throw new Error("missing");
        transaction = deps.createTransaction(pool);
      }
    } catch {
      throw new DatasetDeliverySnapshotError("DATASET_DELIVERY_POLICY_UNAVAILABLE");
    }
    let begun = false;
    const request = () => deps.createRequest(transaction);
    try {
      if (!existingTransaction) { await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE); begun = true; }
      await request().query("SET XACT_ABORT ON");
      await deps.requireSchema(request);

      const dataset = await request().input("datasetId", sql.BigInt, datasetId).query(`
        SELECT DefinitionRowVersion
        FROM uqp.Dataset WITH (HOLDLOCK)
        WHERE Id=@datasetId`);
      if (dataset.recordset.length !== 1) {
        throw new DatasetDeliverySnapshotError("DATASET_DELIVERY_DATASET_NOT_FOUND");
      }

      const revision = await request().input("datasetId", sql.BigInt, datasetId).query(`
        SELECT CONVERT(VARCHAR(20),VersionNumber) AS Version
        FROM uqp.DatasetSensitivePolicyVersion WITH (HOLDLOCK)
        WHERE DatasetId=@datasetId`);
      if (revision.recordset.length !== 1) {
        throw new DatasetDeliverySnapshotError("DATASET_DELIVERY_POLICY_UNCONFIRMED");
      }

      const rulesResult = await request().input("datasetId", sql.BigInt, datasetId).query(`
        SELECT ColumnName,DeviceMaskMode,CustomMaskJson
        FROM uqp.DatasetSensitiveColumn WITH (HOLDLOCK)
        WHERE DatasetId=@datasetId
        ORDER BY ColumnName`);
      const patientResult = await request().input("datasetId", sql.BigInt, datasetId).query(`
        SELECT IsEnabled,PatientKeyColumn,CONVERT(VARCHAR(20),ConfigurationVersion) AS Version
        FROM uqp.DatasetPatientAuditConfig WITH (HOLDLOCK)
        WHERE DatasetId=@datasetId`);
      if (patientResult.recordset.length > 1) {
        throw new DatasetDeliverySnapshotError("DATASET_DELIVERY_POLICY_INVALID");
      }

      const currentDefinitionVersion = definitionVersion(dataset.recordset[0].DefinitionRowVersion);
      const sensitivityVersion = confirmedVersion(revision.recordset[0].Version);
      const patientRow = patientResult.recordset[0] as Record<string, unknown> | undefined;
      const patientAuditVersion = patientRow ? patientVersion(patientRow.Version) : "0";
      const patientKeyColumn = patientRow && typeof patientRow.PatientKeyColumn === "string"
        && patientRow.PatientKeyColumn.trim().length > 0 ? patientRow.PatientKeyColumn : null;
      if (patientRow && !patientKeyColumn) {
        throw new DatasetDeliverySnapshotError("DATASET_DELIVERY_POLICY_INVALID");
      }

      const policy: ConfirmedDatasetDeliveryPolicy = {
        state: "CONFIRMED",
        version: sensitivityVersion,
        rules: rulesResult.recordset.map(ruleFromRow),
        patientAuditOnlyColumns: patientKeyColumn ? [patientKeyColumn] : [],
      };
      try {
        // Reuse the delivery engine's one canonical runtime validator without
        // touching data or creating a second policy interpretation.
        applyDatasetDeliveryPolicy({ policy, columns: [], rows: [] });
      } catch (error) {
        if (error instanceof DatasetDeliveryPolicyError) {
          throw new DatasetDeliverySnapshotError("DATASET_DELIVERY_POLICY_INVALID");
        }
        throw error;
      }

      if (expected && (expected.definitionVersion !== currentDefinitionVersion
        || expected.sensitivityVersion !== sensitivityVersion
        || expected.patientAuditVersion !== patientAuditVersion)) {
        throw new DatasetDeliverySnapshotError("DATASET_DELIVERY_VERSION_CONFLICT");
      }

      const snapshot: ConfirmedDatasetDeliverySnapshot = {
        datasetId,
        definitionVersion: currentDefinitionVersion,
        sensitivityVersion,
        patientAuditVersion,
        policy,
        patientAudit: {
          configured: Boolean(patientRow),
          enabled: Boolean(patientRow?.IsEnabled),
          patientKeyColumn,
        },
      };
      if (!existingTransaction) await transaction.commit();
      return snapshot;
    } catch (error) {
      if (begun) {
        try {
          await transaction.rollback();
        } catch { /* preserve the safe original failure */ }
      }
      if (error instanceof DatasetDeliverySnapshotError) throw error;
      if (error instanceof SecurityContractError) {
        throw new DatasetDeliverySnapshotError("DATASET_DELIVERY_SCHEMA_REQUIRED");
      }
      throw new DatasetDeliverySnapshotError("DATASET_DELIVERY_POLICY_UNAVAILABLE");
    }
  }

  return { readConfirmedDatasetDeliverySnapshot };
}

const repository = createDatasetDeliveryPolicyRepository({
  getPool: getPlatformDbPool,
  createTransaction: pool => new sql.Transaction(pool),
  createRequest: transaction => new sql.Request(transaction),
  requireSchema: async request => {
    await requireSecuritySchema(request());
    await requireDatasetDefinitionVersionSchema(request());
  },
});

export const { readConfirmedDatasetDeliverySnapshot } = repository;
