import type sql from "mssql";
import { createHash } from "node:crypto";
import jwt from "jsonwebtoken";
import { env } from "../../config/env.js";
import type { QueryResult } from "../../query/query.types.js";
import { getTokenSessionState } from "../auth/auth.repository.js";
import { auditDashboardPatientList } from "../audit/patientDisclosure.service.js";
import { getDataset } from "../dataset/dataset.repository.js";
import { executeSavedDataset } from "../dataset/dataset.service.js";
import { applyDatasetDeliveryPolicy, type ConfirmedDatasetDeliveryPolicy } from "../dataset/datasetDeliveryPolicy.js";
import { readConfirmedDatasetDeliverySnapshot } from "../dataset/datasetDeliveryPolicy.repository.js";
import { patientAuditService } from "../dataset/patientAuditContract.repository.js";
import { getEffectiveQueryAccess } from "./queryDefinition.repository.js";
import { getQueryAccessRevision } from "./queryAccess.repository.js";
import { listReportColumns, type ReportColumnRecord } from "./reportColumn.repository.js";

export class QueryDeliveryError extends Error {
  constructor(readonly code: string, readonly status = 409) { super(code); }
}
export type DeliveryAction = "VIEW" | "EXECUTE" | "EXPORT";
export type RuntimeIdentity = { userId: number; tokenVersion: number; permissions: string[] };

/** Re-verifies signature, expiry and current session at every delivery boundary. */
export function createRuntimeIdentityVerifier(session = getTokenSessionState) {
  return async (authorization: string | undefined, transaction?: sql.Transaction): Promise<RuntimeIdentity> => {
    if (!env.JWT_SECRET || !authorization?.startsWith("Bearer ")) throw new QueryDeliveryError("UNAUTHORIZED", 401);
    let payload: jwt.JwtPayload;
    try {
      const verified = jwt.verify(authorization.slice(7), env.JWT_SECRET);
      if (typeof verified === "string") throw new Error();
      payload = verified;
    } catch { throw new QueryDeliveryError("INVALID_TOKEN", 401); }
    const userId = Number(payload.sub), tokenVersion = Number(payload.tokenVersion);
    if (!Number.isSafeInteger(userId) || userId <= 0 || !Number.isSafeInteger(tokenVersion) || tokenVersion < 1)
      throw new QueryDeliveryError("INVALID_TOKEN", 401);
    const current = await session(userId, transaction);
    if (!current?.isActive || current.tokenVersion !== tokenVersion) throw new QueryDeliveryError("TOKEN_REVOKED", 401);
    return { userId, tokenVersion, permissions: current.permissions };
  };
}

/** Metadata uses the same policy validator as rows; omitted grouping/aggregation cannot silently change meaning. */
export function deliveryReportColumns(policy: ConfirmedDatasetDeliveryPolicy, reports: ReportColumnRecord[], result?: QueryResult): ReportColumnRecord[] {
  const omitted = new Set(policy.rules.filter(r => r.mode === "OMIT").map(r => r.columnName.toUpperCase()));
  if (reports.some(r => omitted.has(r.columnName.toUpperCase()) && (r.groupOrder !== null || r.aggregateType !== "NONE")))
    throw new QueryDeliveryError("QUERY_REPORT_POLICY_CONFLICT");
  const columns = result?.columns ?? reports.map(r => ({ name: r.columnName }));
  const filtered = applyDatasetDeliveryPolicy({ policy, columns, rows: [], metadata: { reportColumns: reports } });
  const names = new Map(columns.map(c => [c.name.toUpperCase(), c.name]));
  return (filtered.metadata.reportColumns as ReportColumnRecord[]).map(r => ({ ...r, columnName: names.get(r.columnName.toUpperCase())! }));
}

export const defaultQueryDeliveryDependencies = {
  // Usage statistics can wait on other in-flight audit rows. They are not
  // needed for authorization and must stay out of the final audit transaction.
  access: (userId: number, queryId: number, tx?: sql.Transaction) => getEffectiveQueryAccess(userId, queryId, tx, false), accessRevision: getQueryAccessRevision,
  snapshot: readConfirmedDatasetDeliverySnapshot, dataset: getDataset,
  patientState: patientAuditService.dashboardState, auditPatient: auditDashboardPatientList,
  execute: executeSavedDataset, reports: listReportColumns,
};

