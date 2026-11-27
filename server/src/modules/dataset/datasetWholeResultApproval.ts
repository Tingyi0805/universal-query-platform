import { z } from "zod";

/**
 * Whole-result approval contract for authenticated, source-minimized SQL results.
 * This module does not issue approvals, classify patients, grant permissions or
 * authorize public/device playback. A caller must first prove a durable manager
 * decision, current session and ACL, source identity, and mandatory audit.
 * Existing clinical-disclosure and masking policies cannot be replaced by it.
 */
const version = z.string().regex(/^[0-9a-f]{16}$/u);
const id = z.number().int().positive().safe();
const columnName = z.string().min(1).max(256).refine(
  name => name.trim() === name && !/[\x00-\x1f\x7f]/u.test(name),
);
const manifest = z.array(columnName).min(1).max(128).refine(
  columns => new Set(columns.map(name => name.toUpperCase())).size === columns.length,
);
export const wholeResultApprovalSchema = z.object({
  scope: z.literal("INTERNAL_SOURCE_MINIMIZED"),
  datasetId: id,
  definitionVersion: version,
  dataSourceId: id,
  sourceConfigurationVersion: version,
  approvedBy: id,
  auditLogId: id,
  columns: manifest,
}).strict();

export type WholeResultApproval = z.infer<typeof wholeResultApprovalSchema>;
export type CurrentResultDefinition = Pick<WholeResultApproval,
  "datasetId" | "definitionVersion" | "dataSourceId" | "sourceConfigurationVersion">;

export class WholeResultApprovalError extends Error {
  constructor(readonly code: "WHOLE_RESULT_APPROVAL_INVALID" | "WHOLE_RESULT_APPROVAL_STALE" |
    "WHOLE_RESULT_SHAPE_CHANGED" | "WHOLE_RESULT_SCOPE_FORBIDDEN") {
    super(code);
  }
}

/** Pure comparison only. Input must be read from durable server-owned evidence,
 * never accepted from the preview/execute HTTP body. */
export function assertWholeResultApproval(evidence: unknown, current: CurrentResultDefinition,
  use: "INTERNAL" | "PUBLIC" | "DEVICE" | "PIN"): WholeResultApproval {
  if (use !== "INTERNAL") throw new WholeResultApprovalError("WHOLE_RESULT_SCOPE_FORBIDDEN");
  const parsed = wholeResultApprovalSchema.safeParse(evidence);
  if (!parsed.success) throw new WholeResultApprovalError("WHOLE_RESULT_APPROVAL_INVALID");
  const approved = parsed.data;
  if (approved.datasetId !== current.datasetId ||
      approved.definitionVersion !== current.definitionVersion ||
      approved.dataSourceId !== current.dataSourceId ||
      approved.sourceConfigurationVersion !== current.sourceConfigurationVersion) {
    throw new WholeResultApprovalError("WHOLE_RESULT_APPROVAL_STALE");
  }
  return approved;
}

/** Check actual ordered result metadata, including zero-row results. Unexpected
 * row properties are rejected, not silently exposed. This is not semantic
 * classification, source-fence proof or a substitute for patient disclosure audit. */
export function assertWholeResultShape(approval: WholeResultApproval,
  columns: readonly Readonly<{ name: string }>[],
  rows: readonly Readonly<Record<string, unknown>>[]): void {
  const parsed = wholeResultApprovalSchema.safeParse(approval);
  if (!parsed.success) throw new WholeResultApprovalError("WHOLE_RESULT_APPROVAL_INVALID");
  const names = parsed.data.columns;
  if (!Array.isArray(columns) || columns.length !== names.length ||
      columns.some((column, i) => !column || column.name !== names[i]) ||
      !Array.isArray(rows)) {
    throw new WholeResultApprovalError("WHOLE_RESULT_SHAPE_CHANGED");
  }
  const allowed = new Set(names);
  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row) ||
        Object.keys(row).length !== names.length ||
        Object.keys(row).some(key => !allowed.has(key)) ||
        names.some(name => !Object.hasOwn(row, name))) {
      throw new WholeResultApprovalError("WHOLE_RESULT_SHAPE_CHANGED");
    }
  }
}
