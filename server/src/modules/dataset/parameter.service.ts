import type { DatasetParameterRecord } from "./parameter.repository.js";

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

function parseBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const text = String(value).trim().toLowerCase();
  if (["true","1","yes","y"].includes(text)) return true;
  if (["false","0","no","n"].includes(text)) return false;
  throw new Error("PARAMETER_BOOLEAN_INVALID");
}

function parseScalar(parameter: DatasetParameterRecord, value: unknown): unknown {
  if (isBlank(value)) {
    if (parameter.isRequired) throw new Error(`PARAMETER_REQUIRED:${parameter.name}`);
    if (parameter.defaultValue == null || parameter.defaultValue === "") return null;
    value = parameter.defaultValue;
  }

  switch (parameter.dataType) {
    case "STRING":
      return String(value);
    case "NUMBER": {
      const number = Number(value);
      if (!Number.isFinite(number)) throw new Error(`PARAMETER_NUMBER_INVALID:${parameter.name}`);
      return number;
    }
    case "BOOLEAN":
      return parseBoolean(value);
    case "DATE": {
      const text = String(value);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error(`PARAMETER_DATE_INVALID:${parameter.name}`);
      const date = new Date(`${text}T00:00:00.000Z`);
      if (Number.isNaN(date.getTime())) throw new Error(`PARAMETER_DATE_INVALID:${parameter.name}`);
      return date;
    }
    case "DATETIME": {
      const date = new Date(String(value));
      if (Number.isNaN(date.getTime())) throw new Error(`PARAMETER_DATETIME_INVALID:${parameter.name}`);
      return date;
    }
  }
}

export function coerceRuntimeParameters(
  definitions: DatasetParameterRecord[],
  rawValues: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const parameter of definitions) {
    const raw = rawValues[parameter.name];

    if (parameter.controlType === "MULTISELECT") {
      const values = Array.isArray(raw)
        ? raw
        : isBlank(raw)
          ? []
          : String(raw).split(",").map((value) => value.trim()).filter(Boolean);

      if (parameter.isRequired && values.length === 0) {
        throw new Error(`PARAMETER_REQUIRED:${parameter.name}`);
      }

      result[parameter.name] = values.map((value) => parseScalar(
        { ...parameter, isRequired: false },
        value,
      ));
      continue;
    }

    result[parameter.name] = parseScalar(parameter, raw);
  }

  return result;
}
