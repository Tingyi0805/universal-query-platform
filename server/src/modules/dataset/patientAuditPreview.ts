import type { previewDataset } from "./dataset.service.js";
import type { syncDatasetColumns } from "./column.repository.js";
import type { createPatientAuditService } from "./patientAuditConfig.service.js";
import { withErrorModule } from "../../middleware/safeErrorDiagnostic.js";

export function createPatientAuditPreview(deps: { execute: typeof previewDataset; sync: typeof syncDatasetColumns;
  record: ReturnType<typeof createPatientAuditService>["recordPreview"] }) {
  return async (input: Parameters<typeof previewDataset>[0], userId: number,
    context: { ipAddress?: string | null; userAgent?: string | null }) => {
    // Only this successful executor result can establish aliases. No request-supplied metadata.
    const result = await deps.execute(input);
    if (input.datasetId) {
      await withErrorModule("dataset.columns.sync", () => deps.sync(input.datasetId!, result.columns));
      await deps.record(input.datasetId, { sqlText: input.sqlText, dataSourceId: input.dataSourceId },
        result.columns.map(column => column.name), userId, context);
    }
    return result;
  };
}
