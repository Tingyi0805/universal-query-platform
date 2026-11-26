import sql from "mssql";
import { createHash } from "node:crypto";
import { getPlatformDbPool } from "../../config/database.js";
import type { QueryResult } from "../../query/query.types.js";
import { readManagerDesignPreviewApproval } from "../dataset/datasetManagerDesignPreview.repository.js";
import { assertWholeResultApproval, assertWholeResultShape, WholeResultApprovalError, type WholeResultApproval } from "../dataset/datasetWholeResultApproval.js";
import { defaultQueryDeliveryDependencies, QueryDeliveryError, type DeliveryAction, type RuntimeIdentity } from "./queryDelivery.js";
import type { ReportColumnRecord } from "./reportColumn.repository.js";

type Receipt = { approval: WholeResultApproval; publicationStamp: string; datasetDecisionId: string };
const required = () => new QueryDeliveryError("QUERY_WHOLE_RESULT_APPROVAL_REQUIRED");
function safeFailure(error: unknown): never {
  if (error instanceof WholeResultApprovalError) throw new QueryDeliveryError(error.code);
  if (error instanceof QueryDeliveryError) throw error;
  throw new QueryDeliveryError("QUERY_WHOLE_RESULT_APPROVAL_UNAVAILABLE", 503);
}

/** Read an explicit current publication decision, not an absent-policy fallback
 * or the manager's design-preview authority. Legacy-protected datasets remain
 * excluded by readManagerDesignPreviewApproval. */
export async function readWholeQueryApproval(queryId: number, datasetId: number,
  existingTransaction?: sql.Transaction): Promise<Receipt> {
  let tx = existingTransaction;
  let own = false;
  try {
    if (!tx) {
      const pool = await getPlatformDbPool();
      if (!pool) throw new Error("PLATFORM_DB_NOT_CONFIGURED");
      tx = new sql.Transaction(pool);
      await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
      own = true;
    }
    const current = await readManagerDesignPreviewApproval(datasetId, tx);
    const request = () => new sql.Request(tx!).input("queryId", sql.BigInt, queryId).input("datasetId", sql.BigInt, datasetId);
    const published = await request().query(`
      SELECT CONVERT(varchar(33),PublishedAtUtc,126) AS PublishedStamp,
        CONVERT(varchar(20),PublishedByUserId) AS PublishedBy
      FROM uqp.QueryDefinition WITH(HOLDLOCK)
      WHERE Id=@queryId AND DatasetId=@datasetId AND IsPublished=1 AND IsActive=1 AND IsArchived=0
    `);
    const query = published.recordset[0];
    if (published.recordset.length !== 1 || typeof query.PublishedStamp !== "string" || !query.PublishedStamp)
      throw required();
    const decisions = await request().query(`
      SELECT TOP (1) CONVERT(varchar(20),a.Id) AS AuditId,CONVERT(varchar(20),a.UserId) AS UserId,a.ParametersJson
      FROM (
        SELECT Id,UserId,ParametersJson FROM uqp.AuditLog WITH(HOLDLOCK)
          WHERE QueryDefinitionId=@queryId AND DatasetId=@datasetId AND Status='SUCCESS' AND EventType='QUERY_WHOLE_RESULT_APPROVED'
        UNION ALL
        SELECT Id,UserId,ParametersJson FROM uqp.AuditLogArchive WITH(HOLDLOCK)
          WHERE QueryDefinitionId=@queryId AND DatasetId=@datasetId AND Status='SUCCESS' AND EventType='QUERY_WHOLE_RESULT_APPROVED'
      ) a ORDER BY a.Id DESC
    `);
    const decision = decisions.recordset[0];
    if (decisions.recordset.length !== 1 || decision.UserId !== query.PublishedBy) throw required();
    let evidence: Record<string, unknown>;
    try {
      const parsed = JSON.parse(String(decision.ParametersJson));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw required();
      evidence = parsed;
    } catch { throw required(); }
    const { queryId: boundQuery, publishedStamp, datasetApprovalDecisionId, ...payload } = evidence;
    if (boundQuery !== queryId || publishedStamp !== query.PublishedStamp ||
        datasetApprovalDecisionId !== current.managerApproval.decisionId ||
        String(payload.approvedBy) !== decision.UserId || !/^[1-9][0-9]*$/u.test(String(decision.AuditId))) throw required();
    const approval = assertWholeResultApproval({ ...payload, auditLogId: Number(decision.AuditId) }, {
      datasetId, definitionVersion: current.definitionVersion, dataSourceId: current.managerApproval.dataSourceId,
      sourceConfigurationVersion: current.managerApproval.sourceConfigurationVersion,
    }, "INTERNAL");
    if (own) await tx.commit();
    return { approval, publicationStamp: query.PublishedStamp, datasetDecisionId: current.managerApproval.decisionId };
  } catch (error) {
    if (own && tx) try { await tx.rollback(); } catch { /* preserve rejection */ }
    safeFailure(error);
  }
}

