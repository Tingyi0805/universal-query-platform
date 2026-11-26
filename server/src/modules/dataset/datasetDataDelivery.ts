import type sql from "mssql";
import { createHash } from "node:crypto";
import type { QueryResult } from "../../query/query.types.js";
import { auditDashboardPatientList } from "../audit/patientDisclosure.service.js";
import { getDataSourcePlaybackState } from "../datasource/datasource.repository.js";
import { QueryDeliveryError, type RuntimeIdentity } from "../queryDefinition/queryDelivery.js";
import { getDataset } from "./dataset.repository.js";
import { executeSavedDataset, fixedParameterOptions } from "./dataset.service.js";
import { applyDatasetDeliveryPolicy } from "./datasetDeliveryPolicy.js";
import { readConfirmedDatasetDeliverySnapshot, DatasetDeliverySnapshotError, type ConfirmedDatasetDeliverySnapshot } from "./datasetDeliveryPolicy.repository.js";
import { readManagerDesignPreviewApproval, type ManagerDesignPreviewSnapshot } from "./datasetManagerDesignPreview.repository.js";
import { patientAuditService } from "./patientAuditContract.repository.js";
import { listDatasetParameters } from "./parameter.repository.js";
import { runtimeParameterDefinitions } from "./parameterSync.js";

export const defaultDatasetDataDependencies = {
  dataset: getDataset, snapshot: readConfirmedDatasetDeliverySnapshot, source: getDataSourcePlaybackState,
  managerPreview: readManagerDesignPreviewApproval,
  parameters: listDatasetParameters, patientState: patientAuditService.dashboardState,
  auditPatient: auditDashboardPatientList, execute: executeSavedDataset,
};

/** Dataset management authorization is global DESIGN_QUERY + EXECUTE_QUERY.
 * Ordinary Query lookup is not granted this authority and remains closed.
 * This service never syncs columns, records preview proof, or executes candidate SQL.
 */
export function createDatasetDataDelivery(deps = defaultDatasetDataDependencies) {
  async function open(datasetId: number, identity: (transaction?: sql.Transaction) => Promise<RuntimeIdentity>,
    purpose: "STANDARD" | "RAW_DESIGN" | "DESIGN_CONTEXT" = "STANDARD", expectedDefinitionVersion?: string) {
    if (purpose === "RAW_DESIGN" && !/^[0-9a-f]{16}$/u.test(expectedDefinitionVersion ?? ""))
      throw new QueryDeliveryError("DATASET_PREVIEW_VERSION_REQUIRED");
    async function inspect(transaction?: sql.Transaction) {
      const actor = await identity(transaction);
      if (!["DESIGN_QUERY", "EXECUTE_QUERY"].every(p => actor.permissions.includes(p)))
        throw new QueryDeliveryError("FORBIDDEN", 403);
      // Reject unapproved/archived definitions and unavailable sources before
      // inspecting legacy delivery policy. The same order applies at revalidation.
      const dataset = await deps.dataset(datasetId, transaction);
      if (!dataset?.isActive || dataset.isArchived || dataset.id !== datasetId) throw new QueryDeliveryError("DATASET_NOT_AVAILABLE");
      const source = await deps.source(dataset.dataSourceId, transaction);
      if (!source?.isActive) throw new QueryDeliveryError("DATASOURCE_NOT_AVAILABLE");
      let snapshot: ConfirmedDatasetDeliverySnapshot | ManagerDesignPreviewSnapshot;
      try {
        snapshot = await deps.snapshot(datasetId, undefined, transaction);
      } catch (error) {
        if (!(error instanceof DatasetDeliverySnapshotError) || error.code !== "DATASET_DELIVERY_POLICY_UNCONFIRMED" ||
            purpose === "STANDARD" || actor.pinSession || !actor.permissions.includes("MANAGE_USERS")) throw error;
        // Only a manager preview of a freshly approved saved definition may use
        // the new path. Ordinary execution, lookup, PIN and configured legacy
        // patient/masking policies are not bypassed.
        snapshot = await deps.managerPreview(datasetId, transaction);
      }
      if (snapshot.datasetId !== datasetId || !/^[0-9a-f]{16}$/u.test(snapshot.definitionVersion))
        throw new QueryDeliveryError("DATASET_DELIVERY_VERSION_INVALID", 503);
      if (snapshot.policy !== null) {
        if (snapshot.sensitivityVersion !== snapshot.policy.version) throw new QueryDeliveryError("DATASET_DELIVERY_VERSION_INVALID", 503);
        applyDatasetDeliveryPolicy({ policy: snapshot.policy, columns: [], rows: [] });
      } else if (purpose === "STANDARD" || snapshot.managerApproval.dataSourceId !== dataset.dataSourceId) {
        throw new QueryDeliveryError("MANAGER_PREVIEW_APPROVAL_REQUIRED");
      }
      if (purpose === "RAW_DESIGN" && snapshot.definitionVersion !== expectedDefinitionVersion)
        throw new QueryDeliveryError("DATASET_DELIVERY_VERSION_CONFLICT");
      // A non-patient Dataset does not require the patient-only disclosure
      // configuration merely to use the ordinary, masked Designer preview.
      // When patient disclosure auditing is enabled, its existing confirmation
      // and durable-receipt requirements below remain mandatory.
      if (snapshot.patientAudit.enabled && !snapshot.patientAudit.configured)
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
    if (context.purpose === "DESIGN_CONTEXT") throw new QueryDeliveryError("DATASET_PREVIEW_VERSION_REQUIRED");
    await context.revalidate();
    const raw = await deps.execute(context.dataset.id, values, maxRows);
    await context.revalidate();
    if (context.snapshot.policy === null) {
      // The manager has authorized this saved SQL definition for design preview.
      // Output comes from the source SQL, not a fabricated confirmed policy.
      if (context.purpose !== "RAW_DESIGN" || !context.actor.permissions.includes("MANAGE_USERS") || context.actor.pinSession)
        throw new QueryDeliveryError("FORBIDDEN", 403);
      return { result: raw, disclosureId: null };
    }
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
    if (source.snapshot.policy === null) throw new QueryDeliveryError("PARAMETER_LOOKUP_PROTECTED_FIELD");
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
