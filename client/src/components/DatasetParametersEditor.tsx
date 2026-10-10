import { useCallback, useEffect, useMemo, useState } from "react";
import { apiRequest } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import "./DatasetParametersEditor.css";

type DatasetOption = {
  id: number;
  code: string;
  name: string;
};

type DateOutputMode = "NATIVE" | "STRING";
type DateCalendar = "GREGORIAN" | "ROC";
type DateSource = "FIXED" | "TODAY" | "TODAY_OFFSET" | "NOW" | "TODAY_START" | "TODAY_END";

type ParameterRow = {
  id: number;
  datasetId: number;
  name: string;
  label: string;
  dataType: "STRING" | "NUMBER" | "DATE" | "DATETIME" | "BOOLEAN";
  controlType: "TEXT" | "NUMBER" | "DATE" | "DATETIME" | "SELECT" | "MULTISELECT" | "CHECKBOX";
  isRequired: boolean;
  defaultValue: string | null;
  dateOutputMode: DateOutputMode;
  dateCalendar: DateCalendar;
  dateFormat: string | null;
  displayOrder: number;
  placeholder: string | null;
  helpText: string | null;
  optionMode: "NONE" | "FIXED" | "DATASET";
  fixedOptionsJson: string | null;
  lookupDatasetId: number | null;
  lookupValueField: string | null;
  lookupLabelField: string | null;
};

const dateFormats = [
  "yyyy/MM/dd",
  "dd/MM/yyyy",
  "MM/dd/yyyy",
  "yyyy-MM-dd",
  "yyyyMMdd",
  "yyy/MM/dd",
  "yyy-MM-dd",
  "yyyMMdd",
  "yyyy-MM-dd HH:mm:ss",
  "yyy/MM/dd HH:mm:ss",
];

function isDateParameter(parameter: ParameterRow) {
  return parameter.dataType === "DATE" || parameter.dataType === "DATETIME";
}

function dateSource(value: string | null): DateSource {
  if (value === "$TODAY") return "TODAY";
  if (/^\$TODAY[+-]\d+$/.test(value ?? "")) return "TODAY_OFFSET";
  if (value === "$NOW") return "NOW";
  if (value === "$TODAY_START") return "TODAY_START";
  if (value === "$TODAY_END") return "TODAY_END";
  return "FIXED";
}

function dateOffset(value: string | null): number {
  const match = /^\$TODAY([+-])(\d+)$/.exec(value ?? "");
  if (!match) return 0;
  const amount = Number(match[2]);
  return match[1] === "-" ? -amount : amount;
}

function isoToday(offsetDays = 0) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + offsetDays);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function defaultFixedValue(dataType: ParameterRow["dataType"]) {
  if (dataType === "DATE") return isoToday();
  if (dataType === "DATETIME") return `${isoToday()}T00:00`;
  return "";
}

function previewDate(parameter: ParameterRow): { source: string; output: string } {
  if (!isDateParameter(parameter)) return { source: "", output: "" };

  let date: Date;
  const value = parameter.defaultValue ?? "";
  if (value === "$NOW") {
    date = new Date();
  } else if (value === "$TODAY_START" || value === "$TODAY_END") {
    date = new Date(`${isoToday()}T${value === "$TODAY_END" ? "23:59:59" : "00:00:00"}`);
  } else if (value === "$TODAY" || /^\$TODAY[+-]\d+$/.test(value)) {
    date = new Date(`${isoToday(dateOffset(value))}T00:00:00`);
  } else {
    date = new Date(value || defaultFixedValue(parameter.dataType));
  }

  if (Number.isNaN(date.getTime())) return { source: "格式不正確", output: "無法預覽" };

  const gregorianYear = date.getFullYear();
  const year = parameter.dateCalendar === "ROC" ? gregorianYear - 1911 : gregorianYear;
  const values: Record<string, string> = {
    yyyy: String(year).padStart(4, "0"),
    yyy: String(year).padStart(3, "0"),
    yy: String(year).slice(-2).padStart(2, "0"),
    MM: String(date.getMonth() + 1).padStart(2, "0"),
    M: String(date.getMonth() + 1),
    dd: String(date.getDate()).padStart(2, "0"),
    d: String(date.getDate()),
    HH: String(date.getHours()).padStart(2, "0"),
    H: String(date.getHours()),
    mm: String(date.getMinutes()).padStart(2, "0"),
    m: String(date.getMinutes()),
    ss: String(date.getSeconds()).padStart(2, "0"),
    s: String(date.getSeconds()),
  };
  const format = parameter.dateFormat || (
    parameter.dataType === "DATETIME"
      ? parameter.dateCalendar === "ROC" ? "yyy/MM/dd HH:mm:ss" : "yyyy-MM-dd HH:mm:ss"
      : parameter.dateCalendar === "ROC" ? "yyy/MM/dd" : "yyyy-MM-dd"
  );
  const output = format.replace(/yyyy|yyy|yy|MM|M|dd|d|HH|H|mm|m|ss|s/g, (token) => values[token] ?? token);
  const source = parameter.dataType === "DATE"
    ? `${gregorianYear}-${values.MM}-${values.dd}`
    : `${gregorianYear}-${values.MM}-${values.dd} ${values.HH}:${values.mm}:${values.ss}`;

  return {
    source,
    output: parameter.dateOutputMode === "STRING" ? output : `${source}（原生日期）`,
  };
}

