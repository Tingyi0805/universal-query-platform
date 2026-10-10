import type { DatasetParameterRecord } from "./parameter.repository.js";
import {
  defaultDateFormat,
  formatParameterDate,
  isDynamicDateExpression,
  parseCanonicalDate,
} from "./dateParameter.js";

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

function parseDateValue(parameter: DatasetParameterRecord, value: unknown): unknown {
  const includeTime = parameter.dataType === "DATETIME";
  const text = String(value);

  // Existing dashboards may already contain DB-formatted string values.
  // Preserve those values in STRING mode, while canonical UI values and
  // dynamic expressions are resolved and formatted consistently.
  if (
    parameter.dateOutputMode === "STRING" &&
    !isDynamicDateExpression(text) &&
    !(includeTime ? /^\d{4}-\d{2}-\d{2}T/.test(text) : /^\d{4}-\d{2}-\d{2}$/.test(text))
  ) {
    return text;
  }

  let date: Date;
  try {
    date = parseCanonicalDate(value, includeTime);
  } catch (error) {
    const code = includeTime ? "PARAMETER_DATETIME_INVALID" : "PARAMETER_DATE_INVALID";
    void error;
    throw new Error(`${code}:${parameter.name}`);
  }

  if (parameter.dateOutputMode === "STRING") {
    return formatParameterDate(
      date,
      parameter.dateCalendar,
      parameter.dateFormat || defaultDateFormat(parameter.dataType, parameter.dateCalendar),
    );
  }

  return date;
}

function parseScalar(parameter: DatasetParameterRecord, value: unknown): unknown {
  if (isBlank(value)) {
    if (parameter.defaultValue != null && parameter.defaultValue !== "") {
      value = parameter.defaultValue;
    } else {
      if (parameter.isRequired) throw new Error(`PARAMETER_REQUIRED:${parameter.name}`);
      return null;
    }
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
    case "DATE":
    case "DATETIME":
      return parseDateValue(parameter, value);
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

      if (parameter.isRequired && values.length === 0 && !parameter.defaultValue) {
        throw new Error(`PARAMETER_REQUIRED:${parameter.name}`);
      }

      const sourceValues = values.length > 0
        ? values
        : parameter.defaultValue
          ? [parameter.defaultValue]
          : [];

      result[parameter.name] = sourceValues.map((value) => parseScalar(
        { ...parameter, isRequired: false },
        value,
      ));
      continue;
    }

    result[parameter.name] = parseScalar(parameter, raw);
  }

  return result;
}
