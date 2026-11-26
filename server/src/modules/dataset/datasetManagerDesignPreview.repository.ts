import sql from "mssql";
import { getPlatformDbPool } from "../../config/database.js";
import { decodeDatasetApprovalRevision } from "./datasetManagementApproval.revision.js";
import { QueryDeliveryError } from "../queryDefinition/queryDelivery.js";

/**
 * Administrator-only design preview evidence. This is not a legacy confirmed
 * sensitivity policy and must never be used for ordinary Query, export, PIN,
 * hierarchy, CHART or public/device delivery. No patient data is read here.
 */
export type ManagerDesignPreviewSnapshot = Readonly<{
  datasetId: number;
  definitionVersion: string;
  sensitivityVersion: "0";
  patientAuditVersion: "0";
  policy: null;
  patientAudit: Readonly<{ configured: false; enabled: false; patientKeyColumn: null }>;
  managerApproval: Readonly<{ decisionId: string; approvedBy: string; dataSourceId: number; sourceConfigurationVersion: string }>;
}>;

export async function readManagerDesignPreviewApproval(datasetId: number,
  existingTransaction?: sql.Transaction): Promise<ManagerDesignPreviewSnapshot> {
  let tx = existingTransaction;
  let own = false;
  try {
    if (!tx) {
      const pool = await getPlatformDbPool();
      if (!pool) throw new QueryDeliveryError("MANAGER_PREVIEW_APPROVAL_UNAVAILABLE", 503);
      tx = new sql.Transaction(pool);
      await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
      own = true;
    }
    const request = () => new sql.Request(tx!).input("datasetId", sql.BigInt, datasetId);
    const definition = await request().query(`
      SELECT d.Id, d.DataSourceId, d.DefinitionRowVersion, s.ConfigurationRowVersion,
        CASE WHEN EXISTS (SELECT 1 FROM uqp.DatasetSensitiveColumn WITH(HOLDLOCK) WHERE DatasetId=d.Id)
          OR EXISTS (SELECT 1 FROM uqp.DatasetSensitivePolicyVersion WITH(HOLDLOCK) WHERE DatasetId=d.Id)
          OR EXISTS (SELECT 1 FROM uqp.DatasetPatientAuditConfig WITH(HOLDLOCK) WHERE DatasetId=d.Id)
          THEN 1 ELSE 0 END AS HasLegacyProtection
      FROM uqp.Dataset d WITH(HOLDLOCK)
      INNER JOIN uqp.DataSource s WITH(HOLDLOCK) ON s.Id=d.DataSourceId
      WHERE d.Id=@datasetId AND d.IsActive=1 AND d.IsArchived=0 AND s.IsActive=1
    `);
    const row = definition.recordset[0];
    if (definition.recordset.length !== 1 || Number(row.Id) !== datasetId)
      throw new QueryDeliveryError("DATASET_NOT_AVAILABLE");
    if (row.HasLegacyProtection !== 0 && row.HasLegacyProtection !== false)
      throw new QueryDeliveryError("MANAGER_PREVIEW_LEGACY_PROTECTION_REQUIRED");
    const definitionVersion = decodeDatasetApprovalRevision(row.DefinitionRowVersion);
    const sourceConfigurationVersion = decodeDatasetApprovalRevision(row.ConfigurationRowVersion);
    const dataSourceId = Number(row.DataSourceId);
    if (!definitionVersion || !sourceConfigurationVersion || !Number.isSafeInteger(dataSourceId) || dataSourceId < 1)
      throw new QueryDeliveryError("MANAGER_PREVIEW_APPROVAL_UNAVAILABLE", 503);

    // Reuse the durable approval decision already written by the manager API.
    // No additional per-column configuration or disclosure decision is created.
    const decisions = await request().query(`
      SELECT TOP (1) CONVERT(varchar(20),a.Id) AS DecisionId,
        CONVERT(varchar(20),a.UserId) AS ApprovedBy,a.EventType,a.ParametersJson
      FROM (
        SELECT Id,UserId,EventType,ParametersJson FROM uqp.AuditLog WITH(HOLDLOCK)
          WHERE DatasetId=@datasetId AND Status='SUCCESS' AND EventType IN ('DATASET_USAGE_APPROVED','DATASET_USAGE_REVOKED')
        UNION ALL
        SELECT Id,UserId,EventType,ParametersJson FROM uqp.AuditLogArchive WITH(HOLDLOCK)
          WHERE DatasetId=@datasetId AND Status='SUCCESS' AND EventType IN ('DATASET_USAGE_APPROVED','DATASET_USAGE_REVOKED')
      ) a ORDER BY a.Id DESC
    `);
    const decision = decisions.recordset[0];
    let evidence: unknown;
    try { evidence = JSON.parse(String(decision?.ParametersJson)); } catch { /* missing or malformed */ }
    const e = evidence && typeof evidence === "object" ? evidence as Record<string, unknown> : null;
    if (decisions.recordset.length !== 1 || decision.EventType !== "DATASET_USAGE_APPROVED" ||
        !/^[1-9][0-9]{0,18}$/u.test(String(decision.DecisionId)) ||
        !/^[1-9][0-9]{0,18}$/u.test(String(decision.ApprovedBy)) ||
        e?.approved !== true || e.definitionVersion !== definitionVersion ||
        e.dataSourceId !== dataSourceId || e.sourceConfigurationVersion !== sourceConfigurationVersion) {
      throw new QueryDeliveryError("MANAGER_PREVIEW_APPROVAL_REQUIRED");
    }
    const result: ManagerDesignPreviewSnapshot = {
      datasetId, definitionVersion, sensitivityVersion: "0", patientAuditVersion: "0", policy: null,
      patientAudit: { configured: false, enabled: false, patientKeyColumn: null },
      managerApproval: { decisionId: String(decision.DecisionId), approvedBy: String(decision.ApprovedBy),
        dataSourceId, sourceConfigurationVersion },
    };
    if (own) await tx.commit();
    return result;
  } catch (error) {
    if (own && tx) try { await tx.rollback(); } catch { /* never claim success */ }
    if (error instanceof QueryDeliveryError) throw error;
    throw new QueryDeliveryError("MANAGER_PREVIEW_APPROVAL_UNAVAILABLE", 503);
  }
}
