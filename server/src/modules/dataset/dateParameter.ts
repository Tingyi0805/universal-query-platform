import { env } from "../../config/env.js";

export type DateOutputMode = "NATIVE" | "STRING";
export type DateCalendar = "GREGORIAN" | "ROC";

const DATE_TOKEN = /^\$TODAY(?:([+-])(\d+))?$/;

function zonedParts(now: Date): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: env.PLATFORM_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);

  const value = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);

  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
    second: value("second"),
  };
}

function addDays(parts: ReturnType<typeof zonedParts>, days: number) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days, parts.hour, parts.minute, parts.second));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
    second: date.getUTCSeconds(),
  };
}

export function isDynamicDateExpression(value: unknown): boolean {
  if (typeof value !== "string") return false;
  return DATE_TOKEN.test(value) || ["$NOW", "$TODAY_START", "$TODAY_END"].includes(value);
}

export function resolveDynamicDateExpression(
  expression: string,
  now = new Date(),
): Date {
  const current = zonedParts(now);
  const match = DATE_TOKEN.exec(expression);

  if (match) {
    const direction = match[1] === "-" ? -1 : 1;
    const offset = match[2] ? Number(match[2]) * direction : 0;
    const target = addDays({ ...current, hour: 0, minute: 0, second: 0 }, offset);
    return new Date(Date.UTC(target.year, target.month - 1, target.day, 0, 0, 0, 0));
  }

  if (expression === "$NOW") return now;

  if (expression === "$TODAY_START") {
    return new Date(Date.UTC(current.year, current.month - 1, current.day, 0, 0, 0, 0));
  }

  if (expression === "$TODAY_END") {
    return new Date(Date.UTC(current.year, current.month - 1, current.day, 23, 59, 59, 999));
  }

  throw new Error("PARAMETER_DYNAMIC_DATE_INVALID");
}

export function parseCanonicalDate(value: unknown, includeTime: boolean): Date {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new Error(includeTime ? "PARAMETER_DATETIME_INVALID" : "PARAMETER_DATE_INVALID");
    return value;
  }

  const text = String(value);
  if (isDynamicDateExpression(text)) return resolveDynamicDateExpression(text);

  if (!includeTime) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error("PARAMETER_DATE_INVALID");
    const date = new Date(`${text}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) throw new Error("PARAMETER_DATE_INVALID");
    return date;
  }

  const date = new Date(text);
  if (Number.isNaN(date.getTime())) throw new Error("PARAMETER_DATETIME_INVALID");
  return date;
}

function dateParts(date: Date) {
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
    second: date.getUTCSeconds(),
  };
}

export function formatParameterDate(
  date: Date,
  calendar: DateCalendar,
  format: string,
): string {
  const parts = dateParts(date);
  const year = calendar === "ROC" ? parts.year - 1911 : parts.year;
  const yearText = String(year);
  const tokenValues: Record<string, string> = {
    yyyy: yearText.padStart(4, "0"),
    yyy: yearText.padStart(3, "0"),
    yy: yearText.slice(-2).padStart(2, "0"),
    MM: String(parts.month).padStart(2, "0"),
    M: String(parts.month),
    dd: String(parts.day).padStart(2, "0"),
    d: String(parts.day),
    HH: String(parts.hour).padStart(2, "0"),
    H: String(parts.hour),
    mm: String(parts.minute).padStart(2, "0"),
    m: String(parts.minute),
    ss: String(parts.second).padStart(2, "0"),
    s: String(parts.second),
  };

  return format.replace(/yyyy|yyy|yy|MM|M|dd|d|HH|H|mm|m|ss|s/g, (token) => tokenValues[token] ?? token);
}

export function defaultDateFormat(
  dataType: "DATE" | "DATETIME",
  calendar: DateCalendar,
): string {
  if (dataType === "DATETIME") {
    return calendar === "ROC" ? "yyy/MM/dd HH:mm:ss" : "yyyy-MM-dd HH:mm:ss";
  }
  return calendar === "ROC" ? "yyy/MM/dd" : "yyyy-MM-dd";
}

export function resolveDateForRuntimeInput(
  value: string | null,
  dataType: "DATE" | "DATETIME",
): string | null {
  if (!value) return value;
  if (!isDynamicDateExpression(value)) return value;

  const date = resolveDynamicDateExpression(value);
  if (dataType === "DATE") {
    return formatParameterDate(date, "GREGORIAN", "yyyy-MM-dd");
  }
  return formatParameterDate(date, "GREGORIAN", "yyyy-MM-ddTHH:mm");
}

export function previewDateParameter(
  value: string | null,
  dataType: "DATE" | "DATETIME",
  outputMode: DateOutputMode,
  calendar: DateCalendar,
  format: string | null,
): { inputValue: string | null; outputValue: string | null } {
  if (!value) return { inputValue: value, outputValue: value };

  const date = parseCanonicalDate(value, dataType === "DATETIME");
  const inputValue = dataType === "DATE"
    ? formatParameterDate(date, "GREGORIAN", "yyyy-MM-dd")
    : formatParameterDate(date, "GREGORIAN", "yyyy-MM-ddTHH:mm");

  const outputValue = outputMode === "STRING"
    ? formatParameterDate(date, calendar, format || defaultDateFormat(dataType, calendar))
    : inputValue;

  return { inputValue, outputValue };
}
