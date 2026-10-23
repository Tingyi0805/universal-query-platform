import type sql from "mssql";
import type { createDatasetDataDelivery } from "./datasetDataDelivery.js";
import { QueryDeliveryError, type RuntimeIdentity } from "../queryDefinition/queryDelivery.js";

/** Admission only: candidates never execute and never sync columns or establish proof.
 * Successful admission returns the exact saved-definition context, not candidate SQL.
 */
export function createPatientAuditPreview(delivery: Pick<ReturnType<typeof createDatasetDataDelivery>, "open">) {
  return async (input: { datasetId?: number; dataSourceId: number; sqlText: string; expectedDefinitionVersion?: string },
    identity: (transaction?: sql.Transaction) => Promise<RuntimeIdentity>) => {
    if (!input.datasetId) throw new QueryDeliveryError("DATASET_CANDIDATE_PREVIEW_UNAVAILABLE");
    const context = await delivery.open(input.datasetId, identity, "RAW_DESIGN", input.expectedDefinitionVersion);
    if (input.sqlText !== context.dataset.sqlText || input.dataSourceId !== context.dataset.dataSourceId)
      throw new QueryDeliveryError("DATASET_CANDIDATE_PREVIEW_UNAVAILABLE");
    await context.revalidate();
    return context;
  };
}
