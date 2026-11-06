// Civil Asia/Taipei time is UTC+08:00 for supported device expiry years.
const offset = 8 * 60 * 60 * 1000;
export function taipeiDateTime(utc: string | null): string {
  if (utc === null) return "";
  const instant = Date.parse(utc);
  if (!Number.isFinite(instant)) return "無效日期";
  return new Date(instant + offset).toISOString().slice(0, 16).replace("T", " ");
}
export function parseTaipeiDateTime(text: string): string | null {
  if (text === "") return null;
  if (!/^[1-9]\d{3}-\d{2}-\d{2} \d{2}:\d{2}$/.test(text)) throw new Error("INVALID_DATE_TIME");
  const civil = Date.parse(text.replace(" ", "T") + ":00.000Z");
  if (!Number.isFinite(civil) || new Date(civil).toISOString().slice(0, 16).replace("T", " ") !== text) throw new Error("INVALID_DATE_TIME");
  return new Date(civil - offset).toISOString();
}
export function validDeviceExpiry(utc: string | null, now = Date.now()) {
  return utc === null || Number.isFinite(Date.parse(utc)) && Date.parse(utc) > now;
}