export function wholeQueryReportColumns(approval: WholeResultApproval, reports: ReportColumnRecord[]): ReportColumnRecord[] {
  const names = new Map(approval.columns.map(name => [name.toUpperCase(), name]));
  if (reports.some(r => !names.has(r.columnName.toUpperCase()) && (r.groupOrder !== null || r.aggregateType !== "NONE")))
    throw new QueryDeliveryError("QUERY_REPORT_POLICY_CONFLICT");
  return reports.filter(r => names.has(r.columnName.toUpperCase()))
    .map(r => ({ ...r, columnName: names.get(r.columnName.toUpperCase())! }));
}

const defaultDeps = {
  access: defaultQueryDeliveryDependencies.access,
  accessRevision: defaultQueryDeliveryDependencies.accessRevision,
  dataset: defaultQueryDeliveryDependencies.dataset,
  reports: defaultQueryDeliveryDependencies.reports,
  execute: defaultQueryDeliveryDependencies.execute,
  approval: readWholeQueryApproval,
};

/** Only the ordinary authenticated Query runtime opts into this service.
 * It is not installed in PIN, hierarchy, device or public-display runtimes. */
export function createManagerApprovedQueryDelivery(deps = defaultDeps) {
  async function open(queryId: number, action: DeliveryAction, identity: (tx?: sql.Transaction) => Promise<RuntimeIdentity>) {
    async function inspect(tx?: sql.Transaction) {
      const actor = await identity(tx);
      if (actor.pinSession) throw new QueryDeliveryError("PIN_ASSURANCE_REQUIRED", 403);
      const permissions = ["VIEW_QUERY", ...(action === "VIEW" ? [] : ["EXECUTE_QUERY"]), ...(action === "EXPORT" ? ["EXPORT_QUERY"] : [])];
      if (!permissions.every(permission => actor.permissions.includes(permission))) throw new QueryDeliveryError("FORBIDDEN", 403);
      const query = await deps.access(actor.userId, queryId, tx);
      if (!query?.canView || !query.isPublished || !query.isActive || query.isArchived ||
          (action !== "VIEW" && !query.canExecute) || (action === "EXPORT" && !query.canExport))
        throw new QueryDeliveryError("QUERY_DELIVERY_FORBIDDEN", 403);
      const dataset = await deps.dataset(query.datasetId, tx);
      if (!dataset?.isActive || dataset.isArchived || dataset.id !== query.datasetId)
        throw new QueryDeliveryError("DATASET_NOT_AVAILABLE");
      const receipt = await deps.approval(query.id, dataset.id, tx);
      if (receipt.approval.datasetId !== dataset.id || receipt.approval.dataSourceId !== dataset.dataSourceId)
        throw required();
      const reports = wholeQueryReportColumns(receipt.approval, await deps.reports(query.id, tx));
      const revision = await deps.accessRevision(query.id, tx);
      const fingerprint = createHash("sha256").update(JSON.stringify([
        actor.userId, actor.tokenVersion, [...actor.permissions].sort(), action, dataset,
        query.id, query.datasetId, query.code, query.name, query.publishedAtUtc,
        query.canView, query.canExecute, query.canExport, query.allowExcelExport,
        receipt, reports, revision,
      ])).digest("hex");
      return { actor, query, dataset, receipt, reports, fingerprint };
    }
    const initial = await inspect();
    const revalidate = async (tx?: sql.Transaction) => {
      if ((await inspect(tx)).fingerprint !== initial.fingerprint) throw new QueryDeliveryError("QUERY_DELIVERY_VERSION_CONFLICT");
    };
    await revalidate();
    return { ...initial, action, revalidate };
  }
  async function execute(context: Awaited<ReturnType<typeof open>>, values: Record<string, unknown>) {
    if (context.action === "VIEW") throw new QueryDeliveryError("FORBIDDEN", 403);
    await context.revalidate();
    const result: QueryResult = await deps.execute(context.query.datasetId, values);
    await context.revalidate();
    try { assertWholeResultShape(context.receipt.approval, result.columns, result.rows); }
    catch (error) { safeFailure(error); }
    await context.revalidate();
    return { result, reportColumns: context.reports, disclosureId: null };
  }
  return { open, execute };
}
