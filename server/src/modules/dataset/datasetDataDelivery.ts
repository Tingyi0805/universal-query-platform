import type sql from "mssql";
import { createHash } from "node:crypto";
import type { QueryResult } from "../../query/query.types.js";
import { auditDashboardPatientList } from "../audit/patientDisclosure.service.js";
import { getDataSourcePlaybackState } from "../datasource/datasource.repository.js";
import { QueryDeliveryError, type RuntimeIdentity } from "../queryDefinition/queryDelivery.js";
import { getDataset } from "./dataset.repository.js";
import { executeSavedDataset, fixedParameterOptions } from "./dataset.service.js";
import { applyDatasetDeliveryPolicy } from "./datasetDeliveryPolicy.js";
import { readConfirmedDatasetDeliverySnapshot } from "./datasetDeliveryPolicy.repository.js";
import { patientAuditService } from "./patientAuditContract.repository.js";
import { listDatasetParameters } from "./parameter.repository.js";
import { runtimeParameterDefinitions } from "./parameterSync.js";

export const defaultDatasetDataDependencies = {
  dataset: getDataset, snapshot: readConfirmedDatasetDeliverySnapshot, source: getDataSourcePlaybackState,
  parameters: listDatasetParameters, patientState: patientAuditService.dashboardState,
  auditPatient: auditDashboardPatientList, execute: executeSavedDataset,
};

/** Dataset management authorization is global DESIGN_QUERY + EXECUTE_QUERY.
 * Ordinary Query lookup is not granted this authority and remains closed.
 * This service never syncs columns, records preview proof, or executes candidate SQL.
 */
