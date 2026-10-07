import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import "./DatasetParametersEditor.css";

type DatasetOption = {
  id: number;
  code: string;
  name: string;
};

type ParameterRow = {
  id: number;
  datasetId: number;
  name: string;
  label: string;
  dataType: "STRING" | "NUMBER" | "DATE" | "DATETIME" | "BOOLEAN";
  controlType: "TEXT" | "NUMBER" | "DATE" | "DATETIME" | "SELECT" | "MULTISELECT" | "CHECKBOX";
  isRequired: boolean;
  defaultValue: string | null;
  displayOrder: number;
  placeholder: string | null;
  helpText: string | null;
  optionMode: "NONE" | "FIXED" | "DATASET";
  fixedOptionsJson: string | null;
  lookupDatasetId: number | null;
  lookupValueField: string | null;
  lookupLabelField: string | null;
};

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
      setParameters(result.parameters);
      await onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "載入參數設定失敗。");
    } finally {
      setLoading(false);
    }
  }, [accessToken, datasetId, onChanged]);

  useEffect(() => { void load(); }, [load]);

  function update(index: number, patch: Partial<ParameterRow>) {
    setParameters((rows) => rows.map((row, i) => i === index ? { ...row, ...patch } : row));
  }

  function applyControlDefaults(index: number, controlType: ParameterRow["controlType"]) {
    const patch: Partial<ParameterRow> = { controlType };

    if (controlType === "NUMBER") patch.dataType = "NUMBER";
    if (controlType === "DATE") patch.dataType = "DATE";
    if (controlType === "DATETIME") patch.dataType = "DATETIME";
    if (controlType === "CHECKBOX") patch.dataType = "BOOLEAN";

    if (!["SELECT","MULTISELECT"].includes(controlType)) {
      patch.optionMode = "NONE";
      patch.fixedOptionsJson = null;
      patch.lookupDatasetId = null;
      patch.lookupValueField = null;
      patch.lookupLabelField = null;
    }

    update(index, patch);
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
      setNotice("參數設定已儲存。");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "儲存參數設定失敗。");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <section className="parameter-designer"><div className="notice">參數載入中…</div></section>;

  return (
    <section className="parameter-designer">
      <div className="section-title">
        <div>
          <h2>Parameter Designer</h2>
          <p>SQL Token 會自動同步，不需手動新增或刪除。DATE 建議使用 YYYY-MM-DD；Bind Parameter 外面不要加單引號。</p>
        </div>
        <button className="secondary-button" type="button" onClick={() => void load()}>重新同步</button>
      </div>

      {error && <div className="form-error">{error}</div>}
      {notice && <div className="notice">{notice}</div>}

      {parameters.length === 0 ? (
        <div className="empty-state">此 Dataset 沒有 <code>{"{{PARAM}}"}</code> 參數。</div>
      ) : (
        <div className="parameter-card-list">
          {parameters.map((parameter, index) => (
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

                <label>預設值
                  <input
                    type={
                      parameter.dataType === "NUMBER" ? "number" :
                      parameter.dataType === "DATE" ? "date" :
                      parameter.dataType === "DATETIME" ? "datetime-local" :
                      "text"
                    }
                    placeholder={
                      parameter.dataType === "BOOLEAN" ? "true / false" :
                      parameter.dataType === "DATE" ? "YYYY-MM-DD" :
                      ""
                    }
                    value={parameter.defaultValue ?? ""}
                    onChange={(e) => update(index, { defaultValue: e.target.value })}
                  />
                </label>

                <label>Placeholder
                  <input value={parameter.placeholder ?? ""}
                    onChange={(e) => update(index, { placeholder: e.target.value })} />
                </label>

                <label>說明
                  <input value={parameter.helpText ?? ""}
                    onChange={(e) => update(index, { helpText: e.target.value })} />
                </label>
              </div>

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
          ))}
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
