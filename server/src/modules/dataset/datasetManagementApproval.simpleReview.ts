import { z } from "zod";
import type { DatasetSensitiveColumn } from "./datasetSensitiveColumn.repository.js";

const revision = z.string().regex(/^[0-9a-f]{16}$/);
export const simpleReviewSchema = z.object({
  expectedDefinitionVersion: revision,
  expectedSourceVersion: revision,
  expectedPolicyVersion: z.literal(0),
  requestId: z.string().uuid(),
  confirmedNoPatientData: z.literal(true),
  columns: z.array(z.object({
    columnName: z.string().trim().min(1).max(256),
    decision: z.enum(["GENERAL", "MASK_ALL", "HIDE"]),
  }).strict()).min(1).max(300),
}).strict();

export type SimpleReviewInput = z.infer<typeof simpleReviewSchema>;
export class SimpleReviewError extends Error {
  constructor(readonly code: "REVIEW_COLUMNS_NOT_READY" | "REVIEW_COLUMN_MISMATCH" |
    "REVIEW_PATIENT_SCOPE_REQUIRED" | "REVIEW_VERSION_CONFLICT" |
    "REVIEW_EXISTING_POLICY", readonly status = 409) {
    super(code);
    this.name = "SimpleReviewError";
  }
}

/**
 * The administrator is responsible for positively verifying non-patient scope
 * and each field; no unclassified field is implicitly considered safe.
 * This proposal becomes valid only after the repository checks Dataset/source
 * revisions, policy version, complete saved field membership and absence of
 * an existing patient audit configuration under the same SQL transaction.
 */
export function simpleReviewEligible(policyVersion: number, existingRules: number, columnCount: number,
  hasPatientAuditEvidence: boolean, sourceType: string): boolean {
  return policyVersion === 0 && existingRules === 0 && columnCount > 0 && columnCount <= 300
    && !hasPatientAuditEvidence && ["SQLSERVER", "ORACLE"].includes(sourceType);
}

export function buildSimpleNonPatientRules(
  saved: readonly {name: string}[], input: SimpleReviewInput,
): DatasetSensitiveColumn[] {
  if (input.confirmedNoPatientData !== true) throw new SimpleReviewError("REVIEW_PATIENT_SCOPE_REQUIRED");
  if (!saved.length || saved.length > 300 ||
      saved.some(c => !c.name || c.name.trim() !== c.name || c.name.length > 256) ||
      new Set(saved.map(c => c.name.toUpperCase())).size !== saved.length)
    throw new SimpleReviewError("REVIEW_COLUMNS_NOT_READY");

  const proposed = new Map<string, SimpleReviewInput["columns"][number]>();
  for (const c of input.columns) {
    const key = c.columnName.toUpperCase();
    if (proposed.has(key)) throw new SimpleReviewError("REVIEW_COLUMN_MISMATCH");
    proposed.set(key, c);
  }
  if (proposed.size !== saved.length ||
      saved.some(c => !proposed.has(c.name.toUpperCase())))
    throw new SimpleReviewError("REVIEW_COLUMN_MISMATCH");
  return saved.map(c => {
    const choice = proposed.get(c.name.toUpperCase())!.decision;
    return {
      columnName: c.name,
      sensitivityType: choice === "GENERAL" ? "OTHER" : "GENERIC",
      deviceMaskMode: choice === "GENERAL" ? "NONE" : choice === "MASK_ALL" ? "FULL" : "OMIT",
      customMask: null,
    };
  });
}