export function createDatasetDataDelivery(deps = defaultDatasetDataDependencies) {
  async function open(datasetId: number, identity: (transaction?: sql.Transaction) => Promise<RuntimeIdentity>,
    purpose: "STANDARD" | "RAW_DESIGN" = "STANDARD", expectedDefinitionVersion?: string) {
    if (purpose !== "STANDARD" && !/^[0-9a-f]{16}$/u.test(expectedDefinitionVersion ?? ""))
      throw new QueryDeliveryError("DATASET_PREVIEW_VERSION_REQUIRED");
    async function inspect(transaction?: sql.Transaction) {
      const actor = await identity(transaction);
      if (!["DESIGN_QUERY", "EXECUTE_QUERY"].every(p => actor.permissions.includes(p)))
        throw new QueryDeliveryError("FORBIDDEN", 403);
      const snapshot = await deps.snapshot(datasetId, undefined, transaction);
      if (snapshot.datasetId !== datasetId || snapshot.sensitivityVersion !== snapshot.policy.version
        || !/^[0-9a-f]{16}$/u.test(snapshot.definitionVersion)) throw new QueryDeliveryError("DATASET_DELIVERY_VERSION_INVALID", 503);
      applyDatasetDeliveryPolicy({ policy: snapshot.policy, columns: [], rows: [] });
      if (purpose !== "STANDARD" && snapshot.definitionVersion !== expectedDefinitionVersion)
        throw new QueryDeliveryError("DATASET_DELIVERY_VERSION_CONFLICT");
      const dataset = await deps.dataset(datasetId, transaction);
      if (!dataset?.isActive || dataset.isArchived || dataset.id !== datasetId) throw new QueryDeliveryError("DATASET_NOT_AVAILABLE");
      const source = await deps.source(dataset.dataSourceId, transaction);
      if (!source?.isActive) throw new QueryDeliveryError("DATASOURCE_NOT_AVAILABLE");
      if (purpose === "RAW_DESIGN" && !snapshot.patientAudit.configured)
        throw new QueryDeliveryError("DATASET_PREVIEW_INITIALIZATION_REQUIRED", 503);
      if (purpose === "RAW_DESIGN" && !snapshot.patientAudit.enabled)
        throw new QueryDeliveryError("PATIENT_AUDIT_NOT_CONFIRMED", 503);
      const patient = snapshot.patientAudit.enabled ? await deps.patientState(datasetId, transaction) : null;
      if (patient && patient.status !== "CONFIRMED") throw new QueryDeliveryError("PATIENT_AUDIT_NOT_CONFIRMED", 503);
      const parameters = await deps.parameters(datasetId, transaction);
      const fingerprint = createHash("sha256").update(JSON.stringify([
        purpose, actor.userId, actor.tokenVersion, [...actor.permissions].sort(), snapshot,
        dataset, source, parameters, patient?.fingerprint,
      ])).digest("hex");
      return { actor, dataset, snapshot, parameters, fingerprint };
    }
    const initial = await inspect();
    const revalidate = async (transaction?: sql.Transaction) => {
      if ((await inspect(transaction)).fingerprint !== initial.fingerprint) throw new QueryDeliveryError("DATASET_DELIVERY_VERSION_CONFLICT");
    };
    await revalidate();
    return { ...initial, purpose, revalidate, identity };
  }
  type Context = Awaited<ReturnType<typeof open>>;

  async function execute(context: Context, values: Record<string, unknown>, maxRows?: number) {
    await context.revalidate();
    const raw = await deps.execute(context.dataset.id, values, maxRows);
    await context.revalidate();
    let disclosureId: number | null = null;
    if (context.snapshot.patientAudit.enabled) {
      disclosureId = await deps.auditPatient({ datasetId: context.dataset.id, userId: context.actor.userId,
        sourceScope: `datasource:${context.dataset.dataSourceId}`, deliveryType: "MANUAL",
        masked: true, rows: raw.rows });
      if (raw.rows.length && (!Number.isSafeInteger(disclosureId) || Number(disclosureId) <= 0))
        throw new QueryDeliveryError("PATIENT_DISCLOSURE_REQUIRED", 503);
    }
    await context.revalidate();
    // Designer previews use the same Dataset policy as Query and Dashboard.
    // RAW_DESIGN is an audited purpose, never permission to bypass masking.
    const safe = applyDatasetDeliveryPolicy({ policy: context.snapshot.policy,
      columns: raw.columns, rows: raw.rows });
    const result: QueryResult = { columns: safe.columns, rows: safe.rows, rowCount: raw.rowCount,
      truncated: raw.truncated, elapsedMs: raw.elapsedMs };
    return { result, disclosureId };
  }

  async function prepareOptions(parent: Context, name: string) {
    const parameters = runtimeParameterDefinitions(parent.dataset.sqlText, parent.parameters);
    const parameter = parameters.find(p => p.name === name);
    if (!parameter) throw new QueryDeliveryError("PARAMETER_NOT_FOUND", 404);
    if (parameter.optionMode === "NONE" || parameter.optionMode === "FIXED") {
      return { parent, source: null, parameter, revalidate: parent.revalidate };
    }
    if (parameter.optionMode !== "DATASET" || !Number.isSafeInteger(parameter.lookupDatasetId) || Number(parameter.lookupDatasetId) <= 0
      || !parameter.lookupValueField || !parameter.lookupLabelField) throw new QueryDeliveryError("PARAMETER_LOOKUP_NOT_CONFIGURED");
    // Never substitute the parent Dataset policy for the actual lookup source.
    const source = await open(parameter.lookupDatasetId!, parent.identity, "STANDARD");
    const protectedFields = new Set(source.snapshot.policy.rules.filter(r => r.mode !== "NONE").map(r => r.columnName.toUpperCase()));
    if ([parameter.lookupValueField, parameter.lookupLabelField].some(field => protectedFields.has(field.toUpperCase())))
      throw new QueryDeliveryError("PARAMETER_LOOKUP_PROTECTED_FIELD");
    const active = runtimeParameterDefinitions(source.dataset.sqlText, source.parameters);
    if (active.some(p => p.isRequired && p.defaultValue == null)) throw new QueryDeliveryError("PARAMETER_LOOKUP_REQUIRES_INPUT");
    const revalidate = async (transaction?: sql.Transaction) => { await parent.revalidate(transaction); await source.revalidate(transaction); };
    await revalidate();
    return { parent, source, parameter, revalidate };
  }

  async function options(plan: Awaited<ReturnType<typeof prepareOptions>>) {
    await plan.revalidate();
    if (!plan.source) return fixedParameterOptions(plan.parameter);
    const { result } = await execute(plan.source, {}, 500);
    const valueField = result.columns.find(c => c.name === plan.parameter.lookupValueField)?.name;
    const labelField = result.columns.find(c => c.name === plan.parameter.lookupLabelField)?.name;
    if (!valueField || !labelField) throw new QueryDeliveryError("PARAMETER_LOOKUP_COLUMN_INVALID");
    const values = result.rows.map(row => ({ value: row[valueField], label: String(row[labelField] ?? row[valueField] ?? "") }));
    if (values.some(item => item.value != null && !["string", "number", "boolean"].includes(typeof item.value)))
      throw new QueryDeliveryError("PARAMETER_LOOKUP_VALUE_INVALID");
    await plan.revalidate();
    return values;
  }
  return { open, execute, prepareOptions, options };
}