/** Raw rows are request-local and used only for required auditing before the shared policy engine. */
export function createQueryDelivery(deps = defaultQueryDeliveryDependencies) {
  async function open(queryId: number, action: DeliveryAction, identity: (transaction?: sql.Transaction) => Promise<RuntimeIdentity>) {
    async function inspect(transaction?: sql.Transaction) {
      const actor = await identity(transaction);
      const required = ["VIEW_QUERY", ...(action === "VIEW" ? [] : ["EXECUTE_QUERY"]), ...(action === "EXPORT" ? ["EXPORT_QUERY"] : [])];
      if (!required.every(p => actor.permissions.includes(p))) throw new QueryDeliveryError("FORBIDDEN", 403);
      const query = await deps.access(actor.userId, queryId, transaction);
      if (!query?.canView || !query.isPublished || !query.isActive || query.isArchived
        || (action !== "VIEW" && !query.canExecute) || (action === "EXPORT" && !query.canExport))
        throw new QueryDeliveryError("QUERY_DELIVERY_FORBIDDEN", 403);
      const snapshot = await deps.snapshot(query.datasetId, undefined, transaction);
      if (snapshot.datasetId !== query.datasetId || snapshot.policy.version !== snapshot.sensitivityVersion
        || !/^[0-9a-f]{16}$/u.test(snapshot.definitionVersion)) throw new QueryDeliveryError("QUERY_DELIVERY_VERSION_INVALID", 503);
      applyDatasetDeliveryPolicy({ policy: snapshot.policy, columns: [], rows: [] });
      const dataset = await deps.dataset(query.datasetId, transaction);
      if (!dataset?.isActive || dataset.isArchived || dataset.id !== query.datasetId) throw new QueryDeliveryError("DATASET_NOT_AVAILABLE");
      const patient = snapshot.patientAudit.enabled ? await deps.patientState(query.datasetId, transaction) : null;
      if (patient && patient.status !== "CONFIRMED") throw new QueryDeliveryError("PATIENT_AUDIT_NOT_CONFIRMED", 503);
      const reports = await deps.reports(query.id, transaction);
      const revision = await deps.accessRevision(queryId, transaction);
      // LastUsedAtUtc is derived from the usage audit being completed by this
      // very request. Favorites/usage counters are not authorization evidence.
      const queryEvidence = [query.id, query.datasetId, query.code, query.name,
        query.isPublished, query.publishedAtUtc, query.isActive, query.isArchived,
        query.canView, query.canExecute, query.canExport, query.allowExcelExport];
      const fingerprint = createHash("sha256").update(JSON.stringify([
        actor.userId, actor.tokenVersion, [...actor.permissions].sort(), queryEvidence, revision,
        snapshot, dataset.dataSourceId, patient?.fingerprint, reports,
      ])).digest("hex");
      return { actor, query, snapshot, dataset, reports, fingerprint };
    }
    const initial = await inspect();
    const revalidate = async (transaction?: sql.Transaction) => {
      if ((await inspect(transaction)).fingerprint !== initial.fingerprint) throw new QueryDeliveryError("QUERY_DELIVERY_VERSION_CONFLICT");
    };
    await revalidate();
    return { ...initial, revalidate };
  }

  async function execute(context: Awaited<ReturnType<typeof open>>, values: Record<string, unknown>) {
    const raw = await deps.execute(context.query.datasetId, values);
    await context.revalidate();
    let disclosureId: number | null = null;
    if (context.snapshot.patientAudit.enabled) {
      disclosureId = await deps.auditPatient({
        datasetId: context.query.datasetId, queryDefinitionId: context.query.id, userId: context.actor.userId,
        sourceScope: `datasource:${context.dataset.dataSourceId}`, deliveryType: "MANUAL", masked: true, rows: raw.rows,
      });
      if (raw.rows.length && (!Number.isSafeInteger(disclosureId) || Number(disclosureId) <= 0))
        throw new QueryDeliveryError("PATIENT_DISCLOSURE_REQUIRED", 503);
    }
    await context.revalidate();
    const safe = applyDatasetDeliveryPolicy({ policy: context.snapshot.policy, columns: raw.columns, rows: raw.rows });
    const result: QueryResult = { columns: safe.columns, rows: safe.rows, rowCount: raw.rowCount, truncated: raw.truncated, elapsedMs: raw.elapsedMs };
    const reportColumns = deliveryReportColumns(context.snapshot.policy, context.reports, result);
    return { result, reportColumns, disclosureId };
  }
  return { open, execute };
}