export function DatasetParametersEditor({
  datasetId,
  datasets,
  onChanged,
}: {
  datasetId: number;
  datasets: DatasetOption[];
  onChanged?: () => void | Promise<void>;
}) {
  const { accessToken } = useAuth();
  const [parameters, setParameters] = useState<ParameterRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await apiRequest<{ parameters: ParameterRow[] }>(
        `/datasets/${datasetId}/parameters`,
        {},
        accessToken,
      );
      setParameters(result.parameters.map((parameter) => ({
        ...parameter,
        dateOutputMode: parameter.dateOutputMode ?? "NATIVE",
        dateCalendar: parameter.dateCalendar ?? "GREGORIAN",
        dateFormat: parameter.dateFormat ?? null,
      })));
    } catch (e) {
      setError(e instanceof Error ? e.message : "載入參數設定失敗。");
    } finally {
      setLoading(false);
    }
  }, [accessToken, datasetId]);

  useEffect(() => { void load(); }, [load]);

  function update(index: number, patch: Partial<ParameterRow>) {
    setParameters((rows) => rows.map((row, i) => i === index ? { ...row, ...patch } : row));
  }

  function applyControlDefaults(index: number, controlType: ParameterRow["controlType"]) {
    const current = parameters[index];
    const patch: Partial<ParameterRow> = { controlType };

    if (controlType === "NUMBER") patch.dataType = "NUMBER";
    if (controlType === "DATE") patch.dataType = "DATE";
    if (controlType === "DATETIME") patch.dataType = "DATETIME";
    if (controlType === "CHECKBOX") patch.dataType = "BOOLEAN";

    if (controlType === "DATE" || controlType === "DATETIME") {
      patch.dateOutputMode = current?.dateOutputMode ?? "NATIVE";
      patch.dateCalendar = current?.dateCalendar ?? "GREGORIAN";
    }

    if (!["SELECT","MULTISELECT"].includes(controlType)) {
      patch.optionMode = "NONE";
      patch.fixedOptionsJson = null;
      patch.lookupDatasetId = null;
      patch.lookupValueField = null;
      patch.lookupLabelField = null;
    }

    update(index, patch);
  }

  function changeDateSource(index: number, source: DateSource) {
    const parameter = parameters[index];
    if (!parameter) return;

    let defaultValue = parameter.defaultValue;
    if (source === "FIXED") defaultValue = defaultFixedValue(parameter.dataType);
    if (source === "TODAY") defaultValue = "$TODAY";
    if (source === "TODAY_OFFSET") defaultValue = "$TODAY-7";
    if (source === "NOW") defaultValue = "$NOW";
    if (source === "TODAY_START") defaultValue = "$TODAY_START";
    if (source === "TODAY_END") defaultValue = "$TODAY_END";
    update(index, { defaultValue });
  }

  async function save() {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await apiRequest(`/datasets/${datasetId}/parameters`, {
        method: "PUT",
        body: JSON.stringify({
          parameters: parameters.map((parameter, index) => ({
            name: parameter.name,
            label: parameter.label,
            dataType: parameter.dataType,
            controlType: parameter.controlType,
            isRequired: parameter.isRequired,
            defaultValue: parameter.defaultValue || null,
            dateOutputMode: parameter.dateOutputMode ?? "NATIVE",
            dateCalendar: parameter.dateCalendar ?? "GREGORIAN",
            dateFormat: parameter.dateFormat || null,
            displayOrder: index,
            placeholder: parameter.placeholder || null,
            helpText: parameter.helpText || null,
            optionMode: parameter.optionMode,
            fixedOptionsJson: parameter.fixedOptionsJson || null,
            lookupDatasetId: parameter.lookupDatasetId,
            lookupValueField: parameter.lookupValueField || null,
            lookupLabelField: parameter.lookupLabelField || null,
          })),
        }),
      }, accessToken);
      setNotice("參數設定已儲存。日期動態值會於每次查詢執行時重新計算。");
      await load();
      await onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "儲存參數設定失敗。");
    } finally {
      setSaving(false);
    }
  }

  const hasDateParameter = useMemo(() => parameters.some(isDateParameter), [parameters]);

  if (loading) return <section className="parameter-designer"><div className="notice">參數載入中…</div></section>;

  return (
    <section className="parameter-designer">
      <div className="section-title">
        <div>
          <h2>Parameter Designer</h2>
          <p>SQL Token 會自動同步。DATE / DATETIME 支援固定值、今天／相對日期、民國年與自訂輸出格式。</p>
        </div>
        <button className="secondary-button" type="button" onClick={() => void (async () => {
          await load();
          await onChanged?.();
        })()}>重新同步</button>
      </div>

      {hasDateParameter && (
        <div className="parameter-date-note">
          動態日期以 Server 的 <code>PLATFORM_TIME_ZONE</code> 計算；畫面預覽使用目前瀏覽器時間，正式查詢以 Server 為準。
        </div>
      )}

      {error && <div className="form-error">{error}</div>}
      {notice && <div className="notice">{notice}</div>}

      {parameters.length === 0 ? (
        <div className="empty-state">此 Dataset 沒有 <code>{"{{PARAM}}"}</code> 參數。</div>
      ) : (
        <div className="parameter-card-list">
          {parameters.map((parameter, index) => {
            const source = dateSource(parameter.defaultValue);
            const preview = isDateParameter(parameter) ? previewDate(parameter) : null;

            return (
              <article className="parameter-card" key={parameter.name}>
                <div className="parameter-card-head">
                  <code>{parameter.name}</code>
                  <label>
                    <input type="checkbox" checked={parameter.isRequired}
                      onChange={(e) => update(index, { isRequired: e.target.checked })} />
                    必填
                  </label>
                </div>

                <div className="parameter-form-grid">
                  <label>顯示名稱
                    <input value={parameter.label} onChange={(e) => update(index, { label: e.target.value })} />
                  </label>

                  <label>控制項
                    <select value={parameter.controlType}
                      onChange={(e) => applyControlDefaults(index, e.target.value as ParameterRow["controlType"])}>
                      <option value="TEXT">文字</option>
                      <option value="NUMBER">數字</option>
                      <option value="DATE">日期</option>
                      <option value="DATETIME">日期時間</option>
                      <option value="SELECT">下拉選單</option>
                      <option value="MULTISELECT">多選</option>
                      <option value="CHECKBOX">Checkbox</option>
                    </select>
                  </label>

                  <label>資料型別
                    <select value={parameter.dataType}
                      onChange={(e) => update(index, { dataType: e.target.value as ParameterRow["dataType"] })}>
                      <option value="STRING">STRING</option>
                      <option value="NUMBER">NUMBER</option>
                      <option value="DATE">DATE</option>
                      <option value="DATETIME">DATETIME</option>
                      <option value="BOOLEAN">BOOLEAN</option>
                    </select>
                  </label>

                  {!isDateParameter(parameter) && (
                    <label>預設值
                      <input
                        type={parameter.dataType === "NUMBER" ? "number" : "text"}
                        placeholder={parameter.dataType === "BOOLEAN" ? "true / false" : ""}
                        value={parameter.defaultValue ?? ""}
                        onChange={(e) => update(index, { defaultValue: e.target.value })}
                      />
                    </label>
                  )}

                  <label>Placeholder
                    <input value={parameter.placeholder ?? ""}
                      onChange={(e) => update(index, { placeholder: e.target.value })} />
                  </label>

                  <label>說明
                    <input value={parameter.helpText ?? ""}
                      onChange={(e) => update(index, { helpText: e.target.value })} />
                  </label>
                </div>

                {isDateParameter(parameter) && (
                  <div className="date-parameter-config">
                    <div className="parameter-form-grid">
                      <label>預設日期來源
                        <select value={source} onChange={(e) => changeDateSource(index, e.target.value as DateSource)}>
                          <option value="FIXED">固定日期 / 時間</option>
                          <option value="TODAY">今天</option>
                          <option value="TODAY_OFFSET">今天 ± N 天</option>
                          {parameter.dataType === "DATETIME" && <option value="NOW">現在</option>}
                          {parameter.dataType === "DATETIME" && <option value="TODAY_START">今天開始 00:00:00</option>}
                          {parameter.dataType === "DATETIME" && <option value="TODAY_END">今天結束 23:59:59</option>}
                        </select>
                      </label>

                      {source === "FIXED" && (
                        <label>固定值
                          <input
                            type={parameter.dataType === "DATE" ? "date" : "datetime-local"}
                            value={parameter.defaultValue ?? ""}
                            onChange={(e) => update(index, { defaultValue: e.target.value })}
                          />
                        </label>
                      )}

                      {source === "TODAY_OFFSET" && (
                        <label>相對天數
                          <input
                            type="number"
                            min={-3650}
                            max={3650}
                            value={dateOffset(parameter.defaultValue)}
                            onChange={(e) => {
                              const offset = Math.trunc(Number(e.target.value) || 0);
                              update(index, {
                                defaultValue: offset === 0 ? "$TODAY" : `$TODAY${offset > 0 ? "+" : ""}${offset}`,
                              });
                            }}
                          />
                          <small>例如 -7 表示 7 天前，+1 表示明天。</small>
                        </label>
                      )}

                      <label>傳入資料庫型態
                        <select value={parameter.dateOutputMode}
                          onChange={(e) => update(index, { dateOutputMode: e.target.value as DateOutputMode })}>
                          <option value="NATIVE">原生 DATE / DATETIME Bind</option>
                          <option value="STRING">格式化字串</option>
                        </select>
                      </label>
                    </div>

                    {parameter.dateOutputMode === "STRING" && (
                      <div className="parameter-form-grid date-format-grid">
                        <label>曆法
                          <select value={parameter.dateCalendar}
                            onChange={(e) => {
                              const calendar = e.target.value as DateCalendar;
                              update(index, {
                                dateCalendar: calendar,
                                dateFormat: parameter.dataType === "DATETIME"
                                  ? calendar === "ROC" ? "yyy/MM/dd HH:mm:ss" : "yyyy-MM-dd HH:mm:ss"
                                  : calendar === "ROC" ? "yyy/MM/dd" : "yyyy-MM-dd",
                              });
                            }}>
                            <option value="GREGORIAN">西元</option>
                            <option value="ROC">民國</option>
                          </select>
                        </label>

                        <label>常用格式
                          <select
                            value={dateFormats.includes(parameter.dateFormat ?? "") ? parameter.dateFormat ?? "" : "CUSTOM"}
                            onChange={(e) => {
                              if (e.target.value !== "CUSTOM") update(index, { dateFormat: e.target.value });
                            }}
                          >
                            {dateFormats.map((format) => <option key={format} value={format}>{format}</option>)}
                            <option value="CUSTOM">自訂格式</option>
                          </select>
                        </label>

                        <label>日期格式
                          <input
                            value={parameter.dateFormat ?? ""}
                            placeholder={parameter.dateCalendar === "ROC" ? "yyyMMdd" : "yyyyMMdd"}
                            onChange={(e) => update(index, { dateFormat: e.target.value })}
                          />
                          <small>支援 y、M、d、H、m、s 與 / - : 分隔符號。</small>
                        </label>
                      </div>
                    )}

                    <div className="date-preview">
                      <span>即時預覽</span>
                      <div><small>原始日期</small><strong>{preview?.source || "—"}</strong></div>
                      <div><small>實際送出</small><strong>{preview?.output || "—"}</strong></div>
                    </div>
                  </div>
                )}

                {["SELECT","MULTISELECT"].includes(parameter.controlType) && (
                  <div className="option-config">
                    <label>選項來源
                      <select value={parameter.optionMode}
                        onChange={(e) => update(index, {
                          optionMode: e.target.value as ParameterRow["optionMode"],
                          fixedOptionsJson: null,
                          lookupDatasetId: null,
                          lookupValueField: null,
                          lookupLabelField: null,
                        })}>
                        <option value="NONE">未設定</option>
                        <option value="FIXED">固定選項</option>
                        <option value="DATASET">由 Dataset 載入</option>
                      </select>
                    </label>

                    {parameter.optionMode === "FIXED" && (
                      <label>固定選項 JSON
                        <textarea
                          spellCheck={false}
                          placeholder={'[{"value":"A","label":"選項 A"},{"value":"B","label":"選項 B"}]'}
                          value={parameter.fixedOptionsJson ?? ""}
                          onChange={(e) => update(index, { fixedOptionsJson: e.target.value })}
                        />
                      </label>
                    )}

                    {parameter.optionMode === "DATASET" && (
                      <div className="parameter-form-grid">
                        <label>Lookup Dataset
                          <select value={parameter.lookupDatasetId ?? ""}
                            onChange={(e) => update(index, {
                              lookupDatasetId: e.target.value ? Number(e.target.value) : null,
                            })}>
                            <option value="">請選擇</option>
                            {datasets.filter((dataset) => dataset.id !== datasetId).map((dataset) => (
                              <option key={dataset.id} value={dataset.id}>{dataset.name} ({dataset.code})</option>
                            ))}
                          </select>
                        </label>
                        <label>Value 欄位
                          <input value={parameter.lookupValueField ?? ""}
                            onChange={(e) => update(index, { lookupValueField: e.target.value })} />
                        </label>
                        <label>Label 欄位
                          <input value={parameter.lookupLabelField ?? ""}
                            onChange={(e) => update(index, { lookupLabelField: e.target.value })} />
                        </label>
                      </div>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      {parameters.length > 0 && (
        <button className="primary-button" type="button" disabled={saving} onClick={() => void save()}>
          {saving ? "儲存中…" : "儲存參數設定"}
        </button>
      )}
    </section>
  );
}
