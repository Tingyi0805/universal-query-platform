/** Advisory only. A suggestion never changes a Dataset policy until an administrator explicitly applies and saves it. */
export type MaskSuggestion = { label: string; mode: "CUSTOM" | "FULL" | "OMIT"; prefix: number; suffix: number; symbol: string };
type Template = MaskSuggestion & { aliases: readonly string[] };
const templates: readonly Template[] = [
  { label: "患者姓名", aliases: ["姓名","患者姓名","病人姓名","PATIENT_NAME","PATNAME","PAT_NAME"], mode: "CUSTOM", prefix: 1, suffix: 1, symbol: "○" },
  { label: "病歷號", aliases: ["病歷號","MRN","REGNO","MEDICAL_RECORD_NUMBER"], mode: "CUSTOM", prefix: 0, suffix: 4, symbol: "*" },
  { label: "聯絡電話", aliases: ["電話","手機","MOBILE","PHONE","TELEPHONE"], mode: "CUSTOM", prefix: 3, suffix: 3, symbol: "○" },
  { label: "身分證字號", aliases: ["身分證號","身分證字號","NATIONAL_ID","IDNO"], mode: "OMIT", prefix: 0, suffix: 0, symbol: "○" },
  { label: "生日", aliases: ["出生日期","生日","BIRTH_DATE","BIRTHDAY","DOB"], mode: "OMIT", prefix: 0, suffix: 0, symbol: "○" },
  { label: "地址", aliases: ["地址","HOME_ADDRESS","ADDRESS"], mode: "OMIT", prefix: 0, suffix: 0, symbol: "○" },
];
const normalized = (value: string) => value.trim().normalize("NFKC").toLocaleUpperCase("en-US");
export function suggestSensitivityRule(columnName: string): MaskSuggestion | null {
  if (!columnName || columnName.length > 256) return null;
  const key = normalized(columnName);
  const matches = templates.filter(t => t.aliases.some(alias => normalized(alias) === key));
  if (matches.length !== 1) return null;
  const { label, mode, prefix, suffix, symbol } = matches[0]!;
  return { label, mode, prefix, suffix, symbol };
}
