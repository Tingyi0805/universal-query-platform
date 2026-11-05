// Formats only values already authorized/masked by the server. Masked text stays unchanged.
export const displayFormats = { TEXT: "原始文字", NUMBER: "數字（千分位）", DATE: "日期 YYYY/MM/DD", DATETIME: "日期時間（UTC）" };
export function formatDashboardValue(text: string, format: unknown): string {
  if (format === "NUMBER" && /^-?\d+(\.\d+)?$/.test(text)) {
    const number = Number(text);
    if (Number.isFinite(number)) return new Intl.NumberFormat("zh-TW", {maximumFractionDigits: 10}).format(number);
  }
  if ((format === "DATE" || format === "DATETIME") && /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)?$/.test(text)) {
    const date = new Date(text);
    if (!Number.isNaN(date.getTime())) {
      const iso = date.toISOString();
      return iso.slice(0,10).replace(/-/g,"/") + (format === "DATETIME" ? ` ${iso.slice(11,19)} UTC` : "");
    }
  }
  return text;
}
