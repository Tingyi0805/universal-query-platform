import { createHash } from "node:crypto";
import { extractParameterNames } from "../../query/queryCompiler.js";
import type { DatasetParameterRecord } from "./parameter.repository.js";

export function detectParameterNames(sqlText: string): string[] {
  // Never treat malformed/unrecognized template syntax as an empty successful parse.
  const remainder = sqlText.replace(/\{\{[A-Z][A-Z0-9_]*\}\}/g, "");
  const names = extractParameterNames(sqlText);
  if (remainder.includes("{{") || remainder.includes("}}") || names.length > 100 || names.some(name => name.length > 100)) {
    throw new Error("PARAMETER_PARSE_FAILED");
  }
  return names;
}

export function runtimeParameterDefinitions(sqlText: string, parameters: DatasetParameterRecord[]) {
  const detected = detectParameterNames(sqlText);
  if (detected.some(name => !parameters.some(p => p.name === name))) throw new Error("PARAMETER_DEFINITION_MISMATCH");
  return parameters.filter(p => detected.includes(p.name));
}

export function parameterPreview(datasetId: number, sqlText: string, parameters: DatasetParameterRecord[]) {
  const previewToken = createHash("sha256").update(JSON.stringify([datasetId, sqlText, parameters])).digest("hex");
  try {
    const detected = detectParameterNames(sqlText);
    const saved = parameters.map(parameter => parameter.name);
    return { previewToken, detectionStatus: "OK" as const, detected,
      added: detected.filter(name => !saved.includes(name)),
      retained: saved.filter(name => detected.includes(name)),
      unused: saved.filter(name => !detected.includes(name)) };
  } catch {
    return { previewToken, detectionStatus: "FAILED" as const, detected: [], added: [], retained: parameters.map(p => p.name), unused: [] };
  }
}

export function validateParameterSync(preview: ReturnType<typeof parameterPreview>, expectedToken: string, removeNames: string[]) {
  if (preview.previewToken !== expectedToken) throw new Error("PARAMETER_PREVIEW_STALE");
  if (preview.detectionStatus !== "OK") throw new Error("PARAMETER_PARSE_FAILED");
  if (preview.added.length + preview.retained.length + preview.unused.length - removeNames.length > 100) throw new Error("PARAMETER_SYNC_LIMIT");
  // Zero detections never authorize deletion, even with an explicit removal list.
  if (removeNames.length && (!preview.detected.length || new Set(removeNames).size !== removeNames.length ||
    removeNames.some(name => !preview.unused.includes(name)))) throw new Error("PARAMETER_REMOVAL_INVALID");
}
